import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";

/**
 * Voice Agent — the AI receptionist. The agent that actually answers calls
 * runs on ElevenLabs + Twilio; this module is its portal surface, where the
 * customer sees whether it's live, reads its number, edits the knowledge
 * base it answers from, and logs a problem if something's off.
 *
 * The receptionist is *operated* from its own page, but the AI Assistant can
 * READ what it captured — so "how many jobs did we get today?" / "what's my
 * most urgent call?" work in plain English from the control centre. The
 * write side (pause the line, change hours) stays on the Voice Agent page.
 */

const jobsInput = z.object({
  timeframe: z.enum(["today", "week", "all"]).optional(),
});

/** Start of today / 7 days ago in ISO, or null for "all". */
function sinceFor(timeframe: "today" | "week" | "all"): string | null {
  if (timeframe === "all") return null;
  const d = new Date();
  if (timeframe === "today") d.setHours(0, 0, 0, 0);
  else d.setTime(d.getTime() - 7 * 86_400_000);
  return d.toISOString();
}

export const voiceAgentModule: AgentModule = {
  key: "voice-agent",
  name: "Voice Agent",
  version: "1.0",
  category: "voice",
  description:
    "An AI receptionist that answers missed calls, books jobs and texts you the details.",
  iconName: "mic",
  accent: "#22D3EE",
  href: "/portal/voice-agent",
  availability: "live",
  capabilities: [
    "24/7 call answering on your own number",
    "Job booking & message taking",
    "Editable knowledge base",
    "Call summaries texted to you",
  ],
  tools: [
    {
      name: "read_voice_jobs",
      description:
        "Read the jobs the AI receptionist has captured from phone calls — caller name, phone, address, the problem, urgency and any slot booked. Use when the user asks what calls or jobs came in, how many jobs today/this week, or about their most urgent/recent job. Returns a count and the details.",
      inputSchema: {
        type: "object",
        properties: {
          timeframe: {
            type: "string",
            enum: ["today", "week", "all"],
            description:
              "Which jobs to read: 'today', 'week' (last 7 days), or 'all'. Defaults to 'week'.",
          },
        },
      },
      execute: async (ctx, input) => {
        const parsed = jobsInput.safeParse(input ?? {});
        const timeframe = parsed.success
          ? (parsed.data.timeframe ?? "week")
          : "week";
        const since = sinceFor(timeframe);

        let query = ctx.supabase
          .from("va_jobs")
          .select(
            "caller_name, caller_phone, address, problem, urgency, booking_slot, summary, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(15);
        if (since) query = query.gte("created_at", since);

        const { data, error } = await query;
        if (error) {
          return "Error: couldn't read the receptionist's captured jobs just now.";
        }

        const label =
          timeframe === "today"
            ? "today"
            : timeframe === "week"
              ? "in the last 7 days"
              : "in total";
        const jobs = data ?? [];
        if (jobs.length === 0) {
          return `No jobs captured by the receptionist ${label}.`;
        }

        const lines = jobs.map((j) => {
          const name = String(j.caller_name || "Unknown caller").trim();
          const bits = [
            j.caller_phone && `phone ${j.caller_phone}`,
            j.address && `at ${j.address}`,
            j.problem && `— ${j.problem}`,
            j.urgency && `(${j.urgency})`,
            j.booking_slot && `booked ${j.booking_slot}`,
          ]
            .filter(Boolean)
            .join(" ");
          const when = new Date(j.created_at).toLocaleDateString("en-IE", {
            day: "numeric",
            month: "short",
          });
          return `- ${name} ${bits} [${when}]`;
        });

        return `${jobs.length} job${jobs.length === 1 ? "" : "s"} captured ${label}:\n${lines.join("\n")}`;
      },
    },
  ],
};
