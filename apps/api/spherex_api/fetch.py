"""Download IRSA cutouts (small FITS around a position) with retries + disk cache.

A cutout of a given file URL never changes (the URL embeds the processing
version, e.g. l2b-v27-2026-197), so cached cutouts are kept forever.
"""
import gzip
import time

import requests

from . import cache, config

_session = requests.Session()
_session.headers["User-Agent"] = config.USER_AGENT


class CutoutFailed(RuntimeError):
    pass


def cutout_url(url: str, ra: float, dec: float, size_deg: float) -> str:
    return f"{url}?center={ra:.6f},{dec:.6f}&size={size_deg:.4f}&gzip=false"


def get_cutout(url: str, ra: float, dec: float, size_deg: float) -> bytes:
    path = config.CACHE / "cutouts" / f"{cache.key(url, round(ra, 5), round(dec, 5), round(size_deg, 4))}.fits"
    if path.exists():
        return path.read_bytes()

    full, last = cutout_url(url, ra, dec, size_deg), None
    for i in range(config.RETRIES):
        try:
            r = _session.get(full, timeout=config.TIMEOUT)
            r.raise_for_status()
            data = r.content
            if data[:2] == b"\x1f\x8b":          # gzip despite gzip=false
                data = gzip.decompress(data)
            if not data.startswith(b"SIMPLE"):
                raise ValueError(f"not a FITS file ({data[:40]!r})")
            cache.write_atomic(path, data)
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise CutoutFailed(f"{url.rsplit('/', 1)[-1]}: {str(last)[:200]}")
