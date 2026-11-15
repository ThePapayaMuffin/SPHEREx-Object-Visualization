"""SPHEREx flipbook API.

Run:        .venv/Scripts/python -m uvicorn spherex_api.main:app --reload --port 8000
Fake data:  set SPHEREX_FAKE=1 first (synthetic frames while IRSA is down)
Docs:       http://localhost:8000/docs   (contract: apps/api/API.md)
"""
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import config
from .discover import IrsaUnavailable
from .frames import build_frames
from .targets import PRESETS, Target, TargetNotFound, resolve

app = FastAPI(title="SPHEREx Flipbook API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET"])


@app.get("/api/health")
def health():
    return {"ok": True, "fake": config.FAKE, "releases": config.RELEASES, "discovery": config.DISCOVERY}


@app.get("/api/targets")
def targets():
    """The five challenge targets, with astrometry and what to expect."""
    return [t.to_json() for t in PRESETS.values()]


@app.get("/api/resolve")
def resolve_name(name: str = Query(..., min_length=1, max_length=100)):
    """Look up an object name (preset id, or anything SIMBAD/NED/VizieR knows)."""
    try:
        return resolve(name).to_json()
    except TargetNotFound as e:
        raise HTTPException(404, str(e)) from e


@app.get("/api/frames")
def frames(
    target: str | None = Query(None, max_length=100,
                               description="Preset id (wise0855, barnard, epsindib, rwaur, rdra) or any object name"),
    ra: float | None = Query(None, ge=0, lt=360, description="Right ascension, degrees (ICRS); used if no target"),
    dec: float | None = Query(None, ge=-90, le=90, description="Declination, degrees (ICRS); used if no target"),
    fov: float = Query(0.1, gt=0, le=0.5, description="Field of view, degrees"),
    det: str = Query("D6", pattern="^(D[1-6]|all)$", description="Detector D1-D6, or all"),
    limit: int = Query(40, ge=1, le=200, description="Max frames, spread evenly over time"),
    zodi: bool = Query(True, description="Subtract the zodiacal-light model"),
):
    """Find SPHEREx exposures of a target and return aligned PNG frames + metadata."""
    if target:
        try:
            t = resolve(target)
        except TargetNotFound as e:
            raise HTTPException(404, str(e)) from e
    elif ra is not None and dec is not None:
        t = Target(id=f"{ra:.5f},{dec:.5f}", name=f"RA {ra:.5f}, Dec {dec:.5f}", ra=ra, dec=dec,
                   epoch=2000.0, source="user coordinates (no proper motion)")
    else:
        raise HTTPException(422, "Give either target=<name> or both ra= and dec=")
    try:
        return build_frames(t, fov, det, limit, zodi)
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
