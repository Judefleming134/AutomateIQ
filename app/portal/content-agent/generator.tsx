"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Copy, Check } from "lucide-react";
import { generateContent } from "./actions";

const TYPE_OPTIONS = [
  { value: "blog", label: "Blog post" },
  { value: "social", label: "Social posts (×3)" },
  { value: "email", label: "Marketing email" },
  { value: "ad", label: "Ad copy (×3)" },
  { value: "other", label: "Something else" },
];

export function ContentGenerator() {
  const router = useRouter();
  const [contentType, setContentType] = useState("social");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (pending || topic.trim().length < 3) return;
    setPending(true);
    setError(null);
    setResult(null);

    const res = await generateContent(contentType, topic.trim(), notes.trim());
    setPending(false);
    if (res.ok) {
      setResult(res.content);
      // Refresh the server-rendered library below.
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable — nothing sensible to do.
    }
  }

  return (
    <div className="panel form-card">
      <h2 className="panel-title" style={{ marginBottom: 14 }}>
        <span>
          <span className="sys-index">01 /</span>Write something
        </span>
      </h2>
      <form onSubmit={handleGenerate}>
        <div className="field">
          <label htmlFor="contentType">Content type</label>
          <select
            id="contentType"
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="topic">Topic</label>
          <input
            id="topic"
            type="text"
            placeholder="Spring boiler-service offer for existing customers"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            minLength={3}
          />
        </div>
        <div className="field">
          <label htmlFor="notes">Extra direction (optional)</label>
          <textarea
            id="notes"
            rows={2}
            placeholder="Audience, offer details, call to action…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || topic.trim().length < 3}
          >
            <PenLine size={15} />
            {pending ? "Writing…" : "Generate"}
          </button>
        </div>
      </form>

      {error && <p className="login-error">{error}</p>}

      {result && (
        <div className="gen-result">
          <div className="gen-result-bar">
            <span className="sys-label">OUTPUT</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}
