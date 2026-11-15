/**
 * Types for the SPHEREx flipbook API (apps/api). They mirror the JSON the
 * Python backend returns; see apps/api/API.md for meanings and examples.
 * Framework-agnostic: import from React, Svelte or anything else.
 */

export type Detector = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

export interface Target {
	id: string;
	name: string;
	/** Degrees, ICRS, at `epoch`. */
	ra: number;
	dec: number;
	/** Julian year of ra/dec (2000.0 for SIMBAD positions). */
	epoch: number;
	/** mas/yr; pmra includes cos(dec). */
	pmra: number;
	pmdec: number;
	/** mas */
	plx: number;
	moves: boolean;
	source: string;
	/** What to expect in SPHEREx for this object, written to be shown to users. */
	notes: string;
	suggested_detector: Detector | null;
}

export interface Frame {
	index: number;
	/** Relative URL of the PNG (greyscale + alpha; transparent = masked or no data). */
	png: string;
	mjd: number;
	/** UTC, e.g. "2025-11-03T04:12:55Z" */
	iso: string;
	detector: Detector;
	/** Wavelength and bandwidth at the target in this exposure, µm. null = unknown. */
	lambda_um: number | null;
	bw_um: number | null;
	/** Flag names set in the 3x3 pixels at the target; [] = clean; null = target outside cutout. */
	flags_at_target: string[] | null;
	/** Fraction of the frame that is masked (0-1). */
	masked_frac: number;
	/** Where the target is on THIS frame's date. px is in PNG pixels, (0,0) = top-left pixel centre. */
	target_pos: { ra: number; dec: number; px: [number, number] };
	/** "dr1", "qr3", or "fake" in synthetic mode. */
	release: string;
	/** Processing version from the file path, e.g. "l2b-v27-2026-197". */
	version: string | null;
	obs_id: string;
	/** The original IRSA image (72 MB; don't load in the browser). */
	source_url: string;
}

export interface Discovery {
	method: 'sia' | 'tap' | 'fake';
	releases: string[];
	/** live = just asked IRSA; cache = < 6 h old; stale-cache = IRSA down, older answer used. */
	source: 'live' | 'cache' | 'stale-cache' | 'fake';
	queried_at: string;
	seconds: number;
}

export interface FramesManifest {
	key: string;
	/** true = invented data (SPHEREX_FAKE=1). Show a clear banner. */
	synthetic: boolean;
	target: Target;
	/** Centre of every frame: the target's position at the median frame date. */
	center: { ra: number; dec: number };
	fov_deg: number;
	detector: Detector | 'all';
	detector_range_um: [number, number] | null;
	zodi_subtracted: boolean;
	masked_bits: number[];
	grid: {
		npix: number;
		pix_arcsec: number;
		crval: [number, number];
		crpix: [number, number];
		cdelt: [number, number];
		projection: string;
	};
	counts: {
		exposures_at_position: number;
		exposures_this_detector: number;
		requested: number;
		frames: number;
		failed: number;
	};
	/** Non-null when there are no frames, explaining why. */
	message: string | null;
	releases_present: string[];
	failed: { obs_id: string; error: string }[];
	build_seconds: number;
	built_at: string;
	proc_version: string;
	frames: Frame[];
	discovery: Discovery;
	/** true = served from the backend's cache. */
	cached: boolean;
}

export interface FramesQuery {
	target?: string;
	ra?: number;
	dec?: number;
	fov?: number;
	det?: Detector | 'all';
	limit?: number;
	zodi?: boolean;
}

/** Error body for 404 / 422 / 503. */
export interface ApiError {
	detail: string | unknown[];
}
