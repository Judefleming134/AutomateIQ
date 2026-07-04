import "server-only";

import { z } from "zod";
import type { AgentModule } from "@/lib/agents/types";
import {
  generateContentCore,
  CONTENT_TYPES,
  type ContentType,
} from "@/lib/content-agent/generate-core";

const generateInput = z.object({
  content_type: z.enum(
    Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]]
  ),
  topic: z.string().trim().min(3).max(300),
  notes: z.string().trim().max(1000).optional(),
});

export const contentAgentModule: AgentModule = {
  key: "content-agent",
  name: "Content Agent",
  version: "1.0",
  category: "content",
  description:
    "AI-written blogs, social posts, emails and ad copy — in your brand voice, saved to your content library.",
  iconName: "pen-line",
  accent: "#EC4899",
  href: "/portal/content-agent",
  availability: "live",
  capabilities: [
    "Blog posts",
    "Social media posts",
    "Marketing emails",
    "Ad copy",
    "Brand-voice aware",
    "Content library",
  ],
  tools: [
    {
      name: "generate_content",
      description:
        "Write marketing content for the business (blog, social, email or ad) in their brand voice and save it to their content library. Use when the user asks for posts, blogs, emails, ads or campaign content.",
      inputSchema: {
        type: "object",
        properties: {
          content_type: {
            type: "string",
            enum: ["blog", "social", "email", "ad", "other"],
            description: "What kind of content to write.",
          },
          topic: {
            type: "string",
            description: "What the content is about.",
          },
          notes: {
            type: "string",
            description: "Optional extra direction (audience, offer, length…).",
          },
        },
        required: ["content_type", "topic"],
      },
      execute: async (ctx, input) => {
        const parsed = generateInput.safeParse(input);
        if (!parsed.success) {
          return `Error: ${parsed.error.issues[0]?.message ?? "invalid input"}.`;
        }
        const result = await generateContentCore(
          ctx.supabase,
          ctx.businessId,
          parsed.data.content_type,
          parsed.data.topic,
          parsed.data.notes
        );
        if (!result.ok) return `Could not generate: ${result.error}`;
        return `${result.content}\n\n(${result.saved ? "Saved to the content library." : "Note: could not save to the library — run supabase/manual_update_0007.sql."})`;
      },
    },
  ],
};
