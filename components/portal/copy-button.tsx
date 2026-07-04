"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (very old browser / permissions) — no-op.
    }
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
      {copied ? <Check size={13} style={{ color: "var(--green)" }} /> : <Copy size={13} />}
      {copied ? "Copied!" : label}
    </button>
  );
}
