"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { DOCUMENTATION_LIBRARY } from "@/lib/documentation/library";

type Result = { ok?: boolean; error?: string } | undefined;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// --- Starter library -------------------------------------------------------
/**
 * Idempotently upserts the 16 professional documents from the code-defined
 * library into doc_documents. Data-driven: the library is the source of
 * truth, admins then edit/publish/assign from the UI. Re-running refreshes
 * any doc the admin hasn't diverged from — it upserts by slug and never
 * clobbers status/assignments (only content/meta), so a published+assigned
 * doc stays published and assigned.
 */
export async function seedLibrary(): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const rows = DOCUMENTATION_LIBRARY.map((d) => ({
    slug: d.slug,
    title: d.title,
    category: d.category,
    summary: d.summary,
    icon: d.icon,
    content: d.content,
    sort_order: d.sortOrder,
  }));

  // onConflict slug: refresh authored content + metadata, leave status,
  // version, assignments and is_global untouched for docs already live.
  const { error } = await supabase
    .from("doc_documents")
    .upsert(rows, { onConflict: "slug", ignoreDuplicates: false });

  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.seed_library",
    metadata: { count: rows.length },
  });

  revalidatePath("/admin/documentation");
  return { ok: true };
}

// --- Create / edit ---------------------------------------------------------
const docSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  category: z.string().trim().min(1, "Category is required"),
  summary: z.string().trim().optional(),
  icon: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(100),
  content: z.string().optional(),
});

export async function createDocument(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const parsed = docSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    summary: formData.get("summary") || undefined,
    icon: formData.get("icon") || undefined,
    sortOrder: formData.get("sortOrder") || 100,
    content: formData.get("content") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  // Unique slug from the title (append a short suffix on collision).
  let slug = slugify(d.title) || "document";
  const { data: existing } = await supabase
    .from("doc_documents")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const { error } = await supabase.from("doc_documents").insert({
    slug,
    title: d.title,
    category: d.category,
    summary: d.summary || "",
    icon: d.icon || "file-text",
    content: d.content || "",
    sort_order: d.sortOrder,
    status: "draft",
  });
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.create",
    metadata: { slug, title: d.title },
  });

  revalidatePath("/admin/documentation");
  return { ok: true };
}

export async function saveDocument(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing document id." };

  const parsed = docSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    summary: formData.get("summary") || undefined,
    icon: formData.get("icon") || undefined,
    sortOrder: formData.get("sortOrder") || 100,
    content: formData.get("content") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const { error } = await supabase
    .from("doc_documents")
    .update({
      title: d.title,
      category: d.category,
      summary: d.summary || "",
      icon: d.icon || "file-text",
      content: d.content || "",
      sort_order: d.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.save",
    metadata: { id, title: d.title },
  });

  revalidatePath("/admin/documentation");
  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

// --- Lifecycle: publish / unpublish / archive / delete ---------------------
/**
 * Publish cuts an immutable version snapshot and makes the doc live.
 * The version number is (max existing snapshot version) + 1, so history
 * reads cleanly as v1, v2, v3 across successive publishes.
 */
export async function publishDocument(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: doc, error: readErr } = await supabase
    .from("doc_documents")
    .select("id, title, content, slug")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!doc) return { error: "Document not found." };

  const { data: last } = await supabase
    .from("doc_versions")
    .select("version")
    .eq("document_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (last?.version ?? 0) + 1;

  const { error: snapErr } = await supabase.from("doc_versions").insert({
    document_id: id,
    version: nextVersion,
    title: doc.title,
    content: doc.content,
    created_by: admin.id,
  });
  if (snapErr) return { error: snapErr.message };

  const { error } = await supabase
    .from("doc_documents")
    .update({
      status: "published",
      version: nextVersion,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.publish",
    metadata: { id, slug: doc.slug, version: nextVersion },
  });

  revalidatePath("/admin/documentation");
  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

export async function setDocumentStatus(
  id: string,
  status: "draft" | "archived"
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("doc_documents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: status === "archived" ? "doc.archive" : "doc.unpublish",
    metadata: { id },
  });

  revalidatePath("/admin/documentation");
  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: doc } = await supabase
    .from("doc_documents")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  // Cascades to versions/assignments/group-assignments via FK on delete.
  const { error } = await supabase.from("doc_documents").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.delete",
    metadata: { id, title: doc?.title },
  });

  revalidatePath("/admin/documentation");
  return { ok: true };
}

