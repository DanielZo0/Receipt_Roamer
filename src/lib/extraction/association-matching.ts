import { RULES } from "./rules";
import { evaluateRules, type RuleEvaluationTarget, type RuleRow } from "./rule-engine";

export interface AssociationRow {
  id: string;
  name: string;
  address: string | null;
  keywords: string[];
  notes: string | null;
}

export interface AssociationMatchResult {
  association_id: string | null;
  association_name: string | null;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  matched_by: string[];
}

/**
 * Phase 3: Rule-based association matching, independent of the LLM's guess.
 * Matches supplier name (exact / keyword) and address (substring) against
 * the associations already stored in Supabase.
 */
export function matchAssociation(
  extraction: { supplier: string | null; address?: string | null },
  associations: AssociationRow[],
): AssociationMatchResult {
  const thresholds = RULES.association_matching;

  if (!extraction.supplier) {
    return {
      association_id: null,
      association_name: null,
      confidence: 0,
      reasons: ["No supplier name provided"],
      matched_by: [],
    };
  }

  const supplierLower = extraction.supplier.toLowerCase();
  const addressLower = extraction.address?.toLowerCase() ?? null;

  const matches: { assoc: AssociationRow; confidence: number; signals: string[] }[] = [];

  for (const assoc of associations) {
    const signals: string[] = [];
    let totalScore = 0;
    let scoreComponents = 0;

    // ─── EXACT NAME MATCH ──────────────────────────────────────────────
    if (assoc.name.toLowerCase() === supplierLower) {
      signals.push("exact_name");
      totalScore += thresholds.exact_name_match;
      scoreComponents += 1;
    }

    // ─── KEYWORD MATCH ────────────────────────────────────────────────
    const keywordMatches = assoc.keywords.filter((kw) => supplierLower.includes(kw.toLowerCase()));
    if (keywordMatches.length > 0) {
      signals.push(`keyword_match(${keywordMatches.join(",")})`);
      const keywordScore = Math.min(
        keywordMatches.length / Math.max(assoc.keywords.length, 1),
        1.0,
      );
      totalScore += keywordScore * thresholds.keyword_match_threshold;
      scoreComponents += 1;
    }

    // ─── ADDRESS MATCH ────────────────────────────────────────────────
    if (addressLower && assoc.address) {
      const assocAddressLower = assoc.address.toLowerCase();
      if (addressLower.includes(assocAddressLower) || assocAddressLower.includes(addressLower)) {
        signals.push("address_match");
        totalScore += thresholds.address_match;
        scoreComponents += 1;
      }
    }

    const finalConfidence = scoreComponents > 0 ? totalScore / scoreComponents : 0;
    if (finalConfidence > 0) {
      matches.push({ assoc, confidence: finalConfidence, signals });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length > 0 && matches[0].confidence >= thresholds.combined_threshold) {
    return {
      association_id: matches[0].assoc.id,
      association_name: matches[0].assoc.name,
      confidence: matches[0].confidence,
      reasons: [
        `Matched by: ${matches[0].signals.join(", ")}`,
        `Confidence: ${(matches[0].confidence * 100).toFixed(1)}%`,
      ],
      matched_by: matches[0].signals,
    };
  }

  if (matches.length > 0) {
    return {
      association_id: null,
      association_name: null,
      confidence: matches[0].confidence,
      reasons: [
        `Low confidence: ${(matches[0].confidence * 100).toFixed(1)}% (threshold: ${(thresholds.combined_threshold * 100).toFixed(1)}%)`,
        `Best candidate: "${matches[0].assoc.name}" (matched by: ${matches[0].signals.join(", ")})`,
      ],
      matched_by: [],
    };
  }

  return {
    association_id: null,
    association_name: null,
    confidence: 0,
    reasons: ["No matching associations found"],
    matched_by: [],
  };
}

/** Whether a low-confidence rule match should trigger a Phase 4 LLM re-check. */
export function shouldLLMRecheckAssociation(confidence: number): boolean {
  return confidence < RULES.llm_recheck.association_confidence_threshold;
}

/**
 * Combines heuristic keyword/exact-name matching (matchAssociation above)
 * with user-defined automation rules (src/lib/extraction/rule-engine.ts). A
 * rule hit is treated as certain (confidence 1.0) and takes priority over
 * the heuristic match.
 */
export function matchAssociationWithRules(
  target: RuleEvaluationTarget,
  associations: AssociationRow[],
  rules: RuleRow[],
): AssociationMatchResult {
  const { actions, matchedRuleIds } = evaluateRules(target, rules);
  if (actions.associationId) {
    const assoc = associations.find((a) => a.id === actions.associationId);
    return {
      association_id: actions.associationId,
      association_name: assoc?.name ?? null,
      confidence: 1.0,
      reasons: [`Matched rule(s): ${matchedRuleIds.join(", ")}`],
      matched_by: matchedRuleIds.map((id) => `rule(${id})`),
    };
  }
  return matchAssociation({ supplier: target.supplier }, associations);
}
