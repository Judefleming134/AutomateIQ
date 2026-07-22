"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Mic, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import { askJarvis, type JarvisTurn } from "@/app/growth/(app)/jarvis/actions";

/** Minimal typing for the (webkit-prefixed) Web Speech recognition API. */
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Jarvis speaks with a British accent where the device has one — on
 *  Apple devices "Daniel"/"Arthur" is the classic Jarvis-adjacent voice. */
let cachedVoice: SpeechSynthesisVoice | null | undefined;
function pickBritishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const gb = voices.filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("en-gb"));
  return (
    gb.find((v) => /daniel|arthur/i.test(v.name)) ??
    // \bmale\b so "Female" voices don't match on the trailing "male".
    gb.find((v) => /oliver|brian|george|\bmale\b/i.test(v.name)) ??
    gb[0] ??
    null
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  // Don't read out formatting or full URLs — nobody wants a spoken href.
  const spoken = text
    .replace(/https?:\/\/[^\s<>"']+/g, "(link in chat)")
    .replace(/\*\*/g, "")
    .replace(/^[•·-]\s*/gm, "");
  const u = new SpeechSynthesisUtterance(spoken);
  u.lang = "en-GB";
  if (cachedVoice === undefined) cachedVoice = pickBritishVoice();
  if (cachedVoice) u.voice = cachedVoice;
  u.rate = 1.05;
  u.pitch = 0.95;
  window.speechSynthesis.speak(u);
}

/** Renders inline text with URLs as tappable links and **bold** honoured. */
function TextWithLinks({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          // Trailing punctuation belongs to the sentence, not the URL.
          const m = /^(.*?)([.,;:!?)]*)$/.exec(part)!;
          return (
            <span key={i}>
              <a
                href={m[1]}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--ac2, #3b82f6)",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                }}
              >
                {m[1]}
              </a>
              {m[2]}
            </span>
          );
        }
        // **bold** segments within plain text.
        return part.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
          seg.startsWith("**") && seg.endsWith("**") ? (
            <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>
          ) : (
            <span key={`${i}-${j}`}>{seg}</span>
          )
        );
      })}
    </>
  );
}

/**
 * Structured rendering for Jarvis messages: bullets become properly
 * indented list rows, blank lines become section spacing — instead of one
 * squashed pre-wrap blob.
 */
function MessageBody({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {lines.map((line, i) => {
        // Leading whitespace (captured BEFORE trimming) carries the intended
        // nesting: Jarvis is asked to hang a prospect's phone/email/link on
        // indented bullets under the company line, and flattening them all to
        // one level made a dial list or prospect breakdown a wall to scan.
        // Treat 2+ leading spaces (or a tab) as a sub-item and nudge it right;
        // with no indentation this is a no-op, so plain replies look unchanged.
        const indent = (/^(\s+)/.exec(line)?.[1] ?? "").replace(/\t/g, "  ");
        const nested = indent.length >= 2;
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: 8 }} />;
        const bullet = /^([•·]|-|\d+[.)])\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <div key={i} style={{ display: "flex", gap: 7, paddingLeft: nested ? 22 : 4 }}>
              <span style={{ flexShrink: 0, color: "var(--faint)" }}>
                {/^\d/.test(bullet[1]) ? bullet[1] : "•"}
              </span>
              <span style={{ minWidth: 0 }}>
                <TextWithLinks text={bullet[2]} />
              </span>
            </div>
          );
        }
        return (
          <div key={i} style={nested ? { paddingLeft: 18 } : undefined}>
            <TextWithLinks text={trimmed} />
          </div>
        );
      })}
    </div>
  );
}

const STARTERS = [
  "Prep my dial list — top 10 calls with numbers, openers and why.",
  "Where are we? Contacted, waiting, replies, what's fresh.",
  "Give me my plan for today, in order.",
  "Which industry and channel are working best?",
];

/**
 * The conversation lives in client state (a working session, not a record);
 * every question triggers a fresh server-side snapshot of the CRM, so Jarvis
 * always answers from live data.
 */
const MEMORY_KEY = "aiq-jarvis-chat";
// Remember whether Jude muted Jarvis's voice, so a refresh or navigation
// doesn't turn it talking again mid-call.
const VOICE_KEY = "aiq-jarvis-voice";

