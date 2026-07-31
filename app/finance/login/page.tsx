import { Suspense } from "react";
import type { Metadata } from "next";
import FinanceLoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · FinanceIQ",
  description:
    "Scan your bills, see where the money goes, and get told where you're overpaying — free.",
  robots: { index: false, follow: false },
};

export default function FinanceLoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={null}>
        <FinanceLoginForm />
      </Suspense>
    </main>
  );
}
