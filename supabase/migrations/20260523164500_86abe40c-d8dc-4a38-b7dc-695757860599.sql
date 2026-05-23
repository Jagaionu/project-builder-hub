UPDATE public.job_stops SET arrived_at = scheduled_at WHERE job_id='b795ae26-feb5-45f0-b834-1dca920ab985' AND arrived_at IS NULL;
UPDATE public.jobs SET status='COMPLETED' WHERE id='b795ae26-feb5-45f0-b834-1dca920ab985';
UPDATE public.drivers SET status='AVAILABLE' WHERE id='3739140f-7f6d-4c37-8448-d41f623aac3a' AND status='ON_ROUTE';