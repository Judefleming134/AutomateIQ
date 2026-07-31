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

/**
 * The morning dispatch (queue top-up → autopilot send → brief) fires at a fixed
 * 06:50 UTC — see .github/workflows/morning-brief.yml, which schedules early and
 * sleeps to that target because GitHub delays this repo's crons by hours.
 *
 * UTC is fixed; Ireland isn't. 06:50 UTC is 07:50 Irish in summer (IST) but
 * 06:50 Irish in winter (GMT), so the "~8am" written across the product is
 * roughly right for half the year and over an hour out for the other half.
 * That matters: Jude plans his morning around it, and being told his emails go
 * at 8 when they actually went at 6:50 means a prospect can reply before he's
 * even up.
 */
const DISPATCH_UTC_HOUR = 6;
const DISPATCH_UTC_MINUTE = 50;

/**
 * The morning send time as Irish wall-clock — "7:50am" in summer, "6:50am" in
 * winter. Computed per render, so the copy is never a season out of date.
 */
export function morningSendLabel(): string {
  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      DISPATCH_UTC_HOUR,
      DISPATCH_UTC_MINUTE
    )
  );
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(target)
    .replace(/\s/g, "")
    .toLowerCase();
}

/**
 * What logging a call or a meeting should do to the chase date.
 *
 * The rule, in one line: **a call can put a chase in the diary, but it can
 * never move one that is already there.**
 *
 * Logging a call used to overwrite `next_follow_up_at` with today+3
 * unconditionally, which destroyed the date in both directions:
 *
 *   - a prospect who said "ring me tomorrow" had the callback pushed OUT to
 *     day 3, and got rung two days after he was promised;
 *   - a proposal sitting on its deliberate 7-day decision nudge, a review
 *     booked in a fortnight, and a 90-day `future_opportunity` nurture were
 *     all yanked FORWARD to day 3 — the nurture chased 87 days early.
 *
 * Nothing on screen said the date had moved. `setProspectStatus` already
 * states this exact rule in its own comment ("can add a chase but can never
 * move one"); the two paths to the same outcome were following different ones.
 *
 * A date that has already come round is not a plan, it is the chase this call
 * just was — so that one is rescheduled, which is what stops a called lead
 * reappearing on the list every single day.
 *
 * @param existing the stored `next_follow_up_at` (a date column, or null)
 * @param today    Irish calendar day, defaults to now
 */
export function resolveChaseDate(
  existing: string | null | undefined,
  today: string = dublinDate()
): { date: string; kept: boolean } {
  const current = typeof existing === "string" ? existing.slice(0, 10) : null;
  // Guard the shape: a malformed value must not be treated as a deliberate
  // future date and silently suppress the chase entirely.
  const looksLikeDate = !!current && /^\d{4}-\d{2}-\d{2}$/.test(current);
  if (looksLikeDate && current! > today) return { date: current!, kept: true };
  return { date: dublinDate(3), kept: false };
}
