import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { sendReviewRequest } from "./actions";

export default function SendReviewRequestPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Send a Review Request</h1>
          <p>Send a beautiful review request email to your customer.</p>
        </div>
      </div>

      <ActionForm action={sendReviewRequest} className="panel form-card">
        <div className="field">
          <label htmlFor="customerName">Customer Name</label>
          <input id="customerName" type="text" name="customerName" required />
        </div>
        <div className="field">
          <label htmlFor="customerEmail">Customer Email</label>
          <input id="customerEmail" type="email" name="customerEmail" required />
        </div>
        <div className="form-actions">
          <SubmitButton pendingText="Sending…">Send Review Request</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
