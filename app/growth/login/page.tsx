import { Suspense } from "react";
import type { Metadata } from "next";
import GrowthLoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Growth Engine — Sign in",
  robots: { index: false, follow: false },
};

export default function GrowthLoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={null}>
        <GrowthLoginForm />
      </Suspense>
    </main>
  );
}
