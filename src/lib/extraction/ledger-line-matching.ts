import { matchAssociationWithRules } from "./association-matching";
import type { AssociationRow, AssociationMatchResult } from "./association-matching";
import { evaluateRules, type RuleEvaluationTarget, type RuleRow } from "./rule-engine";

export interface LineItemMatchResult {
  associationMatch: AssociationMatchResult;
  category: string | null;
  needsReview: boolean;
  notifyRuleIds: string[];
  matchedRuleIds: string[];
}

/**
 * Runs the same rule-based association + category matching used for whole
 * documents (Phase 3 of the pipeline), but against a single ledger line
 * item's own supplier/property-name text.
 */
export function matchLineItem(
  target: RuleEvaluationTarget,
  associations: AssociationRow[],
  rules: RuleRow[],
  fallbackCategory: string | null,
): LineItemMatchResult {
  const associationMatch = matchAssociationWithRules(target, associations, rules);

  const { actions, matchedRuleIds } = evaluateRules(target, rules);
  const category = actions.category ?? fallbackCategory;

  return {
    associationMatch,
    category,
    needsReview: actions.needsReview,
    notifyRuleIds: actions.notifyRuleIds,
    matchedRuleIds,
  };
}
