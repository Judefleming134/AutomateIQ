import { ReviewAgentSubnav } from "./subnav";
import { guardProduct } from "@/lib/auth/require-product";

export default async function ReviewAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardProduct("review-agent");

  return (
    <>
      <ReviewAgentSubnav />
      {children}
    </>
  );
}
