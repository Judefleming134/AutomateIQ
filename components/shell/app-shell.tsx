"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import type { NavSection } from "./types";
import { Sidebar } from "./sidebar";

export function AppShell({
  brandLabel,
  topbarTitle,
  userLabel,
  userInitial,
  sections,
  children,
}: {
  brandLabel: string;
  topbarTitle: string;
  userLabel: string;
  userInitial: string;
  sections: NavSection[];
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="app-bg-glow" />

      <Sidebar
        brandLabel={brandLabel}
        sections={sections}
        isOpen={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <div
        className={`sidebar-backdrop${sidebarOpen ? " is-open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="main-col">
        <header className="topbar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
              flex: 1,
            }}
          >
            <button
              type="button"
              className="topbar-menu-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              <Menu size={18} />
            </button>
            <span className="topbar-title">{topbarTitle}</span>
          </div>
          <div className="topbar-user">
            <span className="status-chip">
              <span className="dot" />
              <span className="chip-text">Systems live</span>
            </span>
            <span className="topbar-user-label">{userLabel}</span>
            <span className="topbar-avatar">{userInitial}</span>
          </div>
        </header>

        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
