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
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function go() {
    // Open FIRST, synchronously, while the click is still the active user
    // gesture — awaiting the clipboard before this gets the tab blocked as a
    // popup in Safari and Firefox.
    const win = window.open(link, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      // Clipboard denied (insecure context, permissions, older browser).
      // Say so — the message below is now the only correct source.
      setState("failed");
    }
    if (!win) {
      // Popup blocked: the copy still worked, but nothing opened.
      setState((s) => (s === "failed" ? "failed" : "done"));
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-sm ${state === "done" ? "btn-secondary" : "btn-primary"}`}
        onClick={go}
      >
        {state === "done" ? (
          <>
            <Check size={13} style={{ color: "var(--green)" }} /> Copied — reopen {platform}
          </>
        ) : (
          <>
            Copy &amp; open {platform} <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
          </>
        )}
      </button>
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
