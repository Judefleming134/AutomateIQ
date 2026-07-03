"use client";

import { useFormStatus } from "react-dom";

/**
 * Disables itself while its enclosing <form> is submitting — the primary
 * defense against a double-click double-send (the server-side duplicate
 * guard in send/actions.ts is the backup, not the other way round).
 */
export function SubmitButton({
  children,
  pendingText = "Working…",
  className = "btn btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
