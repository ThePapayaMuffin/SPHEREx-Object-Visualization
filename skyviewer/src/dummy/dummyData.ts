// DUMMY DATA - delete this folder when the back end exists.
import type { OverlayObject, SkyCutout, SkyRequest } from "../types";

export const DUMMY_CATALOG: OverlayObject[] = ([
  ["Orion Nebula (M42)",83.82,-5.39],["Betelgeuse",88.79,7.41],["Sirius",101.29,-16.72],["Pleiades (M45)",56.75,24.12],
  ["Crab Nebula (M1)",83.63,22.01],["Andromeda (M31)",10.68,41.27],["Polaris",37.95,89.26],["Vega",279.23,38.78],
  ["Sgr A* (Galactic Center)",266.42,-29.01],
  ["Barnard's Star",269.452,4.693],["Epsilon Indi",330.84,-56.79],["WISE 0855",133.7951,-7.2451],["RW Aurigae",76.957,30.40],["R Draconis",248.175,66.75],["Alpha Centauri",219.9,-60.83],
] as [string, number, number][]).map(([name, ra, dec]) => ({ name, ra, dec, mag: 1, source: "dummy" }));

const rng = (s: number) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

export function proceduralSky(w = 2048, h = 1024): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!, r = rng(7);
  g.fillStyle = "#05070d"; g.fillRect(0, 0, w, h);
  const band = g.createLinearGradient(0, h * .35, 0, h * .65); // fake galactic plane
  band.addColorStop(0, "transparent"); band.addColorStop(.5, "rgba(255,120,60,.25)"); band.addColorStop(1, "transparent");
  g.fillStyle = band; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,${180 + r() * 60 | 0},${120 + r() * 100 | 0},${.2 + r() * .8})`; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
  return c;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function dummyCutout(req: SkyRequest): SkyCutout {
  const N = 12, S = 512, f = req.fovDeg, cosd = Math.cos(req.dec * Math.PI / 180);
  const toPx = (ra: number, dec: number) => [S / 2 - ((ra - req.ra) * cosd) / f * S, S / 2 - (dec - req.dec) / f * S];
  const seed = Math.abs((req.ra * 1000 + req.dec * 77) | 0) + 1;
  const stars = Array.from({ length: 140 }, (_, i) => { const r = rng(seed + i * 31); return { x: r() * S, y: r() * S, b: r() ** 3 }; });
  const layers = ["ir", "visible"];
  const frames = Array.from({ length: N }, (_, t) => {
    const images: Record<string, string> = {};
    for (const L of layers) {
      const c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d")!, r = rng(t + 99);
      g.fillStyle = L === "ir" ? "#150805" : "#04060c"; g.fillRect(0, 0, S, S);
      stars.forEach(s => { g.fillStyle = L === "ir" ? `rgba(255,150,80,${.3 + s.b})` : `rgba(180,210,255,${.3 + s.b})`; g.beginPath(); g.arc(s.x, s.y, 1 + s.b * 4, 0, 7); g.fill(); });
      const pulse = 4 + 3 * Math.sin(t / 2); g.fillStyle = "#fff"; g.beginPath(); g.arc(S * .62, S * .4, pulse, 0, 7); g.fill(); // fake variable star
      for (let i = 0; i < 30; i++) { g.fillStyle = "rgba(255,255,255,.4)"; g.fillRect(r() * S, r() * S, 1, 1); } // per-frame noise
      images[L] = c.toDataURL("image/png");
    }
    return { time: `2025-${pad(5 + (t >> 1))}-${pad(1 + (t % 2) * 14)}T00:00:00Z`, images };
  });
  const overlays: OverlayObject[] = DUMMY_CATALOG.filter(o => { const [x, y] = toPx(o.ra, o.dec); return x > 0 && x < S && y > 0 && y < S; });
  for (let i = 0; i < 5; i++) { const s = stars[i]; overlays.push({ name: `Gaia DR3 ${4000000000 + seed * 13 + i}`, ra: req.ra - (s.x - S / 2) / S * f / cosd, dec: req.dec - (s.y - S / 2) / S * f, mag: 12, source: "gaia-dummy" }); }
  return { ra: req.ra, dec: req.dec, fovDeg: f, layers, frames, overlays };
}
