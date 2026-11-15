# SPHEREx Sky Viewer

**Watch the infrared sky change.** A web app for the NASA Space Apps Challenge 2026 *Planet X and SPHEREx* challenge.
Pick a star and step through every SPHEREx exposure of it, aligned onto one grid and labelled with each frame's
wavelength and quality, so a change you see is a real change in the sky.

> Challenge objective: *create a public-facing web tool to display images of the sky from the SPHEREx mission,
> making it easy for anyone to quickly see how they change over time.*

## What it does

- **Interactive homepage.** A 3D SPHEREx model with a beam that scans 0.75–5 µm, the five challenge targets, and a short explainer of how SPHEREx sees.
- **Full-sky viewer.** Pan and zoom, search any object by name (via CDS SIMBAD) or by `RA Dec`, or lock onto the crosshair.
- **Time-lapse player.** Every SPHEREx exposure of the region, sorted by date, with play/pause, scrubbing and speed control.
- **All six detectors (D1–D6)** as layers, each showing only its own frames, so the date always matches the image.
- **Target panel** with what the object is, what to expect, its motion and distance, and what the current frame measured.
- **Shareable links** like `?target=wise0855` or `?ra=133.76&dec=-7.24&fov=0.15`, which open the viewer directly and work when embedded.

### Built to be scientifically honest

SPHEREx has two quirks that make naive "blink" viewers misleading. We handle both:

1. **Every exposure samples a different wavelength.** SPHEREx's filters change colour across each detector, so a star lands
   on a slightly different wavelength each time. Every frame shows the wavelength *at the target*, plus a chart of how it varies.
2. **The test targets move.** WISE 0855 has moved about 2′ since its 2010 catalogue position. We predict each target's
   position on the date of every exposure from its proper motion, centre the frames there, and move its marker frame by frame.

We also:
- mask and label bad pixels (saturated, hot, ghost-affected, …);
- use one brightness scale for all frames of a detector, so brightness changes are real;
- show which data release each frame comes from.

### The five challenge targets

| Target | What changes | What to expect in SPHEREx |
|---|---|---|
| **WISE 0855−0714** | Moves 8.2″/yr | Coldest known brown dwarf (~250 K). Only visible at 4–5 µm (D5/D6) and faint in single frames, but it shows clearly in a stack. |
| **Barnard's Star** | Moves 10.4″/yr | Fastest-moving star in the sky. Saturates the core pixels. |
| **ε Indi B** | Moves 4.7″/yr | A pair of brown dwarfs that SPHEREx sees as one source. |
| **RW Aurigae** | Brightness | Young star with a disk, irregularly variable. Saturated core. |
| **R Draconis** | Brightness | Pulsating Mira giant. Most SPHEREx visits of the five. |

## How it works

```
Browser: skyviewer/ (React + TypeScript + three.js, Vite)
   │  POST /api/cutout {ra, dec, fovDeg, target}     GET /api/resolve?q=…     GET /api/catalog
   ▼
Backend: apps/api/ (Python, FastAPI + astropy + reproject)
   ├─ resolve   object name → position + proper motion   (CDS Sesame / SIMBAD; 5 presets built in)
   ├─ discover  which SPHEREx images cover this spot      (IRSA SIA2; DR1 + QR3)
   ├─ fetch     small cutouts, never the 72 MB files      (IRSA cutout service, 8 parallel, retries)
   ├─ process   mask bad pixels → subtract zodiacal light → align to one north-up grid → PNG
   ├─ measure   wavelength + flags at the target's position on that date
   └─ cache     on disk: cutouts forever, image lists for 6 h, finished frame sets by content
```

SPHEREx data is public and needs no login, but IRSA's services can't be called straight from a browser, and the
wavelength lookup and image alignment need astropy. That's why the Python backend sits in the middle.

## Running it locally

### Prerequisites

- **Python 3.11+** (developed on 3.13)
- **Node.js 18+** with npm (developed on Node 26)
- An internet connection, for IRSA, CDS and Google Fonts

### First-time setup

From the repo root, set up the backend:

```bash
cd apps/api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

On macOS/Linux, use `.venv/bin/python` instead of `.venv/Scripts/python`.

Then the frontend:

```bash
cd skyviewer
npm install
cp .env.example .env.local
```

`.env.local` points the frontend at the backend (`VITE_API_URL=http://localhost:8000`). On Windows without `cp`, use
`copy .env.example .env.local`.

