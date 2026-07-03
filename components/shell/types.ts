export type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};
