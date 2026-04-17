#!/usr/bin/env python3
"""
E2E metric for autoresearch: simulates plugin pipeline, outputs briefing file size.
Runs on Mac: python3 verify_metric.py
Output: single integer (file size in bytes, 0 = failure)
"""
import sqlite3, os, time, json, re, sys, urllib.request
import zstandard as zstd

HOME = os.path.expanduser("~")
DB_DIR = os.path.join(HOME, ".wechat-hub/decrypted")
OUTPUT_DIR = os.path.join(HOME, "Documents/WeChat-Briefings")
LM_ENDPOINT = "http://localhost:1234/v1"

def main():
    dctx = zstd.ZstdDecompressor()

    # 1. Contacts
    cdb = sqlite3.connect(os.path.join(DB_DIR, "contact", "contact.db"))
    contacts = {}
    for row in cdb.execute("SELECT username, nick_name, remark FROM contact WHERE username IS NOT NULL"):
        contacts[row[0]] = row[2] or row[1] or row[0]
    cdb.close()

    # 2. Messages (24h)
    mdb = sqlite3.connect(os.path.join(DB_DIR, "message", "message_0.db"))
    name2id = {}
    try:
        for rowid, name in mdb.execute("SELECT rowid, user_name FROM Name2Id"):
            if name: name2id[rowid] = name
    except: pass

    tables = [r[0] for r in mdb.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")]
    cutoff = int(time.time()) - 86400
    msgs = []

    for tbl in tables:
        try:
            has_ct = any(c[1] == 'WCDB_CT_message_content' for c in mdb.execute(f"PRAGMA table_info([{tbl}])"))
            cols = "local_type, create_time, real_sender_id, message_content"
            if has_ct: cols += ", WCDB_CT_message_content"

            for row in mdb.execute(f"SELECT {cols} FROM [{tbl}] WHERE create_time >= ? ORDER BY create_time LIMIT 500", (cutoff,)):
                ltype, ts, sid, content = row[0], row[1], row[2], row[3]
                ct = row[4] if has_ct and len(row) > 4 else 0
                base = ltype & 0xFFFF

                if base in (47, 10000, 10002): continue

                # Decompress
                if ct and ct > 0 and isinstance(content, bytes):
                    try: content = dctx.decompress(content).decode("utf-8", errors="ignore")
                    except: continue
                elif isinstance(content, bytes):
                    content = content.decode("utf-8", errors="ignore")

                if not content: continue

                sender = name2id.get(sid, str(sid)) if isinstance(sid, int) else str(sid)
                text = content

                if base == 1:
                    m = re.match(r"^([a-zA-Z0-9_-]+):\s*(.*)", content, re.DOTALL)
                    if m: sender, text = m.group(1), m.group(2).strip()
                elif base == 49:
                    tm = re.search(r"<title>([^<]+)</title>", content)
                    text = f"[链接] {tm.group(1)}" if tm else "[App消息]"
                elif base == 3: text = "[图片]"
                elif base == 34: text = "[语音]"
                elif base == 43: text = "[视频]"

                name = contacts.get(sender, sender[:15])
                t = time.strftime("%H:%M", time.localtime(ts))
                clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text[:200])
                msgs.append(f"[{t}] {name}: {clean}")
        except: pass

    mdb.close()

    if not msgs:
        print("0")
        return

    # 3. Call LM Studio (batch of 200)
    prompt = f"你是微信消息助手。请总结以下对话要点，中文输出。按话题分组，列出重要讨论和链接。\n\n" + "\n".join(msgs[:200])

    try:
        req = urllib.request.Request(
            f"{LM_ENDPOINT}/chat/completions",
            data=json.dumps({"messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "max_tokens": 4096}).encode(),
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, timeout=180)
        data = json.loads(resp.read())
        result = data["choices"][0]["message"].get("content", "") or data["choices"][0]["message"].get("reasoning_content", "")
    except Exception as e:
        print("0", file=sys.stderr)
        print(f"LM Studio error: {e}", file=sys.stderr)
        print("0")
        return

    if not result:
        print("0")
        return

    # 4. Write briefing
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    path = os.path.join(OUTPUT_DIR, f"{today}.md")
    content = f"# 微信每日简报 — {today}\n\n> {len(msgs)} 条消息\n\n---\n\n{result}"
    with open(path, "w") as f:
        f.write(content)

    print(len(content.encode("utf-8")))

if __name__ == "__main__":
    main()
