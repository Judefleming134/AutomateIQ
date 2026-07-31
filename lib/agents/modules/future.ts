import type { AgentModule } from "@/lib/agents/types";

/**
 * Future agents — declared now so the Products page, AssistIQ's
 * awareness, and the roadmap all come from one place. Each ships later by
 * flipping availability to "live", adding tools, and (optionally) a route —
 * zero changes to the shell, navigation, or assistant architecture.
 */
export const FUTURE_AGENT_MODULES: AgentModule[] = [
  {
    key: "proposal-agent",
    name: "Proposal Agent",
    version: "0.1",
    category: "sales",
    description:
      "Turns discovery calls into branded proposals with pricing, scope and timeline as professional PDFs.",
    iconName: "file-signature",
    accent: "#8B5CF6",
    availability: "coming_soon",
    capabilities: [
      "Call-to-proposal drafting",
      "Pricing & scope",
      "Timeline planning",
      "Branded PDF output",
      "E-signature (future)",
    ],
    tools: [],
  },
  {
    key: "operations-agent",
    name: "Operations Agent",
    version: "0.1",
    category: "operations",
    description:
      "Automates the back office — CRM updates, data entry, internal workflows and task management.",
    iconName: "briefcase",
    accent: "#0891B2",
    availability: "coming_soon",
    capabilities: [
      "CRM updates",
      "Data entry automation",
      "Internal workflows",
      "Task management",
      "Back-office automation",
    ],
    tools: [],
  },
  {
    key: "sales-agent",
    name: "Sales Agent",
    version: "0.1",
    category: "sales",
    description:
      "Works your pipeline — follow-ups, nudges and next-step recommendations that close more work.",
    iconName: "trending-up",
    accent: "#059669",
    availability: "coming_soon",
    capabilities: [
      "Pipeline follow-ups",
      "Deal nudges",
      "Next-step recommendations",
    ],
    tools: [],
  },
  {
    key: "finance-agent",
    name: "Finance Agent",
    version: "0.1",
    category: "finance",
    description:
      "Invoicing, payment chasing and cash-flow summaries without the paperwork.",
    iconName: "banknote",
    accent: "#84CC16",
    availability: "coming_soon",
    capabilities: [
      "Invoicing",
      "Payment reminders",
      "Cash-flow summaries",
    ],
    tools: [],
  },
  {
    key: "scheduling-agent",
    name: "Scheduling Agent",
    version: "0.1",
    category: "scheduling",
    description:
      "Books jobs, manages the calendar and keeps the crew's day running on time.",
    iconName: "calendar",
    accent: "#A855F7",
    availability: "coming_soon",
    capabilities: [
      "Job booking",
      "Calendar management",
      "Reminders & confirmations",
    ],
    tools: [],
  },
  {
    key: "support-agent",
    name: "Support Agent",
    version: "0.1",
    category: "support",
    description:
      "Answers customer questions instantly using your business knowledge, day and night.",
    iconName: "life-buoy",
    accent: "#F472B6",
    availability: "coming_soon",
    capabilities: [
      "Instant customer answers",
      "Business-aware responses",
      "Escalation to you",
    ],
    tools: [],
  },
];
