import { getAssociations, getValidationConfig } from "./loader";
import type { MasterDataAssociation } from "./loader";

export interface AssociationMatchResult {
  association_id: string | null;
  association_name: string | null;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  matched_by: string[]; // Which signals matched ("keyword", "postal_code", "address_pattern", "exact_name")
}

/**
 * Phase 3: Rule-based association matching
 * Finds the best-matching association using keywords, postal codes, and address patterns.
 * Returns null if no confidence threshold is met.
 */
export function matchAssociation(extraction: {
  supplier: string | null;
  postal_code?: string | null;
  address?: string | null;
}): AssociationMatchResult {
  const associations = getAssociations();
  const config = getValidationConfig();
  const thresholds = config.association_matching;

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
  const matches: {
    assoc: MasterDataAssociation;
    confidence: number;
    signals: string[];
  }[] = [];

  for (const assoc of associations) {
    const signals: string[] = [];
    let scoreComponents = 0;
    let totalScore = 0;

    // ─── EXACT NAME MATCH ──────────────────────────────────────────────
    if (assoc.name.toLowerCase() === supplierLower) {
      signals.push("exact_name");
      totalScore += thresholds.exact_name_match;
      scoreComponents += 1;
    }

    // ─── KEYWORD MATCH ────────────────────────────────────────────────
    const keywordMatches = assoc.keywords.filter(
      (kw) => supplierLower.includes(kw.toLowerCase()) || supplierLower.includes(kw.toLowerCase())
    );
    if (keywordMatches.length > 0) {
      signals.push(`keyword_match(${keywordMatches.join(",")})`);
      // Weight by number of matching keywords (max 1.0)
      const keywordScore = Math.min(
        keywordMatches.length / Math.max(assoc.keywords.length, 1),
        1.0
      );
      totalScore += keywordScore * thresholds.keyword_match_threshold;
      scoreComponents += 1;
    }

    // ─── POSTAL CODE MATCH ────────────────────────────────────────────
    if (extraction.postal_code && assoc.postal_codes.length > 0) {
      const postalMatch = assoc.postal_codes.some((pc) =>
        extraction.postal_code!.startsWith(pc)
      );
      if (postalMatch) {
        signals.push("postal_code_match");
        totalScore += thresholds.postal_code_match;
        scoreComponents += 1;
      }
    }

    // ─── ADDRESS PATTERN MATCH ────────────────────────────────────────
    if (extraction.address && assoc.address_patterns.length > 0) {
      const addressPatternMatches = assoc.address_patterns.filter((pattern) => {
        try {
          const regex = new RegExp(pattern);
          return regex.test(extraction.address!);
        } catch {
          console.warn(`Invalid regex pattern in master_data.yaml: ${pattern}`);
          return false;
        }
      });
      if (addressPatternMatches.length > 0) {
        signals.push("address_pattern_match");
        totalScore += thresholds.address_pattern_match;
        scoreComponents += 1;
      }
    }

    // Average the scores to get final confidence
    const finalConfidence = scoreComponents > 0 ? totalScore / scoreComponents : 0;

    if (finalConfidence > 0) {
      matches.push({
        assoc,
        confidence: finalConfidence,
        signals,
      });
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);

  // Return best match if it exceeds combined threshold
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

  // If best match is close but below threshold, still return it but note low confidence
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

/**
 * Suggests whether LLM should re-check the association match
 * Returns true if confidence is below the LLM recheck threshold
 */
export function shouldLLMRecheckAssociation(confidence: number): boolean {
  const config = getValidationConfig();
  return confidence < config.llm_recheck.association_confidence_threshold;
}
