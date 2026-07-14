"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteVoiceJob } from "@/app/portal/voice-agent/actions";

type ActionResult = { ok?: boolean; error?: string } | undefined;

/**
 * A small confirm-guarded delete for a captured job — tidies test calls or
 * duplicates out of the feed. The server action is strictly business-scoped.
 */
export function DeleteJobButton({ jobId }: { jobId: string }) {
  const [, formAction, pending] = useActionState<ActionResult, FormData>(
    deleteVoiceJob,
    undefined
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("Delete this job? This can't be undone.")) {
          e.preventDefault();
        }
      }}
      style={{ display: "inline-flex" }}
    >
      <input type="hidden" name="job_id" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Delete job"
        title="Delete this job"
        style={{
          background: "none",
          border: "none",
          cursor: pending ? "default" : "pointer",
          color: "var(--faint)",
          padding: 2,
          display: "inline-flex",
          opacity: pending ? 0.5 : 0.7,
        }}
      >
        <Trash2 size={13} />
      </button>
    </form>
  );
}
