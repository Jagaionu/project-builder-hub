// Compact relative time, e.g. "just now", "20h 29m ago", "3d ago".
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!then) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin ? hr + "h " + remMin + "m ago" : hr + "h ago";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + "d ago";
  const wk = Math.floor(day / 7);
  if (wk < 5) return wk + "w ago";
  return new Date(iso).toLocaleDateString();
}
