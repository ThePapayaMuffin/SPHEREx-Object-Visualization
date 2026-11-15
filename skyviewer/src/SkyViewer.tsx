import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import type { OverlayObject, SkyCutout, ViewState } from "./types";
import { SKY_TEXTURE_URL } from "./api/skyApi";
import { proceduralSky } from "./dummy/dummyData";

export interface ViewerHandle { goTo(ra: number, dec: number, fov?: number): void; zoomBy(f: number): void; pan(dx: number, dy: number): void }
interface Props { catalog: OverlayObject[]; cutout: SkyCutout | null; frameIndex: number; layer: string; showLabels: boolean; onView: (v: ViewState) => void }
const D2R = Math.PI / 180, R = 500, MIN_FOV = 0.02;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (ra: number) => ((ra % 360) + 360) % 360;
// RA/Dec -> point on sky sphere. RA grows leftwards on screen (astronomical convention).
const dir = (ra: number, dec: number, r = 1) => new THREE.Vector3(-Math.cos(ra * D2R) * Math.cos(dec * D2R) * r, Math.sin(dec * D2R) * r, Math.sin(ra * D2R) * Math.cos(dec * D2R) * r);

type S = { ra: number; dec: number; fov: number; dirty: boolean };
function constrain(s: S, c: SkyCutout | null) {
  s.dec = clamp(s.dec, -89.5, 89.5); s.ra = wrap(s.ra);
  if (c) {
    const h = c.fovDeg / 2, hr = h / Math.cos(c.dec * D2R), dr = ((s.ra - c.ra + 540) % 360) - 180;
    s.dec = clamp(s.dec, c.dec - h, c.dec + h); s.ra = wrap(c.ra + clamp(dr, -hr, hr)); s.fov = clamp(s.fov, MIN_FOV, c.fovDeg * 1.2);
  } else s.fov = clamp(s.fov, MIN_FOV, 100);
}
type Label = { name: string; x: number; y: number; src: string };

export const SkyViewer = forwardRef<ViewerHandle, Props>((props, ref) => {
  const mount = useRef<HTMLDivElement>(null);
  const P = useRef(props); P.current = props;
  const st = useRef<S>({ ra: 83.8, dec: -5.4, fov: 60, dirty: true });
  const gl = useRef<{ scene?: THREE.Scene; plane?: THREE.Mesh; cache: Map<string, THREE.Texture> }>({ cache: new Map() });
  const [labels, setLabels] = useState<Label[]>([]);

  useImperativeHandle(ref, () => ({
    goTo: (ra, dec, fov) => { Object.assign(st.current, { ra, dec, dirty: true }); if (fov) st.current.fov = fov; },
    zoomBy: f => { st.current.fov *= f; st.current.dirty = true; },
    pan: (dx, dy) => { const s = st.current; s.ra -= dx * s.fov / Math.cos(s.dec * D2R); s.dec += dy * s.fov; s.dirty = true; },
  }));

  useEffect(() => {
    const el = mount.current!, s = st.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); el.prepend(renderer.domElement);
    const scene = new THREE.Scene(); gl.current.scene = scene;
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x222233 });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), mat));
    const useTex = (t: THREE.Texture) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; s.dirty = true; };
    new THREE.TextureLoader().load(SKY_TEXTURE_URL, useTex, undefined, () => useTex(new THREE.CanvasTexture(proceduralSky()))); // fallback

    const resize = () => { const { clientWidth: w, clientHeight: h } = el; renderer.setSize(w, h); renderer.setPixelRatio(devicePixelRatio); cam.aspect = w / h; cam.updateProjectionMatrix(); s.dirty = true; };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag) return; const dpp = s.fov / el.clientHeight;
      s.ra += (e.clientX - drag.x) * dpp / Math.cos(s.dec * D2R); s.dec += (e.clientY - drag.y) * dpp; drag = { x: e.clientX, y: e.clientY }; s.dirty = true; };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); s.fov *= Math.exp(e.deltaY * 0.0015); s.dirty = true; };
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === "INPUT") return; const d = 0.1, m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
      if (m[e.key]) { s.ra -= m[e.key][0] * s.fov / Math.cos(s.dec * D2R); s.dec += m[e.key][1] * s.fov; s.dirty = true; }
      if (e.key === "+" || e.key === "=") { s.fov *= 0.8; s.dirty = true; } if (e.key === "-") { s.fov *= 1.25; s.dirty = true; } };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    el.addEventListener("wheel", wheel, { passive: false }); window.addEventListener("keydown", key);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!s.dirty) return; s.dirty = false;
      constrain(s, P.current.cutout);
      cam.fov = s.fov; cam.updateProjectionMatrix(); cam.lookAt(dir(s.ra, s.dec)); cam.updateMatrixWorld();
      renderer.render(scene, cam);
      P.current.onView({ ra: s.ra, dec: s.dec, fov: s.fov });
      const list = P.current.cutout ? P.current.cutout.overlays : P.current.catalog, out: Label[] = [], v = new THREE.Vector3();
      if (P.current.showLabels) for (const o of list) { v.copy(dir(o.ra, o.dec, R)).project(cam);
        if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && out.length < 150) out.push({ name: o.name, src: o.source, x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight }); }
      setLabels(out);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", key); renderer.dispose(); renderer.domElement.remove(); };
  }, []);

  // Cutout plane: tangent-plane image at the locked position, swapped per frame/layer.
  useEffect(() => {
    const { scene, cache } = gl.current; if (!scene) return;
    const c = props.cutout;
    if (!c) { if (gl.current.plane) { scene.remove(gl.current.plane); gl.current.plane = undefined; } st.current.dirty = true; return; }
    if (!gl.current.plane) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff })); scene.add(m); gl.current.plane = m; }
    const m = gl.current.plane, w = 2 * 400 * Math.tan(c.fovDeg / 2 * D2R);
    m.scale.set(w, w, 1); m.position.copy(dir(c.ra, c.dec, 400)); m.lookAt(0, 0, 0);
    const load = (url: string, cb?: (t: THREE.Texture) => void) => { const hit = cache.get(url); if (hit) return cb?.(hit);
      new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace; cache.set(url, t); cb?.(t); }); };
    c.frames.forEach(f => Object.values(f.images).forEach(u => load(u))); // preload everything
    const url = c.frames[props.frameIndex]?.images[props.layer]; if (!url) return;
    load(url, t => { const mm = m.material as THREE.MeshBasicMaterial; mm.map = t; mm.needsUpdate = true; st.current.dirty = true; });
  }, [props.cutout, props.frameIndex, props.layer]);
  useEffect(() => { st.current.dirty = true; }, [props.showLabels, props.catalog, props.cutout]);

  return (<div ref={mount} className="viewer">
    <div className="labels">{labels.map((l, i) => <div key={i} className={`label ${l.src}`} style={{ transform: `translate(${l.x}px,${l.y}px)` }}><i />{l.name}</div>)}</div>
    <div className="crosshair" />
  </div>);
});
