import {
  Users,
  Boxes,
  Wrench,
  ShieldCheck,
  Factory,
  Banknote,
  LayoutDashboard,
  Truck,
  Layers,
  type LucideIcon,
} from "lucide-react";

/** Icons for the Custom Business Systems catalogue. */
const SYSTEM_ICONS: Record<string, LucideIcon> = {
  users: Users,
  boxes: Boxes,
  wrench: Wrench,
  "shield-check": ShieldCheck,
  factory: Factory,
  banknote: Banknote,
  "layout-dashboard": LayoutDashboard,
  truck: Truck,
  layers: Layers,
};

export function SystemIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Icon = SYSTEM_ICONS[name] ?? Layers;
  return <Icon size={size} />;
}
