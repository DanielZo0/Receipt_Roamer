-- Feature: general if-this-then-that automation rules.
-- Replaces the narrow association_rules/category_rules tables (single
-- "supplier contains X" condition, single action) with a generalized
-- condition/action model, and adds a review flag + in-app notifications
-- as new action targets. Nothing is deleted: the old tables are backfilled
-- into public.rules and then renamed (not dropped) so their data survives.

CREATE TABLE public.rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  source_expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rules TO anon, authenticated;
GRANT ALL ON public.rules TO service_role;

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read rules"   ON public.rules FOR SELECT USING (true);
CREATE POLICY "Public insert rules" ON public.rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update rules" ON public.rules FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete rules" ON public.rules FOR DELETE USING (true);

CREATE INDEX rules_active_idx ON public.rules(active);

-- Backfill: one rule per existing association_rules / category_rules row,
-- each expressed as a single "supplier contains" condition plus the
-- corresponding single action.
INSERT INTO public.rules (conditions, actions, active, source_expense_id, created_at)
SELECT
  jsonb_build_array(jsonb_build_object('field', 'supplier', 'operator', 'contains', 'value', supplier_pattern)),
  jsonb_build_array(jsonb_build_object('type', 'set_association', 'value', association_id::text)),
  active,
  source_expense_id,
  created_at
FROM public.association_rules;

INSERT INTO public.rules (conditions, actions, active, source_expense_id, created_at)
SELECT
  jsonb_build_array(jsonb_build_object('field', 'supplier', 'operator', 'contains', 'value', supplier_pattern)),
  jsonb_build_array(jsonb_build_object('type', 'set_category', 'value', category)),
  active,
  source_expense_id,
  created_at
FROM public.category_rules;

-- Renamed rather than dropped — no data is deleted by this migration. The
-- app no longer reads/writes these tables (superseded by public.rules
-- above), but their rows remain in the database untouched under these
-- names if they're ever needed for reference.
ALTER TABLE public.association_rules RENAME TO association_rules_deprecated;
ALTER TABLE public.category_rules RENAME TO category_rules_deprecated;

-- Feature: flag-for-review action target.
ALTER TABLE public.expenses ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX expenses_needs_review_idx ON public.expenses(needs_review) WHERE needs_review;

-- Feature: notify action target (in-app only — no outbound email/SMS
-- provider is configured in this project yet).
CREATE TABLE public.rule_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID REFERENCES public.rules(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rule_notifications TO anon, authenticated;
GRANT ALL ON public.rule_notifications TO service_role;

ALTER TABLE public.rule_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read rule_notifications"   ON public.rule_notifications FOR SELECT USING (true);
CREATE POLICY "Public insert rule_notifications" ON public.rule_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update rule_notifications" ON public.rule_notifications FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete rule_notifications" ON public.rule_notifications FOR DELETE USING (true);

CREATE INDEX rule_notifications_read_idx ON public.rule_notifications(read) WHERE NOT read;
