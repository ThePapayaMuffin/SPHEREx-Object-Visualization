"""SPHEREx flipbook API.

Run:  .venv/Scripts/python -m uvicorn spherex_api.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import config
from .discover import IrsaUnavailable
from .frames import build_frames

app = FastAPI(title="SPHEREx Flipbook API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET"])


@app.get("/api/health")
def health():
    return {"ok": True, "releases": config.RELEASES, "discovery": config.DISCOVERY}


@app.get("/api/frames")
def frames(
    ra: float = Query(..., ge=0, lt=360, description="Right ascension, degrees (ICRS)"),
    dec: float = Query(..., ge=-90, le=90, description="Declination, degrees (ICRS)"),
    fov: float = Query(0.1, gt=0, le=0.5, description="Field of view, degrees"),
    det: str = Query("D6", pattern="^(D[1-6]|all)$", description="Detector D1-D6, or all"),
    limit: int = Query(40, ge=1, le=200, description="Max frames, spread evenly over time"),
    zodi: bool = Query(True, description="Subtract the zodiacal-light model"),
):
    """Find SPHEREx exposures at a position and return aligned PNG frames + metadata."""
    try:
        return build_frames(ra, dec, fov, det, limit, zodi)
    except IrsaUnavailable as e:
        raise HTTPException(503, detail=f"IRSA is unavailable right now and nothing is cached "
                                        f"for this position. {e}") from e


@app.get("/api/frames/{key}/{name}")
def frame_png(key: str = Path(pattern="^[0-9a-f]{16}$"), name: str = Path(pattern=r"^\d{3}\.png$")):
    path = config.CACHE / "frames" / key / name
    if not path.exists():
        raise HTTPException(404, "frame not found")
    # Frame sets are immutable (key includes the image URLs), so cache hard.
    return FileResponse(path, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
