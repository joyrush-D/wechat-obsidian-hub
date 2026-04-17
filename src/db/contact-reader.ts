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
}
