#!/usr/bin/env python3
"""
decrypt.py — Mac WeChat SQLCipher database decryptor
Targets: macOS, WeChat 4.x (arm64)

Usage:
    python3 decrypt.py                        # auto-find key and decrypt
    python3 decrypt.py --key <64-char-hex>    # supply key manually
    python3 decrypt.py --list-dbs             # show discovered databases
    python3 decrypt.py --output ~/my/dir      # custom output dir
"""

import argparse
import glob
import hashlib
import json
import os
import platform
import sqlite3
import struct
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SQLCIPHER_PAGE_SIZE = 4096
SQLCIPHER_SALT_SIZE = 16
SQLCIPHER_RESERVE_SIZE = 48       # IV(16) + HMAC(20) + padding(12)
SQLCIPHER_IV_SIZE = 16
SQLCIPHER_HMAC_SIZE = 20
SQLCIPHER_KDF_ITER = 256000
SQLITE_HEADER = b"SQLite format 3\x00"

DEFAULT_OUTPUT_DIR = Path.home() / ".wechat-hub" / "decrypted"

# WeChat 4.x data path on Mac
WECHAT_DATA_GLOB = (
    "~/Library/Containers/com.tencent.xinWeChat"
    "/Data/Documents/xwechat_files/*/db_storage"
)

# Databases to decrypt, relative to db_storage/
TARGET_DBS = [
    "contact/contact.db",
    "message/message_0.db",
    "message/media_0.db",
]


# ---------------------------------------------------------------------------
# Platform guard
# ---------------------------------------------------------------------------

def _assert_mac() -> None:
    if platform.system() != "Darwin":
        _die(
            "This script must run on macOS.\n"
            "It targets WeChat for Mac (com.tencent.xinWeChat)."
        )


