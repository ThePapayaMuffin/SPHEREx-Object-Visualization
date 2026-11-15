import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import type { OverlayObject, SkyCutout, ViewState } from "./types";
import { SKY_TEXTURE_URL } from "./api/skyApi";
import { proceduralSky } from "./dummy/dummyData";

export interface ViewerHandle { goTo(ra: number, dec: number, fov?: number): void; zoomBy(f: number): void; pan(dx: number, dy: number): void }
/** centerOffsetX: shift the view centre right by this many px (to make room for a side panel). */
/** extra: field-star markers (Gaia/CatWISE). track: target's position on each frame's date; trackIndex = current frame. */
interface Props { catalog: OverlayObject[]; cutout: SkyCutout | null; frameIndex: number; layer: string; showLabels: boolean; onView: (v: ViewState) => void; centerOffsetX?: number;
  extra?: OverlayObject[]; track?: { ra: number; dec: number }[]; trackIndex?: number;
  /** false = show each SPHEREx pixel as a sharp square (good for checking 1-pixel shifts). */
  smooth?: boolean;
  /** Paint masked (untrusted) pixels red. Default true. */
  showMasked?: boolean }
const D2R = Math.PI / 180, R = 500, MIN_FOV = 0.02;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (ra: number) => ((ra % 360) + 360) % 360;
// RA/Dec -> point on sky sphere. RA grows leftwards on screen (astronomical convention).
const dir = (ra: number, dec: number, r = 1) => new THREE.Vector3(-Math.cos(ra * D2R) * Math.cos(dec * D2R) * r, Math.sin(dec * D2R) * r, Math.sin(ra * D2R) * Math.cos(dec * D2R) * r);

