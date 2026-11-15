/** SPHEREx's six detectors and a false-colour scale for infrared wavelengths.
 * Infrared has no "real" colour; we map 0.75 µm -> violet-blue and 5 µm -> red so
 * shorter/longer reads intuitively. Used everywhere a wavelength is shown. */
export interface DetectorInfo { id: string; lo: number; hi: number; sees: string }

export const DETECTORS: DetectorInfo[] = [
  { id: "D1", lo: 0.75, hi: 1.09, sees: "Starlight from ordinary stars and galaxies" },
  { id: "D2", lo: 1.10, hi: 1.62, sees: "Water-vapour bands in cool stars and brown dwarfs" },
  { id: "D3", lo: 1.63, hi: 2.41, sees: "Methane bands in the coolest (T-type) brown dwarfs" },
  { id: "D4", lo: 2.42, hi: 3.82, sees: "Water ice (3.0 µm) and glowing dust grains (3.3 µm)" },
  { id: "D5", lo: 3.83, hi: 4.41, sees: "Carbon-dioxide ice (4.27 µm)" },
  { id: "D6", lo: 4.42, hi: 5.00, sees: "CO ice (4.67 µm), where the coldest brown dwarfs glow" },
];
export const LAMBDA_MIN = 0.75, LAMBDA_MAX = 5.0;
export const detector = (id: string) => DETECTORS.find(d => d.id === id);

/** False colour for a wavelength in µm. */
export function lambdaColor(um: number, alpha = 1): string {
  const t = Math.min(1, Math.max(0, (um - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)));
  return `hsl(${Math.round(255 - 255 * t)} 88% 64% / ${alpha})`;
}
/** CSS gradient across the whole SPHEREx range. */
export const SPECTRUM_GRADIENT = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1]
  .map(t => lambdaColor(LAMBDA_MIN + t * (LAMBDA_MAX - LAMBDA_MIN))).join(", ")})`;