def _die(msg: str, code: int = 1) -> None:
    print(f"[ERROR] {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# Find WeChat data directories
# ---------------------------------------------------------------------------

def find_db_storage_dirs() -> list[Path]:
    """Expand the glob and return all db_storage directories found."""
    pattern = os.path.expanduser(WECHAT_DATA_GLOB)
    return [Path(p) for p in glob.glob(pattern) if Path(p).is_dir()]


def find_target_databases(db_storage_dirs: list[Path]) -> list[Path]:
    """Return existing target database paths from all db_storage dirs."""
    found: list[Path] = []
    for storage in db_storage_dirs:
        for rel in TARGET_DBS:
            candidate = storage / rel
            if candidate.exists():
                found.append(candidate)
    return found


# ---------------------------------------------------------------------------
# Key extraction helpers
# ---------------------------------------------------------------------------

def _get_wechat_pid() -> Optional[int]:
    """Return the first WeChat PID found via pgrep, or None."""
    try:
        result = subprocess.run(
            ["pgrep", "-x", "WeChat"],
            capture_output=True, text=True, timeout=5
        )
        pids = result.stdout.strip().splitlines()
        if pids:
            return int(pids[0])
    except (subprocess.SubprocessError, ValueError, FileNotFoundError):
        pass
    return None


def _extract_key_from_keychain() -> Optional[str]:
    """
    Try to read the SQLCipher key from the macOS Keychain.
    WeChat sometimes stores its DB key under the service name
    'com.tencent.xinWeChat' with account 'db_key' or similar.
    Returns a 64-char hex string, or None.
    """
    services_to_try = [
        ("com.tencent.xinWeChat", "db_key"),
        ("com.tencent.xinWeChat", "database_key"),
        ("com.tencent.xinWeChat.dbkey", ""),
    ]
    for service, account in services_to_try:
        try:
            cmd = ["security", "find-generic-password",
                   "-s", service, "-w"]
            if account:
                cmd += ["-a", account]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                candidate = result.stdout.strip()
                # Validate: 64 hex chars
                if len(candidate) == 64:
                    bytes.fromhex(candidate)   # raises ValueError if not hex
                    return candidate
        except (subprocess.SubprocessError, ValueError, FileNotFoundError):
            continue
    return None


def _extract_key_via_lldb(pid: int) -> Optional[str]:
    """
    Attempt to extract the 32-byte SQLCipher key from WeChat's memory
    using lldb. This requires SIP to be partially disabled or the
    process to have the get-task-allow entitlement (dev builds).

    Technique: search for the known SQLite file header in decrypted
    memory pages, then walk nearby pointers looking for 32-byte
    non-trivial buffers.

    Returns a 64-char hex string, or None.
    """
    print("[INFO] Attempting lldb memory scan (requires entitlement or SIP off)...")

    lldb_script = r"""
import lldb
import re

def find_key(debugger, command, result, internal_dict):
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not process.IsValid():
        result.AppendMessage("No valid process")
        return

    # Walk memory regions looking for 32-byte non-null, non-ff blocks
    # near strings "iphone", "android", "ipad" (device-type markers
    # stored adjacent to the key in some WeChat builds).
    markers = [b"iphone\x00", b"android\x00", b"ipad\x00"]
    key_candidates = []
    error = lldb.SBError()

    region_info = lldb.SBMemoryRegionInfo()
    addr = 0
    while True:
        err = process.GetMemoryRegionInfo(addr, region_info)
        if not err.Success():
            break
        if (region_info.IsReadable() and region_info.IsExecutable() is False
                and region_info.GetRegionEnd() > addr):
            size = region_info.GetRegionEnd() - region_info.GetRegionBase()
            if 0 < size <= 64 * 1024 * 1024:  # skip huge regions
                data = process.ReadMemory(region_info.GetRegionBase(), size, error)
                if error.Success() and data:
                    for marker in markers:
                        idx = data.find(marker)
                        while idx != -1:
                            # Scan backwards for a 32-byte candidate key
                            for back in range(8, 2000, 8):
                                kstart = idx - back
                                if kstart < 0:
                                    break
                                k = data[kstart:kstart+32]
                                if (len(k) == 32
                                        and k != b'\x00'*32
                                        and k != b'\xff'*32):
                                    key_candidates.append(k.hex())
                            idx = data.find(marker, idx + 1)
        next_addr = region_info.GetRegionEnd()
        if next_addr <= addr:
            break
        addr = next_addr

    if key_candidates:
        result.AppendMessage("KEY:" + key_candidates[0])
    else:
        result.AppendMessage("KEY:NOT_FOUND")

def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f lldb_key_scan.find_key find_key")
"""

    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False
        ) as f:
            f.write(lldb_script)
            script_path = f.name

        lldb_commands = (
            f"command script import {script_path}\n"
            "find_key\n"
            "quit\n"
        )
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".lldb", delete=False
        ) as f:
            f.write(lldb_commands)
            cmd_path = f.name

        result = subprocess.run(
            ["lldb", "--attach-pid", str(pid), "--source", cmd_path,
             "--no-lldbinit"],
            capture_output=True, text=True, timeout=60
        )
        os.unlink(script_path)
        os.unlink(cmd_path)

        for line in result.stdout.splitlines():
            if "KEY:" in line:
                key = line.split("KEY:")[1].strip()
                if key != "NOT_FOUND" and len(key) == 64:
                    try:
                        bytes.fromhex(key)
                        return key
                    except ValueError:
                        pass
    except (subprocess.SubprocessError, OSError, FileNotFoundError) as exc:
        print(f"[WARN] lldb scan failed: {exc}")

    return None


def extract_key_auto() -> Optional[str]:
    """
    Try all automatic key-extraction methods in order:
    1. macOS Keychain
    2. lldb memory scan (requires process entitlement)
    Returns hex key string or None.
    """
    print("[INFO] Trying Keychain extraction...")
    key = _extract_key_from_keychain()
    if key:
        print("[INFO] Key found in Keychain.")
        return key
    print("[INFO] Keychain extraction failed.")

    pid = _get_wechat_pid()
    if pid:
        print(f"[INFO] Found WeChat PID: {pid}")
        key = _extract_key_via_lldb(pid)
        if key:
            print("[INFO] Key found via lldb memory scan.")
            return key
        print("[INFO] lldb memory scan did not yield a key.")
    else:
        print("[WARN] WeChat process not found — is WeChat running?")

    return None