### Start it (two terminals)

**Terminal 1, the backend** (from `apps/api`):

```bash
.venv/Scripts/python -m uvicorn spherex_api.main:app --port 8000
```

Wait for `Uvicorn running on http://127.0.0.1:8000`.

**Terminal 2, the frontend** (from `skyviewer`):

```bash
npm run dev
```

Open **http://localhost:5173**. Try **http://localhost:5173/?target=wise0855**. Stop each server with Ctrl+C.

> **The first load of a target takes up to a minute** while the backend searches IRSA and downloads cutouts.
> After that it's served from `apps/api/cache/` and is instant.

### When IRSA is down: fake-data mode

IRSA has outages, and its services return `502` or `503` errors when overloaded. To keep working on the UI, start
the backend with synthetic data. In PowerShell:

```powershell
$env:SPHEREX_FAKE=1; .venv/Scripts/python -m uvicorn spherex_api.main:app --port 8000
```

On macOS/Linux: `SPHEREX_FAKE=1 .venv/bin/python -m uvicorn spherex_api.main:app --port 8000`.

The viewer shows a **"Synthetic test data"** banner in this mode. Restart without the variable for real data.

### Tests

From `apps/api`:

```bash
.venv/Scripts/python -m pytest -q
```

The tests run offline with synthetic cutouts. To check the live data path, run `.venv/Scripts/python smoke_test.py`.

From `skyviewer`, typecheck and build with:

```bash
npm run build
```

## Configuration

The backend reads these environment variables. All are optional.

| Variable | Default | Meaning |
|---|---|---|
| `SPHEREX_FAKE` | off | `1` serves synthetic frames, for when IRSA is down |
| `SPHEREX_CORS` | `http://localhost:5173,…` | Comma-separated browser origins allowed to call the API |
| `SPHEREX_MAX_FOV` | `0.3` | Largest patch in degrees. Larger means near-full 72 MB downloads per frame. |
| `SPHEREX_RELEASES` | `spherex_dr1,spherex_qr3` | Collections to search. Add new releases (e.g. DR2) here. |
| `SPHEREX_DISCOVERY` | `sia` | `sia` or `tap`. TAP was far slower in our tests. |
| `SPHEREX_CACHE` | `apps/api/cache` | Where cutouts and frames are cached |

## Repository layout

| Path | What's there |
|---|---|
| `skyviewer/` | **The web app.** Homepage (`src/home/`), viewer (`src/Viewer.tsx`, `src/SkyViewer.tsx`), target panel, API client (`src/api/skyApi.ts`). See `skyviewer/README.md`. |
| `apps/api/` | **The backend.** `spherex_api/` holds the pipeline and endpoints, and `tests/` the offline tests. `API.md` documents every endpoint. |
| `packages/shared/` | TypeScript types for the `/api/frames` endpoint |
| `apps/web/` | Earlier SvelteKit scaffold used for brainstorming; not used by the app |
| `spherex-planetarium.html`, `test.cpp` | Team experiments; not part of the app |

## Known limitations

- **Images:** only DR1 covers the test targets so far. QR3 returns no images at WISE 0855 yet.
- **Speed:** IRSA can be slow. First loads take about a minute, and some cutouts fail and are retried on the next request.
- **Faint WISE 0855:** it's near the single-exposure limit. It shows up in a stack of D6 frames but is hard to see frame by frame.
- **Full-sky backdrop:** the background behind the viewer is a placeholder (`skyviewer/scripts/make_texture.py`), not real SPHEREx data yet.
- **Masked pixels** show as black in the viewer.
- **Not deployed:** everything runs locally for now.

## Credits

- **Images:** NASA SPHEREx data releases (DR1, QR3) via NASA/IPAC Infrared Science Archive (IRSA).
- **Names, positions and proper motions:** CDS SIMBAD (Sesame), including Gaia DR3 and Kirkpatrick et al. (2021).
- **Libraries:** astropy, astroquery, reproject, FastAPI, React, three.js.
- The spacecraft on the homepage is an illustrative model, and infrared colours are false colour.

Built for the NASA Space Apps Challenge 2026.
