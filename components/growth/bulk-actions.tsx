"use client";

import { useActionState, useEffect, useState } from "react";
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

  // HOW MANY ARE TICKED, live on the buttons.
  //
  // The header checkbox ticks the whole page — a hundred rows — and the
  // buttons said only "Archive selected". You found out the number in the
  // delete confirm, and for archive you never found out at all.
  //
  // Recounted from the REAL form, the same way the autopilot panel learned to
  // do it: the row checkboxes live in the server-rendered table and attach
  // here by `form="prospect-bulk"`, so arithmetic over a remembered number
  // drifts the moment the browser restores checked state on a back-navigation.
  //
  // Listened for on `document`, not on the form: a checkbox associated by the
  // `form` attribute is OUTSIDE the form in the DOM, so its change event
  // bubbles up the table, never to the <form> element.
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    const recount = () => {
      const form = document.getElementById("prospect-bulk");
      if (form instanceof HTMLFormElement) {
        setTicked(new FormData(form).getAll("ids").length);
      }
    };
    const onChange = (e: Event) => {
      const t = e.target as Element | null;
      if (
        t?.matches?.('input[name="ids"][form="prospect-bulk"]') ||
        t?.matches?.("input[data-select-all]")
      ) {
        recount();
      }
    };
    document.addEventListener("change", onChange);
    // Once on mount: a back-navigation can restore ticks before this runs.
    recount();
    return () => document.removeEventListener("change", onChange);
  }, []);

  const noun = (n: number) => `${n} prospect${n === 1 ? "" : "s"}`;

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
          return;
        }
        // ARCHIVE ASKS TOO, AND SAYS THE PART THAT ISN'T OBVIOUS.
        //
        // It was the only bulk mutation on this page with no confirmation at
        // all, while the inbox's own delete note points out that "every other
        // destructive action in the engine already asks first". One header
        // checkbox ticks a hundred rows, so a mis-click here moves a hundred
        // prospects.
        //
        // And archive is not just a status flip: bulkProspectAction sets
        // `next_follow_up_at: null` alongside it. Setting a status back later
        // does NOT put the chase date back — that is gone. So the prompt says
        // so, rather than letting it be discovered a week later when nobody
        // got chased.
        if (
          intent === "archive" &&
          !window.confirm(
            `Archive ${selected} prospect${selected === 1 ? "" : "s"}? They drop out of every working list and their follow-up date is cleared — putting one back later restarts its chase from scratch. Live deals (replied, qualified, booked, in proposal, won) are skipped automatically.`
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
        disabled={pending || ticked === 0}
      >
        <Archive size={13} />{" "}
        {ticked > 0 ? `Archive ${noun(ticked)}` : "Archive selected"}
      </button>
      {isOwner && (
        <button
          type="submit"
          name="intent"
          value="delete"
          className="btn btn-danger btn-sm"
          disabled={pending || ticked === 0}
        >
          <Trash2 size={13} />{" "}
          {ticked > 0 ? `Delete ${noun(ticked)}` : "Delete selected"}
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
      // Marks this box for the bulk bar's recount listener: ticking every row
      // programmatically fires no change event on the rows themselves, so the
      // count would sit at 0 after the one click that selects a hundred.
      data-select-all="true"
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
