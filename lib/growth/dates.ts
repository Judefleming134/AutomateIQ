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

export function dublinHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
}
