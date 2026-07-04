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

      <div className="grid-main-side">
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

        <div className="panel panel-block">
          <h2 className="panel-title">What happens next</h2>
          <ol className="timeline">
            <li>
              <h3>Instantly</h3>
              <p>
                A branded email lands in their inbox — your business name,
                logo and review link, signed off with your signature.
              </p>
            </li>
            <li>
              <h3>Day 3</h3>
              <p>
                One polite reminder goes out automatically — only if they
                haven&apos;t clicked yet. Never a second one.
              </p>
            </li>
            <li>
              <h3>Tracked</h3>
              <p>
                Every send, reminder and click shows up in your History tab
                as it happens.
              </p>
            </li>
          </ol>
        </div>
      </div>
    </>
  );
}
