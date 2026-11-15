// Left-hand panel in the viewer: what the target is, what to expect, and what the
// current frame actually measured (wavelength, flags, release).
import type { FrameMeta, SkyCutout, SkyFrame } from "./types";
import { detector, lambdaColor } from "./spectrum";

const FLAG_INFO: Record<string, [string, "bad" | "warn" | "info"]> = {
  OVERFLOW: ["Saturated: brightness not reliable", "bad"], NONFUNC: ["Dead pixel", "bad"], MISSING_DATA: ["Missing data", "bad"],
  TRANSIENT: ["Transient or blooming pixels", "warn"], NONLINEAR: ["Near saturation", "warn"], GHOST: ["Possible optical ghost", "warn"],
  GHOST_FPA: ["Possible optical ghost", "warn"], GHOST_EXT: ["Possible optical ghost", "warn"], HALO: ["Bright-star halo", "warn"],
  PERSIST: ["Afterglow from an earlier bright source", "warn"], CROSSTALK: ["Electronic crosstalk", "warn"], STREAK: ["Satellite or meteor streak", "warn"],
  HOT: ["Hot pixel", "warn"], COLD: ["Cold pixel", "warn"], OUTLIER: ["Outlier pixel", "warn"], SUR_ERROR: ["Readout fit error", "warn"],
  SOURCE: ["A catalogued star is here (informational)", "info"],
};

function facts(c: SkyCutout) {
  const t = c.target, out: [string, string][] = [];
  if (!t) return out;
  const mu = Math.hypot(t.pmra, t.pmdec) / 1000;
  if (mu > 0.05) out.push(["Motion", `${mu.toFixed(1)}″/yr · ${(mu / 6.15).toFixed(2)} px/yr`]);
  if (t.plx > 0.5) { const ly = 1000 / t.plx * 3.2616; out.push(["Distance", ly < 100 ? `${ly.toFixed(1)} light-years` : `${Math.round(ly).toLocaleString()} light-years`]); }
  if (t.suggested_detector) out.push(["Best band", t.suggested_detector]);
  return out;
}

/** Wavelength at the target, frame by frame, within the detector's range. */
function LambdaTrack({ frames, layer, index }: { frames: SkyFrame[]; layer: string; index: number }) {
  const d = detector(layer), pts = frames.map(f => f.meta?.[layer]?.lambda_um ?? null);
  if (!d || pts.every(p => p === null)) return null;
  const W = 260, H = 56, x = (i: number) => frames.length < 2 ? W / 2 : 8 + i * (W - 16) / (frames.length - 1), y = (l: number) => H - 8 - (l - d.lo) / (d.hi - d.lo) * (H - 16);
  return (<figure className="lam-track">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Wavelength at the target in each ${layer} frame`}>
      <line x1="0" x2={W} y1={H - 8} y2={H - 8} /><line x1="0" x2={W} y1="8" y2="8" />
      {pts.map((l, i) => l === null ? null : <circle key={i} cx={x(i)} cy={y(l)} r={i === index ? 5 : 2.6} fill={lambdaColor(l)} className={i === index ? "cur" : ""} />)}
    </svg>
    <figcaption>Wavelength at the target, frame by frame <span>{d.lo.toFixed(2)}–{d.hi.toFixed(2)} µm</span></figcaption>
  </figure>);
}

export function TargetPanel({ cutout, frames, index, layer, meta, open, onToggle }:
  { cutout: SkyCutout; frames: SkyFrame[]; index: number; layer: string; meta?: FrameMeta; open: boolean; onToggle: () => void }) {
  const setOpen = (_: boolean) => onToggle();
  const t = cutout.target, named = !!t && !/^RA [\d.]+, Dec/.test(t.name) && t.source !== "crosshair position (no proper motion)";
  const d = detector(layer), flags = meta?.flags_at_target ?? [];
  const title = named ? t!.name : "Locked region";

  return (<aside className={`tpanel ${open ? "open" : ""}`} aria-label="Target details">
    <button className="tp-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span><small>{named ? (t!.moves ? "Moving target" : "Target") : "Sky region"}</small>{title}</span>
      <i aria-hidden="true">{open ? "−" : "+"}</i>
    </button>
    {open && <div className="tp-body">
      {named && facts(cutout).length > 0 && <dl className="tp-facts">{facts(cutout).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {!named && <p className="tp-notes">RA {cutout.ra.toFixed(4)}°, Dec {cutout.dec.toFixed(4)}°. Coordinates are treated as fixed (no proper motion).</p>}
      {named && t!.notes && <section><h4>What to expect</h4><p className="tp-notes">{t!.notes}</p></section>}

      {meta && <section>
        <h4>This frame <span className="tp-count">{index + 1} / {frames.length}</span></h4>
        <div className="tp-lambda" style={{ borderColor: meta.lambda_um ? lambdaColor(meta.lambda_um, 0.5) : undefined }}>
          <b style={{ color: meta.lambda_um ? lambdaColor(meta.lambda_um) : undefined }}>{meta.lambda_um != null ? `${meta.lambda_um.toFixed(3)} µm` : "λ unknown"}</b>
          {meta.bw_um != null && <span>± {(meta.bw_um / 2).toFixed(3)} µm</span>}
          <small>{meta.iso.slice(0, 10)} · {layer}{d ? ` (${d.lo.toFixed(2)}–${d.hi.toFixed(2)} µm)` : ""} · {meta.release.toUpperCase()}</small>
        </div>
        <LambdaTrack frames={frames} layer={layer} index={index} />
        <ul className="tp-flags">
          {flags.length === 0 ? <li className="ok">No quality flags at the target</li> :
            flags.map(f => { const [txt, lvl] = FLAG_INFO[f] ?? [f, "warn"]; return <li key={f} className={lvl}><code>{f}</code>{txt}</li>; })}
        </ul>
      </section>}

      <p className="tp-foot">
        {cutout.counts ? `${cutout.counts.exposures_at_position} SPHEREx exposures cover this spot · ` : ""}
        {cutout.releases?.length ? `releases ${cutout.releases.map(r => r.toUpperCase()).join(", ")}` : ""}
        {t?.source && named ? ` · position & motion: ${t.source}` : ""}
      </p>
    </div>}
  </aside>);
}
