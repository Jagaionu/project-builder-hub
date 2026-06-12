// Fixed Mon–Sun (UK) week helpers — pure, safe on client and server.
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Monday (YYYY-MM-DD) of the fixed week containing the given calendar day. */
export function weekStartOf(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return ymd(d);
}
export function addWeeks(weekStart: string, n: number): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n * 7);
  return ymd(d);
}
/** Today's UK (Europe/London) calendar date as YYYY-MM-DD. */
export function ukToday(ms: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
