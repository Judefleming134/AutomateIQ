"use client";

import { useEffect, useState } from "react";
import type { Heading } from "./markdown";

function useReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const article = document.getElementById("doc-article");
    function onScroll() {
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const total = article.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setProgress(total > 0 ? Math.round((scrolled / total) * 100) : 100);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return progress;
}

/** Full-width reading-progress bar, fixed under the topbar. Rendered once. */
export function DocProgress() {
  const progress = useReadingProgress();
  return <div className="doc-progress" style={{ transform: `scaleX(${progress / 100})` }} />;
}

/** Scrollspy table of contents. Lives in the aside column. */
export function DocToc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState("");
  const progress = useReadingProgress();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="doc-toc" aria-label="On this page">
      <p className="doc-toc-title">On this page</p>
      <ul>
        {headings.map((h) => (
          <li key={h.id} className={`doc-toc-l${h.level} ${active === h.id ? "is-active" : ""}`}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
      <div className="doc-toc-progress">{progress}% read</div>
    </nav>
  );
}
