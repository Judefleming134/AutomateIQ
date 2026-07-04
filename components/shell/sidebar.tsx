"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "./types";
import { SignOutButton } from "./sign-out-button";

export function Sidebar({
  brandLabel,
  sections,
  isOpen,
  onNavigate,
}: {
  brandLabel: string;
  sections: NavSection[];
  isOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className={`sidebar${isOpen ? " is-open" : ""}`}>
      <div className="sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
        {brandLabel.includes("Admin") && (
          <span className="brand-admin-badge">ADMIN</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {sections.map((section, i) => (
          <div key={section.label ?? i}>
            {section.label && (
              <div className="sidebar-section-label">{section.label}</div>
            )}
            {section.items.map((item) => {
              // Exact match for the dashboard root, prefix match for
              // everything else so a sub-nav page still highlights its
              // parent tile (e.g. /portal/review-agent/send).
              const isActive =
                item.href === "/portal" || item.href === "/admin"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/");

              if (item.disabled) {
                return (
                  <span
                    key={item.href}
                    className="sidebar-link is-disabled"
                    title="Coming soon"
                  >
                    {item.icon}
                    {item.label}
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`sidebar-link${isActive ? " is-active" : ""}`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <SignOutButton />
      </div>
    </aside>
  );
}
