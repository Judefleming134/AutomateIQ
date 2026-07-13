"use client";

import { useActionState } from "react";

type ActionResult =
  | { ok?: boolean; error?: string; notice?: string }
  | undefined;

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
  style,
}: {
  action: (
    prevState: ActionResult,
    formData: FormData
  ) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className} style={style}>
      {children}
      {state?.error && <p className="login-error">{state.error}</p>}
      {state?.ok && !pending && (
        <p style={{ color: "var(--green)", fontSize: 13, marginTop: 6 }}>
          ✓ Done
        </p>
      )}
      {state?.notice && !pending && (
        <p style={{ color: "var(--orange)", fontSize: 12.5, marginTop: 6 }}>
          {state.notice}
        </p>
      )}
      {pending && (
        <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>
          Working…
        </p>
      )}
    </form>
  );
}
