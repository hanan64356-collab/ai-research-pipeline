CREATE TABLE IF NOT EXISTS public.research_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at text NOT NULL,
  topic text NOT NULL,
  subtopics text NOT NULL DEFAULT '',
  reviewer_email text NOT NULL,
  revisions integer NOT NULL DEFAULT 0,
  archive_link text,
  status text NOT NULL DEFAULT 'Approved',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.research_log TO service_role;
ALTER TABLE public.research_log ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('research-reports', 'research-reports', true)
ON CONFLICT (id) DO NOTHING;
