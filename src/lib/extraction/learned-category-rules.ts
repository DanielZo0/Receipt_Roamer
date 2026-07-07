export interface CategoryRuleRow {
  id: string;
  supplier_pattern: string;
  category: string;
  active: boolean;
}

export interface LearnedCategoryMatchResult {
  category: string | null;
  matched_rule_id: string | null;
  matched_pattern: string | null;
}

/**
 * Mirrors matchLearnedRule (learned-rules.ts) but for category corrections:
 * checks user-confirmed category rules for a substring match against the
 * supplier name. A match overrides whatever category Gemini guessed.
 */
export function matchLearnedCategoryRule(
  supplier: string | null,
  rules: CategoryRuleRow[],
): LearnedCategoryMatchResult {
  if (!supplier) {
    return { category: null, matched_rule_id: null, matched_pattern: null };
  }

  const supplierLower = supplier.toLowerCase();
  const match = rules.find(
    (r) => r.active && supplierLower.includes(r.supplier_pattern.toLowerCase()),
  );

  if (!match) {
    return { category: null, matched_rule_id: null, matched_pattern: null };
  }

  return {
    category: match.category,
    matched_rule_id: match.id,
    matched_pattern: match.supplier_pattern,
  };
}
