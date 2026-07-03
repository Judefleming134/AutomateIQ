import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export function ReviewRequestEmail({
  businessName,
  customerName,
  reviewUrl,
  logoUrl,
  signature,
  isReminder = false,
}: {
  businessName: string;
  customerName: string;
  reviewUrl: string;
  logoUrl?: string | null;
  signature?: string | null;
  isReminder?: boolean;
}) {
  return (
    <Html>
      <Head />
      <Preview>
        {isReminder
          ? `Just a reminder — we'd love your feedback`
          : `We'd love your feedback`}
      </Preview>
      <Body style={{ backgroundColor: "#151314", fontFamily: "sans-serif" }}>
        <Container
          style={{
            backgroundColor: "#18171a",
            borderRadius: 12,
            padding: 32,
            maxWidth: 480,
          }}
        >
          {logoUrl ? (
            <Img src={logoUrl} alt={businessName} height={40} style={{ marginBottom: 16 }} />
          ) : (
            <Heading as="h2" style={{ color: "#fafafa" }}>
              {businessName}
            </Heading>
          )}

          <Text style={{ color: "#a1a1aa" }}>Hi {customerName},</Text>

          <Text style={{ color: "#a1a1aa" }}>
            {isReminder ? (
              <>
                Just a quick follow-up — thank you again for choosing{" "}
                {businessName}. If you have a moment, we&apos;d really
                appreciate a quick review.
              </>
            ) : (
              <>
                Thank you for choosing {businessName}. If you&apos;re happy
                with our service, would you mind leaving us a quick review?
                It really helps our business grow.
              </>
            )}
          </Text>

          <Section style={{ textAlign: "center", margin: "24px 0" }}>
            <Button
              href={reviewUrl}
              style={{
                backgroundColor: "#3B82F6",
                color: "#fff",
                padding: "12px 24px",
                borderRadius: 8,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Leave a Review
            </Button>
          </Section>

          <Text style={{ color: "#71717a", fontSize: 12 }}>
            {signature || `Thank you,\n${businessName}`}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
