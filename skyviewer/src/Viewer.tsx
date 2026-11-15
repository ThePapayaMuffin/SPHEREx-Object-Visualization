import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { SkyViewer, ViewerHandle } from "./SkyViewer";
import { TargetPanel } from "./TargetPanel";
import { fetchCatalog, fetchCutout, resolveName } from "./api/skyApi";
import { detector, lambdaColor } from "./spectrum";
import type { FrameMeta, OverlayObject, SkyCutout, ViewState } from "./types";

const p2 = (n: number) => String(n).padStart(2, "0");
const hms = (ra: number) => { const h = ra / 15, m = (h % 1) * 60, s = (m % 1) * 60; return `${p2(h | 0)}h ${p2(m | 0)}m ${s.toFixed(1).padStart(4, "0")}s`; };
const dms = (d: number) => { const a = Math.abs(d), m = (a % 1) * 60, s = (m % 1) * 60; return `${d < 0 ? "-" : "+"}${p2(a | 0)}° ${p2(m | 0)}′ ${s.toFixed(1).padStart(4, "0")}″`; };
const fovText = (f: number) => f >= 1 ? `${f.toFixed(2)}°` : f >= 1 / 60 ? `${(f * 60).toFixed(1)}′` : `${(f * 3600).toFixed(0)}″`;
const MAX_LOAD_FOV = 20; // cap on the FOV sent to the back end when loading from the crosshair (the back end clamps further)
const DEFAULT_LOAD_FOV = 0.15; // patch for names / typed coordinates. SPHEREx pixels are ~6″, so 0.15° ≈ 88 px
const layerName = (l: string, c: SkyCutout | null) => l === "ir" ? "Infrared" : l === "visible" ? "Visible" : c?.layerInfo?.[l]?.label ?? l;
/** Quality flags worth a badge in the time bar (SOURCE just means "a catalogued star is here"). */
const flagText = (m: FrameMeta) => {
  const f = (m.flags_at_target ?? []).filter(x => x !== "SOURCE");
  return f.includes("OVERFLOW") ? "saturated" : f.length ? f.join(", ").toLowerCase() : "";
};

