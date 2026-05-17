-- The dashboard aggregates evaluation results across every submitting user.
-- RLS must therefore allow signed-in users to read all evaluation rows.
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evaluations_select_dashboard_authenticated ON public.evaluations;

CREATE POLICY evaluations_select_dashboard_authenticated
ON public.evaluations
FOR SELECT
TO authenticated
USING (true);

GRANT SELECT ON public.evaluations TO authenticated;
