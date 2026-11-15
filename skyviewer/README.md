# SPHEREx Sky Viewer (front end)

React + TypeScript + three.js (Vite). Run: `npm i && npm run dev`. Front end only: all data is currently dummy data.

## Required setup: `make_texture.py`
The full-sky starting view needs an image at `public/sky_equirect.png`. **You must run `python scripts/make_texture.py`** (needs `numpy` and `pillow`) to create it. Without the file, the app falls back to a random procedural sky generated in the browser.

That script currently draws a fake placeholder. For the real thing, edit it to build the image from SPHEREx data (see "Datasets" below). It's an offline, one-time job and doesn't need the back end.

## Datasets: each feature needs its own data
Nothing here comes from a single source. Each piece below needs its own dataset and its own back-end code:

| Feature | Dataset needed | Notes |
|---|---|---|
| **Full-sky starting texture** (`make_texture.py`) | A SPHEREx all-sky infrared mosaic from IRSA (https://irsa.ipac.caltech.edu/Missions/spherex.html) | Built offline from one epoch and one band (or a sum of bands). Reproject to equirectangular (RA 0–360° left→right, Dec +90° top). |
| **Time-interval "video"** (infrared layer) | SPHEREx spectral images/cutouts for the chosen sky patch, one frame per available epoch, from IRSA (see the SPHEREx tutorial notebooks) | This is what the time bar plays. Frames are time-ordered by observation date. Summing bands/detector arrays is up to the back end. |
| **Visible-light layer** | A different survey, not SPHEREx (SPHEREx is near-infrared only). e.g. DSS/Pan-STARRS via CDS HiPS/`hips2fits` | Usually one epoch or archival, so it won't have the same time steps as SPHEREx. Omit that layer key in frames that lack it. |
| **WISE layer** (optional) | WISE/unWISE images, as in WiseView | Same idea as the visible layer. |
| **Overlays (labels, names)** | Gaia DR3 (https://archive.stsci.edu/missions-and-data/gaia), AllWISE, SIMBAD for names | Coordinates + labels only. Use Gaia proper motions to move markers per frame if you want. |

## How it works
- **Full-sky view:** Drag / arrow keys / wheel / `+` `-` / zoom buttons. The crosshair and the RA/Dec/FOV readout use the screen centre.
- **Loading a patch:** Press **Enter or "Load at crosshair" with the box empty** to load the current crosshair position and FOV (capped at 20° by `MAX_LOAD_FOV` in `App.tsx`). Or type a name or `RA Dec [FOV°]` (decimal degrees).
- **Time bar:** Appears after loading. Seek, play/pause, speed. Layer buttons (Infrared, Visible, …) are generated from `cutout.layers`.
- **URL params:** `?ra=133.795&dec=-7.245&fov=0.1` opens that patch directly, and the URL updates after each load, so views can be shared or embedded.
- **Hide UI** button (or `H`) hides all panels, leaving only the sky. A "Show UI" button replaces it.
- **Test targets in the dummy catalog:** Barnard's Star, Epsilon Indi, WISE 0855, RW Aurigae, R Draconis (coordinates approximate).

## Files
- `src/api/skyApi.ts`: the only back-end touchpoint. Dummy data is used while `VITE_API_URL` is unset.
- `src/dummy/`: fake data. Delete it and its two imports in `skyApi.ts` when done.
- `src/types.ts`: the contract below. `src/SkyViewer.tsx`: 3D view. `src/App.tsx`: UI. `src/styles.css`: styling.

## Back-end integration
Set `VITE_API_URL=http://localhost:8000` in `.env`. Endpoints:

1. `POST /api/cutout`, body `{ra, dec, fovDeg}` (ICRS degrees):
```json
{ "ra":133.795, "dec":-7.245, "fovDeg":0.1,
  "layers":["ir","visible"],
  "frames":[{"time":"2025-06-01T00:00:00Z","images":{"ir":"/data/f0_ir.png","visible":"/data/f0_vis.png"}}],
  "overlays":[{"name":"Gaia DR3 …","ra":133.8,"dec":-7.24,"mag":12.1,"source":"gaia"}] }
```
   - Every image is a **square, north-up, east-left** cutout centred on `ra,dec`, spanning exactly `fovDeg` (use `astropy.wcs` + `reproject`). Same pixel size for all frames, ideally ≤1024². Use consistent stretching across frames.
   - `frames` are sorted by time. If a layer has no image for a frame, omit that key (the viewer then keeps showing the previous image for that layer).
   - Image URLs must be CORS-enabled.
   - Larger FOV means more data transfer. The back end may clamp `fovDeg` and should cache by sky tile and FOV bucket. SPHEREx pixels are ~6″, so zooming far below a few arcminutes adds no detail.
2. `GET /api/resolve?q=name` → one `OverlayObject` or 404 (SIMBAD/Sesame work well).
3. `GET /api/catalog` → `OverlayObject[]` of bright named objects for the full-sky labels (keep to a few thousand).
4. The texture is not served by an endpoint: generate `public/sky_equirect.png` offline.

## Not built yet (from the challenge's optional list)
Band/detector-array selection and on-the-fly spectra, add/subtract images across epochs, contamination-flag metadata, a user-facing FOV input, and per-frame proper-motion overlays. The contract can be extended (e.g. `bands`, `metadata` fields) without touching the viewer much.
