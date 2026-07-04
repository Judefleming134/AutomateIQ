import { Bot } from "lucide-react";
import { ProductPreview } from "@/components/portal/product-preview";

export default function AiAssistantPage() {
  return (
    <ProductPreview
      name="AI Assistant"
      tagline="A smart assistant that helps your business around the clock."
      accent="#22D3EE"
      icon={<Bot size={22} />}
      features={[
        "Answers customer enquiries 24/7 — even while you're on the tools",
        "Trained on your services, prices and availability, so answers sound like you",
        "Books jobs and appointments straight into your calendar",
        "Qualifies leads before they reach you — no more tyre-kicker calls",
        "Hands over to you the moment a conversation needs a human",
        "Full conversation history in your dashboard",
      ]}
    />
  );
}
