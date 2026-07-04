import { Globe } from "lucide-react";
import { ProductPreview } from "@/components/portal/product-preview";

export default function WebsiteAgentPage() {
  return (
    <ProductPreview
      name="Website Agent"
      tagline="AI-powered websites that convert and engage."
      accent="#3B82F6"
      icon={<Globe size={22} />}
      features={[
        "A professional website built and maintained for you — no designers, no developers",
        "Copy and imagery tuned to your trade and your local area",
        "Built-in lead capture that lands straight in your AutomateIQ dashboard",
        "Search-engine optimised so local customers actually find you",
        "Automatic updates — change your services or prices once, the site follows",
        "Monthly performance snapshot: visitors, leads, and what they looked at",
      ]}
    />
  );
}
