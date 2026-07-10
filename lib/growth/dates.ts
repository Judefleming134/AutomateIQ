/**
 * The Growth Engine's working calendar is Irish time — follow-up dates,
 * "due today" comparisons and greetings should all agree with the person
 * using it, not with the server's UTC clock (which is a day ahead/behind
 * around midnight). en-CA gives the YYYY-MM-DD shape Postgres dates use.
 */
export function dublinDate(daysFromNow = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(
    new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  );
}

/**
 * Day of week in Irish time: 0 = Sunday … 6 = Saturday. Used to give the
 * morning brief a lighter weekend shape without depending on the server's
 * own timezone.
 */
export function dublinWeekday(): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Dublin",
    weekday: "short",
  }).format(new Date());
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? 1;
}

export function dublinHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
}

/**
 * Converts a <input type="datetime-local"> value (e.g. "2026-07-14T14:00",
 * which the user means as IRISH wall-clock time) into the correct UTC
 * instant to store. `new Date("2026-07-14T14:00")` on a UTC server reads it
 * as 14:00 UTC, which then displays as 15:00 in Irish summer time — the
 * off-by-an-hour bug. This anchors it to Europe/Dublin, DST-aware, and is
 * independent of the server's own timezone (both toLocaleString results are
 * parsed in the same local zone, so it cancels out).
 * Returns null on an unparseable value.
 */
export function dublinLocalToUtcISO(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  // The entered wall time, interpreted (temporarily) as if it were UTC.
  const asUtcMs = Date.UTC(y, mo - 1, d, h, mi);
  const at = new Date(asUtcMs);
  // Dublin's offset from UTC at that instant, in ms (+3600000 in summer).
  const dublinShown = new Date(
    at.toLocaleString("en-US", { timeZone: "Europe/Dublin" })
  ).getTime();
  const utcShown = new Date(
    at.toLocaleString("en-US", { timeZone: "UTC" })
  ).getTime();
  const offset = dublinShown - utcShown;
  const instant = new Date(asUtcMs - offset);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
