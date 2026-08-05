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
 * `fallbackDays` only changes the date used when there is NOTHING to keep.
 * "No answer" wants the lead back tomorrow rather than in three days — an
 * unanswered ring bought three days of silence, and on a dial week that is the
 * difference between three attempts and one. The KEEP half of the rule is
 * identical either way: whatever the fallback, a date already in the diary is
 * still never moved.
 *
 * @param existing     the stored `next_follow_up_at` (a date column, or null)
 * @param today        Irish calendar day, defaults to now
 * @param fallbackDays days out to schedule when there is no date to keep
 */
export function resolveChaseDate(
  existing: string | null | undefined,
  today: string = dublinDate(),
  fallbackDays: number = 3
): { date: string; kept: boolean } {
  const current = typeof existing === "string" ? existing.slice(0, 10) : null;
  // Guard the shape: a malformed value must not be treated as a deliberate
  // future date and silently suppress the chase entirely.
  const looksLikeDate = !!current && /^\d{4}-\d{2}-\d{2}$/.test(current);
  if (looksLikeDate && current! > today) return { date: current!, kept: true };
  // Count the cadence forward from the SAME `today` the comparison above used.
  //
  // This used to return dublinDate(fallbackDays) — Dublin's today plus N —
  // regardless of what `today` was. With the default argument the two agree, so
  // production was right; but the parameter exists precisely so a caller (or a
  // test) can pin the day, and half-ignoring it made the function answer two
  // different questions in one call. It shows up for real between 23:00 and
  // midnight UTC each summer, when Dublin has already rolled over: the whole
  // suite went red for that one hour a night, off by exactly one day.
  return { date: addDays(today, fallbackDays), kept: false };
}

/**
 * Adds whole days to a YYYY-MM-DD date, staying on the calendar.
 *
 * Deliberately UTC arithmetic on a bare date, NOT a local-time Date: adding
 * days to a local midnight walks into DST and produces the previous day twice
 * a year. A calendar date has no clock, so it must not be given one.
 */
export function addDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return dublinDate(days);
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dublinDate(days);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
