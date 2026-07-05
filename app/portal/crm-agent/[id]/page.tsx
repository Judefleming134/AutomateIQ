import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, Building2, StickyNote } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { StageSelect } from "../interactive";
import { addNote, addTask } from "../actions";

const ACTIVITY_ICON: Record<string, string> = {
  note: "📝",
  system: "⚙",
  email: "✉",
  call: "📞",
};

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from("crm_contacts")
    .select("id, name, email, phone, company, stage, source, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!contact) notFound();

  const [{ data: activities }, { data: tasks }] = await Promise.all([
    supabase
      .from("crm_activities")
      .select("id, type, body, created_at")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("crm_tasks")
      .select("id, title, due_date, done")
      .eq("contact_id", id)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(50),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <Link
            href="/portal/crm-agent"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--faint)",
              textDecoration: "none",
              marginBottom: 6,
            }}
          >
            <ArrowLeft size={13} /> All contacts
          </Link>
          <h1>{contact.name}</h1>
          <p style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
            {contact.email && (
              <a href={`mailto:${contact.email}`} style={{ color: "var(--ac2)", display: "inline-flex", gap: 5, alignItems: "center" }}>
                <Mail size={13} /> {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} style={{ color: "var(--body)", display: "inline-flex", gap: 5, alignItems: "center" }}>
                <Phone size={13} /> {contact.phone}
              </a>
            )}
            {contact.company && (
              <span style={{ color: "var(--body)", display: "inline-flex", gap: 5, alignItems: "center" }}>
                <Building2 size={13} /> {contact.company}
              </span>
            )}
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <StageSelect contactId={contact.id} stage={contact.stage ?? "new"} />
        </div>
      </div>

      <div className="grid-main-side">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>Activity timeline</span>
          </h2>

          <ActionForm action={addNote} style={{ marginBottom: 18 }}>
            <input type="hidden" name="contactId" value={contact.id} />
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="body">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <StickyNote size={13} /> Log a note or call
                </span>
              </label>
              <textarea id="body" name="body" rows={2} placeholder="Left a voicemail, will try again Thursday…" required />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Saving…">Add to timeline</SubmitButton>
            </div>
          </ActionForm>

          {(activities ?? []).length === 0 ? (
            <p className="empty-state">No activity logged yet.</p>
          ) : (
            <ul className="crm-timeline">
              {(activities ?? []).map((a) => (
                <li key={a.id} className={a.type === "note" ? "is-note" : ""}>
                  <span className="crm-timeline-icon">{ACTIVITY_ICON[a.type] ?? "•"}</span>
                  <span className="crm-timeline-body">
                    <span>{a.body}</span>
                    <span className="crm-timeline-time">
                      {new Date(a.created_at).toLocaleString("en-IE", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">02 /</span>Tasks</span>
          </h2>
          {(tasks ?? []).length === 0 ? (
            <p className="empty-state" style={{ padding: "8px 0" }}>No tasks for this contact.</p>
          ) : (
            <ul className="crm-task-list">
              {(tasks ?? []).map((t) => (
                <li key={t.id} style={{ opacity: t.done ? 0.5 : 1 }}>
                  <span style={{ flex: "none" }}>{t.done ? "✓" : "○"}</span>
                  <span className="crm-task-body">
                    <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.title}</span>
                    {t.due_date && (
                      <span className="crm-task-meta">
                        due {new Date(t.due_date).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addTask} style={{ marginTop: 12 }}>
            <input type="hidden" name="contactId" value={contact.id} />
            <div className="field">
              <label htmlFor="title">New task</label>
              <input id="title" name="title" type="text" placeholder="Follow up on the quote" required />
            </div>
            <div className="field">
              <label htmlFor="dueDate">Due date</label>
              <input id="dueDate" name="dueDate" type="date" />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Adding…">Add task</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
