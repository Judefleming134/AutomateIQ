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
}: {
  children: React.ReactNode;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
