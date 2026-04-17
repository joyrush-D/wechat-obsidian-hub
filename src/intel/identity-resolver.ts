/**
 * Identity Resolver — authoritative person index.
 *
 * Problem: one WeChat user has multiple names:
 *   - wxid (authoritative ID)
 *   - nick_name (their global nickname)
 *   - remark (alias you set for them)
 *   - per-group nicknames (different in each group they're in)
 *
 * Without resolution, the system can't tell that multiple per-group
 * nicknames all refer to the same underlying person. Analyst output
 * must also ANNOTATE each multi-alias person with their ID and per-
 * group aliases so the reader can cross-reference original messages.
 */

import type { ContactReader } from '../db/contact-reader';

export interface Identity {
  wxid: string;                          // authoritative ID
  primaryName: string;                   // best display name (remark > nickname > wxid)
  globalNames: Set<string>;              // wxid + nickname + remark
  groupAliases: Map<string, string>;     // chatroomId → per-group nickname
  allNames: Set<string>;                 // globalNames ∪ groupAliases values (for @ scanning)
  isGroup: boolean;
  hasRemark: boolean;
}

export class IdentityResolver {
  /** alias (any name) → wxid */
  private aliasToWxid: Map<string, string> = new Map();
  /** wxid → Identity */
  private identities: Map<string, Identity> = new Map();
  /** chatroom wxid → display name (remark > nickName > wxid) */
  private groupDisplayNames: Map<string, string> = new Map();

  constructor(contactReader: ContactReader) {
    this.buildFromContacts(contactReader);
    this.addGroupAliases(contactReader);
  }

  private buildFromContacts(reader: ContactReader): void {
    for (const c of reader.getAllContacts()) {
      const globalNames = new Set<string>([c.username]);
      if (c.nickName) globalNames.add(c.nickName);
      if (c.remark) globalNames.add(c.remark);

      const primaryName = c.remark || c.nickName || c.username;
      const identity: Identity = {
        wxid: c.username,
        primaryName,
        globalNames,
        groupAliases: new Map(),
        allNames: new Set(globalNames),
        isGroup: c.isGroup,
        hasRemark: !!c.remark,
      };
      this.identities.set(c.username, identity);

      for (const name of globalNames) this.registerAlias(name, c.username);

      // Cache group display names for annotation output
      if (c.isGroup) {
        this.groupDisplayNames.set(c.username, primaryName);
      }
    }
  }

  /**
   * Extract per-group aliases from chat_room.ext_buffer.
   * Each group entry has a map {member_wxid -> group_specific_nickname}.
   * Store per (wxid, groupId) so we can annotate analyst output with
   * "她在 X 群叫 A，在 Y 群叫 B".
   */
  private addGroupAliases(reader: ContactReader): void {
    const db = (reader as any).db;
    if (!db) return;

    try {
      const results = db.exec('SELECT username, ext_buffer FROM chat_room WHERE ext_buffer IS NOT NULL');
      if (results.length === 0) return;

      for (const row of results[0].values) {
        const groupId = row[0] as string;
        const buf = row[1] as Uint8Array;
        if (!buf || buf.length === 0) continue;

        parseAllMembers(buf).forEach(({ wxid, nickname }) => {
          if (!wxid || !nickname) return;
          const nickTrim = nickname.trim();
          if (!nickTrim) return;

          let identity = this.identities.get(wxid);
          if (!identity) {
            // Stranger group member (not in your direct contacts)
            identity = {
              wxid,
              primaryName: nickTrim,
              globalNames: new Set([wxid]),
              groupAliases: new Map(),
              allNames: new Set([wxid, nickTrim]),
              isGroup: false,
              hasRemark: false,
            };
            this.identities.set(wxid, identity);
          }

          // Record per-group alias
          identity.groupAliases.set(groupId, nickTrim);
          identity.allNames.add(nickTrim);

          // Upgrade primaryName if we only had wxid before
          if (!identity.hasRemark && identity.primaryName === wxid) {
            identity.primaryName = nickTrim;
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
    // Prefer first writer wins — contact table wins over group alias collision
    if (!this.aliasToWxid.has(key)) {
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

  /**
   * Return per-group aliases for a wxid, with group display names resolved.
   * Used by formatters to render "X 群叫 A，Y 群叫 B".
   */
  getGroupAliasEntries(wxid: string): Array<{ groupName: string; alias: string }> {
    const id = this.identities.get(wxid);
    if (!id) return [];
    const out: Array<{ groupName: string; alias: string }> = [];
    for (const [groupId, alias] of id.groupAliases) {
      const groupName = this.groupDisplayNames.get(groupId) || groupId;
      out.push({ groupName, alias });
    }
    return out;
  }

  /** Iterate all known identities. */
  allIdentities(): Identity[] {
    return [...this.identities.values()];
  }

  /** Size statistics for debugging. */
  stats(): { identities: number; aliases: number; withRemark: number; multiAlias: number } {
    let withRemark = 0;
    let multiAlias = 0;
    for (const id of this.identities.values()) {
      if (id.hasRemark) withRemark++;
      if (id.allNames.size >= 3) multiAlias++;  // wxid + ≥2 names
    }
    return {
      identities: this.identities.size,
      aliases: this.aliasToWxid.size,
      withRemark,
      multiAlias,
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
