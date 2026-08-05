"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, X } from "lucide-react";
import { setAssetStatus, setAssetDue } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  in_service: "In service",
  in_repair: "In repair",
  retired: "Retired",
};

export function StatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select
        value={value}
        disabled={pending}
        aria-label="Status"
        onChange={(e) => {
          const next = e.target.value;
          const previous = value;
          setValue(next);
          setError("");
          start(async () => {
            const res = await setAssetStatus(id, next);
            if (!res.ok) {
              // Put it back. A select that shows the new value while the row
              // still holds the old one is the worst of both.
              setValue(previous);
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        style={{ fontSize: 12.5, padding: "3px 6px" }}
      >
        {Object.entries(STATUS_LABEL).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      {error && <span style={{ fontSize: 11.5, color: "var(--red, #f87171)" }}>{error}</span>}
    </span>
  );
}

/**
 * Book the next thing due, or clear it.
 *
 * Opens from the row rather than living in it, because eleven date inputs down
 * a page is a form, not a list — and the common case is reading the list, not
 * editing it.
 */
export function DueEditor({
  id,
  dueDate,
  dueLabel,
}: {
  id: string;
  dueDate: string | null;
  dueLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(dueDate ?? "");
  const [label, setLabel] = useState(dueLabel ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function save(nextDate: string, nextLabel: string) {
    setError("");
    start(async () => {
      const res = await setAssetDue(id, nextDate || null, nextLabel || null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen(true)}
        style={{ fontSize: 12 }}
      >
        <CalendarCheck size={13} /> {dueDate ? "Change" : "Set due"}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input
        type="date"
        value={date}
        aria-label="Next due date"
        onChange={(e) => setDate(e.target.value)}
        style={{ fontSize: 12.5, padding: "3px 6px" }}
      />
      <input
        type="text"
        value={label}
        aria-label="What is due"
        placeholder="CVRT, service, PAT…"
        maxLength={80}
        onChange={(e) => setLabel(e.target.value)}
        style={{ fontSize: 12.5, padding: "3px 6px", width: 130 }}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() => save(date, label)}
        style={{ fontSize: 12 }}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {/* Clearing is offered explicitly. An asset with nothing due is a normal
          state, and the alternative — typing a fake date to get it off the
          list — is how the overdue count stops being believed. */}
      {dueDate && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={() => {
            setDate("");
            setLabel("");
            save("", "");
          }}
          style={{ fontSize: 12 }}
        >
          Nothing due
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          setOpen(false);
          setDate(dueDate ?? "");
          setLabel(dueLabel ?? "");
          setError("");
        }}
        aria-label="Cancel"
        style={{ fontSize: 12 }}
      >
        <X size={13} />
      </button>
      {error && <span style={{ fontSize: 11.5, color: "var(--red, #f87171)" }}>{error}</span>}
    </span>
  );
}
