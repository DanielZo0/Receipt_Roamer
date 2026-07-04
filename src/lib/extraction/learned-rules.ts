export interface AssociationRuleRow {
  id: string;
  supplier_pattern: string;
  association_id: string;
  active: boolean;
}

export interface LearnedRuleMatchResult {
  association_id: string | null;
  matched_rule_id: string | null;
  matched_pattern: string | null;
}

/**
 * Checks user-confirmed learned rules (from prior corrections) for a substring
 * match against the supplier name. Learned rules are higher-trust than the
 * heuristic keyword matching in Phase 3 — a match here is treated as certain.
 */
export function matchLearnedRule(
  supplier: string | null,
  rules: AssociationRuleRow[],
): LearnedRuleMatchResult {
  if (!supplier) {
    return { association_id: null, matched_rule_id: null, matched_pattern: null };
  }

  const supplierLower = supplier.toLowerCase();
  const match = rules.find(
    (r) => r.active && supplierLower.includes(r.supplier_pattern.toLowerCase()),
  );

  if (!match) {
    return { association_id: null, matched_rule_id: null, matched_pattern: null };
  }

  return {
    association_id: match.association_id,
    matched_rule_id: match.id,
    matched_pattern: match.supplier_pattern,
  };
}
