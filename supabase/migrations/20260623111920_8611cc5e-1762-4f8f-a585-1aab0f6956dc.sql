
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  keywords text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public insert categories" ON public.categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update categories" ON public.categories FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete categories" ON public.categories FOR DELETE USING (true);

INSERT INTO public.categories (name) VALUES
  ('Utilities'), ('Cleaning'), ('Maintenance'), ('Lifts'),
  ('Insurance'), ('Tax'), ('Bank'), ('Supplies'),
  ('Professional Services'), ('Other')
ON CONFLICT (name) DO NOTHING;
