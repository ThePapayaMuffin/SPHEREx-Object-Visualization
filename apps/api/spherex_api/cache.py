"""Tiny disk cache helpers. Writes are atomic (tmp file + rename)."""
import hashlib
import json
import time
from pathlib import Path


def key(*parts) -> str:
    return hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:16]


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def json_put(path: Path, obj) -> None:
    write_atomic(path, json.dumps(obj, indent=1).encode())


def json_get(path: Path, max_age: float | None = None):
    """Return cached JSON, or None if missing / older than max_age seconds."""
    if not path.exists():
        return None
    if max_age is not None and time.time() - path.stat().st_mtime > max_age:
        return None
    return json.loads(path.read_text())
