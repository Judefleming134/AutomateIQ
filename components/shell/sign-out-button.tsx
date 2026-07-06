"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ signInHref = "/login" }: { signInHref?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace(signInHref);
    router.refresh();
  }

  return (
    <button
      type="button"
      className="sidebar-signout"
      onClick={handleSignOut}
      disabled={pending}
    >
      <LogOut />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
