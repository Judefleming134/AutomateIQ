/**
 * "Is this click about to throw away unsaved edits?"
 *
 * Deliberately NOT server-only, and deliberately not inside the component:
 * UnsavedGuard is a client component doing DOM plumbing, and this is the part
 * that actually decides something. Splitting it means the decision can be
 * tested the way the rest of this suite is — plain Node, no jsdom, no browser —
 * rather than asserted by reading the source.
 *
 * The rule has to be conservative in BOTH directions. Interrupting a click
 * that was never going to lose anything is the fastest way to teach someone to
 * hit "OK" without reading, and then the one prompt that mattered gets
 * dismissed too.
 */

export type NavClick = {
  /** Has the form actually been edited? Nothing is guarded until it has. */
  dirty: boolean;
  /** 0 for a primary click. Middle-click opens a new tab. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Something else already handled it. */
  defaultPrevented: boolean;
  /** The href of the nearest enclosing <a>, or null if the click wasn't on one. */
  href: string | null;
  /** The anchor's target attribute, if any. */
  linkTarget?: string | null;
};

/**
 * True when the click should be confirmed before it is allowed to proceed.
 *
 * Everything that does NOT navigate this page away from the form is let
 * through untouched:
 *
 *   a clean form            nothing typed, nothing to lose
 *   a non-anchor click      buttons, including this form's own Save — asking
 *                           "are you sure?" on save is the most annoying
 *                           possible reading of an unsaved-changes guard
 *   cmd/ctrl/shift/middle   opens a NEW tab; the form stays exactly where it is
 *   target="_blank"         same reason
 *   a #hash link            scrolls, doesn't navigate
 *   already handled         another handler called preventDefault first
 */
export function shouldConfirmLeaving(click: NavClick): boolean {
  if (!click.dirty) return false;
  if (click.defaultPrevented) return false;
  if (click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  const href = click.href;
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (click.linkTarget === "_blank") return false;
  return true;
}
