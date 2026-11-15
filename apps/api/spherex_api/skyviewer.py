"""Endpoints in the shape the skyviewer React frontend expects (skyviewer/README.md).

They are thin adapters over the same pipeline as /api/frames:
  POST /api/cutout   {ra, dec, fovDeg, target?}  -> SkyCutout
  GET  /api/resolve?q=name                       -> OverlayObject (+ target details)
  GET  /api/catalog                              -> OverlayObject[] for the full-sky labels

Layers are the six SPHEREx detectors. SPHEREx images a field with a detector pair
at the same moment (D1+D4, D2+D5, D3+D6), so one time step can carry two layers;
a frame simply omits layers it has no image for.
"""
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from . import config
from .discover import IrsaUnavailable
from .field import field_stars
from .frames import DETECTOR_RANGE_UM, DISCOVERY_EPOCH_MJD, build_frames
from .targets import PRESETS, Target, TargetNotFound, resolve

router = APIRouter()

# Bright, well-known objects for the full-sky labels (J2000; stationary at this scale).
FAMOUS = [
    ("Orion Nebula (M42)", 83.8221, -5.3911), ("Betelgeuse", 88.7929, 7.4071),
    ("Sirius", 101.2872, -16.7161), ("Pleiades (M45)", 56.75, 24.1167),
    ("Crab Nebula (M1)", 83.6331, 22.0145), ("Andromeda Galaxy (M31)", 10.6847, 41.2690),
    ("Polaris", 37.9546, 89.2641), ("Vega", 279.2347, 38.7837),
    ("Sgr A* (Galactic Centre)", 266.4168, -29.0078), ("Alpha Centauri", 219.9021, -60.8340),
    ("Whirlpool Galaxy (M51)", 202.4696, 47.1952), ("Pinwheel Galaxy (M101)", 210.8024, 54.3488),
]
SAME_EXPOSURE_DAYS = 0.002  # frames closer than ~3 min are one exposure (a detector pair)


class CutoutRequest(BaseModel):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    fovDeg: float = Field(gt=0)
    target: str | None = Field(None, max_length=100,
                               description="Optional name; lets the backend follow a moving star")
    perDetector: int = Field(16, ge=1, le=60, description="Max frames per detector, spread over time")


def _overlay(t: Target, source: str = "simbad") -> dict:
    p = t.position_at(DISCOVERY_EPOCH_MJD)  # "now-ish" position (late 2025), so labels sit on the star
    return {"name": t.name, "ra": round(float(p.ra.deg), 6), "dec": round(float(p.dec.deg), 6),
            "source": source, "target": t.to_json()}


@router.post("/api/cutout")
def cutout(req: CutoutRequest, request: Request):
    fov = min(req.fovDeg, config.MAX_FOV_DEG)
    if req.target:
        try:
            t = resolve(req.target)
        except TargetNotFound as e:
            raise HTTPException(404, str(e)) from e
    else:
        t = Target(id=f"{req.ra:.5f},{req.dec:.5f}", name=f"RA {req.ra:.4f}, Dec {req.dec:.4f}",
                   ra=req.ra, dec=req.dec, epoch=2000.0, source="crosshair position (no proper motion)")
    try:
        m = build_frames(t, fov, "all", req.perDetector, True)
    except IrsaUnavailable as e:
        raise HTTPException(503, "IRSA (NASA's SPHEREx archive) is not responding right now, and "
                                 "this region isn't cached yet. Try again in a few minutes.") from e

    base = str(request.base_url).rstrip("/")
    frames: list[dict] = []
    for f in m["frames"]:  # already time-sorted
        meta = {k: f[k] for k in ("detector", "lambda_um", "bw_um", "flags_at_target", "masked_frac",
                                  "target_pos", "release", "version", "iso")}
        if frames and f["mjd"] - frames[-1]["mjd"] < SAME_EXPOSURE_DAYS and f["detector"] not in frames[-1]["images"]:
            frames[-1]["images"][f["detector"]] = base + f["png"]
            frames[-1]["meta"][f["detector"]] = meta
        else:
            frames.append({"time": f["iso"], "mjd": f["mjd"],
                           "images": {f["detector"]: base + f["png"]}, "meta": {f["detector"]: meta}})

    layers = sorted({d for fr in frames for d in fr["images"]})
    overlays = [_overlay(t, "target")] if req.target else []
    return {
        "ra": m["center"]["ra"], "dec": m["center"]["dec"], "fovDeg": fov,
        "layers": layers,
        "frames": [{k: fr[k] for k in ("time", "images", "meta")} for fr in frames],
        "overlays": overlays,
        # --- extensions beyond the README contract (all optional for the viewer) ---
        "requestedFovDeg": req.fovDeg,
        "fovClamped": fov < req.fovDeg,
        "layerInfo": {d: {"label": f"{d} · {lo:.2f}–{hi:.2f} µm", "range_um": [lo, hi]}
                      for d, (lo, hi) in DETECTOR_RANGE_UM.items() if d in layers},
        "synthetic": m["synthetic"],
        "target": m["target"],
        "counts": m["counts"],
        "message": m["message"],
        "releases": m["releases_present"],
        "discovery": m["discovery"],
        "gridNpix": m["grid"]["npix"],
    }


@router.get("/api/resolve")
def resolve_name(q: str | None = Query(None, min_length=1, max_length=100),
                 name: str | None = Query(None, min_length=1, max_length=100)):
    """Object name -> position. `q` is skyviewer's param; `name` kept for API.md."""
    query = q or name
    if not query:
        raise HTTPException(422, "Give q=<object name>")
    try:
        return _overlay(resolve(query))
    except TargetNotFound as e:
        raise HTTPException(404, str(e)) from e


@router.get("/api/field")
def field(ra: float = Query(..., ge=0, lt=360), dec: float = Query(..., ge=-90, le=90),
          fov: float = Query(..., gt=0), mjd: float = Query(..., gt=50000, lt=70000)):
    """Gaia DR3 + CatWISE2020 stars in the patch, moved to date `mjd` with their proper motions."""
    return field_stars(ra, dec, min(fov, config.MAX_FOV_DEG * 1.2), mjd)


@router.get("/api/catalog")
def catalog():
    presets = [_overlay(t, "challenge") for t in PRESETS.values()]
    famous = [{"name": n, "ra": ra, "dec": dec, "source": "bright"} for n, ra, dec in FAMOUS]
    return presets + famous
