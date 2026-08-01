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
  formAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  /**
   * Optional: submit this form to a DIFFERENT action than the form's own.
   * Lets one form carry a second button ("send me a test") that posts the
   * values currently on screen rather than the last thing saved.
   *
   * Omitted everywhere it was before, so every existing button behaves
   * exactly as it did — the form's own action still wins when this is unset.
   */
  formAction?: (formData: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      formAction={formAction}
    >
      {pending ? pendingText : children}
    </button>
  );
}
