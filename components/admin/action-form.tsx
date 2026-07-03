"use client";

import { useActionState } from "react";

type ActionResult = { ok?: boolean; error?: string } | undefined;

/**
 * Thin wrapper so server actions can return { ok } | { error } (real user
 * feedback) instead of the plain void a bare <form action={fn}> requires.
 * Used for every admin mutation form — small enough not to warrant a
 * heavier form library for V1.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (
    prevState: ActionResult,
    formData: FormData
  ) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p style={{ color: "#f87171", fontSize: 13 }}>{state.error}</p>
      )}
      {pending && <p style={{ fontSize: 12 }}>Working…</p>}
    </form>
  );
}
