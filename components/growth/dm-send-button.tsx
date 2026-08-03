"use client";

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink } from "lucide-react";

/**
 * One tap: copy this prospect's DM, and open their profile.
 *
 * Copy and Open used to be two separate buttons, which is fine until you're
 * ripping through forty of them. Tap Open without tapping Copy and you paste
 * whatever was last on the clipboard — which, on this page, is the PREVIOUS
 * prospect's message. That's the manual version of the cross-company
 * contamination the send gates exist to prevent, except there's no gate on a
 * DM you paste by hand. Doing both in one action means the clipboard and the
 * open profile can never belong to different businesses.
 *
 * If the clipboard write fails, that has to be LOUD — a silent failure is
 * exactly the case that sends the wrong company's message.
 */
export function DmSendButton({
  text,
  link,
  platform,
}: {
  text: string;
  link: string;
  platform: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed" | "blocked">("idle");

  async function go() {
    // Open FIRST, synchronously, while the click is still the active user
    // gesture — awaiting the clipboard before this gets the tab blocked as a
    // popup in Safari and Firefox.
    const win = window.open(link, "_blank", "noopener,noreferrer");
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard denied (insecure context, permissions, older browser).
      // Say so — the message below is now the only correct source.
      copied = false;
    }
    // A blocked popup used to be folded into "done", so the button read
    // "Copied — reopen Instagram" and NOTHING had opened. On a 15-DM session
    // behind a popup blocker that is every single tap: the copy works, the
    // profile never appears, and the button insists it did its job. The case
    // was known — there was a comment about it — it just wasn't told to Jude.
    //
    // Clipboard failure still wins: pasting the previous prospect's message is
    // worse than a tab not opening.
    setState(!copied ? "failed" : win ? "done" : "blocked");
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-sm ${state === "done" || state === "blocked" ? "btn-secondary" : "btn-primary"}`}
        onClick={go}
      >
        {state === "done" || state === "blocked" ? (
          <>
            <Check size={13} style={{ color: "var(--green)" }} /> Copied — reopen {platform}
          </>
        ) : (
          <>
            Copy &amp; open {platform} <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
          </>
        )}
      </button>
      {state === "blocked" && (
        /* A plain link, not another window.open — this one is a direct click,
           so no blocker can stop it. The message IS copied, so the only thing
           missing is the tab. */
        <span
          style={{ fontSize: 12, color: "var(--orange, #fb923c)", flexBasis: "100%" }}
          role="alert"
        >
          <AlertTriangle size={12} style={{ verticalAlign: "-2px" }} /> Copied — but your
          browser blocked the new tab.{" "}
          <a href={link} target="_blank" rel="noreferrer">
            Open {platform} here
          </a>{" "}
          instead, or allow pop-ups for this site and the one-tap flow works again.
        </span>
      )}
      {state === "failed" && (
        <span
          style={{ fontSize: 12, color: "var(--red, #f87171)", flexBasis: "100%" }}
          role="alert"
        >
          <AlertTriangle size={12} style={{ verticalAlign: "-2px" }} /> Couldn&apos;t copy to
          your clipboard — select the message above and copy it by hand.{" "}
          <strong>Don&apos;t paste what&apos;s already on your clipboard</strong>, it&apos;s
          the last prospect&apos;s message.
        </span>
      )}
    </>
  );
}
