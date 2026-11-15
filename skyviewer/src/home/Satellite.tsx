// Illustrative 3D model of SPHEREx for the homepage: nested conical photon shields
// on a hexagonal bus with a solar panel, a scanning beam that sweeps 0.75-5 µm in
// false colour, a star field and Earth's limb. Drag to spin; it tilts toward the mouse.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LAMBDA_MAX, LAMBDA_MIN } from "../spectrum";

const hueFor = (t: number) => (255 - 255 * t) / 360; // same false-colour scale as spectrum.ts

function panelTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b1730"; g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) {
    const grd = g.createLinearGradient(0, y * 32, 0, y * 32 + 30);
    grd.addColorStop(0, "#27508f"); grd.addColorStop(1, "#152d57");
    g.fillStyle = grd; g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
  }
  g.strokeStyle = "rgba(190,210,240,.35)"; g.lineWidth = 2; g.strokeRect(1, 1, 510, 254);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function earthTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a2142"; g.fillRect(0, 0, 1024, 512);
  let s = 11; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) { // land masses (stylised)
    g.fillStyle = `rgba(${40 + r() * 30 | 0},${70 + r() * 40 | 0},${45 + r() * 20 | 0},.55)`;
    g.beginPath(); g.ellipse(r() * 1024, 120 + r() * 280, 20 + r() * 90, 10 + r() * 40, r() * 3, 0, 7); g.fill();
  }
  g.filter = "blur(6px)";
  for (let i = 0; i < 160; i++) { // clouds
    g.fillStyle = `rgba(235,242,255,${0.05 + r() * 0.12})`;
    g.beginPath(); g.ellipse(r() * 1024, r() * 512, 15 + r() * 80, 4 + r() * 16, r() * 0.6, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildSpherex() {
  const g = new THREE.Group();
  const shield = new THREE.MeshStandardMaterial({ color: 0xb4bcc9, metalness: 1, roughness: 0.09, side: THREE.DoubleSide, envMapIntensity: 1.35 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a347, metalness: 1, roughness: 0.34 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252a33, metalness: 0.55, roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 0.2, roughness: 0.5 });

  const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.82, 6), dark); bus.position.y = -0.92; g.add(bus);
  const mli = new THREE.Mesh(new THREE.CylinderGeometry(0.815, 0.815, 0.44, 6), gold); mli.position.y = -0.92; g.add(mli);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 6), white); deck.position.y = -0.48; g.add(deck);

  // Three nested photon shields (cones opening upward) around the telescope.
  ([[1.05, 0.52, 1.72], [1.39, 0.66, 1.56], [1.74, 0.8, 1.4]] as const).forEach(([top, bot, h], i) => {
    const y0 = -0.45 + i * 0.05;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bot, h, 96, 1, true), shield);
    cone.position.y = y0 + h / 2; g.add(cone);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(top, 0.02, 8, 120), shield);
    lip.rotation.x = Math.PI / 2; lip.position.y = y0 + h; g.add(lip);
  });
  // Telescope tube and aperture.
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 1.05, 48), dark); tube.position.y = 0.1; g.add(tube);
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(0.37, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a1424, emissive: 0x1b4a8a, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.15 }));
  aperture.rotation.x = -Math.PI / 2; aperture.position.y = 0.63; g.add(aperture);

  // Solar panel on a strut.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.035, 1.15),
    [dark, dark, new THREE.MeshStandardMaterial({ map: panelTexture(), metalness: 0.45, roughness: 0.32 }), dark, dark, dark]);
  panel.position.set(-2.25, -0.98, 0); panel.rotation.z = 0.08; g.add(panel);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 12), white);
  strut.rotation.z = Math.PI / 2; strut.position.set(-1.15, -0.95, 0); g.add(strut);
  // Antenna and star trackers.
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), white);
  dish.rotation.x = Math.PI; dish.position.set(0.3, -1.38, 0.25); g.add(dish);
  for (const a of [0.6, 2.4]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), white);
    st.position.set(Math.cos(a) * 0.82, -0.82, Math.sin(a) * 0.82); g.add(st);
  }
  return g;
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color() }, time: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 color; uniform float time; varying vec2 vUv;
      void main(){
        float along = 1.0 - vUv.y;                       // 0 at the far end, 1 at the aperture
        float base = pow(along, 1.6) * 0.16;
        float pulse = exp(-pow((fract(time * 0.22) - (1.0 - along)) * 9.0, 2.0)) * 0.42 * along;
        float a = base + pulse;
        gl_FragColor = vec4(color * a, a);
      }`,
  });
}

export function SatelliteScene({ readout }: { readout?: React.RefObject<HTMLSpanElement> }) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mount.current!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { el.classList.add("no-webgl"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env;
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 500); cam.position.set(0, 0.4, 11);

    scene.add(new THREE.AmbientLight(0x7f8db0, 0.22));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); sun.position.set(6, 4, 5); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6cb8ff, 1.5); rim.position.set(-6, 1.5, -5); scene.add(rim);

    // Star field.
    const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), tint = [0xffffff, 0xd6e4ff, 0xffe4c8, 0xffcfae].map(c => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 140 + Math.random() * 60, s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const c = tint[(Math.random() * 4) | 0].clone().multiplyScalar(0.35 + Math.random() ** 2 * 0.9);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, depthWrite: false }));
    scene.add(stars);

    // Earth's limb with an atmosphere glow.
    const earth = new THREE.Mesh(new THREE.SphereGeometry(40, 96, 64), new THREE.MeshStandardMaterial({ map: earthTexture(), color: 0x6a7a92, roughness: 0.9, metalness: 0 }));
    const earthTilt = new THREE.Group(); earthTilt.position.set(0, -49, -32); earthTilt.rotation.set(0.4, 0, 1.25); // keep the poles off-camera
    earthTilt.add(earth); scene.add(earthTilt);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(40, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying vec3 vN; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.35,0.65,1.0,1.0) * i; }",
    }));
    atmo.scale.setScalar(1.06); atmo.position.copy(earthTilt.position); scene.add(atmo);

    // The spacecraft + scanning beam.
    const rig = new THREE.Group(); scene.add(rig);
    const sat = buildSpherex(); rig.add(sat);
    const beamMat = beamMaterial();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.36, 7, 64, 1, true), beamMat);
    beam.position.y = 0.66 + 3.5; sat.add(beam);

    // Layout: satellite to the right on wide screens, above the text on narrow ones.
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
      const halfW = Math.tan((cam.fov / 2) * Math.PI / 180) * cam.position.z * cam.aspect;
      if (w > 900) { const s = Math.min(0.95, Math.max(0.6, halfW / 6.2)); rig.position.set(halfW * 0.5, -0.35, 0); rig.scale.setScalar(s); }
      else { const halfH = halfW / cam.aspect, s = Math.min(0.75, halfW / 3.4); rig.position.set(0.25 * s, halfH - 1.75 * s - 0.35, 0); rig.scale.setScalar(s); }
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // Interaction: drag spins with inertia; mouse tilts gently.
    const auto = reduce ? 0 : 0.0028;
    let spin = 0.6, vel = auto, drag: number | null = null, tx = 0, ty = 0, tiltX = 0, tiltZ = 0;
    const down = (e: PointerEvent) => { drag = e.clientX; el.setPointerCapture(e.pointerId); el.classList.add("grabbing"); };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (drag !== null) { const dx = e.clientX - drag; drag = e.clientX; spin += dx * 0.008; vel = dx * 0.004; }
    };
    const up = () => { drag = null; el.classList.remove("grabbing"); };
    el.addEventListener("pointerdown", down); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);

    // Only render while visible.
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);

    const clock = new THREE.Clock(); let raf = 0, lastText = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const t = clock.getElapsedTime();
      if (drag === null) { vel += (auto - vel) * 0.02; spin += vel; }
      tiltX += ((reduce ? 0 : ty * 0.12) - tiltX) * 0.05; tiltZ += ((reduce ? 0 : -tx * 0.1) - tiltZ) * 0.05;
      sat.rotation.set(0.32 + tiltX, spin, -0.2 + tiltZ);
      sat.position.y = reduce ? 0 : Math.sin(t * 0.7) * 0.08;
      stars.rotation.y = t * 0.004; earth.rotation.y = t * 0.01;

      const phase = reduce ? 0.85 : (Math.sin(t * 0.28) + 1) / 2; // sweep across the band and back
      beamMat.uniforms.color.value.setHSL(hueFor(phase), 0.9, 0.6); beamMat.uniforms.time.value = t;
      if (readout?.current) { const txt = (LAMBDA_MIN + phase * (LAMBDA_MAX - LAMBDA_MIN)).toFixed(2); if (txt !== lastText) { readout.current.textContent = txt; lastText = txt; } }
      renderer.render(scene, cam);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      el.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }); });
      env.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [readout]);

  return <div ref={mount} className="sat-scene" aria-label="Illustrative 3D model of the SPHEREx spacecraft. Drag to rotate." role="img" />;
}
