"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import { generateCaption, type CaptionResult } from "./actions";

type Story = {
  id: string;
  title: string;
  link: string;
  source: string;
  summary: string;
  publishedAt: string | null;
  score: number;
  angles: string[];
};

const TONES = [
  { key: "straight", label: "Straight" },
  { key: "story", label: "From a job" },
  { key: "contrarian", label: "Push back" },
] as const;

function CopyBtn({ text, label = "Copy caption" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : label}
    </button>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function StoryCard({ story }: { story: Story }) {
  const [state, action, pending] = useActionState<CaptionResult | undefined, FormData>(
    generateCaption,
    undefined
  );
  const [tone, setTone] = useState<string>("straight");

  return (
    <section className="panel panel-block">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", marginBottom: 6 }}>
        <span className="badge badge-blue">{story.source}</span>
        {story.publishedAt && (
          <span style={{ fontSize: 12, color: "var(--faint)" }}>{ago(story.publishedAt)}</span>
        )}
        {story.angles.slice(0, 3).map((a) => (
          <span key={a} className="badge badge-gray" style={{ fontSize: 11 }}>
            {a}
          </span>
        ))}
      </div>

      <a
        href={story.link}
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: 16, fontWeight: 600, textDecoration: "none" }}
      >
        {story.title} <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
      </a>

      {story.summary && (
        <p style={{ fontSize: 13, color: "var(--faint)", margin: "6px 0 10px", lineHeight: 1.55 }}>
          {story.summary.slice(0, 260)}
          {story.summary.length > 260 ? "…" : ""}
        </p>
      )}

      <form action={action} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="title" value={story.title} />
        <input type="hidden" name="summary" value={story.summary} />
        <input type="hidden" name="source" value={story.source} />
        <input type="hidden" name="link" value={story.link} />
        <input type="hidden" name="angles" value={story.angles.join(", ")} />
        <input type="hidden" name="tone" value={tone} />

        <div style={{ display: "flex", gap: 4 }} role="radiogroup" aria-label="Tone">
          {TONES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={tone === t.key}
              className={`btn btn-sm ${tone === t.key ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setTone(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? (
            <>
              <Loader2 size={13} className="book-spin" /> Writing…
            </>
          ) : (
            <>
              <Sparkles size={13} /> {state?.ok ? "Rewrite" : "Write my post"}
            </>
          )}
        </button>
      </form>

      {state && !state.ok && !pending && (
        <p style={{ color: "var(--red, #f87171)", fontSize: 13, marginTop: 8 }}>{state.error}</p>
      )}

      {state?.ok && !pending && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 14.5,
              lineHeight: 1.65,
              background: "var(--bg2, rgba(255,255,255,.03))",
              border: "1px solid var(--line, rgba(255,255,255,.08))",
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            {state.caption}
          </div>

          {state.imageIdea && (
            <p style={{ fontSize: 13, color: "var(--faint)", margin: "10px 0 0" }}>
              <ImageIcon size={13} style={{ verticalAlign: "-2px" }} />{" "}
              <strong>Photo to use:</strong> {state.imageIdea}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <CopyBtn text={state.caption} />
            <CopyBtn text={story.link} label="Copy link for first comment" />
            <a
              href="https://www.linkedin.com/feed/?shareActive=true"
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Open LinkedIn <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
            </a>
          </div>
          {/* The link is deliberately NOT in the caption — LinkedIn suppresses
              reach on posts with outbound links, so it goes in the first
              comment instead. Worth saying out loud, because pasting it into
              the post is the obvious thing to do and it costs him reach. */}
          <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "8px 0 0" }}>
            Attach your photo, paste the caption, post it — then put the article link in
            the first comment. LinkedIn shows posts with outbound links to fewer people,
            so keeping it out of the caption is worth the extra tap.
          </p>
        </div>
      )}
    </section>
  );
}
