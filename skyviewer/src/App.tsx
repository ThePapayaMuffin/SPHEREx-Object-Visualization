// Two pages: the homepage, and the sky viewer. A URL with ?ra/?dec, ?target or ?view
// opens the viewer directly, so shared and embedded links skip the homepage.
import { useEffect, useState } from "react";
import { Home } from "./home/Home";
import { Viewer } from "./Viewer";

const wantsViewer = () => { const q = new URLSearchParams(location.search); return q.has("ra") || q.has("target") || q.has("view"); };

export default function App() {
  const [page, setPage] = useState<"home" | "viewer">(wantsViewer() ? "viewer" : "home");
  useEffect(() => { const f = () => setPage(wantsViewer() ? "viewer" : "home"); window.addEventListener("popstate", f); return () => window.removeEventListener("popstate", f); }, []);
  const open = (target?: string) => { history.pushState(null, "", target ? `?target=${encodeURIComponent(target)}` : "?view=sky"); setPage("viewer"); };
  const home = () => { history.pushState(null, "", location.pathname); setPage("home"); };
  return page === "home" ? <Home onOpen={open} /> : <Viewer onHome={home} />;
}
