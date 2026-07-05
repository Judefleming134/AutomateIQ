import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Confirmation email sent to a visitor who books an AI Strategy Session.
 * Branded in the AutomateIQ dark/blue system. `confirmed` distinguishes the
 * initial "we've received your request" note from the owner-approved
 * confirmation.
 */
export function StrategySessionEmail({
  name,
  slotLabel,
  timezoneLabel,
  durationLabel,
  confirmed = false,
}: {
  name: string;
  slotLabel: string;
  timezoneLabel: string;
  durationLabel: string;
  confirmed?: boolean;
}) {
  return (
    <Html>
      <Head />
      <Preview>
        {confirmed
          ? "Your AutomateIQ AI Strategy Session is confirmed"
          : "We've received your AI Strategy Session request"}
      </Preview>
      <Body style={{ backgroundColor: "#0f0f12", fontFamily: "sans-serif", margin: 0 }}>
        <Container
          style={{
            backgroundColor: "#17171b",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 36,
            maxWidth: 520,
            margin: "24px auto",
          }}
        >
          <Text
            style={{
              color: "#3b82f6",
              fontFamily: "monospace",
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              margin: "0 0 8px",
            }}
          >
            AutomateIQ · AI Strategy Session
          </Text>

          <Heading as="h1" style={{ color: "#f7f7f8", fontSize: 24, margin: "0 0 16px" }}>
            {confirmed ? "You're confirmed" : "Request received"}
          </Heading>

          <Text style={{ color: "#a4a4ae", fontSize: 15, lineHeight: 1.6 }}>Hi {name},</Text>

          <Text style={{ color: "#a4a4ae", fontSize: 15, lineHeight: 1.6 }}>
            {confirmed
              ? "Your free AI Strategy Session is confirmed. Here are the details:"
              : "Thanks for booking a free AI Strategy Session with AutomateIQ. We've reserved your slot and will confirm shortly. Here's what you booked:"}
          </Text>

          <Section
            style={{
              backgroundColor: "rgba(59,130,246,0.10)",
              border: "1px solid rgba(59,130,246,0.25)",
              borderRadius: 12,
              padding: "18px 20px",
              margin: "20px 0",
            }}
          >
            <Text style={{ color: "#f7f7f8", fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
              {slotLabel}
            </Text>
            <Text style={{ color: "#8a8a95", fontSize: 13, margin: 0 }}>
              {durationLabel} · {timezoneLabel} · Online video call
            </Text>
          </Section>

          <Text style={{ color: "#a4a4ae", fontSize: 15, lineHeight: 1.6 }}>
            This is a personalised consultation — not a generic sales call. We&apos;ll review your
            current processes, assess where AI can save you time and money, and give you a
            high-level roadmap you can act on whether or not you work with us.
          </Text>

          <Text style={{ color: "#a4a4ae", fontSize: 15, lineHeight: 1.6 }}>
            To get the most from the session, have a rough idea of the manual or repetitive tasks
            that eat the most time in your business. No technical knowledge needed.
          </Text>

          <Hr style={{ borderColor: "rgba(255,255,255,0.08)", margin: "24px 0" }} />

          <Text style={{ color: "#6f6f7a", fontSize: 12, margin: 0 }}>
            Need to change your time? Just reply to this email and we&apos;ll sort it.
          </Text>
          <Text style={{ color: "#6f6f7a", fontSize: 12, margin: "8px 0 0" }}>
            — The AutomateIQ team · automateiq.ie
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
