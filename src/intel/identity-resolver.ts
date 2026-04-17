/**
 * Identity Resolver — authoritative person index.
 *
 * Problem: one WeChat user has multiple names:
 *   - wxid (authoritative ID)
 *   - nick_name (their global nickname)
 *   - remark (alias you set for them)
 *   - per-group nicknames (different in each group they're in)
 *
 * Without resolution, the system can't tell "Dexter", "罗俊", "罗舒扬爸爸",
 * "猫大师" all refer to the same person.
 *
 * This module builds a complete alias → wxid index at load time, and exposes
 * lookup by ANY alias to retrieve the authoritative wxid + all known names.
 */

import type { ContactReader } from '../db/contact-reader';

export interface Identity {
  wxid: string;                    // authoritative ID
  primaryName: string;             // best display name (remark > nickname > wxid)
  allNames: Set<string>;           // every alias known
  isGroup: boolean;
  hasRemark: boolean;
}

export class IdentityResolver {
  /** alias (any name) → wxid */
  private aliasToWxid: Map<string, string> = new Map();
  /** wxid → Identity */
  private identities: Map<string, Identity> = new Map();

  constructor(contactReader: ContactReader) {
    this.buildFromContacts(contactReader);
    this.addGroupAliases(contactReader);
  }

  private buildFromContacts(reader: ContactReader): void {
    for (const c of reader.getAllContacts()) {
      const names = new Set<string>([c.username]);
      if (c.nickName) names.add(c.nickName);
      if (c.remark) names.add(c.remark);

      const primaryName = c.remark || c.nickName || c.username;
      this.identities.set(c.username, {
        wxid: c.username,
        primaryName,
        allNames: names,
        isGroup: c.isGroup,
        hasRemark: !!c.remark,
      });

      for (const name of names) this.registerAlias(name, c.username);
    }
  }

  /**
   * Extract per-group aliases from chat_room.ext_buffer.
   * Each group entry has a map {member_wxid -> group_specific_nickname}.
   * We expand the Identity.allNames for every (wxid, group_nickname) pair.
   */
  private addGroupAliases(reader: ContactReader): void {
    // Use the existing ext_buffer parser in ContactReader.extractUserGroupAliases,
    // but extend to every member, not just user.
    // Since extractUserGroupAliases is user-specific, we parse ourselves here:
    const db = (reader as any).db;
    if (!db) return;

    try {
      const results = db.exec('SELECT username, ext_buffer FROM chat_room WHERE ext_buffer IS NOT NULL');
      if (results.length === 0) return;

      for (const row of results[0].values) {
        const buf = row[1] as Uint8Array;
        if (!buf || buf.length === 0) continue;

        parseAllMembers(buf).forEach(({ wxid, nickname }) => {
          if (!wxid || !nickname) return;
          const nickTrim = nickname.trim();
          if (!nickTrim) return;

          // Add this nickname to the identity (or create a stub identity)
          const identity = this.identities.get(wxid);
          if (identity) {
            identity.allNames.add(nickTrim);
            // Upgrade primaryName if the contact had no remark/nick
            if (!identity.hasRemark && identity.primaryName === wxid) {
              identity.primaryName = nickTrim;
            }
          } else {
            // Stranger group member (not in your direct contacts but you see them in groups)
            const stub: Identity = {
              wxid,
              primaryName: nickTrim,
              allNames: new Set([wxid, nickTrim]),
              isGroup: false,
              hasRemark: false,
            };
            this.identities.set(wxid, stub);
          }

          this.registerAlias(nickTrim, wxid);
        });
      }
    } catch (e) {
      console.error('OWH: IdentityResolver group alias parsing failed:', e);
    }
  }

  private registerAlias(alias: string, wxid: string): void {
    const key = alias.trim().toLowerCase();
    if (!key) return;
    // Prefer first writer wins — but prefer "has contact remark" over stranger
    const existing = this.aliasToWxid.get(key);
    if (!existing) {
      this.aliasToWxid.set(key, wxid);
    }
  }

  /**
   * Look up a person by ANY name they could be known as.
   * Returns the Identity (authoritative) or null.
   */
  findByName(name: string): Identity | null {
    const wxid = this.aliasToWxid.get(name.trim().toLowerCase());
    if (!wxid) return null;
    return this.identities.get(wxid) || null;
  }

  /** Direct wxid lookup. */
  get(wxid: string): Identity | null {
    return this.identities.get(wxid) || null;
  }

  /**
   * Return ALL names (including per-group aliases) for a given wxid.
   * Use this for scanning @ mentions: search for each name in message text.
   */
  getAllNames(wxid: string): string[] {
    const id = this.identities.get(wxid);
    if (!id) return [];
    return [...id.allNames];
  }

  /** Iterate all known identities. */
  allIdentities(): Identity[] {
    return [...this.identities.values()];
  }

  /** Size statistics for debugging. */
  stats(): { identities: number; aliases: number; withRemark: number } {
    let withRemark = 0;
    for (const id of this.identities.values()) if (id.hasRemark) withRemark++;
    return {
      identities: this.identities.size,
      aliases: this.aliasToWxid.size,
      withRemark,
    };
  }
}

// ============================================================================
// Protobuf parsing (shared logic — also lives in contact-reader.ts)
// ============================================================================

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos];
    pos++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7;
    if (shift > 35) break;
  }
  return [result, pos];
}

function parseAllMembers(buf: Uint8Array): Array<{ wxid: string; nickname: string }> {
  const members: Array<{ wxid: string; nickname: string }> = [];
  let pos = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (pos < buf.length) {
    try {
      const [tag, newPos] = readVarint(buf, pos);
      pos = newPos;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;

      if (wireType === 2) {
        const [length, lenPos] = readVarint(buf, pos);
        pos = lenPos;
        const sub = buf.slice(pos, pos + length);
        pos += length;
        if (fieldNum === 1) {
          let wxid = '', nickname = '';
          let subPos = 0;
          while (subPos < sub.length) {
            try {
              const [subTag, np] = readVarint(sub, subPos);
              subPos = np;
              const fn = subTag >> 3;
              const wt = subTag & 0x7;
              if (wt === 2) {
                const [l, lp] = readVarint(sub, subPos);
                subPos = lp;
                const val = sub.slice(subPos, subPos + l);
                subPos += l;
                if (fn === 1 && !wxid) wxid = decoder.decode(val);
                else if (fn === 2 && !nickname) nickname = decoder.decode(val);
              } else if (wt === 0) {
                const [, vp] = readVarint(sub, subPos);
                subPos = vp;
              } else break;
            } catch { break; }
          }
          if (wxid) members.push({ wxid, nickname });
        }
      } else if (wireType === 0) {
        const [, vPos] = readVarint(buf, pos);
        pos = vPos;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return members;
}
