"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { importContacts, updateStage, toggleTask } from "./actions";

const STAGES = ["new", "contacted", "qualified", "won", "lost"];

export function ImportButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (state === "running") return;
    setState("running");
    const res = await importContacts();
    if (res.ok) {
      setState("done");
      setMsg(
        res.imported > 0
          ? `Imported ${res.imported} new contact${res.imported === 1 ? "" : "s"}.`
          : "Already up to date."
      );
      router.refresh();
      setTimeout(() => setState("idle"), 2500);
    } else {
      setState("idle");
      setMsg(res.error);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-secondary" onClick={run} disabled={state === "running"}>
        <Download size={15} />
        {state === "running" ? "Importing…" : "Import from agents"}
      </button>
      {msg && <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{msg}</span>}
    </span>
  );
}

export function StageSelect({ contactId, stage }: { contactId: string; stage: string }) {
  const [value, setValue] = useState(stage);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function change(next: string) {
    // Optimistic, but honest: if the save doesn't land, roll the dropdown back
    // to what's actually stored and flag it — never leave it showing a stage
    // (e.g. "won") that silently didn't persist.
    const prev = value;
    setValue(next);
    setFailed(false);
    start(async () => {
      try {
        const res = await updateStage(contactId, next);
        if (!res?.ok) {
          setValue(prev);
          setFailed(true);
        }
      } catch {
        setValue(prev);
        setFailed(true);
      }
    });
  }

  return (
    <select
      className={`stage-select stage-${value}`}
      value={value}
      disabled={pending}
      title={failed ? "Couldn't save that change — please try again." : undefined}
      style={failed ? { outline: "2px solid var(--orange, #fb923c)" } : undefined}
      onChange={(e) => change(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function TaskCheckbox({ taskId, done }: { taskId: string; done: boolean }) {
  const [checked, setChecked] = useState(done);
  const [, start] = useTransition();
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => {
        const next = e.target.checked;
        const prev = checked;
        setChecked(next);
        start(async () => {
          // Roll the tick back if the save didn't land, so a task never looks
          // done (or undone) when the database says otherwise.
          try {
            const res = await toggleTask(taskId, next);
            if (!res?.ok) setChecked(prev);
          } catch {
            setChecked(prev);
          }
        });
      }}
      style={{ width: 16, height: 16, flex: "none", cursor: "pointer" }}
    />
  );
}
