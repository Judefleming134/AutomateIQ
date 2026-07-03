import { Star, Globe, Bot, Box, type LucideIcon } from "lucide-react";

const PRODUCT_ICONS: Record<string, LucideIcon> = {
  star: Star,
  globe: Globe,
  bot: Bot,
  box: Box,
};

export function ProductIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = PRODUCT_ICONS[name] ?? Box;
  return <Icon size={size} />;
}
