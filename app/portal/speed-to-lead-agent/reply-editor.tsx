"use client";

import { useActionState, useState } from "react";
import { Eye, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  renderTemplate,
  placeholderProblem,
  PREVIEW_VARS,
} from "@/lib/speed-to-lead/template";
import { sendTestReply } from "./actions";

/**
 * The reply editor, with the half that was missing.
 *
 * This form rewrites the email every one of a customer's leads receives. It
 * had a subject box, a body box and a Save button — and no way to see the
 * result. You saved it blind, and the next real enquiry was the test. The
 * template file's own doc comment claimed a "settings preview" existed to keep
 * what you see identical to what gets sent; it did not.
 *
 * Three things, all live as you type:
 *   - the rendered email, with {{name}} and {{business}} filled in;
 *   - a warning naming any placeholder that will NOT be filled and would
 *     therefore be posted to a customer verbatim;
 *   - a real send to your own address, through the same Resend path a lead's
 *     reply takes, so "does it arrive and does it look right" is answerable
 *     before it goes to anyone real.
 *
 * The preview imports the SAME renderTemplate the lead-capture route calls, so
 * the two cannot drift.
 */
export function ReplyEditor({
  defaultSubject,
  defaultTemplate,
  businessName,
}: {
  defaultSubject: string;
  defaultTemplate: string;
  businessName: string;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultTemplate);
  const [testState, testAction] = useActionState(sendTestReply, undefined);

  // The real business name, an obviously-sample lead name.
  const vars = { name: PREVIEW_VARS.name, business: businessName };
  const problem = placeholderProblem(subject) ?? placeholderProblem(body);

  return (
    <>
      <div className="field">
        <label htmlFor="subject">Subject line</label>
        <input
          id="subject"
          type="text"
          name="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          maxLength={200}
        />
      </div>
      <div className="field">
        <label htmlFor="replyTemplate">Message</label>
        <textarea
          id="replyTemplate"
          name="replyTemplate"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={4000}
        />
      </div>

      {problem && (
        <p
          role="alert"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            margin: "0 0 14px",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--orange, #fb923c)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{problem}</span>
        </p>
      )}

      {/* What the lead actually receives. Rendered with the same function the
          send path uses, so this cannot show one thing and send another. */}
      <div
        style={{
          margin: "0 0 16px",
          border: "1px solid var(--line, rgba(255,255,255,.08))",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <p
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            margin: 0,
            padding: "9px 12px",
            fontSize: 12,
            color: "var(--faint)",
            background: "var(--bg2, rgba(255,255,255,.03))",
            borderBottom: "1px solid var(--line, rgba(255,255,255,.08))",
          }}
        >
          <Eye size={13} /> What a lead called {PREVIEW_VARS.name} receives
        </p>
        <div style={{ padding: "14px 16px" }}>
          <p style={{ margin: "0 0 10px", fontWeight: 600, fontSize: 14.5 }}>
            {renderTemplate(subject, vars) || (
              <span style={{ color: "var(--faint)", fontWeight: 400 }}>
                (no subject yet)
              </span>
            )}
          </p>
          <p
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            {renderTemplate(body, vars) || (
              <span style={{ color: "var(--faint)" }}>(no message yet)</span>
            )}
          </p>
        </div>
      </div>

      <div className="form-actions" style={{ gap: 10, flexWrap: "wrap" }}>
        <SubmitButton pendingText="Saving…">Save reply</SubmitButton>
        {/* formAction posts THIS form's current values to the test action, so
            it tests the draft on screen rather than the last thing saved. */}
        <SubmitButton
          formAction={testAction}
          className="btn btn-secondary"
          pendingText="Sending…"
        >
          <Send size={14} /> Send me a test
        </SubmitButton>
      </div>

      {testState?.ok && (
        <p
          style={{
            display: "flex",
            gap: 7,
            alignItems: "center",
            margin: "10px 0 0",
            fontSize: 13,
            color: "var(--green, #34d399)",
          }}
        >
          <CheckCircle2 size={14} /> Test sent to {testState.sentTo} — check
          your inbox. Real leads don&apos;t see the [Test] tag or the footer.
        </p>
      )}
      {testState?.error && (
        <p
          role="alert"
          style={{
            display: "flex",
            gap: 7,
            alignItems: "center",
            margin: "10px 0 0",
            fontSize: 13,
            color: "var(--orange, #fb923c)",
          }}
        >
          <AlertTriangle size={14} /> {testState.error}
        </p>
      )}
    </>
  );
}
