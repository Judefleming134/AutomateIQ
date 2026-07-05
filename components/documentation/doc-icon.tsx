import {
  Sparkles,
  Rocket,
  ClipboardList,
  FileText,
  CheckSquare,
  Calendar,
  PenSquare,
  Handshake,
  BookOpen,
  Book,
  HelpCircle,
  LifeBuoy,
  ShieldCheck,
  TriangleAlert,
  Lock,
  Cpu,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  rocket: Rocket,
  clipboard: ClipboardList,
  "file-text": FileText,
  "check-square": CheckSquare,
  calendar: Calendar,
  edit: PenSquare,
  handshake: Handshake,
  "book-open": BookOpen,
  book: Book,
  "help-circle": HelpCircle,
  "life-buoy": LifeBuoy,
  "shield-check": ShieldCheck,
  "alert-triangle": TriangleAlert,
  lock: Lock,
  cpu: Cpu,
};

export function DocIcon({ name, size = 20 }: { name?: string | null; size?: number }) {
  const Icon = (name && ICONS[name]) || FileText;
  return <Icon size={size} />;
}
