import { useCallback, useEffect, useRef, useState } from "react";
import { SkyViewer, ViewerHandle } from "./SkyViewer";
import { fetchCatalog, fetchCutout, resolveName } from "./api/skyApi";
import type { OverlayObject, SkyCutout, ViewState } from "./types";

const p2 = (n: number) => String(n).padStart(2, "0");
const hms = (ra: number) => { const h = ra / 15, m = (h % 1) * 60, s = (m % 1) * 60; return `${p2(h | 0)}h ${p2(m | 0)}m ${s.toFixed(1).padStart(4, "0")}s`; };
const dms = (d: number) => { const a = Math.abs(d), m = (a % 1) * 60, s = (m % 1) * 60; return `${d < 0 ? "-" : "+"}${p2(a | 0)}° ${p2(m | 0)}′ ${s.toFixed(1).padStart(4, "0")}″`; };
const fovText = (f: number) => f >= 1 ? `${f.toFixed(2)}°` : f >= 1 / 60 ? `${(f * 60).toFixed(1)}′` : `${(f * 3600).toFixed(0)}″`;
const MAX_LOAD_FOV = 20; // cap on the FOV sent to the back end when loading from the crosshair

export default function App() {
  const viewer = useRef<ViewerHandle>(null);
  const [view, setView] = useState<ViewState>({ ra: 83.8, dec: -5.4, fov: 60 });
  const [catalog, setCatalog] = useState<OverlayObject[]>([]);
  const [cutout, setCutout] = useState<SkyCutout | null>(null);
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [layer, setLayer] = useState("ir"), [labels, setLabels] = useState(true), [hud, setHud] = useState(true);
  const [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const abort = useRef<AbortController>();

  useEffect(() => { fetchCatalog().then(setCatalog); }, []);
  useEffect(() => { if (!playing || !cutout) return; const id = setInterval(() => setFrame(i => (i + 1) % cutout.frames.length), 700 / speed); return () => clearInterval(id); }, [playing, speed, cutout]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "h" && (e.target as HTMLElement).tagName !== "INPUT") setHud(h => !h); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const lockTo = useCallback(async (ra: number, dec: number, fovDeg: number) => {
    abort.current?.abort(); abort.current = new AbortController(); setBusy(true); setErr("");
    try { const c = await fetchCutout({ ra, dec, fovDeg }, abort.current.signal);
      setCutout(c); setFrame(0); setLayer(l => c.layers.includes(l) ? l : c.layers[0]); viewer.current?.goTo(ra, dec, fovDeg);
      history.replaceState(null, "", `?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&fov=${fovDeg}`); } // shareable / embeddable link
    catch (e) { if ((e as Error).name !== "AbortError") setErr("Could not load data for that region"); } finally { setBusy(false); }
  }, []);

  // Open from URL: ?ra=133.795&dec=-7.245&fov=0.1
  useEffect(() => { const q = new URLSearchParams(location.search), ra = parseFloat(q.get("ra") ?? ""), dec = parseFloat(q.get("dec") ?? "");
    if (!isNaN(ra) && !isNaN(dec)) lockTo(ra, dec, parseFloat(q.get("fov") ?? "") || 2); }, [lockTo]);

  const loadAtCrosshair = () => lockTo(view.ra, view.dec, Math.min(view.fov, MAX_LOAD_FOV));
  const submit = async () => {
    const q = query.trim();
    if (!q) return loadAtCrosshair();                       // empty box: use current crosshair + FOV
    const nums = q.split(/[\s,]+/).map(Number);
    if (nums.length >= 2 && nums.every(n => !isNaN(n))) return lockTo(nums[0], nums[1], nums[2] ?? 2);
    const o = await resolveName(q); if (!o) return setErr(`No match for “${q}”`);
    setQuery(o.name); lockTo(o.ra, o.dec, 2);
  };
  const unlock = () => { setCutout(null); setPlaying(false); viewer.current?.zoomBy(8); history.replaceState(null, "", location.pathname); };
  const layers = cutout?.layers ?? ["ir"];

  return (<div className="app">
    <SkyViewer ref={viewer} catalog={catalog} cutout={cutout} frameIndex={frame} layer={layer} showLabels={labels} onView={setView} />
    {hud ? <>
      <header className="topbar">
        <div className="brand">SPHEREx<span>Sky Viewer</span></div>
        <div className="search">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Object name or “RA Dec [FOV°]” — leave empty to use the crosshair" />
          <button className="primary" onClick={submit} disabled={busy}>{busy ? "Loading…" : query.trim() ? "Go" : "Load at crosshair"}</button>
          {cutout && <button onClick={unlock}>Exit lock</button>}
        </div>
        <div className="group">
          <button onClick={() => viewer.current?.zoomBy(0.6)} aria-label="Zoom in">＋</button>
          <button onClick={() => viewer.current?.zoomBy(1 / 0.6)} aria-label="Zoom out">－</button>
        </div>
        <button onClick={() => setHud(false)} title="Hide the interface (H)">Hide UI</button>
        {err && <div className="err">{err}</div>}
      </header>
      <footer className="bottombar">
        <dl className="readout">
          <dt>RA</dt><dd>{hms(view.ra)}</dd><dt>Dec</dt><dd>{dms(view.dec)}</dd><dt>FOV</dt><dd>{fovText(view.fov)} <em>×{(60 / view.fov).toFixed(1)}</em></dd>
        </dl>
        {cutout ? <div className="timebar">
          <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</button>
          <input type="range" min={0} max={cutout.frames.length - 1} value={frame} onChange={e => { setPlaying(false); setFrame(+e.target.value); }} />
          <time>{cutout.frames[frame].time.slice(0, 10)}</time>
          <select value={speed} onChange={e => setSpeed(+e.target.value)}>{[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}</select>
        </div> : <div />}
        <div className="group">
          {layers.map(l => <button key={l} className={l === layer ? "on" : ""} onClick={() => setLayer(l)}>{l === "ir" ? "Infrared" : l === "visible" ? "Visible" : l}</button>)}
          <button className={labels ? "on" : ""} onClick={() => setLabels(!labels)}>Labels</button>
        </div>
      </footer>
    </> : <button className="showui" onClick={() => setHud(true)}>Show UI</button>}
  </div>);
}
