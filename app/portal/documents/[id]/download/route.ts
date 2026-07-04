import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Download a document via a short-lived signed URL. Ownership is checked
 * with the caller's OWN RLS-scoped client first — the service-role client
 * is only used to sign the storage URL after that check passes, so one
 * tenant can never fetch another's file even with a guessed document id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { id } = await params;

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, name")
    .eq("id", id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60, {
      download: doc.name,
    });

  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Could not prepare the download — try again." },
      { status: 502 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
