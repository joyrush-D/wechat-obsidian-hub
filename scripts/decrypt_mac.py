#!/usr/bin/env python3
"""
Decrypt WeChat SQLCipher 4.x databases on macOS.
Keys from wechat-decrypt are ALREADY the derived AES keys (post-PBKDF2).
No key derivation needed — use directly for AES-256-CBC decryption.

Usage: python3 decrypt_mac.py [--keys-file ~/all_keys.json] [--output DIR]
"""

import json
import os
import sqlite3
import struct
import sys

from Crypto.Cipher import AES

PAGE_SIZE = 4096
RESERVE_SIZE = 48  # IV(16) + HMAC(20) + padding(12)
SALT_SIZE = 16
SQLITE_HEADER = b'SQLite format 3\x00'


def decrypt_page(page_data: bytes, enc_key: bytes, page_num: int) -> bytes:
    """Decrypt a single SQLCipher 4.x page using the raw AES key."""
    if len(page_data) != PAGE_SIZE:
        return page_data

    # IV is at offset PAGE_SIZE - RESERVE_SIZE (16 bytes)
    iv_offset = PAGE_SIZE - RESERVE_SIZE
    iv = page_data[iv_offset:iv_offset + 16]

    if page_num == 1:
        # Page 1: first 16 bytes are salt (unencrypted), rest is encrypted
        ciphertext = page_data[SALT_SIZE:iv_offset]
    else:
        ciphertext = page_data[:iv_offset]

    cipher = AES.new(enc_key, AES.MODE_CBC, iv)
    plaintext = cipher.decrypt(ciphertext)

    if page_num == 1:
        # Reconstruct page 1: SQLite header + decrypted content + reserve
        # The decrypted content starts after the salt-sized portion
        return SQLITE_HEADER + plaintext[16 - SALT_SIZE:] + b'\x00' * RESERVE_SIZE
    else:
        return plaintext + b'\x00' * RESERVE_SIZE


def decrypt_database(src_path: str, dst_path: str, key_hex: str) -> bool:
    """Decrypt a full SQLCipher 4.x database."""
    name = os.path.basename(src_path)
    try:
        with open(src_path, 'rb') as f:
            data = f.read()

        if len(data) < PAGE_SIZE:
            print(f"  SKIP: {name} (too small)")
            return False

        enc_key = bytes.fromhex(key_hex)
        if len(enc_key) != 32:
            print(f"  FAIL: {name} — key must be 32 bytes, got {len(enc_key)}")
            return False

        total_pages = len(data) // PAGE_SIZE
        pages = []
        for i in range(total_pages):
            page = data[i * PAGE_SIZE:(i + 1) * PAGE_SIZE]
            pages.append(decrypt_page(page, enc_key, i + 1))

        result = b''.join(pages)

        os.makedirs(os.path.dirname(dst_path) or '.', exist_ok=True)
        with open(dst_path, 'wb') as f:
            f.write(result)

        # Verify
        try:
            conn = sqlite3.connect(dst_path)
            tables = conn.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()[0]
            conn.close()
            size_kb = len(data) // 1024
            print(f"  OK: {name} → {tables} tables ({size_kb} KB)")
            return True
        except Exception as e:
            print(f"  FAIL: {name} — decrypted file not valid SQLite: {e}")
            os.remove(dst_path)
            return False

    except Exception as e:
        print(f"  FAIL: {name} — {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Decrypt WeChat databases")
    parser.add_argument('--output', default=os.path.expanduser('~/.wechat-hub/decrypted'))
    parser.add_argument('--keys-file', default=os.path.expanduser('~/all_keys.json'))
    args = parser.parse_args()

    if not os.path.exists(args.keys_file):
        print(f"ERROR: {args.keys_file} not found")
        print("Run: sudo ~/wechat-decrypt/find_all_keys_macos")
        sys.exit(1)

    with open(args.keys_file) as f:
        keys_data = json.load(f)

    # Find db_storage
    home = os.path.expanduser('~')
    base = os.path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files')
    db_storage = None
    for entry in os.listdir(base):
        if entry == 'all_users':
            continue
        candidate = os.path.join(base, entry, 'db_storage')
        if os.path.isdir(candidate):
            db_storage = candidate
            break

    if not db_storage:
        print("ERROR: WeChat db_storage not found")
        sys.exit(1)

    print(f"Source: {db_storage}")
    print(f"Output: {args.output}")
    os.makedirs(args.output, exist_ok=True)

    # Build key map
    key_map = {}
    for db_path, info in keys_data.items():
        if isinstance(info, dict):
            key_map[db_path] = info.get('enc_key', '')
        elif isinstance(info, str):
            key_map[db_path] = info

    print(f"Keys: {len(key_map)}\n")

    success = 0
    for rel_path, key_hex in key_map.items():
        if not key_hex:
            continue
        src = os.path.join(db_storage, rel_path)
        if not os.path.exists(src):
            continue
        dst = os.path.join(args.output, os.path.basename(rel_path))
        if decrypt_database(src, dst, key_hex):
            success += 1

    print(f"\nDecrypted {success}/{len(key_map)} → {args.output}")
    return 0 if success > 0 else 1


if __name__ == '__main__':
    sys.exit(main())
