// The ONLY file that talks to the back end. Set VITE_API_URL to switch off dummy data.
import type { OverlayObject, SkyCutout, SkyRequest } from "../types";
import { DUMMY_CATALOG, dummyCutout } from "../dummy/dummyData";

const API = import.meta.env.VITE_API_URL as string | undefined;

export async function fetchCutout(req: SkyRequest, signal?: AbortSignal): Promise<SkyCutout> {
  if (!API) return dummyCutout(req);
  const r = await fetch(`${API}/api/cutout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal });
  if (!r.ok) throw new Error(`cutout failed: ${r.status}`);
  return r.json();
}
/** Name -> coordinates (Gaia/SIMBAD/etc. on the back end). */
export async function resolveName(q: string): Promise<OverlayObject | null> {
  if (API) { const r = await fetch(`${API}/api/resolve?q=${encodeURIComponent(q)}`); return r.ok ? r.json() : null; }
  const k = q.trim().toLowerCase();
  return DUMMY_CATALOG.find(o => o.name.toLowerCase().includes(k)) ?? null;
}
/** Named objects shown on the full-sky view. */
export async function fetchCatalog(): Promise<OverlayObject[]> {
  if (API) return (await fetch(`${API}/api/catalog`)).json();
  return DUMMY_CATALOG;
}
/** Equirectangular all-sky texture (RA 0..360 left->right). Falls back to procedural if missing. */
export const SKY_TEXTURE_URL = "/sky_equirect.png";
