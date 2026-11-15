/** Shared front-end/back-end contract. See README. */
export interface OverlayObject { name: string; ra: number; dec: number; mag?: number; source: string } // degrees (ICRS)
export interface SkyFrame { time: string; images: Record<string, string> } // layer id -> image URL (N up, E left, covers fovDeg square)
export interface SkyRequest { ra: number; dec: number; fovDeg: number }
export interface SkyCutout { ra: number; dec: number; fovDeg: number; layers: string[]; frames: SkyFrame[]; overlays: OverlayObject[] }
export interface ViewState { ra: number; dec: number; fov: number }
