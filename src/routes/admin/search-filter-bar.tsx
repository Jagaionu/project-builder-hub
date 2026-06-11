import { useState, useCallback, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SubscriptionStatus } from "@/lib/types";

const STATUS_FILTERS: Array<{ key: SubscriptionStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trial", label: "Trial" },
  { key: "suspended", label: "Suspended" },
  { key: "cancelled", label: "Cancelled" },
];

interface SearchFilterBarProps {
  onSearch: (query: string) => void;
  onStatusFilter: (status: SubscriptionStatus | "all") => void;
  activeStatus: SubscriptionStatus | "all";
  searchPlaceholder?: string;
  actions?: ReactNode;
}

export function SearchFilterBar({
  onSearch,
  onStatusFilter,
  activeStatus,
  searchPlaceholder = "Search by name or slug...",
  actions,
}: SearchFilterBarProps) {
  const [value, setValue] = useState("");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setValue(v);
      onSearch(v);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setValue("");
    onSearch("");
  }, [onSearch]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-[320px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={value}
          onChange={handleChange}
          placeholder={searchPlaceholder}
          className="pl-8 h-8 text-xs"
        />
        {value && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onStatusFilter(key)}
            className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              activeStatus === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  );
}