// --- Assignment (visibility) ----------------------------------------------
export async function setGlobal(id: string, isGlobal: boolean): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("doc_documents")
    .update({ is_global: isGlobal, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.set_global",
    metadata: { id, isGlobal },
  });

  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

/** Replaces the full set of per-business assignments for a document. */
export async function setBusinessAssignments(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing document id." };
  const businessIds = formData.getAll("businessIds").map(String).filter(Boolean);

  await supabase.from("doc_assignments").delete().eq("document_id", id);
  if (businessIds.length) {
    const { error } = await supabase.from("doc_assignments").insert(
      businessIds.map((bid) => ({ document_id: id, business_id: bid }))
    );
    if (error) return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "doc.assign_businesses",
    metadata: { id, count: businessIds.length },
  });

  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

/** Replaces the full set of group assignments for a document. */
export async function setGroupAssignments(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing document id." };
  const groupIds = formData.getAll("groupIds").map(String).filter(Boolean);

  await supabase.from("doc_group_assignments").delete().eq("document_id", id);
  if (groupIds.length) {
    const { error } = await supabase.from("doc_group_assignments").insert(
      groupIds.map((gid) => ({ document_id: id, group_id: gid }))
    );
    if (error) return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "doc.assign_groups",
    metadata: { id, count: groupIds.length },
  });

  revalidatePath(`/admin/documentation/${id}`);
  return { ok: true };
}

// --- Groups ----------------------------------------------------------------
export async function createGroup(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Group name is required." };

  const { data: group, error } = await supabase
    .from("doc_groups")
    .insert({ name, description })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const businessIds = formData.getAll("businessIds").map(String).filter(Boolean);
  if (businessIds.length && group) {
    await supabase.from("doc_group_members").insert(
      businessIds.map((bid) => ({ group_id: group.id, business_id: bid }))
    );
  }

  await logAdminAction({
    actorId: admin.id,
    action: "doc.group_create",
    metadata: { name, members: businessIds.length },
  });

  revalidatePath("/admin/documentation/groups");
  return { ok: true };
}

/** Replaces the full membership of a group. */
export async function setGroupMembers(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const groupId = String(formData.get("groupId") ?? "");
  if (!groupId) return { error: "Missing group id." };
  const businessIds = formData.getAll("businessIds").map(String).filter(Boolean);

  await supabase.from("doc_group_members").delete().eq("group_id", groupId);
  if (businessIds.length) {
    const { error } = await supabase.from("doc_group_members").insert(
      businessIds.map((bid) => ({ group_id: groupId, business_id: bid }))
    );
    if (error) return { error: error.message };
  }

  await logAdminAction({
    actorId: admin.id,
    action: "doc.group_members",
    metadata: { groupId, count: businessIds.length },
  });

  revalidatePath("/admin/documentation/groups");
  return { ok: true };
}

export async function deleteGroup(groupId: string): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await supabase.from("doc_groups").delete().eq("id", groupId);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.group_delete",
    metadata: { groupId },
  });

  revalidatePath("/admin/documentation/groups");
  return { ok: true };
}

/** Restore a prior version's title/content into the working document. */
export async function restoreVersion(
  documentId: string,
  versionId: string
): Promise<Result> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data: version } = await supabase
    .from("doc_versions")
    .select("title, content, version")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) return { error: "Version not found." };

  const { error } = await supabase
    .from("doc_documents")
    .update({
      title: version.title,
      content: version.content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);
  if (error) return { error: error.message };

  await logAdminAction({
    actorId: admin.id,
    action: "doc.restore_version",
    metadata: { documentId, version: version.version },
  });

  revalidatePath(`/admin/documentation/${documentId}`);
  return { ok: true };
}
