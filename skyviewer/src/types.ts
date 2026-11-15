/** Shared front-end/back-end contract. See README. */
// degrees (ICRS). source: "target" | "challenge" | "bright" | "gaia" | "catwise" | …
export interface OverlayObject { name: string; ra: number; dec: number; mag?: number; band?: string; source: string; target?: TargetInfo }
export interface TargetInfo { id: string; name: string; notes: string; moves: boolean; suggested_detector: string | null; suggested_fov?: number | null;
  pmra: number; pmdec: number; plx: number; source: string }
/** Gaia DR3 / CatWISE2020 stars in a patch, moved to the frames' date (GET /api/field). */
export interface FieldStars { epochMjd: number; objects: OverlayObject[]; notes: string[] }
export interface SkyFrame { time: string; images: Record<string, string>; meta?: Record<string, FrameMeta> } // layer id -> image URL (N up, E left, covers fovDeg square)
/** `target`: optional object name, so the back end can follow a moving star frame by frame. */
export interface SkyRequest { ra: number; dec: number; fovDeg: number; target?: string }
export interface SkyCutout {
  ra: number; dec: number; fovDeg: number; layers: string[]; frames: SkyFrame[]; overlays: OverlayObject[];
  // ---- optional extensions sent by the SPHEREx back end (apps/api) ----
  requestedFovDeg?: number; fovClamped?: boolean;
  layerInfo?: Record<string, { label: string; range_um: [number, number] }>;
  synthetic?: boolean;            // true = invented test data: show a banner
  target?: TargetInfo;
  gridNpix?: number;
  counts?: { exposures_at_position: number; frames: number; failed: number };
  message?: string | null;        // why there are no frames, if so
  releases?: string[];
}
/** Per-layer metadata for one frame. SPHEREx samples a different wavelength in every exposure. */
export interface FrameMeta {
  detector: string;
  lambda_um: number | null; bw_um: number | null;   // wavelength at the target in this exposure
  flags_at_target: string[] | null;                  // [] clean; SOURCE is informational; OVERFLOW = saturated
  masked_frac: number;
  target_pos: { ra: number; dec: number; px: [number, number] }; // where the target is on this date
  release: string; version: string | null; iso: string;
}
export interface ViewState { ra: number; dec: number; fov: number }
