import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { sendReviewRequest } from "./actions";

export default function SendReviewRequestPage() {
  return (
    <main style={{ padding: 40, maxWidth: 480 }}>
      <h1>Send a Review Request</h1>
      <p>Send a beautiful review request email to your customer.</p>

      <ActionForm action={sendReviewRequest} className="send-request-form">
        <label>
          Customer Name
          <input type="text" name="customerName" required />
        </label>
        <label>
          Customer Email
          <input type="email" name="customerEmail" required />
        </label>
        <SubmitButton pendingText="Sending…">Send Review Request</SubmitButton>
      </ActionForm>
    </main>
  );
}
