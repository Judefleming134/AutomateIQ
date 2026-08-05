"use client";

import { useEffect } from "react";
import { shouldConfirmLeaving } from "@/lib/growth/unsaved-nav";

/**
 * Stops a long form's edits being thrown away by a click.
 *
 * The prospect workspace's Details tab is sixteen fields — company, contact,
 * job title, industry, website, location, email, phone, three social URLs,
 * campaign, owner, follow-up date, pipeline value, notes — behind one Save
 * button at the bottom. The tabs above it are `<Link>`s, so tapping
 * "Conversation" to check something mid-edit is a client-side navigation: React
 * unmounts the form and every uncommitted keystroke is gone, with no warning
 * and nothing to undo it with.
 *
 * That is the "destructive with no undo" class in CLAUDE.md wearing ordinary
 * clothes. It is also the likeliest way to lose a phone number that was just
 * copied off a website — Jude is on the phones, and the Details tab is where a
 * number gets pasted.
 *
 * WHAT IT GUARDS, AND WHAT IT DELIBERATELY DOESN'T
 *
 *   guarded    any <a href> click while the form is dirty — the workspace
 *              tabs, the sidebar, "Open prospect", anything
 *   guarded    a reload, a tab close, a back button (beforeunload)
 *   NOT        the form's own Save button, or any other <button>. Submitting
 *              is how you stop being dirty; asking "are you sure?" on save
 *              would be the most annoying possible reading of this.
 *   NOT        a form that hasn't been touched. Landing on the tab, reading
 *              it and clicking away costs nothing.
 *
 * Purely additive: it adds a confirmation to a path that previously discarded
 * silently. Nothing is blocked — declining the prompt is always an option, and
 * "OK" behaves exactly as the click did before.
 */
export function UnsavedGuard({
  formId,
  message = "You have unsaved changes on this form. Leave anyway and lose them?",
}: {
  formId: string;
  message?: string;
}) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;

    let dirty = false;

    // `input` covers typing and pasting; `change` covers the selects and the
    // date field, which don't fire `input` in every browser.
    const touch = () => {
      dirty = true;
    };
    // Submitting is the thing that makes it clean again. React re-renders the
    // form in place after the action resolves, so the flag has to clear here
    // rather than waiting for an unmount that never comes.
    const clean = () => {
      dirty = false;
    };

    form.addEventListener("input", touch);
    form.addEventListener("change", touch);
    form.addEventListener("submit", clean);

    // A hard navigation: reload, back, tab close. The browser shows its own
    // wording — `preventDefault` is what asks for the prompt at all.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      // Legacy browsers keyed the prompt off a returned string.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    /**
     * A soft navigation: any in-app link, including the workspace tabs.
     *
     * CAPTURE phase, so it runs before Next's router picks the click up —
     * preventDefault in the bubble phase is too late to stop the navigation.
     */
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") ?? null;
      // The decision itself lives in lib/growth/unsaved-nav.ts so it can be
      // tested without a browser. This is only the wiring.
      if (
        !shouldConfirmLeaving({
          dirty,
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          defaultPrevented: e.defaultPrevented,
          href: link?.getAttribute("href") ?? null,
          linkTarget: link?.getAttribute("target") ?? null,
        })
      ) {
        return;
      }
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        // They chose to leave. Don't ask twice on the way out.
        dirty = false;
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      form.removeEventListener("input", touch);
      form.removeEventListener("change", touch);
      form.removeEventListener("submit", clean);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [formId, message]);

  return null;
}
