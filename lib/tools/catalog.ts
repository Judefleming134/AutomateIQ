import "server-only";
import { resolveProvider } from "@/lib/ai/config";
import { gbpConfigured } from "@/lib/tools/gbp";

/**
 * The free tools, and — the part that was missing — whether each one is
 * actually switched on.
 *
 * The hub page hard-coded six tools and the headline "Six things you can check
 * right now, for nothing". One of them, the Google Business Profile checker,
 * needs GOOGLE_PLACES_API_KEY, which isn't set. So a visitor read a promise of
 * six working tools, clicked the second card, and got "Not switched on yet".
 * The API's own error text says "The other free tools all work" — the hub was
 * the only surface that didn't know.
 *
 * These are front doors. Someone who has never heard of AutomateIQ judges the
 * whole product by whether the free thing worked, so a dead card costs more
 * here than almost anywhere else on the site.
 *
 * `isAvailable()` is evaluated on the server, per tool, PER REQUEST — which is
 * why the hub sets `dynamic = "force-dynamic"`. It has to: the page was
 * statically prerendered, so an availability check would have been frozen at
 * build time, and the hub would keep insisting a tool worked for as long as
 * the deployment lived. Adding the key switches the tool back on within one
 * request; losing it degrades to an honest "not switched on" rather than a
 * dead end. The page does no I/O, so a dynamic render is a cheap one.
 *
 * This module is server-only — it reads process.env. The client components get
 * a plain serialisable ToolCard from `toolCards()`.
 */

export type ToolStatus = "live" | "unavailable";

export type FreeTool = {
  slug: string;
  href: string;
  /** Icon name, resolved to a component on the page — keeps this file serialisable. */
  icon: "search" | "map-pin" | "timer" | "phone-missed" | "quote" | "calculator";
  title: string;
  blurb: string;
  /** Concrete outputs. What lands on screen, not what it "helps with". */
  gives: string[];
  time: string;
  accent: string;
  /** Why it's off, shown in place of the call to action. Null when live. */
  unavailableNote: string | null;
  /** Evaluated server-side, per request. */
  isAvailable: () => boolean;
};

const aiConfigured = () => resolveProvider().kind !== "none";

const TOOLS: FreeTool[] = [
  {
    slug: "autoseo",
    href: "/freetools/autoseo",
    icon: "search",
    title: "Website SEO check",
    blurb:
      "Why your site doesn't come up on Google — with the exact code to fix it, pre-filled with your own details.",
    gives: [
      "A score across 19 checks",
      "The one bottleneck costing you most",
      "Copy-paste code, filled in for you",
    ],
    time: "20 seconds",
    accent: "#3B82F6",
    unavailableNote: null,
    isAvailable: () => true,
  },
  {
    slug: "google-profile",
    href: "/freetools/google-profile",
    icon: "map-pin",
    title: "Google Business Profile check",
    blurb:
      "The half that decides the map pack: reviews, rating, hours, category. Tells you which one to fix first.",
    gives: [
      "Your rating and review count in context",
      "Category, hours and phone checked",
      "The single fix to do first",
    ],
    time: "10 seconds",
    accent: "#F59E0B",
    unavailableNote:
      "Waiting on a Google Places API key. The website check below covers the half of local ranking you control directly, and it works right now.",
    isAvailable: gbpConfigured,
  },
  {
    slug: "response-time",
    href: "/freetools/response-time",
    icon: "timer",
    title: "How fast do you reply?",
    blurb:
      "We send one realistic enquiry to your published email and time how long it sits unopened. Usually a shock.",
    gives: [
      "Your real reply time, measured",
      "One enquiry, to your own published address",
      "No email address to type in",
    ],
    time: "1 minute",
    accent: "#8B5CF6",
    unavailableNote: null,
    isAvailable: () => true,
  },
  {
    slug: "missed-calls",
    href: "/freetools/missed-calls",
    icon: "phone-missed",
    title: "What missed calls cost you",
    blurb:
      "Four numbers you already know, and a euro figure for the work going to whoever answered first.",
    gives: [
      "A euro figure per week and per year",
      "Every input is yours and editable",
      "Runs entirely in your browser",
    ],
    time: "30 seconds",
    accent: "#EF4444",
    unavailableNote: null,
    isAvailable: () => true,
  },
  {
    slug: "reviews",
    href: "/freetools/reviews",
    icon: "quote",
    title: "Review reply writer",
    blurb:
      "Paste any review, get three replies — warm, professional, or firm but fair. Never defensive.",
    gives: [
      "Three replies in different tones",
      "Handles a one-star as well as a five",
      "Ready to paste into Google",
    ],
    time: "15 seconds",
    accent: "#34D399",
    unavailableNote:
      "The writing engine is between keys. Everything else here is offline-safe and unaffected.",
    isAvailable: aiConfigured,
  },
  {
    slug: "quote-builder",
    href: "/freetools/quote-builder",
    icon: "calculator",
    title: "Instant quote widget",
    blurb:
      "Build a quote calculator for your own website. Set your prices, copy the code, paste it in. No account.",
    gives: [
      "A working calculator on your own site",
      "Your prices, your options",
      "One snippet to paste, no account",
    ],
    time: "2 minutes",
    accent: "#0EA5E9",
    unavailableNote: null,
    isAvailable: () => true,
  },
];

/** Serialisable view of one tool, with its status resolved. */
export type ToolCard = Omit<FreeTool, "isAvailable" | "unavailableNote"> & {
  status: ToolStatus;
  unavailableNote: string | null;
};

/**
 * The catalog with every status resolved, live tools first.
 *
 * Ordering matters: a visitor's first click should never be the one thing that
 * doesn't work. It was, before — the Google check sat second in the grid.
 */
export function toolCards(): ToolCard[] {
  return TOOLS.map((t) => {
    const status: ToolStatus = t.isAvailable() ? "live" : "unavailable";
    const { isAvailable: _drop, ...rest } = t;
    return {
      ...rest,
      status,
      unavailableNote: status === "live" ? null : t.unavailableNote,
    };
  }).sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
}

/** One tool's card, status resolved. Returns undefined for an unknown slug. */
export function getToolCard(slug: string): ToolCard | undefined {
  return toolCards().find((t) => t.slug === slug);
}

/** How many are actually usable right now. Never hard-code this. */
export function liveToolCount(): number {
  return TOOLS.filter((t) => t.isAvailable()).length;
}

export function totalToolCount(): number {
  return TOOLS.length;
}

/** "Six" / "Five" — the headline should read as a sentence, not a digit. */
const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** Exported for tests only — the raw list, before status resolution. */
export const ALL_TOOLS = TOOLS;
