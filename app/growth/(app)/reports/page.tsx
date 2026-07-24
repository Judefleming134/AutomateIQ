import { redirect } from "next/navigation";

/**
 * Reports was merged into Analytics — the numbers and the CSV exports now live
 * on one page. This route stays as a permanent redirect so old links,
 * bookmarks and the morning brief keep working; the period carries across.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  redirect(days ? `/growth/analytics?days=${days}` : "/growth/analytics");
}