# ---------------------------------------------------------------------------
# SQLCipher 4.x decryption (pure-Python fallback)
# ---------------------------------------------------------------------------

def _derive_enc_key(raw_key: bytes, salt: bytes) -> bytes:
    """PBKDF2-SHA512, 256 000 iterations, 32-byte output."""
    material = hashlib.pbkdf2_hmac(
        "sha512", raw_key, salt, SQLCIPHER_KDF_ITER, dklen=64
    )
    return material[:32]


def _decrypt_page_aes_cbc(enc_key: bytes, page_data: bytes) -> bytes:
    """
    Decrypt one SQLCipher page (without the 16-byte salt prefix on page 1).
    page_data must be exactly SQLCIPHER_PAGE_SIZE bytes with the salt
    already stripped from page 1.
    """
    try:
        from Crypto.Cipher import AES
    except ImportError:
        try:
            from Cryptodome.Cipher import AES
        except ImportError:
            raise ImportError(
                "pycryptodome or pycryptodomex is required for pure-Python "
                "decryption.\nInstall with: pip3 install pycryptodome"
            )

    usable = SQLCIPHER_PAGE_SIZE - SQLCIPHER_RESERVE_SIZE
    iv = page_data[usable: usable + SQLCIPHER_IV_SIZE]
    encrypted = page_data[:usable]
    cipher = AES.new(enc_key, AES.MODE_CBC, iv)
    return cipher.decrypt(encrypted)


def decrypt_db_pure_python(
    db_path: Path, output_path: Path, raw_key: bytes
) -> bool:
    """
    Decrypt a SQLCipher 4.x database without pysqlcipher3.
    Returns True on success.
    """
    try:
        with open(db_path, "rb") as fh:
            file_data = fh.read()
    except OSError as exc:
        print(f"[ERROR] Cannot read {db_path}: {exc}")
        return False

    if len(file_data) < SQLCIPHER_PAGE_SIZE:
        print(f"[ERROR] {db_path}: file too small to be a SQLCipher database")
        return False

    salt = file_data[:SQLCIPHER_SALT_SIZE]
    enc_key = _derive_enc_key(raw_key, salt)

    output: bytearray = bytearray()
    num_pages = len(file_data) // SQLCIPHER_PAGE_SIZE

    for page_num in range(num_pages):
        start = page_num * SQLCIPHER_PAGE_SIZE
        page = file_data[start: start + SQLCIPHER_PAGE_SIZE]

        if page_num == 0:
            # First page: first 16 bytes are salt (unencrypted),
            # rest is encrypted content.
            page_body = page[SQLCIPHER_SALT_SIZE:]
            # Pad to full page size for uniform processing
            padded = page_body + bytes(SQLCIPHER_SALT_SIZE)
            decrypted = _decrypt_page_aes_cbc(enc_key, padded)

            # Replace SQLite header (the real header was in plaintext
            # conceptually; we emit the correct header).
            first_page_out = bytearray(SQLCIPHER_PAGE_SIZE)
            first_page_out[: len(SQLITE_HEADER)] = SQLITE_HEADER
            content_after_header = decrypted[len(SQLITE_HEADER):]
            first_page_out[len(SQLITE_HEADER): len(SQLITE_HEADER) + len(content_after_header)] = content_after_header
            output.extend(first_page_out)
        else:
            decrypted = _decrypt_page_aes_cbc(enc_key, page)
            output.extend(decrypted)
            output.extend(b"\x00" * SQLCIPHER_RESERVE_SIZE)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(bytes(output))

    # Verify the output looks like SQLite
    try:
        conn = sqlite3.connect(str(output_path))
        conn.cursor().execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        conn.close()
        return True
    except sqlite3.DatabaseError:
        print(f"[WARN] Pure-Python decryption of {db_path.name} may be "
              "incomplete. Consider using pysqlcipher3.")
        # Keep the file anyway; caller can decide.
        return False


