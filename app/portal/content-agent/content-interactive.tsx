"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, CalendarClock, CheckCircle2 } from "lucide-react";
import { buildCampaign, scheduleContent, markPublished } from "./actions";

export function CampaignBuilder() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [theme, setTheme] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMsg(null);
    setError(null);
    // try/finally: a network blip mid-call must never leave the button
    // stuck on "Building…" — pending always clears.
    try {
      const res = await buildCampaign(name.trim(), goal.trim(), theme.trim());
      if (res.ok) {
        setMsg(`✓ Generated and scheduled ${res.created} pieces across the next week.`);
        setName("");
        setGoal("");
        setTheme("");
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Connection hiccup — nothing was lost. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel form-card">
      <h2 className="panel-title" style={{ marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Megaphone size={15} /> Launch a campaign
        </span>
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--faint)", maxWidth: "60ch" }}>
        One click generates a whole multi-channel campaign — a blog, social
        posts and an email — in your voice, scheduled across the next week.
      </p>
      <form onSubmit={run}>
        <div className="field">
          <label htmlFor="cname">Campaign name</label>
          <input id="cname" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer boiler-service push" required />
        </div>
        <div className="field">
          <label htmlFor="ctheme">Theme / offer</label>
          <input id="ctheme" type="text" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="€20 off boiler servicing, booked before September" required />
        </div>
        <div className="field">
          <label htmlFor="cgoal">Goal (optional)</label>
          <input id="cgoal" type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Fill the quiet summer weeks" />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Megaphone size={15} />
            {pending ? "Building campaign…" : "Generate campaign"}
          </button>
        </div>
      </form>
      {msg && <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--green, #34D399)" }}>{msg}</p>}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

export function ScheduleControl({ id, scheduledFor }: { id: string; scheduledFor: string | null }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <input
      type="date"
      defaultValue={scheduledFor ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const date = e.target.value;
        start(async () => {
          // Swallow a network hiccup: the transition still ends, the page
          // refresh shows the true stored state either way.
          await scheduleContent(id, date).catch(() => {});
          router.refresh();
        });
      }}
      className="content-schedule-input"
    />
  );
}

export function PublishButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          await markPublished(id).catch(() => {});
          router.refresh();
        });
      }}
    >
      {pending ? "…" : <><CheckCircle2 size={13} /> Mark published</>}
    </button>
  );
}

export { CalendarClock };