export function Viewer({ onHome }: { onHome: () => void }) {
  const viewer = useRef<ViewerHandle>(null);
  const [view, setView] = useState<ViewState>({ ra: 83.8, dec: -5.4, fov: 60 });
  const [catalog, setCatalog] = useState<OverlayObject[]>([]);
  const [cutout, setCutout] = useState<SkyCutout | null>(null);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [layer, setLayer] = useState("ir"), [labels, setLabels] = useState(true), [hud, setHud] = useState(true);
  const [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [note, setNote] = useState("");
  const abort = useRef<AbortController>();
  // Side panel: on wide screens the sky view shifts right so the image sits beside it, not under it.
  const [vw, setVw] = useState(window.innerWidth), [panelOpen, setPanelOpen] = useState(window.innerWidth > 900);
  const panelRef = useRef(panelOpen); panelRef.current = panelOpen;
  useEffect(() => { const r = () => setVw(window.innerWidth); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  // Expose the bars' real heights (--tb, --bb) so the panel can sit between them on small screens.
  useEffect(() => {
    const root = document.documentElement.style, ro = new ResizeObserver(() => {
      const tb = document.querySelector(".topbar"), bb = document.querySelector(".bottombar");
      if (tb) root.setProperty("--tb", `${tb.getBoundingClientRect().height}px`); if (bb) root.setProperty("--bb", `${bb.getBoundingClientRect().height}px`);
    });
    document.querySelectorAll(".topbar,.bottombar").forEach(e => ro.observe(e)); return () => ro.disconnect();
  }, [hud, cutout]);
  const PANEL_W = 350, sidePanel = !!cutout && panelOpen && vw > 900;

  // Only step through frames that have an image for the selected layer (detector), so the date
  // shown always belongs to the image shown.
  const shown = useMemo(() => cutout && { ...cutout, frames: cutout.frames.filter(f => f.images[layer]) }, [cutout, layer]);
  const fi = Math.min(frame, Math.max(0, (shown?.frames.length ?? 1) - 1));
  const meta: FrameMeta | undefined = shown?.frames[fi]?.meta?.[layer];
  // Put the target's label where the target is on this frame's date (fast movers like WISE 0855).
  const display = useMemo(() => shown && meta ? { ...shown, overlays: shown.overlays.map(o => o.source === "target" ? { ...o, ra: meta.target_pos.ra, dec: meta.target_pos.dec } : o) } : shown, [shown, meta]);

  useEffect(() => { fetchCatalog().then(setCatalog).catch(() => setErr("Back end not reachable: labels unavailable")); }, []);
  useEffect(() => { if (!playing || !shown?.frames.length) return; const n = shown.frames.length; const id = setInterval(() => setFrame(i => (i + 1) % n), 700 / speed); return () => clearInterval(id); }, [playing, speed, shown]);
  useEffect(() => { const k = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "h") setHud(h => !h);
    if (e.key === " " && shown) { e.preventDefault(); setPlaying(p => !p); }
    if (e.key === "," || e.key === ".") { setPlaying(false); const n = shown?.frames.length ?? 1; setFrame(i => (i + (e.key === "." ? 1 : n - 1)) % n); }
  }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [shown]);

  const lockTo = useCallback(async (ra: number, dec: number, fovDeg: number, target?: string) => {
    abort.current?.abort(); abort.current = new AbortController(); setBusy(true); setErr(""); setNote("");
    try { const c = await fetchCutout({ ra, dec, fovDeg, target }, abort.current.signal);
      if (!c.frames.length) { setErr(c.message ?? "No SPHEREx images of this region yet"); return; }
      setCutout(c); setFrame(0); setPlaying(false);
      const pick = c.target?.suggested_detector; // e.g. WISE 0855 is only visible in D6
      setLayer(l => pick && c.layers.includes(pick) ? pick : c.layers.includes(l) ? l : c.layers[0]);
      // Back end may recentre (moving target) and clamp the FOV. Zoom out a touch so the image fits the free area.
      const avail = window.innerWidth - (panelRef.current && window.innerWidth > 900 ? 350 : 0) - 40;
      viewer.current?.goTo(c.ra, c.dec, c.fovDeg * Math.min(1.2, Math.max(1.05, window.innerHeight / Math.max(300, avail))));
      if (c.fovClamped) setNote(`Showing ${fovText(c.fovDeg)}, the largest patch available (asked for ${fovText(fovDeg)}).`);
      history.replaceState(null, "", `?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${c.fovDeg}${target ? `&target=${encodeURIComponent(target)}` : ""}`); } // shareable / embeddable link
    catch (e) { if ((e as Error).name !== "AbortError") setErr((e as Error).message || "Could not load data for that region"); } finally { setBusy(false); }
  }, []);

  // Open from URL: ?ra=133.795&dec=-7.245&fov=0.1[&target=wise0855]  or just ?target=Barnard's Star
  useEffect(() => { const q = new URLSearchParams(location.search), ra = parseFloat(q.get("ra") ?? ""), dec = parseFloat(q.get("dec") ?? "");
    const fov = parseFloat(q.get("fov") ?? "") || DEFAULT_LOAD_FOV, target = q.get("target") ?? undefined;
    if (!isNaN(ra) && !isNaN(dec)) lockTo(ra, dec, fov, target);
    else if (target) { setBusy(true); resolveName(target).then(o => o ? lockTo(o.ra, o.dec, fov, target) : (setBusy(false), setErr(`No match for “${target}”`))); } }, [lockTo]);

  const loadAtCrosshair = () => lockTo(view.ra, view.dec, Math.min(view.fov, MAX_LOAD_FOV));
  const submit = async () => {
    const q = query.trim();
    if (!q) return loadAtCrosshair();                       // empty box: use current crosshair + FOV
    const nums = q.split(/[\s,]+/).map(Number);
    if (nums.length >= 2 && nums.every(n => !isNaN(n))) return lockTo(nums[0], nums[1], nums[2] ?? DEFAULT_LOAD_FOV);
    const o = await resolveName(q); if (!o) return setErr(`No match for “${q}”`);
    setQuery(o.name); lockTo(o.ra, o.dec, DEFAULT_LOAD_FOV, q); // pass the name so the back end can follow its motion
  };
  const unlock = () => { setCutout(null); setPlaying(false); setNote(""); viewer.current?.zoomBy(8); history.replaceState(null, "", "?view=sky"); };
  /** Change detector, staying on the frame closest in time. */
  const switchLayer = (l: string) => {
    const t = shown?.frames[fi]?.time, fr = cutout?.frames.filter(f => f.images[l]) ?? [];
    let best = 0; if (t) fr.forEach((f, i) => { if (Math.abs(Date.parse(f.time) - Date.parse(t)) < Math.abs(Date.parse(fr[best].time) - Date.parse(t))) best = i; });
    setLayer(l); setFrame(best);
  };
  const layers = cutout?.layers ?? ["ir"];
  const cur = shown?.frames.length ? shown.frames[fi] : null;

  return (<div className="app">
    <SkyViewer ref={viewer} catalog={catalog} cutout={display} frameIndex={fi} layer={layer} showLabels={labels} onView={setView} centerOffsetX={sidePanel && hud ? PANEL_W / 2 : 0} />
    {cutout?.synthetic && !hud && <div className="synthetic floating">Synthetic test data, not real SPHEREx images</div>}
    {busy && <div className="scanning" role="status"><div className="rings"><i /><i /><i /></div>
      <p>Fetching SPHEREx exposures from IRSA…</p><small>The first load of a region can take up to a minute. After that it's instant.</small></div>}
    {hud ? <>
      <header className="topbar">
        <button className="brand" onClick={onHome} title="Back to the homepage">SPHEREx<span>Sky Viewer</span></button>
        <div className="search">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Object name or “RA Dec [FOV°]” — leave empty to use the crosshair" aria-label="Search for an object or coordinates" />
          <button className="primary" onClick={submit} disabled={busy}>{busy ? "Loading…" : query.trim() ? "Go" : "Load at crosshair"}</button>
          {cutout && <button onClick={unlock}>Exit lock</button>}
        </div>
        <div className="group">
          <button onClick={() => viewer.current?.zoomBy(0.6)} aria-label="Zoom in">＋</button>
          <button onClick={() => viewer.current?.zoomBy(1 / 0.6)} aria-label="Zoom out">－</button>
        </div>
        <button onClick={() => setHud(false)} title="Hide the interface (H)">Hide UI</button>
        {cutout?.synthetic && <div className="banner-row"><span className="synthetic">Synthetic test data, not real SPHEREx images</span></div>}
        {err && <div className="err">{err}</div>}
        {note && !busy && <div className="note">{note}</div>}
      </header>
      {cutout && shown && <TargetPanel cutout={cutout} frames={shown.frames} index={fi} layer={layer} meta={meta} open={panelOpen} onToggle={() => setPanelOpen(o => !o)} />}
      <footer className="bottombar">
        <dl className="readout">
          <dt>RA</dt><dd>{hms(view.ra)}</dd><dt>Dec</dt><dd>{dms(view.dec)}</dd><dt>FOV</dt><dd>{fovText(view.fov)} <em>×{(60 / view.fov).toFixed(1)}</em></dd>
        </dl>
        {shown && cur ? <div className="timebar">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause (space)" : "Play (space)"}>{playing ? "❚❚" : "▶"}</button>
          <div className="scrub">
            <input type="range" min={0} max={shown.frames.length - 1} value={fi} onChange={e => { setPlaying(false); setFrame(+e.target.value); }} aria-label="Frame" />
            <div className="ticks" aria-hidden="true">{shown.frames.map((f, i) => { const l = f.meta?.[layer]?.lambda_um;
              return <i key={i} className={i === fi ? "on" : ""} style={{ left: `${shown.frames.length < 2 ? 50 : i / (shown.frames.length - 1) * 100}%`, background: l ? lambdaColor(l) : undefined }} />; })}</div>
          </div>
          <time>{cur.time.slice(0, 10)}</time>
          {meta && <span className="meta" title="Wavelength at the target in this exposure (SPHEREx's filter varies across the detector) · data release">
            <i className="swatch" style={{ background: meta.lambda_um ? lambdaColor(meta.lambda_um) : "#666" }} />
            {meta.lambda_um != null ? `${meta.lambda_um.toFixed(2)} µm` : "λ ?"}
            {flagText(meta) && <b className="flag" title={`Quality flags at the target: ${(meta.flags_at_target ?? []).join(", ")}`}>{flagText(meta)}</b>}
          </span>}
          <select value={speed} onChange={e => setSpeed(+e.target.value)} aria-label="Playback speed">{[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}</select>
        </div> : <div className="hint-line">{busy ? "" : "Drag to pan · scroll to zoom · search a star or press Load at crosshair"}</div>}
        <div className="group layers">
          {layers.map(l => { const d = detector(l);
            return <button key={l} className={`${l === layer ? "on" : ""} ${d ? "det" : ""}`} onClick={() => switchLayer(l)} title={layerName(l, cutout)}
              style={d ? { "--det": lambdaColor((d.lo + d.hi) / 2) } as CSSProperties : undefined}>{d ? l : layerName(l, cutout)}</button>; })}
          <button className={labels ? "on" : ""} onClick={() => setLabels(!labels)}>Labels</button>
        </div>
      </footer>
    </> : <button className="showui" onClick={() => setHud(true)}>Show UI</button>}
  </div>);
}