def decrypt_db_pysqlcipher(
    db_path: Path, output_path: Path, hex_key: str
) -> bool:
    """
    Decrypt using pysqlcipher3 (most reliable).
    SQLCipher 4 settings: cipher_compatibility=4, page_size=4096,
    kdf_iter=256000.
    """
    try:
        from pysqlcipher3 import dbapi2 as sqlcipher
    except ImportError:
        return False

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        # Remove stale output if present
        if output_path.exists():
            output_path.unlink()

        conn = sqlcipher.connect(str(db_path))
        cur = conn.cursor()
        cur.execute(f"PRAGMA key = \"x'{hex_key}'\";")
        cur.execute("PRAGMA cipher_compatibility = 4;")
        cur.execute("PRAGMA cipher_page_size = 4096;")
        cur.execute("PRAGMA kdf_iter = 256000;")

        # Verify the key works
        tables = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table';"
        ).fetchall()
        if not tables:
            conn.close()
            print(f"[WARN] {db_path.name}: no tables found — wrong key?")
            return False

        # Export to plain SQLite
        cur.execute(
            f"ATTACH DATABASE '{output_path}' AS plaintext KEY '';"
        )
        cur.execute("SELECT sqlcipher_export('plaintext');")
        cur.execute("DETACH DATABASE plaintext;")
        conn.close()
        return True

    except Exception as exc:  # noqa: BLE001
        print(f"[WARN] pysqlcipher3 decryption error for {db_path.name}: {exc}")
        return False


def decrypt_single(
    db_path: Path, output_path: Path, hex_key: str
) -> bool:
    """
    Decrypt one database using the best available method.
    1. pysqlcipher3  (preferred — full SQLCipher 4 support)
    2. pure-Python AES-CBC fallback
    Returns True on success.
    """
    raw_key = bytes.fromhex(hex_key)

    print(f"  Decrypting {db_path.name} ...")
    if decrypt_db_pysqlcipher(db_path, output_path, hex_key):
        return True

    print(f"  [INFO] pysqlcipher3 not available, using pure-Python fallback")
    return decrypt_db_pure_python(db_path, output_path, raw_key)


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def write_metadata(
    output_dir: Path,
    key_source: str,
    results: list[dict],
) -> Path:
    """Write decrypt_meta.json to output_dir."""
    meta = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "key_source": key_source,
        "output_dir": str(output_dir),
        "databases": results,
    }
    meta_path = output_dir / "decrypt_meta.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta_path


# ---------------------------------------------------------------------------
# Manual-key instructions
# ---------------------------------------------------------------------------

