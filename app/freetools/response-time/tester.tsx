"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, MailCheck, Send } from "lucide-react";

type Stage = "idle" | "finding" | "confirm" | "sending" | "sent";

export function ResponseTimeTester() {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ email: string; host: string } | null>(null);

  async function call(step: "find" | "send") {
    setError(null);
    setStage(step === "find" ? "finding" : "sending");
    try {
      const res = await fetch("/api/tools/response-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), step }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Try again.");
        setStage(step === "find" ? "idle" : "confirm");
        return;
      }
      if (step === "find") {
        setTarget({ email: data.email, host: data.host });
        setStage("confirm");
      } else {
        setStage("sent");
      }
    } catch {
      setError("Couldn't reach the tester — check your connection.");
      setStage(step === "find" ? "idle" : "confirm");
    }
  }

  return (
    <div>
      {stage !== "sent" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (stage === "finding" || stage === "sending") return;
            if (!url.trim()) {
              setError("Put your website address in first.");
              return;
            }
            void call("find");
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}
        >
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTarget(null);
              setStage("idle");
            }}
            placeholder="yourbusiness.ie"
            aria-label="Your website address"
            disabled={stage === "finding" || stage === "sending"}
            style={{ flex: "1 1 280px", minWidth: 0 }}
          />
          <button type="submit" className="btn btn-primary" disabled={stage === "finding"}>
            {stage === "finding" ? (
              <>
                <Loader2 size={15} className="book-spin" /> Reading your site…
              </>
            ) : (
              <>Start the test</>
            )}
          </button>
        </form>
      )}

      {error && (
        <div
          className="panel panel-block"
          style={{ borderLeft: "3px solid var(--orange, #fb923c)" }}
        >
          <strong style={{ color: "var(--orange, #fb923c)" }}>
            <AlertTriangle size={15} style={{ verticalAlign: "-2px" }} /> {error}
          </strong>
        </div>
      )}

      {stage === "confirm" && target && (
        <div className="aseo-hero is-warn" style={{ marginTop: 14 }}>
          <h3>Ready to send</h3>
          <div className="aseo-now">
            We&apos;ll send one realistic enquiry to <strong>{target.email}</strong> — the
            address published on {target.host}.
          </div>
          <div className="aseo-block">
            <p className="aseo-block-label">What happens next</p>
            <p>
              The email reads like a genuine customer, because a test you can spot at a
              glance measures nothing. It does say plainly, further down, that it&apos;s a
              test you asked for and that nobody is waiting on you. The moment you see it,
              click the link inside — that tells you exactly how long a real enquiry would
              have sat there.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void call("send")}
            style={{ marginTop: 14 }}
          >
            <Send size={14} /> Send the test enquiry
          </button>
          <p style={{ fontSize: 12, color: "var(--faint)", margin: "10px 0 0" }}>
            Once per business per day. We only ever write to an address published on the
            site&apos;s own domain.
          </p>
        </div>
      )}

      {stage === "sending" && (
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 12 }}>
          <Loader2 size={13} className="book-spin" style={{ verticalAlign: "-2px" }} /> Sending…
        </p>
      )}

      {stage === "sent" && target && (
        <div className="aseo-hero is-good">
          <h3>
            <MailCheck size={20} style={{ verticalAlign: "-3px" }} /> Sent — the clock is
            running
          </h3>
          <div className="aseo-now">
            One enquiry is on its way to <strong>{target.email}</strong>. Now close this
            page and go back to whatever you were doing.
          </div>
          <div className="aseo-block">
            <p className="aseo-block-label">The honest version of this test</p>
            <p>
              Don&apos;t sit watching your inbox — that measures nothing. Carry on with
              your day exactly as normal. Whenever you happen to notice the email, click
              the link inside it and you&apos;ll get your real number.
            </p>
          </div>
          <div className="aseo-block">
            <p className="aseo-block-label">While you wait, here&apos;s the maths</p>
            <p>
              Most people who enquire go with whoever answers first, and plenty stop
              waiting inside the hour.{" "}
              <Link href="/freetools/missed-calls">Work out what that&apos;s worth to you</Link>{" "}
              — it takes about thirty seconds.
            </p>
          </div>
        </div>
      )}

      {stage === "idle" && !error && (
        <div className="panel panel-block" style={{ marginTop: 18 }}>
          <strong>How this stays safe</strong>
          <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 0" }}>
            You can&apos;t type in an email address — we read the one published on the
            website you enter, and it has to be on that site&apos;s own domain. So this can
            only ever be pointed at a business that publishes its own contact address, and
            never at someone else. One test per business per day.
          </p>
        </div>
      )}
    </div>
  );
}
