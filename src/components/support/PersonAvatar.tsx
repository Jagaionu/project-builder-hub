function initials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function PersonAvatar({ name, url, size = 20 }: { name?: string | null; url?: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt={name ?? ""} width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full shrink-0 grid place-items-center bg-surface-2 text-muted-foreground font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {initials(name)}
    </span>
  );
}

export { initials as personInitials };
