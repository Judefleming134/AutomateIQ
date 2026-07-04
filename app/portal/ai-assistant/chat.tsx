"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { sendAssistantMessage } from "./actions";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTED_PROMPTS = [
  "Draft a reply to a customer asking for a quote",
  "Write a polite follow-up to a late payer",
  "Give me three ideas to get more Google reviews",
  "Write a short post announcing our summer availability",
];

export function AssistantChat({
  initialConversationId,
  initialMessages,
}: {
  initialConversationId: string | null;
  initialMessages: Message[];
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function submit(text: string) {
    if (!text || pending) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);

    const result = await sendAssistantMessage(conversationId, text);
    setPending(false);

    if (result.ok) {
      setConversationId(result.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: result.reply }]);
    } else {
      setError(result.error);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    void submit(input.trim());
  }

  return (
    <div className="panel panel-block chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !pending ? (
          <div className="chat-empty">
            <div>
              <p style={{ margin: "0 0 12px", color: "var(--body)" }}>
                Ask your assistant anything — or start with one of these:
              </p>
              <div className="chat-suggest">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void submit(p)}
                    disabled={pending}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`chat-msg ${m.role === "user" ? "is-user" : "is-assistant"}`}
            >
              {m.content}
            </div>
          ))
        )}
        {pending && (
          <div className="chat-msg is-assistant is-typing">Thinking…</div>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}

      <form onSubmit={handleSend} className="chat-input-row">
        <input
          type="text"
          placeholder="Message your assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !input.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
