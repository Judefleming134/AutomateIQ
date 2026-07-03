"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portal/review-agent", label: "Overview" },
  { href: "/portal/review-agent/send", label: "Send Request" },
  { href: "/portal/review-agent/customers", label: "Customers" },
  { href: "/portal/review-agent/history", label: "History" },
  { href: "/portal/review-agent/settings", label: "Settings" },
];

export function ReviewAgentSubnav() {
  const pathname = usePathname();

  return (
    <nav className="subnav">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/portal/review-agent"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={isActive ? "is-active" : ""}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
