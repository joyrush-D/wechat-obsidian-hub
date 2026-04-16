import type { Database } from 'sql.js';
import type { Contact } from '../types';

export class ContactReader {
  private contacts: Map<string, Contact> = new Map();

  constructor(private db: Database) {
    this.loadContacts();
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

  getAllContacts(): Contact[] { return Array.from(this.contacts.values()); }
  getContact(username: string): Contact | undefined { return this.contacts.get(username); }
  getDisplayName(username: string): string {
    const c = this.contacts.get(username);
    if (!c) return username;
    return c.remark || c.nickName || username;
  }
  count(): number { return this.contacts.size; }
}
