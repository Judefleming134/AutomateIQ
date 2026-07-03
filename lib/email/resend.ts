import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

export function getResendClient() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

/**
 * Falls back to Resend's own onboarding sender until RESEND_FROM_EMAIL
 * (a verified automateiq.ie address) is configured, so email sending works
 * end-to-end before domain verification finishes rather than being blocked
 * on it.
 */
export function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL || "AutomateIQ <onboarding@resend.dev>";
}
