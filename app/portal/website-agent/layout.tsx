import { WebsiteAgentSubnav } from "./subnav";
import { guardProduct } from "@/lib/auth/require-product";

export default async function WebsiteAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardProduct("website-agent");

  return (
    <>
      <WebsiteAgentSubnav />
      {children}
    </>
  );
}
