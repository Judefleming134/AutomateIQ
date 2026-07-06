"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portal/logistics", label: "Control Centre" },
  { href: "/portal/logistics/fleet", label: "Fleet" },
  { href: "/portal/logistics/warehouses", label: "Warehouses" },
  { href: "/portal/logistics/routes", label: "Routes" },
  { href: "/portal/logistics/deliveries", label: "Deliveries" },
];

export function LogisticsSubnav() {
  const pathname = usePathname();
  return (
    <nav className="subnav">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/portal/logistics"
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