/** Frame image material: transparent (masked / no-data) pixels are painted in MASK_RED, or left as background grey. */
const MASK_RED = 0xe0332e;
function frameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, maskColor: { value: new THREE.Color(MASK_RED) }, showMask: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D map; uniform vec3 maskColor; uniform float showMask; varying vec2 vUv;
      void main(){
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(mix(t.rgb, maskColor, (1.0 - t.a) * showMask), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
type S = { ra: number; dec: number; fov: number; dirty: boolean };
function constrain(s: S, c: SkyCutout | null) {
  s.dec = clamp(s.dec, -89.5, 89.5); s.ra = wrap(s.ra);
  if (c) {
    const h = c.fovDeg / 2, hr = h / Math.cos(c.dec * D2R), dr = ((s.ra - c.ra + 540) % 360) - 180;
    s.dec = clamp(s.dec, c.dec - h, c.dec + h); s.ra = wrap(c.ra + clamp(dr, -hr, hr)); s.fov = clamp(s.fov, MIN_FOV, c.fovDeg * 1.2);
  } else s.fov = clamp(s.fov, MIN_FOV, 100);
}
type Label = { name: string; x: number; y: number; src: string; mag?: number };
type Pt = { x: number; y: number };

export const SkyViewer = forwardRef<ViewerHandle, Props>((props, ref) => {
  const mount = useRef<HTMLDivElement>(null);
  const P = useRef(props); P.current = props;
  const st = useRef<S>({ ra: 83.8, dec: -5.4, fov: 60, dirty: true });
  const gl = useRef<{ scene?: THREE.Scene; plane?: THREE.Mesh; cache: Map<string, THREE.Texture> }>({ cache: new Map() });
  const [labels, setLabels] = useState<Label[]>([]);
  const [track, setTrack] = useState<Pt[]>([]);

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
      cam.fov = s.fov; const off = P.current.centerOffsetX ?? 0;
      if (off) cam.setViewOffset(el.clientWidth, el.clientHeight, -off, 0, el.clientWidth, el.clientHeight); else cam.clearViewOffset();
      cam.updateProjectionMatrix(); cam.lookAt(dir(s.ra, s.dec)); cam.updateMatrixWorld();
      renderer.render(scene, cam);
      P.current.onView({ ra: s.ra, dec: s.dec, fov: s.fov });
      const c = P.current.cutout, named = P.current.showLabels ? (c ? c.overlays : P.current.catalog) : [];
      const list = [...(c ? P.current.extra ?? [] : []), ...named], out: Label[] = [], v = new THREE.Vector3();
      const toScreen = (ra: number, dec: number): Pt | null => { v.copy(dir(ra, dec, R)).project(cam);
        return v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 ? { x: (v.x + 1) / 2 * el.clientWidth, y: (1 - v.y) / 2 * el.clientHeight } : null; };
      for (const o of list) { const p = toScreen(o.ra, o.dec); if (p && out.length < 900) out.push({ name: o.name, src: o.source, mag: o.mag, ...p }); }
      setLabels(out);
      setTrack(c ? (P.current.track ?? []).map(t => toScreen(t.ra, t.dec)).filter((p): p is Pt => !!p) : []);
    };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", key); renderer.dispose(); renderer.domElement.remove(); };
  }, []);

  // Cutout plane: tangent-plane image at the locked position, swapped per frame/layer.
  useEffect(() => {
    const { scene, cache } = gl.current; if (!scene) return;
    const c = props.cutout;
    if (!c) { if (gl.current.plane) { scene.remove(gl.current.plane); gl.current.plane = undefined; } st.current.dirty = true; return; }
    if (!gl.current.plane) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), frameMaterial()); scene.add(m); gl.current.plane = m; }
    const m = gl.current.plane, w = 2 * 400 * Math.tan(c.fovDeg / 2 * D2R);
    m.scale.set(w, w, 1); m.position.copy(dir(c.ra, c.dec, 400)); m.lookAt(0, 0, 0);
    const load = (url: string, cb?: (t: THREE.Texture) => void) => { const hit = cache.get(url); if (hit) return cb?.(hit);
      new THREE.TextureLoader().load(url, t => { t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = P.current.smooth === false ? THREE.NearestFilter : THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
        cache.set(url, t); cb?.(t); }); };
    c.frames.forEach(f => Object.values(f.images).forEach(u => load(u))); // preload everything
    const url = c.frames[props.frameIndex]?.images[props.layer]; if (!url) return;
    load(url, t => { (m.material as THREE.ShaderMaterial).uniforms.map.value = t; st.current.dirty = true; });
  }, [props.cutout, props.frameIndex, props.layer]);
  useEffect(() => {
    const m = gl.current.plane?.material as THREE.ShaderMaterial | undefined;
    if (m?.uniforms) { m.uniforms.showMask.value = props.showMasked === false ? 0 : 1; st.current.dirty = true; }
  }, [props.showMasked, props.cutout]);
  // Switch every loaded frame between smooth and sharp pixels.
  useEffect(() => {
    const f = props.smooth === false ? THREE.NearestFilter : THREE.LinearFilter;
    gl.current.cache.forEach(t => { if (t.magFilter !== f) { t.magFilter = f; t.needsUpdate = true; } });
    st.current.dirty = true;
  }, [props.smooth]);
  useEffect(() => { st.current.dirty = true; }, [props.showLabels, props.catalog, props.cutout, props.centerOffsetX, props.extra, props.track]);

  return (<div ref={mount} className="viewer">
    <div className="labels">
      {track.length > 1 && <svg className="track" aria-hidden="true">
        <polyline points={track.map(p => `${p.x},${p.y}`).join(" ")} />
        {track.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 || i === track.length - 1 ? 3.5 : 2} className={i === (props.trackIndex ?? -1) ? "cur" : i === 0 ? "start" : i === track.length - 1 ? "end" : ""} />)}
      </svg>}
      {labels.map((l, i) => {
        const at = { transform: `translate(${l.x}px,${l.y}px)` };
        if (l.src === "gaia" || l.src === "catwise") return <div key={i} className={`mark ${l.src}`} style={at} />;
        if (l.src === "target") return <div key={i} className="label target" style={at}><span className="reticle"><b /><b /><b /><b /></span><em>{l.name}</em></div>;
        return <div key={i} className={`label ${l.src}`} style={at}><i />{l.name}</div>;
      })}
    </div>
    <div className="crosshair" style={props.centerOffsetX ? { transform: `translateX(${props.centerOffsetX}px)` } : undefined} />
  </div>);
});
