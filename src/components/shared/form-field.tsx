export function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 px-3 rounded border border-border bg-surface text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
