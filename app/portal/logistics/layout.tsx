import { guardProduct } from "@/lib/auth/require-product";
import { LogisticsSubnav } from "./subnav";

export default async function LogisticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardProduct("logistics-control-centre");
  return (
    <>
      <LogisticsSubnav />
      {children}
    </>
  );
}
