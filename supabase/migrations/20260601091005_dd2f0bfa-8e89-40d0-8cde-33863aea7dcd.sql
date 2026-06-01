
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS home_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_to_base_required boolean NOT NULL DEFAULT false;
