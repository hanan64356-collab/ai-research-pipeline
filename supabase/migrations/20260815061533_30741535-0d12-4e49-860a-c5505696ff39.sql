CREATE TABLE public.research_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  subtopics text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  reviewer_email text NOT NULL,
  status text NOT NULL DEFAULT 'researching',
  report_html text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback jsonb NOT NULL DEFAULT '[]'::jsonb,
  revisions integer NOT NULL DEFAULT 0,
  review_token uuid NOT NULL DEFAULT gen_random_uuid(),
  pdf_name text,
  drive_link text,
  drive_file_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX research_requests_review_token_idx ON public.research_requests (review_token);

GRANT ALL ON public.research_requests TO service_role;
ALTER TABLE public.research_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_research_requests_updated_at
BEFORE UPDATE ON public.research_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();