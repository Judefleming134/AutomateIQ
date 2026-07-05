import Link from "next/link";
import { Contact, Trophy, ListChecks, UserPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { ImportButton, StageSelect, TaskCheckbox } from "./interactive";
import { addContact, addTask } from "./actions";

const STAGE_ORDER = ["new", "contacted", "qualified", "won", "lost"] as const;
const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export default async function CrmAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const { q = "" } = await searchParams;
  const query = q.replace(/[,()%]/g, " ").trim();

  let contactsQuery = supabase
    .from("crm_contacts")
    .select("id, name, email, phone, company, stage, source, last_activity_at")
    .order("last_activity_at", { ascending: false })
    .limit(500);
  if (query) {
    contactsQuery = contactsQuery.or(
      `name.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`
    );
  }

  const [{ data: contacts }, { data: tasks }] = await Promise.all([
    contactsQuery,
    supabase
      .from("crm_tasks")
      .select("id, title, due_date, done, contact_id, crm_contacts(name)")
      .eq("done", false)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(25),
  ]);

  const all = contacts ?? [];
  const won = all.filter((c) => c.stage === "won").length;
  const openTasks = tasks ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const byStage = (stage: string) => all.filter((c) => (c.stage ?? "new") === stage);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CRM Agent</h1>
          <p>
            Every customer and lead from every agent — in one pipeline, with
            a full history and follow-up tasks.
          </p>
        </div>
        <ImportButton />
      </div>

      <div className="stat-grid">
        <StatCard label="Contacts" value={all.length} icon={<Contact />} accent="#3B82F6" />
        <StatCard label="Won" value={won} icon={<Trophy />} accent="#34D399" hint="deals closed" />
        <StatCard
          label="Open tasks"
          value={openTasks.length}
          icon={<ListChecks />}
          accent="#EA580C"
          hint="follow-ups to do"
        />
      </div>

      <form method="get" className="search-bar">
        <input type="text" name="q" placeholder="Search contacts…" defaultValue={q} />
        <button type="submit" className="btn btn-secondary">Search</button>
      </form>

      <div className="grid-main-side">
        <div>
          {all.length === 0 ? (
            <div className="panel panel-block">
              <p className="empty-state">
                {query
                  ? "No contacts match that search."
                  : "No contacts yet — click “Import from agents” to pull in your review customers, website leads and quote recipients, or add one below."}
              </p>
            </div>
          ) : (
            <div className="crm-pipeline">
              {STAGE_ORDER.map((stage) => {
                const rows = byStage(stage);
                if (rows.length === 0) return null;
                return (
                  <div key={stage} className="panel panel-block crm-stage">
                    <h2 className="panel-title">
                      <span>
                        {STAGE_LABEL[stage]}
                        <span className="crm-stage-count">{rows.length}</span>
                      </span>
                    </h2>
                    <ul className="crm-contact-list">
                      {rows.map((c) => (
                        <li key={c.id}>
                          <Link href={`/portal/crm-agent/${c.id}`} className="crm-contact-main">
                            <span className="crm-contact-name">{c.name}</span>
                            <span className="crm-contact-sub">
                              {c.email || c.phone || c.company || c.source || "—"}
                            </span>
                          </Link>
                          <StageSelect contactId={c.id} stage={c.stage ?? "new"} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="assistant-side">
          <ActionForm action={addContact} className="panel form-card" style={{ marginBottom: 18 }}>
            <h2 className="panel-title" style={{ marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <UserPlus size={15} /> Add contact
              </span>
            </h2>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="tel" />
            </div>
            <div className="field">
              <label htmlFor="company">Company</label>
              <input id="company" name="company" type="text" />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Adding…">Add contact</SubmitButton>
            </div>
          </ActionForm>

          <div className="panel panel-block">
            <h2 className="panel-title">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <ListChecks size={15} /> Follow-ups
              </span>
            </h2>
            {openTasks.length === 0 ? (
              <p className="empty-state" style={{ padding: "8px 0" }}>
                No open tasks.
              </p>
            ) : (
              <ul className="crm-task-list">
                {openTasks.map((t) => {
                  const contact = t.crm_contacts as unknown as { name: string } | null;
                  const overdue = t.due_date && t.due_date < today;
                  return (
                    <li key={t.id}>
                      <TaskCheckbox taskId={t.id} done={false} />
                      <span className="crm-task-body">
                        <span>{t.title}</span>
                        <span className="crm-task-meta">
                          {contact ? `${contact.name} · ` : ""}
                          {t.due_date ? (
                            <span style={{ color: overdue ? "#f87171" : "var(--faint)" }}>
                              {overdue ? "overdue " : "due "}
                              {new Date(t.due_date).toLocaleDateString("en-IE", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          ) : (
                            "no date"
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <ActionForm action={addTask} style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="title">New task</label>
                <input id="title" name="title" type="text" placeholder="Call back about the quote" required />
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
      </div>
    </>
  );
}
