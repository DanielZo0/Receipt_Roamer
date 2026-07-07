import { matchAssociationWithLearnedRules } from "./association-matching";
import type { AssociationRow, AssociationMatchResult } from "./association-matching";
import type { AssociationRuleRow } from "./learned-rules";
import { matchLearnedCategoryRule, type CategoryRuleRow } from "./learned-category-rules";

export interface LineItemMatchResult {
  associationMatch: AssociationMatchResult;
  category: string | null;
}

/**
 * Runs the same rule-based association + learned-category matching used for
 * whole documents (Phase 3 of the pipeline), but against a single ledger
 * line item's own supplier/property-name text.
 */
export function matchLineItem(
  supplierText: string | null,
  associations: AssociationRow[],
  learnedAssociationRules: AssociationRuleRow[],
  learnedCategoryRules: CategoryRuleRow[],
  fallbackCategory: string | null,
): LineItemMatchResult {
  const associationMatch = matchAssociationWithLearnedRules(
    supplierText,
    associations,
    learnedAssociationRules,
  );

  const learnedCategoryMatch = matchLearnedCategoryRule(supplierText, learnedCategoryRules);
  const category = learnedCategoryMatch.category ?? fallbackCategory;

  return { associationMatch, category };
}
