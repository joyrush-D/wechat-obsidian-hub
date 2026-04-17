import type { Database } from 'sql.js';
import type { Contact } from '../types';
import { createHash } from 'crypto';

export class ContactReader {
  private contacts: Map<string, Contact> = new Map();
  /** MD5(username) → username — for reverse-looking up Msg_<hash> tables */
  private hashToUsername: Map<string, string> = new Map();

  constructor(private db: Database) {
    this.loadContacts();
    this.buildHashIndex();
  }

  private loadContacts(): void {
    const results = this.db.exec(
      'SELECT username, nick_name, remark FROM contact WHERE username IS NOT NULL'
    );
    if (results.length === 0) return;
    for (const row of results[0].values) {
      const username = row[0] as string;
      const nickName = (row[1] as string) || '';
      const remark = (row[2] as string) || '';
      this.contacts.set(username, {
        username, nickName, remark,
        isGroup: username.endsWith('@chatroom'),
      });
    }
  }

  /**
   * Build hash → username map so we can resolve Msg_<md5hex> table names
   * back to real chatroom/user identifiers.
   */
  private buildHashIndex(): void {
    for (const username of this.contacts.keys()) {
      const h = createHash('md5').update(username).digest('hex');
      this.hashToUsername.set(h, username);
    }
  }

  getAllContacts(): Contact[] { return Array.from(this.contacts.values()); }
  getContact(username: string): Contact | undefined { return this.contacts.get(username); }
  getDisplayName(username: string): string {
    const c = this.contacts.get(username);
    if (!c) return username;
    return c.remark || c.nickName || username;
  }
  count(): number { return this.contacts.size; }

  /**
   * Resolve an MD5 hash (the part after "Msg_" in table names) back to
   * the real chatroom/user username. Returns null if no match.
   */
  resolveHashToUsername(hash: string): string | null {
    return this.hashToUsername.get(hash) || null;
  }

  /**
   * Given a Msg_ table hash, return a friendly display name
   * (remark > nick_name > raw username > hash fallback).
   */
  resolveHashToDisplayName(hash: string): { name: string; username: string | null } {
    const username = this.hashToUsername.get(hash);
    if (!username) return { name: hash, username: null };
    const contact = this.contacts.get(username);
    const name = contact?.remark || contact?.nickName || username;
    return { name, username };
  }

  /**
   * Extract user's per-group nicknames from chat_room.ext_buffer.
   * In WeChat, each group has its own nickname for each member (protobuf encoded).
   * Returns the UNION of all nicknames the user has across all groups they're in.
   *
   * This is critical for @ detection: people @ you by the group-specific nickname,
   * not your global WeChat nickname.
   */
  extractUserGroupAliases(userWxid: string): Set<string> {
    const aliases = new Set<string>();
    if (!userWxid) return aliases;

    try {
      const results = this.db.exec('SELECT username, ext_buffer FROM chat_room WHERE ext_buffer IS NOT NULL');
      if (results.length === 0) return aliases;

      const userWxidBytes = new TextEncoder().encode(userWxid);

      for (const row of results[0].values) {
        const buf = row[1] as Uint8Array;
        if (!buf || buf.length === 0) continue;

        // Quick check: does this group's ext_buffer contain the userWxid?
        if (!containsBytes(buf, userWxidBytes)) continue;

        // Parse protobuf to find member entries where field 1 == userWxid
        parseGroupMembers(buf).forEach(({ wxid, nickname }) => {
          if (wxid === userWxid && nickname && nickname.trim()) {
            aliases.add(nickname.trim());
          }
        });
      }
    } catch (e) {
      console.error('OWH: extractUserGroupAliases failed:', e);
    }

    return aliases;
  }
}

// ============================================================================
// Protobuf parser helpers (no external dep)
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
    if (shift > 35) break;  // safety
  }
  return [result, pos];
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function parseGroupMembers(buf: Uint8Array): Array<{ wxid: string; nickname: string }> {
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
          // Member entry — parse sub for wxid (field 1) and nickname (field 2)
          const member = parseMemberEntry(sub, decoder);
          if (member.wxid) members.push(member);
        }
      } else if (wireType === 0) {
        const [, vPos] = readVarint(buf, pos);
        pos = vPos;
      } else {
        break;  // unknown wire type
      }
    } catch {
      break;
    }
  }
  return members;
}

function parseMemberEntry(buf: Uint8Array, decoder: TextDecoder): { wxid: string; nickname: string } {
  let wxid = '';
  let nickname = '';
  let pos = 0;
  while (pos < buf.length) {
    try {
      const [tag, newPos] = readVarint(buf, pos);
      pos = newPos;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;

      if (wireType === 2) {
        const [length, lenPos] = readVarint(buf, pos);
        pos = lenPos;
        const val = buf.slice(pos, pos + length);
        pos += length;
        if (fieldNum === 1 && !wxid) wxid = decoder.decode(val);
        else if (fieldNum === 2 && !nickname) nickname = decoder.decode(val);
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
  return { wxid, nickname };
}
