#!/usr/bin/env python3
"""
Extract WeChat SQLCipher key from process memory on macOS.
Uses lldb Python API to attach to WeChat and search for the DB salt,
then examines nearby memory for the 32-byte encryption key.

Usage: sudo python3 extract_key_mac.py
"""

import subprocess
import os
import sys
import json
import struct

def get_wechat_pid():
    try:
        out = subprocess.check_output(['pgrep', '-x', 'WeChat']).decode().strip()
        pids = out.split('\n')
        return int(pids[0])
    except Exception:
        return None

def find_db_storage():
    home = os.path.expanduser('~')
    base = os.path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files')
    if not os.path.isdir(base):
        return None
    for entry in os.listdir(base):
        if entry == 'all_users':
            continue
        candidate = os.path.join(base, entry, 'db_storage')
        if os.path.isdir(candidate):
            return candidate
    return None

def get_salt(db_path):
    with open(db_path, 'rb') as f:
        return f.read(16)

def try_key_on_db(db_path, key_hex):
    """Test if a key can decrypt a database using sqlcipher CLI or Python."""
    # Try sqlcipher CLI
    try:
        result = subprocess.run(
            ['sqlcipher', db_path,
             f"PRAGMA key = \"x'{key_hex}'\";",
             'PRAGMA cipher_compatibility = 4;',
             'SELECT count(*) FROM sqlite_master;'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            count = result.stdout.strip().split('\n')[-1]
            if count.isdigit() and int(count) > 0:
                return True
    except FileNotFoundError:
        pass
    except Exception:
        pass

    # Try pysqlcipher3
    try:
        import pysqlcipher3.dbapi2 as sqlcipher
        conn = sqlcipher.connect(db_path)
        conn.execute(f"PRAGMA key = \"x'{key_hex}'\"")
        conn.execute("PRAGMA cipher_compatibility = 4")
        cursor = conn.execute("SELECT count(*) FROM sqlite_master")
        count = cursor.fetchone()[0]
        conn.close()
        return count > 0
    except Exception:
        pass

    return False

def search_with_lldb(pid, salt_hex):
    """Use lldb CLI to search for salt in memory and dump nearby regions."""
    print(f"Attaching lldb to PID {pid}...")

    # Create lldb command script
    lldb_script = f"""
process attach --pid {pid}
script
import lldb

target = lldb.debugger.GetSelectedTarget()
process = target.GetProcess()
salt = bytes.fromhex("{salt_hex}")
found = []

regions = process.GetMemoryRegions()
total_scanned = 0

for i in range(regions.GetSize()):
    ri = lldb.SBMemoryRegionInfo()
    regions.GetMemoryRegionAtIndex(i, ri)
    if not ri.IsReadable():
        continue
    base = ri.GetRegionBase()
    size = ri.GetRegionEnd() - base
    if size > 100*1024*1024 or size == 0:
        continue
    err = lldb.SBError()
    data = process.ReadMemory(base, size, err)
    if not err.Success() or not data:
        continue
    total_scanned += len(data)
    idx = data.find(salt)
    while idx >= 0:
        found.append(base + idx)
        idx = data.find(salt, idx + 1)

print(f"SCAN_RESULT:scanned={total_scanned},found={len(found)}")

for addr in found[:30]:
    for off in range(-512, 513, 16):
        raddr = addr + off
        if raddr < 0:
            continue
        err2 = lldb.SBError()
        chunk = process.ReadMemory(raddr, 32, err2)
        if err2.Success() and chunk and len(chunk) == 32:
            unique = len(set(chunk))
            if unique > 18:
                print(f"CANDIDATE:0x{{raddr:x}},{{off}},{{chunk.hex()}},{{unique}}")

process.Detach()
quit
"""

    script_path = '/tmp/lldb_wechat.txt'
    with open(script_path, 'w') as f:
        f.write(lldb_script)

    result = subprocess.run(
        ['lldb', '--batch', '--source', script_path],
        capture_output=True, text=True, timeout=120
    )

    output = result.stdout + '\n' + result.stderr
    return output

def parse_candidates(lldb_output):
    """Parse CANDIDATE lines from lldb output."""
    candidates = []
    for line in lldb_output.split('\n'):
        if line.startswith('CANDIDATE:'):
            parts = line[len('CANDIDATE:'):].split(',')
            if len(parts) >= 4:
                candidates.append({
                    'addr': parts[0],
                    'offset': int(parts[1]),
                    'hex': parts[2],
                    'entropy': int(parts[3]),
                })
    return candidates

def main():
    pid = get_wechat_pid()
    if not pid:
        print("ERROR: WeChat is not running")
        sys.exit(1)
    print(f"WeChat PID: {pid}")

    db_storage = find_db_storage()
    if not db_storage:
        print("ERROR: WeChat data directory not found")
        sys.exit(1)
    print(f"DB storage: {db_storage}")

    contact_db = os.path.join(db_storage, 'contact', 'contact.db')
    if not os.path.exists(contact_db):
        print(f"ERROR: {contact_db} not found")
        sys.exit(1)

    salt = get_salt(contact_db)
    salt_hex = salt.hex()
    print(f"contact.db salt: {salt_hex}")

    # Search memory
    output = search_with_lldb(pid, salt_hex)

    # Check scan result
    for line in output.split('\n'):
        if 'SCAN_RESULT:' in line:
            print(line)

    # Parse candidates
    candidates = parse_candidates(output)
    print(f"\nFound {len(candidates)} key candidates")

    if not candidates:
        print("\nNo candidates found. Full lldb output:")
        print(output[-2000:])
        sys.exit(1)

    # Deduplicate by hex value
    seen = set()
    unique_candidates = []
    for c in candidates:
        if c['hex'] not in seen:
            seen.add(c['hex'])
            unique_candidates.append(c)

    print(f"Unique candidates: {len(unique_candidates)}")

    # Test each candidate against the actual database
    print("\nTesting candidates against contact.db...")
    for i, c in enumerate(unique_candidates[:50]):
        key_hex = c['hex']
        if try_key_on_db(contact_db, key_hex):
            print(f"\n{'='*60}")
            print(f"KEY FOUND!")
            print(f"Key: {key_hex}")
            print(f"Address: {c['addr']}, offset from salt: {c['offset']}")
            print(f"{'='*60}")

            # Save to file
            result = {
                'key': key_hex,
                'address': c['addr'],
                'salt': salt_hex,
                'pid': pid,
                'db_storage': db_storage,
            }
            out_path = os.path.join(os.path.dirname(__file__), 'wechat_key.json')
            with open(out_path, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"Saved to {out_path}")
            return

        if (i + 1) % 10 == 0:
            print(f"  Tested {i+1}/{len(unique_candidates)} candidates...")

    print("\nNo working key found among candidates.")
    print("The key pattern may be different for this WeChat version.")
    sys.exit(1)

if __name__ == '__main__':
    main()
