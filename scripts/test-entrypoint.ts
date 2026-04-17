/**
 * Standalone E2E test using REAL plugin modules.
 * Bundled by esbuild → run on Mac with Node.js.
 * Tests: DB load → message parse (with WCDB zstd) → LM Studio → briefing
 * Output: METRIC:<bytes> on stdout (briefing file size)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { DbConnector } from '../src/db/connector';
import { ContactReader } from '../src/db/contact-reader';
import { MessageReader } from '../src/db/message-reader';
import { parseMessage } from '../src/parser/index';
import { LlmClient } from '../src/ai/llm-client';
import { BriefingGenerator } from '../src/ai/briefing-generator';
import type { ParsedMessage } from '../src/types';

const HOME = process.env.HOME || '/Users/joyrush';
const DB_DIR = join(HOME, '.wechat-hub/decrypted');
const OUTPUT_DIR = join(HOME, 'Documents/WeChat-Briefings');
const TODAY = new Date().toISOString().slice(0, 10);
const LM_ENDPOINT = process.env.LM_ENDPOINT || 'http://localhost:1234/v1';

async function main() {
  const connector = new DbConnector();
  await connector.init();

  // Load contacts
  const contactDb = connector.loadFromBytes(new Uint8Array(readFileSync(join(DB_DIR, 'contact', 'contact.db'))));
  const contacts = new ContactReader(contactDb);
  console.log(`Contacts: ${contacts.count()}`);

  // Load messages
  const msgDir = join(DB_DIR, 'message');
  const msgFiles = readdirSync(msgDir).filter(f => f.endsWith('.db') && (f.startsWith('message_') || f.startsWith('biz_message_')) && !f.includes('fts') && !f.includes('resource'));

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const allMessages: ParsedMessage[] = [];

  for (const file of msgFiles) {
    const msgDb = connector.loadFromBytes(new Uint8Array(readFileSync(join(msgDir, file))));
    const reader = new MessageReader(msgDb);
    const tables = reader.getConversationTables();

    for (const table of tables) {
      const conversationId = table.replace(/^Msg_/, '');
      const contact = contacts.getContact(conversationId);
      const conversationName = contact?.remark || contact?.nickName || conversationId;

      const raws = reader.getMessages(table, since, 500);
      for (const raw of raws) {
        const parsed = parseMessage(raw);
        let senderWxid = parsed.senderWxid || '';
        if (!senderWxid || /^\d+$/.test(senderWxid)) {
          senderWxid = reader.resolveSenderId(raw.real_sender_id);
        }
        const senderContact = contacts.getContact(senderWxid);
        const sender = senderContact?.remark || senderContact?.nickName || senderWxid || conversationName;

        allMessages.push({
          localId: raw.local_id,
          time: new Date(raw.create_time * 1000),
          conversationId,
          conversationName,
          sender,
          senderWxid,
          text: parsed.text,
          type: parsed.type,
          extra: parsed.extra,
        });
      }
    }
  }

  console.log(`Messages (24h): ${allMessages.length}`);
  if (allMessages.length === 0) {
    console.log('METRIC:0');
    return;
  }

  // Generate briefing via real BriefingGenerator + LlmClient
  const llmClient = new LlmClient(LM_ENDPOINT, '');
  const isAvail = await llmClient.isAvailable();
  if (!isAvail) {
    console.error('LM Studio not available at', LM_ENDPOINT);
    console.log('METRIC:0');
    return;
  }

  const generator = new BriefingGenerator({ skipEmoji: true, skipSystemMessages: true });
  console.log('Generating briefing...');
  const briefing = await generator.generateProgressive(
    allMessages, llmClient, TODAY,
    async (content, done) => {
      if (done) console.log(`Progress: complete (${content.length} chars)`);
    }
  );

  // Save
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = join(OUTPUT_DIR, `${TODAY}.md`);
  writeFileSync(filePath, briefing, 'utf-8');
  const size = Buffer.byteLength(briefing, 'utf-8');
  console.log(`Saved: ${filePath} (${size} bytes)`);
  console.log(`METRIC:${size}`);
}

main().catch(e => {
  console.error('ERROR:', e.stack || e.message);
  console.log('METRIC:0');
  process.exit(1);
});
