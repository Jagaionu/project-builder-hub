import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CompanyPlan } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

interface CreateCompanyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function toSlug(v: string) {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const PLANS: CompanyPlan[] = ["starter", "pro", "enterprise"];

export function CreateCompanyDialog({ open, onOpenChange, onCreated }: CreateCompanyDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<CompanyPlan>("starter");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const { error } = await supabase.from("companies" as never).insert({
        name: name.trim(),
        slug: slug.trim() || toSlug(name),
        plan,
        subscription_status: "trial",
        subscription_ends_at: trialEndsAt.toISOString(),
      } as never);
      if (error) throw new Error(error.message);
      toast.success(`Company "${name}" created (trial expires in 14 days)`);
      setName("");
      setSlug("");
      setPlan("starter");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            New Company
          </DialogTitle>
          <DialogDescription>
            Create a new tenant company. A 14-day trial will be automatically assigned.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Company Name</label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(toSlug(e.target.value));
                }}
                required
                placeholder="Acme Logistics Ltd"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Slug</label>
              <Input
                value={slug}
                onChange={(e) => setSlug(toSlug(e.target.value))}
                required
                placeholder="acme-logistics"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Starting Plan</label>
            <div className="flex gap-1.5">
              {PLANS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlan(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                    plan === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim()}>
              {loading ? "Creating..." : "Create Company"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
