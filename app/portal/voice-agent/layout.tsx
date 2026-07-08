import { guardProduct } from "@/lib/auth/require-product";

export default async function VoiceAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardProduct("voice-agent");
  return <>{children}</>;
}
