import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import logo from "@/assets/clearwater-logo.png";

const links = [
  { id: "home", label: "Home" },
  { id: "packages", label: "Packages" },
  { id: "calculator", label: "Savings Calculator" },
  { id: "how-it-works", label: "How It Works" },
  { id: "faq", label: "FAQ" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("home");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const ids = ["home", "packages", "calculator", "how-it-works", "faq", "contact"];
    const sections = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: 0 },
    );
    sections.forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const onLinkClick = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const navBg = { background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--grey-3)", boxShadow: scrolled ? "0 2px 16px rgba(0,0,0,0.07)" : "0 1px 4px rgba(0,0,0,0.04)" };

  const linkColor = "var(--grey-1)";

  return (
    <>
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, height: 68, transition: "all 300ms ease", ...navBg }}>
        <div style={{ height: "100%", padding: "0 max(24px, 4vw)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
          <a href="#home" onClick={(e) => { e.preventDefault(); onLinkClick("home"); }} style={{ display: "flex", alignItems: "center" }}>
            <img src={logo} alt="ClearWaterIreland" width={150} loading="eager" style={{ display: "block", height: "auto" }} />
          </a>

          <div className="nav-center" style={{ display: "flex", gap: 36, alignItems: "center" }}>
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} onClick={(e) => { e.preventDefault(); onLinkClick(l.id); }}
                 style={{ color: linkColor, fontSize: 14, fontWeight: 500, position: "relative", padding: "6px 0", transition: "color 200ms" }}
                 className="nav-link" data-active={active === l.id ? "true" : "false"}>
                {l.label}
              </a>
            ))}
          </div>

          <div className="nav-right" style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <a href="tel:017267941" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--navy-dark)", fontWeight: 600, fontSize: 15 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              (1) 726 7941
            </a>
            <a href="/#chatbot" onClick={(e) => { if (window.location.pathname === "/") { e.preventDefault(); onLinkClick("chatbot"); } }} style={{ color: "var(--navy-dark)", fontSize: 14, fontWeight: 600 }}>AI Assistant</a>
            <Link to="/portal" style={{ color: "var(--navy-dark)", fontSize: 14, fontWeight: 600, padding: "9px 16px", border: "1.5px solid var(--navy-dark)", borderRadius: 8, transition: "all 200ms" }}>Customer Portal</Link>
            <a href="#contact" onClick={(e) => { e.preventDefault(); onLinkClick("contact"); }} className="btn btn-cta" style={{ padding: "10px 20px", fontSize: 14 }}>Get a Quote</a>
          </div>

          <button onClick={() => setOpen(!open)} aria-label="Menu" className="nav-burger" style={{ background: "none", border: 0, cursor: "pointer", color: "var(--navy-dark)", padding: 4 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d={open ? "M6 6l12 12M18 6L6 18" : "M3 6h18M3 12h18M3 18h18"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>
      </nav>

      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "var(--navy-dark)", display: "flex", flexDirection: "column", padding: "92px 32px 32px", overflowY: "auto" }} className="dark-texture">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} onClick={(e) => { e.preventDefault(); onLinkClick(l.id); }} className="font-display" style={{ color: "#fff", fontSize: 36, fontWeight: 700 }}>{l.label}</a>
            ))}
            <Link to="/portal" onClick={() => setOpen(false)} className="font-display" style={{ color: "var(--sky)", fontSize: 36, fontWeight: 700 }}>Customer Portal</Link>
            <a href="/#chatbot" onClick={(e) => { if (window.location.pathname === "/") { e.preventDefault(); onLinkClick("chatbot"); } }} className="font-display" style={{ color: "var(--sky)", fontSize: 36, fontWeight: 700 }}>AI Assistant</a>
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <a href="tel:017267941" className="btn btn-cta" style={{ width: "100%", padding: "16px" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Call (1) 726 7941
            </a>
          </div>
        </div>
      )}

      <style>{`
        .nav-link::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--sky); transform: scaleX(0); transform-origin: left; transition: transform 200ms; }
        .nav-link:hover::after, .nav-link[data-active="true"]::after { transform: scaleX(1); }
        .nav-burger { display: none; }
        @media (max-width: 960px) {
          .nav-center { display: none !important; }
          .nav-right { display: none !important; }
          .nav-burger { display: inline-flex !important; }
        }
      `}</style>
    </>
  );
}
