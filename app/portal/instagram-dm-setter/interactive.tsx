"use client";

import { useState } from "react";
import { Send, Loader2, Instagram } from "lucide-react";
import { simulateInboundMessage } from "./actions";

type Bubble = { from: "lead" | "setter" | "system"; text: string };

/**
 * Live tester: send a DM as if you were an Instagram lead and watch the setter
 * reply, using the exact same pipeline the real webhook runs. Lets the owner
 * (or a demo) see the agent working before connecting a live Instagram account.
 */
export function SetterSimulator({ defaultUser = "test_lead" }: { defaultUser?: string }) {
  const [username, setUsername] = useState(defaultUser);
  const [text, setText] = useState("");
  const [thread, setThread] = useState<Bubble[]>([]);
  const [pending, setPending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || pending) return;
    setThread((t) => [...t, { from: "lead", text: message }]);
    setText("");
    setPending(true);
    try {
      const res = await simulateInboundMessage(username, message);
      if (!res.ok) {
        setThread((t) => [...t, { from: "system", text: res.error }]);
      } else if (res.reply) {
        setThread((t) => [...t, { from: "setter", text: res.reply as string }]);
      } else {
        setThread((t) => [
          ...t,
          { from: "system", text: "Message saved. Auto-reply is off, so the setter didn't respond." },
        ]);
      }
    } catch {
      setThread((t) => [...t, { from: "system", text: "Something went wrong — please try again." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ig-sim">
      <div className="ig-sim-head">
        <span className="ig-sim-avatar"><Instagram size={15} /></span>
        <div>
          <strong>@{username || "test_lead"}</strong>
          <span>Instagram · test conversation</span>
        </div>
      </div>

      <div className="ig-sim-thread">
        {thread.length === 0 && (
          <p className="ig-sim-empty">
            Send a message below as if you were a lead who just DM&apos;d the business — the setter
            replies using your business knowledge and booking link.
          </p>
        )}
        {thread.map((b, i) => (
          <div key={i} className={`ig-bubble ig-bubble-${b.from}`}>
            {b.text}
          </div>
        ))}
        {pending && (
          <div className="ig-bubble ig-bubble-setter ig-bubble-typing">
            <Loader2 size={14} className="book-spin" /> typing…
          </div>
        )}
      </div>

      <form className="ig-sim-form" onSubmit={send}>
        <input
          className="ig-sim-user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="lead username"
          aria-label="Lead username"
        />
        <input
          className="ig-sim-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a DM as the lead…"
          aria-label="Message"
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !text.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
