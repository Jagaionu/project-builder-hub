-- Multi-stop routes
CREATE TYPE public.stop_kind AS ENUM ('PICKUP', 'DROP');

CREATE TABLE public.job_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind public.stop_kind NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
  scheduled_at timestamptz NULL,
  arrived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, seq)
);

CREATE INDEX idx_job_stops_job_seq ON public.job_stops (job_id, seq);

ALTER TABLE public.job_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public all" ON public.job_stops FOR ALL USING (true) WITH CHECK (true);

-- Backfill existing jobs into stops
INSERT INTO public.job_stops (job_id, seq, kind, warehouse_id, scheduled_at)
SELECT id, 0, 'PICKUP'::public.stop_kind, origin_warehouse_id, scheduled_at FROM public.jobs WHERE origin_warehouse_id IS NOT NULL;
INSERT INTO public.job_stops (job_id, seq, kind, warehouse_id)
SELECT id, 1, 'DROP'::public.stop_kind, destination_warehouse_id FROM public.jobs WHERE destination_warehouse_id IS NOT NULL;

-- Make origin/destination optional on jobs going forward
ALTER TABLE public.jobs ALTER COLUMN origin_warehouse_id DROP NOT NULL;
ALTER TABLE public.jobs ALTER COLUMN destination_warehouse_id DROP NOT NULL;