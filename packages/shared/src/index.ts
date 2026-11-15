export interface Frame {
  id: string;
  mjd: number; // observation time
  detector: number; // 1-6
  wavelengthUm: number; // at the target pixel
  version: string; // QR3 / DR1 processing version
  flags: number; // fraction or bitmask of bad pixels
  imageUrl: string; // /api/cutout?id=...
}

export interface FramesResponse {
  ra: number;
  dec: number;
  fovDeg: number;
  frames: Frame[];
  failed: number; // cutouts that errored
}
