import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { AssistantChat } from "./chat";
import { updateAssistantSettings } from "./actions";

export default async function AiAssistantPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: assistant }, { data: conversation }] = await Promise.all([
    supabase
      .from("aa_assistants")
      .select("knowledge, tone")
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
    supabase
      .from("aa_conversations")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let initialMessages: { role: "user" | "assistant"; content: string }[] = [];
  if (conversation) {
    const { data: messages } = await supabase
      .from("aa_messages")
      .select("role, content")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(50);
    initialMessages = (messages ?? []) as typeof initialMessages;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>AI Assistant</h1>
          <p>
            Your business&apos;s own AI — trained on your details, ready to
            draft replies, answer questions and help you run the day.
          </p>
        </div>
      </div>

      <div className="grid-main-side">
        <AssistantChat
          initialConversationId={conversation?.id ?? null}
          initialMessages={initialMessages}
        />

        <ActionForm action={updateAssistantSettings} className="panel form-card">
          <h2 className="panel-title" style={{ marginBottom: 4 }}>
            Knowledge
          </h2>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--faint)" }}>
            Everything your assistant should know — services, prices, opening
            hours, service area, policies. The more detail, the better its
            answers.
          </p>
          <div className="field">
            <label htmlFor="knowledge">Business information</label>
            <textarea
              id="knowledge"
              name="knowledge"
              rows={9}
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
    </>
  );
}
