"use client";

/**
 * A one-click "load a starter template" button for admin onboarding forms.
 * On click it fills the named fields of its enclosing <form> — but only the
 * ones that are still EMPTY, so it never clobbers anything already typed or
 * previously seeded. The values are editable defaults: Jude reviews and
 * tweaks rather than writing a knowledge base from a blank box.
 */
export function PrefillButton({
  fields,
  label = "Load starter template",
  className = "btn btn-secondary btn-sm",
}: {
  fields: Record<string, string>;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        const form = e.currentTarget.closest("form");
        if (!form) return;
        for (const [name, value] of Object.entries(fields)) {
          const el = form.elements.namedItem(name);
          if (
            (el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement) &&
            !el.value.trim()
          ) {
            el.value = value;
          }
        }
      }}
    >
      {label}
    </button>
  );
}
