"use client";

import { useActionState } from "react";
import { Archive, Trash2 } from "lucide-react";
import { bulkProspectAction } from "@/app/growth/(app)/prospects/actions";

type ActionResult = { ok?: boolean; error?: string } | undefined;

/**
 * The bulk bar for the prospects table. Row checkboxes live inside the
 * server-rendered table and attach here via form="prospect-bulk", so the
 * table itself stays a Server Component.
 */
export function BulkActions({ isOwner }: { isOwner: boolean }) {
  const [state, formAction, pending] = useActionState(
    bulkProspectAction as (
      prev: ActionResult,
      formData: FormData
    ) => Promise<ActionResult>,
    undefined
  );

  return (
    <form
      id="prospect-bulk"
      action={formAction}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
      onSubmit={(e) => {
        const selected = new FormData(e.currentTarget).getAll("ids").length;
        if (selected === 0) {
          e.preventDefault();
          window.alert("Tick at least one prospect first.");
          return;
        }
        const intent = (
          (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        )?.value;
        if (
          intent === "delete" &&
          !window.confirm(
            `Permanently delete ${selected} prospect${selected === 1 ? "" : "s"}? This also removes their research, messages and full history. Archive instead if you might ever want them back.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <span style={{ fontSize: 12, color: "var(--faint)" }}>With ticked:</span>
      <button
        type="submit"
        name="intent"
        value="archive"
        className="btn btn-secondary btn-sm"
        disabled={pending}
      >
        <Archive size={13} /> Archive selected
      </button>
      {isOwner && (
        <button
          type="submit"
          name="intent"
          value="delete"
          className="btn btn-danger btn-sm"
          disabled={pending}
        >
          <Trash2 size={13} /> Delete selected
        </button>
      )}
      {pending && <span style={{ fontSize: 12, color: "var(--faint)" }}>Working…</span>}
      {state?.error && (
        <span style={{ fontSize: 12, color: "var(--red, #f87171)" }}>{state.error}</span>
      )}
      {state?.ok && !pending && (
        <span style={{ fontSize: 12, color: "var(--green, #34d399)" }}>✓ Done</span>
      )}
      {/* "Select all" only ticks the rows on THIS page — spell it out so a
          filtered list of hundreds isn't half-archived by surprise. */}
      <span style={{ fontSize: 11, color: "var(--faint)", flexBasis: "100%" }}>
        Applies to the ticked rows on this page. To act on more, work page by
        page.
      </span>
    </form>
  );
}

/** Header checkbox that ticks/unticks every row checkbox in the table. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all prospects on this page"
      title="Selects every prospect on this page"
      onChange={(e) => {
        const checked = e.currentTarget.checked;
        document
          .querySelectorAll<HTMLInputElement>('input[name="ids"][form="prospect-bulk"]')
          .forEach((box) => {
            box.checked = checked;
          });
      }}
    />
  );
}
