"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyseDocument,
  isAnalysableType,
} from "@/lib/permitiq/document-intelligence";
import { resolveRequirements } from "@/lib/permitiq/checklist";

// NOTE: no `export const maxDuration` here. A "use server" module may only
// export async functions — any other export breaks the whole module, and the
// error surfaces confusingly as "createApplication was not found". Route
// segment config belongs on the page, which is where it now lives.

type Result = { ok?: boolean; error?: string; id?: string };

/** Matches the storage guidance for drawings; a set of A1 PDFs adds up. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Every action re-checks the session AND the entitlement, not just the layout.
 * The layout is the UX gate; this is the security boundary — a bookmarked URL
 * or a direct POST must fail for a business without PermitIQ.
 */
async function guard() {
  const { user, profile } = await requireSession();
  const enabled = await requireProductEnabled(profile.business_id!, "permitiq");
  if (!enabled) return null;
  return { user, businessId: profile.business_id! };
}

const createSchema = z.object({
  reference: z.string().trim().max(120).optional(),
  jurisdiction: z.enum(["ie", "us"]),
  authority: z.string().trim().max(160).optional(),
  application_type: z.string().trim().min(1).max(80),
  site_address: z.string().trim().max(400).optional(),
  applicant_name: z.string().trim().max(200).optional(),
});

export async function createApplication(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const ctx = await guard();
  if (!ctx) return { error: "PermitIQ isn't enabled on this account." };

  const parsed = createSchema.safeParse({
    reference: String(formData.get("reference") ?? "") || undefined,
    jurisdiction: String(formData.get("jurisdiction") ?? "ie"),
    authority: String(formData.get("authority") ?? "") || undefined,
    application_type: String(formData.get("application_type") ?? ""),
    site_address: String(formData.get("site_address") ?? "") || undefined,
    applicant_name: String(formData.get("applicant_name") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: "Choose an application type and jurisdiction." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pq_applications")
    .insert({
      business_id: ctx.businessId,
      reference: parsed.data.reference ?? null,
      jurisdiction: parsed.data.jurisdiction,
      authority: parsed.data.authority ?? null,
      application_type: parsed.data.application_type,
      site_address: parsed.data.site_address ?? null,
      applicant_name: parsed.data.applicant_name ?? null,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/migrations/0033_permitiq.sql." };
    }
    return { error: error.message };
  }

  await admin.from("pq_events").insert({
    application_id: data.id,
    business_id: ctx.businessId,
    type: "created",
    detail: `Application created (${parsed.data.application_type})`,
    actor: ctx.user.id,
  });

  revalidatePath("/portal/permitiq");
  return { ok: true, id: data.id };
}

/**
 * Uploads a document, then reads it.
 *
 * ORDER MATTERS: the file lands in storage and the row is written BEFORE the
 * model is called, and the analysis is applied afterwards as an update. An
 * applicant must never lose an upload because inference was slow or the
 * provider was down — the document is the thing they came to protect.
 */
export async function uploadDocument(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const ctx = await guard();
  if (!ctx) return { error: "PermitIQ isn't enabled on this account." };

  const applicationId = String(formData.get("application_id") ?? "");
  const file = formData.get("file");
  const declaredType = String(formData.get("doc_type") ?? "").trim() || null;

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "File is too large — 25MB max." };
  }

  // Ownership through the caller's OWN RLS-scoped client before the
  // service-role client touches anything.
  const supabase = await createClient();
  const { data: app } = await supabase
    .from("pq_applications")
    .select("id, jurisdiction, authority, application_type")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return { error: "Application not found." };

  const admin = createAdminClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 90);
  const storagePath = `${ctx.businessId}/${applicationId}/${crypto.randomUUID()}-${safeName}`;

  const { error: storageError } = await admin.storage
    .from("permits")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
    });
  if (storageError) return { error: `Upload failed: ${storageError.message}` };

  const { data: row, error: rowError } = await admin
    .from("pq_documents")
    .insert({
      application_id: applicationId,
      business_id: ctx.businessId,
      name: file.name.slice(0, 200),
      storage_path: storagePath,
      content_type: file.type || null,
      file_size: file.size,
      doc_type: declaredType,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (rowError) {
    // Never leave a file the index doesn't know about.
    await admin.storage.from("permits").remove([storagePath]);
    return { error: rowError.message };
  }

  await admin.from("pq_events").insert({
    application_id: applicationId,
    business_id: ctx.businessId,
    type: "document_uploaded",
    detail: file.name.slice(0, 200),
    actor: ctx.user.id,
  });

  // ---- Best-effort reading, after the file is safe ------------------------
  if (isAnalysableType(file.type)) {
    try {
      const { data: reqRows } = await admin
        .from("pq_requirements")
        .select("code, label, guidance, mandatory, sort_order, authority")
        .eq("jurisdiction", app.jurisdiction)
        .eq("application_type", app.application_type);

      const requirements = resolveRequirements(reqRows ?? [], app.authority);
      if (requirements.length > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const analysis = await analyseDocument({
          fileBase64: buffer.toString("base64"),
          contentType: file.type,
          fileName: file.name,
          requirements: requirements.map((r) => ({
            code: r.code,
            label: r.label,
            guidance: r.guidance,
          })),
        });

        if (analysis) {
          await admin
            .from("pq_documents")
            .update({
              // Only overwrite doc_type when the uploader didn't state one —
              // a person's explicit choice always outranks the model's.
              doc_type: declaredType ?? analysis.requirementCode,
              extraction: analysis,
              extracted_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        }
      }
    } catch {
      // The document is stored and the checklist still works by hand.
    }
  }

  revalidatePath(`/portal/permitiq/${applicationId}`);
  return { ok: true };
}

/** Sets or corrects which requirement a document satisfies. */
export async function setDocumentType(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const ctx = await guard();
  if (!ctx) return { error: "PermitIQ isn't enabled on this account." };

  const documentId = String(formData.get("document_id") ?? "");
  const applicationId = String(formData.get("application_id") ?? "");
  const docType = String(formData.get("doc_type") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("pq_documents")
    .select("id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "Document not found." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("pq_documents")
    .update({ doc_type: docType })
    .eq("id", documentId);
  if (error) return { error: error.message };

  await admin.from("pq_events").insert({
    application_id: applicationId,
    business_id: ctx.businessId,
    type: "document_reclassified",
    detail: docType ? `Marked as ${docType}` : "Attribution cleared",
    actor: ctx.user.id,
  });

  revalidatePath(`/portal/permitiq/${applicationId}`);
  return { ok: true };
}
