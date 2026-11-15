// Search with autocomplete (challenge targets + bright objects, then "look up in SIMBAD"),
// plus an optional row of separate RA / Dec / FOV boxes.
import { useMemo, useRef, useState } from "react";
import type { OverlayObject } from "./types";

export type Pick = { kind: "name"; query: string; known?: OverlayObject } | { kind: "coords"; ra: number; dec: number; fovDeg?: number } | { kind: "crosshair" };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
/** "133.795", "08 55 10.8", "08h55m10.8s" -> degrees. RA in h m s is converted from hours. */
export function parseAngle(s: string, isRA: boolean): number | null {
  const t = s.trim(); if (!t) return null;
  if (/^[+-]?\d+(\.\d+)?°?$/.test(t)) return parseFloat(t);
  const parts = t.replace(/[hdms°'′"″:]/gi, " ").trim().split(/\s+/).map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  const v = Math.abs(parts[0]) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return isRA ? v * 15 : (t.startsWith("-") ? -v : v);
}
const KIND: Record<string, string> = { challenge: "Challenge target", bright: "Bright object", simbad: "SIMBAD" };

export function SearchBox({ catalog, busy, onPick, coordsOpen, onToggleCoords }:
  { catalog: OverlayObject[]; busy: boolean; onPick: (p: Pick) => void; coordsOpen: boolean; onToggleCoords: () => void }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [hi, setHi] = useState(0);
  const [ra, setRa] = useState(""), [dec, setDec] = useState(""), [fov, setFov] = useState("6"), [cErr, setCErr] = useState("");
  const box = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const k = norm(q); if (!k) return catalog.filter(o => o.source === "challenge").slice(0, 6);
    return catalog.filter(o => norm(o.name).includes(k) || (o.target?.id && norm(o.target.id).includes(k)))
      .sort((a, b) => Number(!norm(a.name).startsWith(k)) - Number(!norm(b.name).startsWith(k))).slice(0, 7);
  }, [q, catalog]);
  const options = [...matches.map(o => ({ label: o.name, sub: KIND[o.source] ?? o.source, o })), ...(q.trim() ? [{ label: `Look up “${q.trim()}”`, sub: KIND.simbad, o: undefined }] : [])];

  const choose = (i: number) => {
    const opt = options[i]; setOpen(false); if (!opt) return;
    if (opt.o) { setQ(opt.o.name); onPick({ kind: "name", query: opt.o.target?.id ?? opt.o.name, known: opt.o }); }
    else submitText();
  };
  const submitText = () => {
    const t = q.trim(); setOpen(false);
    if (!t) return onPick({ kind: "crosshair" });
    const nums = t.split(/[\s,]+/).map(Number);   // still accepts "RA Dec [FOV°]" typed in one box
    if (nums.length >= 2 && nums.length <= 3 && nums.every(n => !isNaN(n))) return onPick({ kind: "coords", ra: nums[0], dec: nums[1], fovDeg: nums[2] });
    onPick({ kind: "name", query: t });
  };
  const submitCoords = () => {
    const r = parseAngle(ra, true), d = parseAngle(dec, false), f = parseFloat(fov);
    if (r === null || r < 0 || r >= 360) return setCErr("RA: degrees (0–360) or h m s, e.g. 08 55 10.8");
    if (d === null || d < -90 || d > 90) return setCErr("Dec: degrees (−90 to +90) or d m s, e.g. -07 14 32");
    if (!(f > 0)) return setCErr("FOV: arcminutes, e.g. 6");
    setCErr(""); onPick({ kind: "coords", ra: r, dec: d, fovDeg: f / 60 });
  };

  return (<>
    <div className="search" role="search">
      <div className="ac">
        <input ref={box} value={q} placeholder="Search a star or object — e.g. WISE 0855, Barnard, M101"
          aria-label="Search for an object" aria-autocomplete="list" aria-expanded={open} role="combobox"
          onChange={e => { setQ(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(options.length - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter") { if (q.trim() && open && options.length) choose(hi); else submitText(); } // empty box + Enter = load at crosshair
          }} />
        {open && options.length > 0 && <ul className="ac-list" role="listbox">
          {!q.trim() && <li className="ac-head">Challenge targets</li>}
          {options.map((o, i) => <li key={o.label} role="option" aria-selected={i === hi} className={i === hi ? "on" : ""}
            onMouseDown={e => { e.preventDefault(); choose(i); }} onMouseEnter={() => setHi(i)}>
            <span>{o.label}</span><small>{o.sub}</small></li>)}
        </ul>}
      </div>
      <button className="primary" onClick={submitText} disabled={busy}>{busy ? "Loading…" : q.trim() ? "Go" : "Load at crosshair"}</button>
      <button className={coordsOpen ? "on" : ""} onClick={onToggleCoords} aria-expanded={coordsOpen} title="Enter RA, Dec and field of view">RA / Dec</button>
    </div>
    {coordsOpen && <form className="coords" onSubmit={e => { e.preventDefault(); submitCoords(); }}>
      <label>RA<input value={ra} onChange={e => setRa(e.target.value)} placeholder="133.7599 or 08 55 02.4" /></label>
      <label>Dec<input value={dec} onChange={e => setDec(e.target.value)} placeholder="-7.2422 or -07 14 32" /></label>
      <label>FOV<span className="unit"><input value={fov} onChange={e => setFov(e.target.value)} inputMode="decimal" />arcmin</span></label>
      <button className="primary" type="submit" disabled={busy}>Load</button>
      <small className="coords-help">{cErr || "Field of view = width of the patch of sky. 6′ ≈ 59 SPHEREx pixels across; max 18′."}</small>
    </form>}
  </>);
}
