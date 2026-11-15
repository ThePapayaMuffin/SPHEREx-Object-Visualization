import { useEffect, useRef, useState } from "react";
import { SatelliteScene } from "./Satellite";
import { DETECTORS, LAMBDA_MAX, LAMBDA_MIN, SPECTRUM_GRADIENT, lambdaColor } from "../spectrum";
import "./home.css";

/** The five challenge targets. Facts here are for people; astrometry lives in the back end. */
const TARGETS = [
  { id: "wise0855", name: "WISE 0855−0714", kind: "Coldest known brown dwarf", change: "Moves 8.2″/yr", tag: "motion",
    blurb: "About 250 K, as cold as a kitchen freezer, 7.4 light-years away. It only glows at 4–5 µm, so look in D6." },
  { id: "barnard", name: "Barnard's Star", kind: "Red dwarf, 6 light-years away", change: "Moves 10.4″/yr", tag: "motion",
    blurb: "The fastest-moving star across our sky. Bright enough to saturate SPHEREx's core pixels, so follow the motion." },
  { id: "epsindib", name: "ε Indi B", kind: "Pair of brown dwarfs", change: "Moves 4.7″/yr", tag: "motion",
    blurb: "Two brown dwarfs 0.66″ apart that SPHEREx sees as one point, with strong methane and water bands." },
  { id: "rwaur", name: "RW Aurigae", kind: "Young star with a disk", change: "Brightness changes", tag: "variable",
    blurb: "A T Tauri star still gathering material. Its infrared brightness flickers irregularly." },
  { id: "rdra", name: "R Draconis", kind: "Pulsating giant (Mira)", change: "Brightness changes", tag: "variable",
    blurb: "Swells and dims over months. It sits near the ecliptic pole, so SPHEREx visits it most often." },
];

/** Fade sections in as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.15 });
    els.forEach(e => io.observe(e)); return () => io.disconnect();
  }, []);
}

export function Home({ onOpen }: { onOpen: (target?: string) => void }) {
  const lambda = useRef<HTMLSpanElement>(null);
  const [det, setDet] = useState("D6");
  const active = DETECTORS.find(d => d.id === det)!;
  useReveal();

  return (<div className="home">
    <section className="hero">
      <SatelliteScene readout={lambda} />
      <div className="hero-copy">
        <p className="eyebrow">NASA Space Apps 2026 · Planet X and SPHEREx</p>
        <h1>Watch the infrared sky <em>change</em>.</h1>
        <p className="lede">Pick a star and step through every SPHEREx exposure of it, aligned and labelled with the exact
          wavelength and quality of each frame, so what you see moving is really moving.</p>
        <div className="cta">
          <button className="primary big" onClick={() => onOpen()}>Explore the sky</button>
          <button className="big ghost" onClick={() => onOpen("wise0855")}>Start with WISE 0855 →</button>
        </div>
      </div>
      <div className="hero-hud" aria-hidden="true">
        <span className="dot" style={{ background: "currentColor" }} />Scanning <b><span ref={lambda}>2.50</span> µm</b>
        <span className="hint">Illustrative model · drag to rotate</span>
      </div>
      <a className="scroll-cue" href="#targets" aria-label="Scroll to targets"><span /></a>
    </section>

    <section id="targets" className="band">
      <div className="wrap">
        <header className="reveal"><p className="eyebrow">Start here</p><h2>Five worlds that won't sit still</h2>
          <p className="sub">The challenge's test targets: three cross the sky fast enough to see, two change in brightness.</p></header>
        <div className="cards">
          {TARGETS.map((t, i) => <button key={t.id} className="card reveal" style={{ transitionDelay: `${i * 60}ms` }} onClick={() => onOpen(t.id)}>
            <span className={`tag ${t.tag}`}>{t.change}</span>
            <h3>{t.name}</h3>
            <p className="kind">{t.kind}</p>
            <p>{t.blurb}</p>
            <span className="go">Open in viewer <i>→</i></span>
          </button>)}
        </div>
      </div>
    </section>

    <section className="band alt">
      <div className="wrap split">
        <div className="reveal">
          <p className="eyebrow">How SPHEREx sees</p>
          <h2>102 colours of infrared</h2>
          <p className="sub">SPHEREx photographs the whole sky about every six months through filters whose colour changes across
            each detector. Six detectors cover {LAMBDA_MIN}–{LAMBDA_MAX.toFixed(1)} µm, wavelengths our eyes can't see.
            Hover a band to see what it reveals.</p>
          <div className="stats">
            <div><b>102</b><span>spectral channels</span></div>
            <div><b>6.15″</b><span>per pixel</span></div>
            <div><b>2×</b><span>whole sky per year</span></div>
          </div>
        </div>
        <div className="spectrum reveal" onMouseLeave={() => setDet("D6")}>
          <div className="bar" style={{ background: SPECTRUM_GRADIENT }}>
            {DETECTORS.map(d => <button key={d.id} className={d.id === det ? "seg on" : "seg"}
              style={{ flexGrow: d.hi - d.lo }} onMouseEnter={() => setDet(d.id)} onFocus={() => setDet(d.id)} onClick={() => setDet(d.id)}
              aria-label={`${d.id}: ${d.lo}–${d.hi} µm`}><span>{d.id}</span></button>)}
          </div>
          <div className="axis"><span>{LAMBDA_MIN} µm · just past red light</span><span>{LAMBDA_MAX.toFixed(1)} µm</span></div>
          <div className="det-card" style={{ borderColor: lambdaColor((active.lo + active.hi) / 2, 0.6) }}>
            <b style={{ color: lambdaColor((active.lo + active.hi) / 2) }}>{active.id} · {active.lo.toFixed(2)}–{active.hi.toFixed(2)} µm</b>
            <p>{active.sees}</p>
          </div>
        </div>
      </div>
    </section>

    <section className="band">
      <div className="wrap">
        <header className="reveal"><p className="eyebrow">Honest by design</p><h2>What you see is what changed</h2></header>
        <div className="pillars">
          <div className="reveal"><i className="ico lam" /><h3>Every frame names its wavelength</h3>
            <p>Because SPHEREx's filter shifts across the detector, a star lands on a slightly different colour in each exposure.
              We show it on every frame, so a colour change isn't mistaken for a real one.</p></div>
          <div className="reveal"><i className="ico mot" /><h3>Moving stars are tracked</h3>
            <p>We predict where each star is on the date of every exposure from its measured motion, and keep it centred and marked.
              WISE 0855 is 2′ from its old catalogue position.</p></div>
          <div className="reveal"><i className="ico flag" /><h3>Bad pixels are shown, not hidden</h3>
            <p>Saturated, hot and ghost-affected pixels are masked and flagged on each frame. All frames from one detector share
              one brightness scale.</p></div>
        </div>
        <div className="final reveal">
          <h2>Ready to look?</h2>
          <button className="primary big" onClick={() => onOpen()}>Open the sky viewer</button>
        </div>
      </div>
    </section>

    <footer className="foot">
      <p>Built for the NASA Space Apps Challenge 2026. Images: SPHEREx data releases via NASA/IPAC IRSA. Names and motions:
        CDS SIMBAD. The spacecraft above is an illustrative model, and infrared colours are false colour.</p>
    </footer>
  </div>);
}
