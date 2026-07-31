/**
 * Custom Business Systems catalogue.
 *
 * These are examples of the bespoke enterprise platforms AutomateIQ designs and
 * builds AROUND each client's business — never off-the-shelf products or
 * templates. Every feature list here is illustrative: any system can be
 * customised, expanded and integrated to a client's exact operation.
 *
 * This is the single source of truth shared by the marketing showcase
 * (/systems), the customer Solutions module (/portal/solutions) and the admin
 * Business Systems console (/admin/systems). The database (bsys_systems) is
 * seeded from these keys so admins can assign them and add more.
 */

export type BusinessSystem = {
  key: string;
  name: string;
  icon: string; // SystemIcon key
  accent: string;
  tagline: string;
  overview: string;
  benefits: string[];
  features: string[];
  industries: string[];
  sortOrder: number;
};

export const SYSTEMS_CATALOG: BusinessSystem[] = [
  {
    key: "workforce-management",
    name: "Workforce Management System",
    icon: "users",
    accent: "#3B82F6",
    tagline: "Every hour worked, scheduled and accounted for.",
    overview:
      "A complete workforce platform built around how your teams actually work — from the shop floor to the field — with mobile clock-in, scheduling and approvals in one place.",
    benefits: [
      "Cut admin time on timesheets and rotas",
      "Accurate, dispute-proof attendance records",
      "Real-time visibility of who's working, where",
      "Payroll-ready exports with zero re-keying",
    ],
    features: [
      "Employee clock in/out",
      "GPS geofencing",
      "QR & NFC clock-in",
      "Shift scheduling",
      "Leave management",
      "Payroll exports",
      "Timesheets",
      "Mobile workforce app",
      "Manager approvals",
      "Performance dashboards",
      "Attendance reporting",
    ],
    industries: ["Construction", "Hospitality", "Retail", "Facilities", "Healthcare", "Manufacturing"],
    sortOrder: 10,
  },
  {
    key: "asset-management",
    name: "Asset Management System",
    icon: "boxes",
    accent: "#8B5CF6",
    tagline: "Know exactly what you own, where it is and its condition.",
    overview:
      "A live asset register designed around your equipment, sites and maintenance regime — track everything from tools to fleet with scanning, warranties and full service history.",
    benefits: [
      "Eliminate lost and untracked equipment",
      "Stay ahead of maintenance and warranties",
      "Audit-ready records at any moment",
      "Accurate depreciation and asset value",
    ],
    features: [
      "Asset register",
      "QR & Barcode scanning",
      "Asset check-in/check-out",
      "Live asset tracking",
      "Warranty tracking",
      "Maintenance schedules",
      "Service history",
      "Depreciation tracking",
      "Asset reporting",
      "Audit history",
    ],
    industries: ["Construction", "Manufacturing", "Healthcare", "Education", "Logistics", "Facilities"],
    sortOrder: 20,
  },
  {
    key: "field-service-management",
    name: "Job & Field Service Management System",
    icon: "wrench",
    accent: "#F59E0B",
    tagline: "From first call to signed-off job — one connected flow.",
    overview:
      "A field service platform built around your jobs, engineers and customers: schedule work, dispatch the right person, track them live and close the job on-site with photos and signatures.",
    benefits: [
      "More jobs completed per engineer, per day",
      "Live status on every job in progress",
      "Faster quote-to-invoice cash cycle",
      "A single record for every customer and job",
    ],
    features: [
      "Job scheduling",
      "Engineer allocation",
      "Route planning",
      "Live job tracking",
      "Customer management",
      "Quote generation",
      "Invoice generation",
      "Digital signatures",
      "Mobile workforce app",
      "Photo uploads",
      "Job completion reports",
    ],
    industries: ["Electricians", "Plumbing", "HVAC", "Construction", "Maintenance companies", "Engineering businesses"],
    sortOrder: 30,
  },
  {
    key: "health-safety-compliance",
    name: "Health, Safety & Compliance Management System",
    icon: "shield-check",
    accent: "#34D399",
    tagline: "Compliance, standardised and impossible to lose track of.",
    overview:
      "A complete compliance platform designed to simplify workplace safety and standardise operational procedures — risk assessments, RAMS and SOPs through to incidents, training and audits.",
    benefits: [
      "Provable, always-current compliance",
      "Standardised procedures across every site",
      "Faster incident response and follow-up",
      "Inspection- and audit-ready in minutes",
    ],
    features: [
      "Risk Assessments",
      "RAMS",
      "Standard Operating Procedures (SOPs)",
      "Incident reporting",
      "Toolbox talks",
      "Training records",
      "Equipment inspections",
      "Compliance reminders",
      "Safety document management",
      "Corrective action tracking",
      "Audit trails",
      "Compliance reporting",
    ],
    industries: ["Construction", "Manufacturing", "Engineering", "Facilities", "Logistics", "Energy"],
    sortOrder: 40,
  },
  {
    key: "erp",
    name: "Enterprise Resource Planning (ERP) System",
    icon: "factory",
    accent: "#22D3EE",
    tagline: "Enterprise power, shaped entirely around your operation.",
    overview:
      "A fully bespoke Enterprise Resource Planning platform inspired by enterprise systems such as SAP — designed specifically around your organisation, without the complexity or cost of traditional enterprise software.",
    benefits: [
      "One connected system across the whole operation",
      "Enterprise capability without enterprise overhead",
      "Real-time stock, orders and production visibility",
      "Modules built around your processes, not the reverse",
    ],
    features: [
      "Inventory Management",
      "Warehouse Management",
      "Purchasing",
      "Procurement",
      "Supplier Management",
      "Sales Orders",
      "Manufacturing workflows",
      "Barcode & QR scanning",
      "Batch & Serial Tracking",
      "Multi-location management",
      "Business analytics",
      "KPI dashboards",
      "Operational reporting",
      "Fully custom modules designed around your business",
    ],
    industries: ["Manufacturing", "Wholesale", "Distribution", "Retail", "Engineering", "Food & Beverage"],
    sortOrder: 50,
  },
  {
    key: "finance-invoice-automation",
    name: "Finance & Invoice Automation System",
    icon: "banknote",
    accent: "#10B981",
    tagline: "Get paid faster, with the paperwork on autopilot.",
    overview:
      "A finance platform built around how money moves through your business — automating invoicing, receipt capture and reminders, with AI insight on top of your real numbers.",
    benefits: [
      "Faster payments and healthier cash flow",
      "Hours saved on manual data entry with AI OCR",
      "Fewer errors and missed follow-ups",
      "Clear, VAT-ready financial reporting",
    ],
    features: [
      "Professional invoice creation",
      "Automated recurring invoices",
      "AI receipt scanning (OCR)",
      "Automatic supplier invoice extraction",
      "Expense management",
      "Quote generation",
      "Convert quotes into invoices",
      "Payment tracking",
      "Automated payment reminders",
      "Customer account statements",
      "VAT-ready reporting",
      "Accounting software integrations",
      "Financial dashboards",
      "KPI reporting",
      "AI financial insights",
    ],
    industries: ["Professional services", "Trades", "Construction", "Retail", "Agencies", "SMEs"],
    sortOrder: 60,
  },
  {
    key: "business-operations-platform",
    name: "Business Operations Platform",
    icon: "layout-dashboard",
    accent: "#F472B6",
    tagline: "The central operating system for your entire business.",
    overview:
      "A single operating system for your organisation — CRM, projects, workforce, documents and automation working together, with your AssistIQ coordinating across all of it.",
    benefits: [
      "One place to run the whole business",
      "No more disconnected tools and double entry",
      "Automation across every department",
      "Live business intelligence in one view",
    ],
    features: [
      "CRM",
      "Project management",
      "AssistIQ",
      "Workflow automation",
      "Document management",
      "Scheduling",
      "Workforce management",
      "KPI dashboards",
      "Analytics",
      "Business intelligence",
      "Internal communications",
      "Reporting",
      "Custom workflows",
    ],
    industries: ["Professional services", "Agencies", "SMEs", "Multi-site operators", "Franchises", "Startups"],
    sortOrder: 70,
  },
  {
    key: "ai-logistics-control-centre",
    name: "FleetIQ",
    icon: "truck",
    accent: "#FB7185",
    tagline: "Your whole fleet and network, on one intelligent map.",
    overview:
      "An enterprise logistics management platform powered by AI — track your fleet live on an interactive map, optimise routes automatically and stay ahead of maintenance and delays.",
    benefits: [
      "Lower fuel and mileage with AI routing",
      "Live visibility of every vehicle and delivery",
      "Fewer breakdowns with predictive maintenance",
      "Data-driven control of the whole network",
    ],
    features: [
      "Interactive logistics map",
      "Live fleet tracking",
      "GPS integration",
      "Warehouse management",
      "Route optimisation",
      "Delivery management",
      "Driver management",
      "Live vehicle locations",
      "Delivery KPIs",
      "Fleet analytics",
      "Predictive maintenance",
      "AI route recommendations",
      "Operational dashboards",
    ],
    industries: ["Logistics", "Distribution", "Courier & delivery", "Haulage", "Wholesale", "E-commerce"],
    sortOrder: 80,
  },
];

export function getSystemByKey(key: string): BusinessSystem | undefined {
  return SYSTEMS_CATALOG.find((s) => s.key === key);
}