export function JarvisChat() {
  const [turns, setTurns] = useState<JarvisTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  // Pin the transcript to its latest line. Runs on the next frame so the
  // just-appended turn (or restored history) has painted before we scroll.
  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: 99999, behavior })
    );
  }

  // Memory: restore this browser's Jarvis conversation on mount so it
  // survives a refresh/navigation. Being able to scroll back to a past
  // answer means Jude doesn't re-ask the same question — which is what
  // burns tokens. New questions still hit live data every time.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MEMORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as JarvisTurn[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTurns(parsed.slice(-40));
          // Open on the most recent answer, not scrolled up to the top.
          scrollToBottom("auto");
        }
      }
    } catch {
      /* corrupt/blocked storage — start fresh */
    }
  }, []);

  // Persist on every change (keep the last 40 turns — plenty of history,
  // bounded so storage never grows without limit).
  useEffect(() => {
    try {
      if (turns.length > 0) {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(turns.slice(-40)));
      }
    } catch {
      /* storage full/blocked — ignore, chat still works in-memory */
    }
  }, [turns]);

  // Feature-detect after mount (SSR has no window). Voice lists load
  // asynchronously in most browsers — warm them and re-pick when ready.
  useEffect(() => {
    setCanListen(getRecognitionCtor() !== null);
    // Restore the saved voice preference (default stays "on" when never set),
    // so muting sticks across refreshes and page navigations.
    try {
      const savedVoice = localStorage.getItem(VOICE_KEY);
      if (savedVoice !== null) setVoiceOn(savedVoice === "1");
    } catch {
      /* storage blocked — keep the default */
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        cachedVoice = undefined;
      };
    }
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      recRef.current?.stop();
    };
  }, []);

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-IE";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim();
      if (transcript) ask(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function ask(raw: string) {
    const question = raw.trim();
    if (!question || pending) return;
    setError(null);
    setInput("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: question }]);
    // Reveal the new question and the "checking the live numbers…" indicator
    // straight away — on a long chat they'd otherwise sit below the fold
    // until the answer lands.
    scrollToBottom();
    startTransition(async () => {
      const res = await askJarvis(history, question).catch(() => ({
        ok: false as const,
        error: "Network hiccup — ask again.",
      }));
      if (res.ok) {
        setTurns((t) => [...t, { role: "jarvis", text: res.answer }]);
        if (voiceOnRef.current) speak(res.answer);
      } else {
        setError(res.error);
        // Put the failed question back so one tap retries it — and sync the
        // rollback to storage explicitly: the persist effect skips empty
        // arrays (so mount can't wipe a saved chat), which would otherwise
        // leave the failed question as a ghost turn after a reload.
        setTurns((t) => {
          const next = t.slice(0, -1);
          try {
            if (next.length > 0) {
              localStorage.setItem(MEMORY_KEY, JSON.stringify(next.slice(-40)));
            } else {
              localStorage.removeItem(MEMORY_KEY);
            }
          } catch {
            /* storage blocked — in-memory state is still correct */
          }
          return next;
        });
        setInput(question);
      }
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" })
      );
    });
  }

  return (
    <section className="panel panel-block" aria-label="Talk to Jarvis">
      <h2 className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>
          <Sparkles size={16} style={{ verticalAlign: "-3px" }} /> Talk to Jarvis
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const next = !voiceOn;
            if (!next && typeof window !== "undefined")
              window.speechSynthesis?.cancel();
            setVoiceOn(next);
            try {
              localStorage.setItem(VOICE_KEY, next ? "1" : "0");
            } catch {
              /* storage blocked — preference just won't persist this session */
            }
          }}
          title={voiceOn ? "Jarvis speaks its answers — tap to mute" : "Muted — tap so Jarvis speaks"}
        >
          {voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          {voiceOn ? " Voice on" : " Muted"}
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              // Stop Jarvis mid-sentence too — clearing the chat while it's
              // still speaking the last answer is jarring.
              if (typeof window !== "undefined") window.speechSynthesis?.cancel();
              setTurns([]);
              try {
                localStorage.removeItem(MEMORY_KEY);
              } catch {
                /* ignore */
              }
            }}
            title="Clear this saved conversation"
          >
            Clear
          </button>
        )}
      </h2>
      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
        Ask anything about your pipeline — Jarvis pulls the live numbers every
        time it answers, and reads the answer out loud.
        {canListen ? " Tap the mic and just talk to it." : ""} It advises and
        preps; sending is still your finger on the button.
      </p>

      {turns.length === 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => ask(s)}
              disabled={pending}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            display: "grid",
            gap: 10,
            maxHeight: 460,
            overflowY: "auto",
            marginBottom: 12,
            paddingRight: 4,
          }}
        >
          {turns.map((t, i) => (
            <div
              key={i}
              style={{
                justifySelf: t.role === "user" ? "end" : "start",
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 12,
                fontSize: 14,
                whiteSpace: "pre-wrap",
                background:
                  t.role === "user"
                    ? "var(--ac2, #3b82f6)"
                    : "rgba(255,255,255,.06)",
                color: t.role === "user" ? "#fff" : "inherit",
                border:
                  t.role === "user"
                    ? "none"
                    : "1px solid var(--line, rgba(255,255,255,.08))",
              }}
            >
              {t.role === "jarvis" ? <MessageBody text={t.text} /> : t.text}
            </div>
          ))}
          {pending && (
            <div style={{ fontSize: 13, color: "var(--faint)" }}>
              Jarvis is checking the live numbers…
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 13, color: "var(--orange, #fb923c)", margin: "0 0 8px" }}>
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Ask Jarvis…"}
          aria-label="Ask Jarvis"
          maxLength={2000}
          style={{ flex: 1, margin: 0 }}
          disabled={pending}
        />
        {canListen && (
          <button
            type="button"
            className={`btn ${listening ? "btn-primary" : "btn-secondary"}`}
            onClick={toggleMic}
            disabled={pending}
            aria-label={listening ? "Stop listening" : "Speak to Jarvis"}
            title={listening ? "Listening — tap to stop" : "Speak to Jarvis"}
          >
            <Mic size={14} />
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending || !input.trim()}>
          <Send size={14} /> {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}
