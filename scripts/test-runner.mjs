/**
 * Standalone test runner for OWH plugin core logic.
 * Runs on Mac via: node test-runner.mjs
 * Tests: DB loading → message parsing → LM Studio → briefing output
 * Outputs: briefing file size (bytes) as the metric
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const HOME = process.env.HOME || '/Users/joyrush';
const DB_DIR = join(HOME, '.wechat-hub/decrypted');
const OUTPUT_DIR = join(HOME, 'Documents/WeChat-Briefings');
const LM_ENDPOINT = 'http://localhost:1234/v1';

async function main() {
  try {
    // 1. Init sql.js
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    console.log('sql.js initialized');

    // 2. Load contacts
    const contactPath = join(DB_DIR, 'contact', 'contact.db');
    if (!existsSync(contactPath)) {
      console.log('METRIC:0');
      console.error('contact.db not found');
      process.exit(1);
    }
    const contactDb = new SQL.Database(new Uint8Array(readFileSync(contactPath)));
    const contacts = {};
    const contactRows = contactDb.exec('SELECT username, nick_name, remark FROM contact WHERE username IS NOT NULL');
    if (contactRows.length > 0) {
      for (const row of contactRows[0].values) {
        contacts[row[0]] = row[2] || row[1] || row[0];
      }
    }
    console.log(`Contacts: ${Object.keys(contacts).length}`);
    contactDb.close();

    // 3. Load messages
    const msgDir = join(DB_DIR, 'message');
    const msgFiles = readdirSync(msgDir).filter(f => f.startsWith('message_') && f.endsWith('.db') && !f.includes('fts') && !f.includes('resource'));

    const cutoff = Math.floor(Date.now() / 1000) - 86400;
    const allMessages = [];

    for (const file of msgFiles) {
      const msgDb = new SQL.Database(new Uint8Array(readFileSync(join(msgDir, file))));

      // Load Name2Id
      const name2id = {};
      try {
        const n2iRows = msgDb.exec('SELECT rowid, user_name FROM Name2Id');
        if (n2iRows.length > 0) {
          for (const row of n2iRows[0].values) {
            if (row[1]) name2id[row[0]] = row[1];
          }
        }
      } catch {}

      // Find Msg_ tables
      const tableRows = msgDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'");
      if (tableRows.length === 0) { msgDb.close(); continue; }

      for (const [tableName] of tableRows[0].values) {
        // Check if WCDB_CT column exists
        const colInfo = msgDb.exec(`PRAGMA table_info([${tableName}])`);
        const hasWcdbCt = colInfo.length > 0 && colInfo[0].values.some(c => c[1] === 'WCDB_CT_message_content');

        const cols = 'local_type, create_time, real_sender_id, message_content' + (hasWcdbCt ? ', WCDB_CT_message_content' : '');

        let rows;
        try {
          rows = msgDb.exec(`SELECT ${cols} FROM [${tableName}] WHERE create_time >= ${cutoff} ORDER BY create_time LIMIT 500`);
        } catch { continue; }

        if (rows.length === 0) continue;

        for (const row of rows[0].values) {
          const localType = row[0];
          const createTime = row[1];
          const senderId = row[2];
          let content = row[3];
          const wcdbCt = hasWcdbCt ? row[4] : 0;
          const baseType = localType & 0xFFFF;

          // Decompress WCDB content if needed
          if (wcdbCt && wcdbCt > 0 && content instanceof Uint8Array) {
            try {
              // Use zstd CLI for decompression (simpler than loading WASM in test)
              const tmpIn = '/tmp/owh_decompress_in';
              const tmpOut = '/tmp/owh_decompress_out';
              writeFileSync(tmpIn, Buffer.from(content));
              execSync(`zstd -d -f "${tmpIn}" -o "${tmpOut}" 2>/dev/null`, { timeout: 5000 });
              content = readFileSync(tmpOut, 'utf-8');
            } catch {
              content = null;
            }
          } else if (content instanceof Uint8Array) {
            content = new TextDecoder('utf-8', { fatal: false }).decode(content);
          }

          if (!content || typeof content !== 'string') continue;

          // Parse sender
          let senderWxid = typeof senderId === 'number' ? (name2id[senderId] || String(senderId)) : String(senderId);
          let text = content;

          // For text messages, extract sender from "wxid:\ncontent" format
          if (baseType === 1) {
            const match = content.match(/^([a-zA-Z0-9_-]+):\s*([\s\S]*)$/);
            if (match) {
              senderWxid = match[1];
              text = match[2].trim();
            }
          } else if (baseType === 49) {
            // App message - extract title
            const titleMatch = content.match(/<title>([^<]+)<\/title>/);
            text = titleMatch ? `[链接] ${titleMatch[1]}` : '[App消息]';
          } else if (baseType === 3) {
            text = '[图片]';
          } else if (baseType === 34) {
            text = '[语音]';
          } else if (baseType === 43) {
            text = '[视频]';
          } else if (baseType === 47) {
            continue; // skip emoji
          } else if (baseType === 10000 || baseType === 10002) {
            continue; // skip system
          }

          const senderName = contacts[senderWxid] || senderWxid;
          const time = new Date(createTime * 1000);
          const timeStr = time.toTimeString().slice(0, 5);

          allMessages.push({ time: timeStr, sender: senderName, text: text.slice(0, 200), type: baseType });
        }
      }
      msgDb.close();
    }

    console.log(`Messages (24h): ${allMessages.length}`);

    if (allMessages.length === 0) {
      console.log('METRIC:0');
      console.error('No messages found');
      process.exit(1);
    }

    // 4. Build prompt (batch: top 200 messages)
    const sample = allMessages.slice(0, 200);
    const lines = sample.map(m => {
      let line = `[${m.time}] ${m.sender}: ${m.text}`;
      return line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
    });

    const prompt = `你是微信消息助手。请总结以下对话的要点，用中文简洁输出。
按话题分组，列出重要讨论、待办事项、分享的链接。

${lines.join('\n')}`;

    console.log(`Prompt: ${prompt.length} chars`);

    // 5. Call LM Studio
    console.log('Calling LM Studio...');
    const resp = await fetch(`${LM_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`LM Studio ${resp.status}: ${errBody.slice(0, 200)}`);
      console.log('METRIC:0');
      process.exit(1);
    }

    const data = await resp.json();
    const briefingContent = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';

    if (!briefingContent) {
      console.error('Empty response from LM Studio');
      console.log('METRIC:0');
      process.exit(1);
    }

    // 6. Write briefing
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const filePath = join(OUTPUT_DIR, `${today}.md`);
    const fullContent = `# 微信每日简报 — ${today}\n\n> ${allMessages.length} 条消息，${sample.length} 条已分析\n\n---\n\n${briefingContent}`;
    writeFileSync(filePath, fullContent, 'utf-8');

    const fileSize = Buffer.byteLength(fullContent, 'utf-8');
    console.log(`Briefing saved: ${filePath} (${fileSize} bytes)`);
    console.log(`METRIC:${fileSize}`);

  } catch (e) {
    console.error(`Error: ${e.message}`);
    console.log('METRIC:0');
    process.exit(1);
  }
}

main();
