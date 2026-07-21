import { NextResponse, type NextRequest } from "next/server";
import { runJarvisNightly } from "@/lib/cron/jarvis-nightly";
import { isAuthorizedCron } from "@/lib/cron/auth";

// Website fetches + a few AI rewrites need the full function budget.
export const maxDuration = 60;

/**
 * Jarvis's nightly routine (10pm Irish): unattended Growth Engine hygiene —
 * contact harvesting and outdated-draft repair — so the 8am autopilot run
 * and morning brief start from clean data. Same auth doctrine as the daily
 * dispatch: Vercel signs cron requests, we verify the secret ourselves.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jarvisNightly = await runJarvisNightly();

  return NextResponse.json({ ok: true, tasks: { jarvisNightly } });
}
