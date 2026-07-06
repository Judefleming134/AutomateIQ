import {
  Star,
  Globe,
  Bot,
  Box,
  Sparkles,
  Calculator,
  Zap,
  FileSignature,
  Briefcase,
  PenLine,
  Mic,
  TrendingUp,
  Contact,
  Banknote,
  Calendar,
  LifeBuoy,
  Instagram,
  type LucideIcon,
} from "lucide-react";

const PRODUCT_ICONS: Record<string, LucideIcon> = {
  star: Star,
  globe: Globe,
  bot: Bot,
  box: Box,
  sparkles: Sparkles,
  calculator: Calculator,
  zap: Zap,
  "file-signature": FileSignature,
  briefcase: Briefcase,
  "pen-line": PenLine,
  mic: Mic,
  "trending-up": TrendingUp,
  contact: Contact,
  banknote: Banknote,
  calendar: Calendar,
  "life-buoy": LifeBuoy,
  instagram: Instagram,
};

export function ProductIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = PRODUCT_ICONS[name] ?? Box;
  return <Icon size={size} />;
}