MANUAL_KEY_INSTRUCTIONS = """
Auto-extraction failed. To obtain the key manually:

Option A — lldb (requires SIP off or development entitlement):
    sudo lldb --attach-name WeChat
    # Once paused, type:
    process save-core /tmp/wechat.core
    # Then search the core for 32-byte non-null sequences near device strings.

Option B — use a pre-built tool (e.g. wechatdb-exporter, WeChatDump):
    brew install wechatdb-exporter   # if available
    wechatdb-exporter key

Option C — supply manually after finding it by another means:
    python3 scripts/decrypt.py --key <64-char-hex-key>

For WeChat 4.1.8 on Apple Silicon the key is typically found by scanning the
WeChat process heap for 32-byte buffers adjacent to the string "iphone\\0".
"""


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Decrypt Mac WeChat SQLCipher databases to plain SQLite.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--key", "-k",
        metavar="HEX",
        help="64-char hex key (32 bytes). Skips auto-extraction.",
    )
    p.add_argument(
        "--output", "-o",
        metavar="DIR",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    p.add_argument(
        "--list-dbs",
        action="store_true",
        help="Print discovered databases and exit.",
    )
    p.add_argument(
        "--db-storage",
        metavar="PATH",
        help="Explicit path to db_storage/ directory (skips auto-discovery).",
    )
    return p


def validate_key(key: str) -> str:
    """Validate and normalise a hex key. Exits on invalid input."""
    key = key.strip().lower()
    if len(key) != 64:
        _die(
            f"Key must be exactly 64 hex characters (32 bytes); "
            f"got {len(key)} characters."
        )
    try:
        bytes.fromhex(key)
    except ValueError:
        _die("Key contains non-hexadecimal characters.")
    return key


def main() -> None:
    _assert_mac()

    parser = build_arg_parser()
    args = parser.parse_args()

    # ---- discover db_storage dirs ----------------------------------------
    if args.db_storage:
        storage_dirs = [Path(args.db_storage).expanduser()]
        if not storage_dirs[0].is_dir():
            _die(f"db_storage path does not exist: {storage_dirs[0]}")
    else:
        storage_dirs = find_db_storage_dirs()

    if not storage_dirs:
        _die(
            "No WeChat db_storage directories found.\n"
            "Expected pattern: "
            "~/Library/Containers/com.tencent.xinWeChat"
            "/Data/Documents/xwechat_files/*/db_storage/\n"
            "Make sure WeChat has been launched at least once."
        )

    target_dbs = find_target_databases(storage_dirs)

    # ---- --list-dbs -------------------------------------------------------
    if args.list_dbs:
        if target_dbs:
            print("Discovered databases:")
            for db in target_dbs:
                size_kb = db.stat().st_size // 1024
                print(f"  {db}  ({size_kb} KB)")
        else:
            print("No target databases found in discovered storage dirs:")
            for d in storage_dirs:
                print(f"  {d}")
        sys.exit(0)

    if not target_dbs:
        print("[WARN] No target databases found. Listing all .db files in "
              "storage dirs for reference:")
        for storage in storage_dirs:
            for db in storage.rglob("*.db"):
                print(f"  {db}")
        _die("Nothing to decrypt.")

    # ---- obtain key -------------------------------------------------------
    key_source = "manual"
    if args.key:
        hex_key = validate_key(args.key)
        print(f"[INFO] Using manually supplied key: {hex_key[:8]}...{hex_key[-8:]}")
    else:
        print("[INFO] Attempting automatic key extraction...")
        hex_key_raw = extract_key_auto()
        if hex_key_raw:
            hex_key = validate_key(hex_key_raw)
            key_source = "auto"
            print(f"[INFO] Extracted key: {hex_key[:8]}...{hex_key[-8:]}")
        else:
            print()
            print(MANUAL_KEY_INSTRUCTIONS)
            _die(
                "Could not extract key automatically.\n"
                "Run with --key <64-char-hex> to supply it manually."
            )

    # ---- decrypt ---------------------------------------------------------
    output_dir = Path(args.output).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    ok_count = 0
    fail_count = 0

    print(f"\n[INFO] Output directory: {output_dir}")
    print(f"[INFO] Decrypting {len(target_dbs)} database(s)...\n")

    for db_path in target_dbs:
        # Preserve relative structure: contact/contact.db -> contact/contact.db
        # inside output_dir.
        # Find which storage dir it belongs to and compute relative path.
        rel: Optional[Path] = None
        for storage in storage_dirs:
            try:
                rel = db_path.relative_to(storage)
                break
            except ValueError:
                continue
        if rel is None:
            rel = Path(db_path.name)

        out_path = output_dir / rel
        ok = decrypt_single(db_path, out_path, hex_key)

        record = {
            "source": str(db_path),
            "output": str(out_path),
            "success": ok,
        }
        if ok:
            ok_count += 1
            record["size_bytes"] = out_path.stat().st_size
            print(f"  [OK]   {rel}")
        else:
            fail_count += 1
            print(f"  [FAIL] {rel}")

        results.append(record)

    # ---- write metadata --------------------------------------------------
    meta_path = write_metadata(output_dir, key_source, results)

    # ---- summary ---------------------------------------------------------
    print(f"\n{'='*60}")
    print(f"Decryption complete: {ok_count} succeeded, {fail_count} failed")
    print(f"Metadata written to: {meta_path}")
    if fail_count:
        print(
            "\nFor failed databases, verify the key is correct.\n"
            "Install pysqlcipher3 for the most reliable decryption:\n"
            "  pip3 install pysqlcipher3\n"
            "  (requires libsqlcipher-dev / sqlcipher Homebrew formula)"
        )
    print("="*60)

    if fail_count and ok_count == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
