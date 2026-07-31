import { Suspense } from "react";
import type { Metadata } from "next";
import TradesLoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · TradeIQ",
  description: "Quotes and invoices for tradespeople — create, send and get paid.",
  robots: { index: false, follow: false },
};

export default function TradesLoginPage() {
  return (
    <main className="login-page">
      <Suspense fallback={null}>
        <TradesLoginForm />
      </Suspense>
    </main>
  );
}
