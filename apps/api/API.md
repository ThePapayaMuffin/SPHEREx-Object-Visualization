# SPHEREx Flipbook API

A Python backend that finds SPHEREx images of a target, cuts out a small region around it,
aligns every exposure onto one north-up grid, and returns PNG frames plus metadata.
Any frontend (React, Svelte, plain JS) can use it. TypeScript types for every response are in
[`packages/shared/src/index.ts`](../../packages/shared/src/index.ts).

## Run it

From `apps/api`, once:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

Then start the server with real IRSA data:

```bash
.venv/Scripts/python -m uvicorn spherex_api.main:app --reload --port 8000
```

or with **fake data**, for UI work while IRSA is down (PowerShell):

```powershell
$env:SPHEREX_FAKE=1; .venv/Scripts/python -m uvicorn spherex_api.main:app --reload --port 8000
```

Interactive docs: <http://localhost:8000/docs>.

**CORS:** by default only `http://localhost:5173` may call it from a browser. For another dev port,
set `SPHEREX_CORS=http://localhost:3000` (comma-separate several origins), or forward `/api`
to `localhost:8000` with your dev server's proxy so CORS doesn't apply.

## Endpoints

| Method and path | What it returns |
|---|---|
| `GET /api/health` | `{ok, fake, releases, discovery}` |
| `GET /api/targets` | `Target[]`: the five challenge targets with astrometry and notes |
| `GET /api/resolve?name=M101` | `Target` for any name SIMBAD, NED or VizieR knows; 404 if unknown |
| `GET /api/frames?...` | `FramesManifest` (below) |
| `GET /api/frames/{key}/{NNN}.png` | One frame. Its URL comes from the manifest. |

### `GET /api/frames`

| Param | Default | Meaning |
|---|---|---|
| `target` | | Preset id (`wise0855`, `barnard`, `epsindib`, `rwaur`, `rdra`) or any object name |
| `ra`, `dec` | | Degrees (ICRS). Used when there's no `target`. Assumes the object doesn't move. |
| `fov` | `0.1` | Field of view in degrees (max 0.5). 0.1° is 59 × 59 px. |
| `det` | `D6` | `D1`…`D6`, or `all` |
| `limit` | `40` | Max frames (1–200), spread evenly over time so the first and last dates are kept |
| `zodi` | `true` | Subtract the zodiacal-light model |

Example: `/api/frames?target=wise0855&det=D6`

**How long it takes:** the first request for a target downloads cutouts from IRSA, which can
take 10–60 s. Repeat requests come from cache and are instant. Show a loading state.

**Errors:** `422` for bad or missing params, `404` for an unknown name, and `503` when IRSA is
down and nothing is cached. Each has a readable `detail` you can show users.

## Reading a manifest

- **`frames[]` is sorted by time.** Each PNG is `grid.npix` square, north up, east left.
  Transparent pixels are masked (saturated, hot, …) or have no data, so draw them in a
  distinct colour rather than black.
- **Every frame has its own wavelength.** SPHEREx's filter varies across the detector, so
  `lambda_um` differs per exposure even on one detector. Always show it on the frame,
  e.g. `2025-11-03 · D6 · 4.71 µm · DR1`.
- **`target_pos.px` is where the target is on that frame's date**, in PNG pixels with (0,0) at the
  top-left pixel centre. For fast movers (WISE 0855, Barnard's Star) this changes frame to frame;
  draw a marker there. Scale it if you draw the PNG bigger than `npix`.
- **`flags_at_target`** lists the quality flags at the target. `[]` means clean. `"SOURCE"` only
  means a known star is there, so it's not a problem. `"OVERFLOW"` means saturated: don't trust
  the brightness.
- **Brightness is comparable within a detector.** All frames of one detector share one stretch,
  so a change in the flipbook is a change in the data.
- **`synthetic: true` means invented data.** Show an unmissable banner.
- **`discovery.source: "stale-cache"`** means IRSA was down and an older image list was used.
  Worth a small notice.
- **`message`** is set when there are no frames, explaining why.
