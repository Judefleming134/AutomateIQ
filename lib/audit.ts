import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every admin mutation (suspend, delete, assign product, reset password...)
 * writes here. Best-effort: a logging failure must never block the actual
 * mutation it's describing, so errors are swallowed (with a console.error
 * for visibility) rather than thrown.
 */
export async function logAdminAction(params: {
  actorId: string;
  action: string;
  targetBusinessId?: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: params.actorId,
    action: params.action,
    target_business_id: params.targetBusinessId ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) {
    console.error("Failed to write admin_audit_log entry:", error, params);
  }
}
