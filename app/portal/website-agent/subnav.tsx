"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portal/website-agent", label: "Your Page" },
  { href: "/portal/website-agent/leads", label: "Leads" },
];

export function WebsiteAgentSubnav() {
  const pathname = usePathname();

  return (
    <nav className="subnav">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/portal/website-agent"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={isActive ? "is-active" : ""}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
