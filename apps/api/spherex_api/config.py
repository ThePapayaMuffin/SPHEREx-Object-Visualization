"""All tunable settings in one place. Override with environment variables."""
import os
from pathlib import Path

# Releases to search. When DR2 / a new QR appears, add one string here.
RELEASES = os.environ.get("SPHEREX_RELEASES", "spherex_dr1,spherex_qr3").split(",")

# "sia" (fast in our first test) or "tap" (plan's original choice; see time_discovery.py).
DISCOVERY = os.environ.get("SPHEREX_DISCOVERY", "sia")

CACHE = Path(os.environ.get("SPHEREX_CACHE", Path(__file__).resolve().parent.parent / "cache"))

# SPHEREX_FAKE=1 serves synthetic frames (clearly labelled) so the frontend can be
# built while IRSA is down. Never use for the real demo.
FAKE = os.environ.get("SPHEREX_FAKE", "") not in ("", "0", "false")

PIX_ARCSEC = 6.15          # SPHEREx native pixel scale
WORKERS = 8                # parallel cutout downloads (IRSA suggests 7-12)
RETRIES = 4                # per cutout request, with exponential backoff
QUERY_RETRIES = 3          # per image search; kept short so "IRSA is down" comes back fast
TIMEOUT = 120              # seconds per cutout request
QUERY_TTL = 6 * 3600       # re-ask IRSA for the image list after 6 h (weekly data drops)

# Largest field the backend will build. SPHEREx pixels are 6.15", so 0.3 deg = 176 px;
# much larger means near-full 72 MB downloads per frame. Requests above this are clamped.
MAX_FOV_DEG = float(os.environ.get("SPHEREX_MAX_FOV", "0.3"))

# Bump when processing changes, so old cached PNGs are not reused.
PROC_VERSION = "1"

CORS_ORIGINS = os.environ.get(
    "SPHEREX_CORS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

IRSA = "https://irsa.ipac.caltech.edu/"
USER_AGENT = "spherex-flipbook/0.1 (NASA Space Apps 2026)"
