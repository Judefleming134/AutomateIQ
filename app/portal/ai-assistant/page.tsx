import Link from "next/link";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { getEnabledProductKeys, getInstalledAgents } from "@/lib/agents/registry";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { AssistantChat } from "./chat";
import { updateAssistantSettings } from "./actions";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AiAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const { c } = await searchParams;

  const [{ data: assistant }, { data: conversations }, enabledKeys] =
    await Promise.all([
      supabase
        .from("aa_assistants")
        .select("knowledge, tone")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
      supabase
        .from("aa_conversations")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      getEnabledProductKeys(supabase),
    ]);

  // Active conversation: ?c=new starts fresh, a valid id opens that thread
  // (RLS means a foreign id simply matches nothing), default = most recent.
  const convList = conversations ?? [];
  let activeId: string | null = null;
  if (c === "new") {
    activeId = null;
  } else if (c && UUID_RE.test(c) && convList.some((x) => x.id === c)) {
    activeId = c;
  } else {
    activeId = convList[0]?.id ?? null;
  }

  let initialMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (activeId) {
    const { data: messages } = await supabase
      .from("aa_messages")
      .select("role, content")
      .eq("conversation_id", activeId)
      .order("created_at", { ascending: true })
      .limit(80);
    initialMessages = (messages ?? []) as typeof initialMessages;
  }

  // Suggested actions come from the agents actually installed — the
  // assistant can really do these, today.
  const installed = getInstalledAgents(enabledKeys);
  const installedSet = new Set(installed.map((m) => m.key));
  const suggestions = [
    "How is my business doing right now?",
    ...(installedSet.has("voice-agent")
      ? ["What jobs came in today?"]
      : []),
    ...(installedSet.has("review-agent")
      ? ["How are my review requests performing?"]
      : []),
    ...(installedSet.has("website-agent") ? ["Show me my latest leads"] : []),
    ...(installedSet.has("content-agent")
      ? ["Write 3 social posts about our summer availability"]
      : []),
    ...(installedSet.has("instant-quote-agent")
      ? ["Create a quote for a bathroom re-seal"]
      : []),
    ...(installedSet.has("crm-agent") ? ["Find a contact for me"] : []),
    "Draft a reply to a customer asking for a quote",
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>AI Assistant</h1>
          <p>
            Your AI business partner — ask questions, draft anything, and let
            it run your installed agents for you.
          </p>
        </div>
        <Link href="/portal/ai-assistant?c=new" className="btn btn-secondary btn-sm">
          <MessageSquarePlus size={14} /> New conversation
        </Link>
      </div>

      <div className="assistant-grid">
        <aside className="panel assistant-convos">
          <h2 className="panel-title" style={{ marginBottom: 10 }}>
            <span><span className="sys-index">01 /</span>Conversations</span>
          </h2>
          {convList.length === 0 ? (
            <p className="empty-state" style={{ padding: "12px 0" }}>
              No conversations yet.
            </p>
          ) : (
            <ul>
              {convList.map((conv) => (
                <li key={conv.id}>
                  <Link
                    href={`/portal/ai-assistant?c=${conv.id}`}
                    className={conv.id === activeId ? "is-active" : ""}
                  >
                    <span className="convo-title">{conv.title || "Conversation"}</span>
                    <span className="convo-date">
                      {new Date(conv.created_at).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <AssistantChat
          key={activeId ?? "new"}
          initialConversationId={activeId}
          initialMessages={initialMessages}
          suggestions={suggestions}
        />

        <div className="assistant-side">
          <div className="panel panel-block" style={{ marginBottom: 18 }}>
            <h2 className="panel-title">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={14} /> Connected agents
              </span>
            </h2>
            {installed.length === 0 ? (
              <p className="empty-state" style={{ padding: "8px 0" }}>
                No agents installed yet.
              </p>
            ) : (
              <ul className="feed-list">
                {installed.map((m) => (
                  <li key={m.key}>
                    <span style={{ color: "var(--heading)" }}>{m.name}</span>
                    <span className="badge badge-green">ready</span>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--faint)" }}>
              The assistant uses these automatically — just ask in plain
              English.
            </p>
          </div>

          <ActionForm action={updateAssistantSettings} className="panel form-card">
            <h2 className="panel-title" style={{ marginBottom: 4 }}>
              Knowledge
            </h2>
            <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--faint)" }}>
              Everything your assistant should know — services, prices,
              opening hours, service area, policies.
            </p>
            <div className="field">
              <label htmlFor="knowledge">Business information</label>
              <textarea
                id="knowledge"
                name="knowledge"
                rows={7}
                placeholder={
                  "We're a plumbing company covering north Dublin.\nCall-out fee: €80. Hourly rate: €95.\nOpen Mon-Sat 8am-6pm, emergency service 24/7.\n..."
                }
                defaultValue={assistant?.knowledge ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="tone">Tone</label>
              <input
                id="tone"
                type="text"
                name="tone"
                defaultValue={assistant?.tone ?? "friendly and professional"}
              />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Saving…">Save knowledge</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
