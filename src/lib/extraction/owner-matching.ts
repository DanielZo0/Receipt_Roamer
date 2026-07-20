import { RULES } from "./rules";
import { matchAssociation, type AssociationRow } from "./association-matching";

export interface OwnerRow {
  id: string;
  condominium_id: string | null;
  name: string;
  apartment: string | null;
}

export interface OwnerMatchResult {
  owner_id: string | null;
  owner_name: string | null;
  condominium_id: string | null;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  matched_by: string[];
}

const TITLE_RE = /^(mr|mrs|ms|miss|dr|mister)\.?\s+/i;

function normalizeName(name: string): Set<string> {
  const cleaned = name.toLowerCase().replace(TITLE_RE, "").replace(/[^a-z0-9&\s]/g, " ");
  return new Set(cleaned.split(/\s+/).filter(Boolean));
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Extracts a flat/apartment number from a reference string like "...Flt20JD052026". */
function extractApartmentNumber(referenceString: string): string | null {
  // No leading \b: reference strings are often run-together words with no
  // spaces (e.g. "...AssoFlt20JD..."), so "Flt" won't sit on a word boundary.
  const m = referenceString.match(/(?:flt|apt|apartment|unit)\.?\s?0*(\d{1,4})(?=\D|$)/i);
  return m ? m[1] : null;
}

function normalizeApartment(apartment: string): string | null {
  const m = apartment.match(/\d+/);
  return m ? String(Number(m[0])) : null;
}

function normalizeForSubstring(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves the condominium referenced in a reference string. Tries the
 * existing exact-name/keyword-based matchAssociation() first, then falls
 * back to a plain substring check (association name, punctuation/spaces
 * stripped, found inside the reference string) — needed because reference
 * strings are often a single run-together word with no configured keywords
 * on the association (e.g. "PrimroseCourtOwnerAssoFlt20JD052026").
 */
function resolveCondoFromReference(
  referenceString: string,
  associations: AssociationRow[],
): { association_id: string | null } {
  const ruleMatch = matchAssociation({ supplier: referenceString }, associations);
  if (ruleMatch.association_id) return ruleMatch;

  const refNormalized = normalizeForSubstring(referenceString);
  let best: AssociationRow | null = null;
  for (const assoc of associations) {
    const nameNormalized = normalizeForSubstring(assoc.name);
    if (nameNormalized.length >= 4 && refNormalized.includes(nameNormalized)) {
      if (!best || nameNormalized.length > normalizeForSubstring(best.name).length) {
        best = assoc;
      }
    }
  }
  return { association_id: best?.id ?? null };
}

/**
 * Matches an extracted payment (payer name + reference string) against the
 * owners list. Mirrors matchAssociation()'s shape/approach:
 *  1. Resolve the condominium from the reference string (reuses matchAssociation).
 *  2. Extract an apartment/flat number from the reference string.
 *  3. Score each candidate owner by condo match + apartment match + name token overlap.
 */
export function matchOwner(
  extraction: { payer_name: string | null; reference_string: string | null },
  owners: OwnerRow[],
  associations: AssociationRow[],
): OwnerMatchResult {
  const thresholds = RULES.owner_matching;
  const payerName = extraction.payer_name;
  const referenceString = extraction.reference_string ?? "";

  let condoMatch: { association_id: string | null } = { association_id: null };
  if (referenceString) {
    condoMatch = resolveCondoFromReference(referenceString, associations);
  }

  const apartmentNumber = referenceString ? extractApartmentNumber(referenceString) : null;
  const payerTokens = payerName ? normalizeName(payerName) : new Set<string>();

  const candidates = condoMatch.association_id
    ? owners.filter((o) => o.condominium_id === condoMatch.association_id)
    : owners;

  const matches: { owner: OwnerRow; confidence: number; signals: string[] }[] = [];

  for (const owner of candidates) {
    const signals: string[] = [];
    const hasCondo = !!condoMatch.association_id && owner.condominium_id === condoMatch.association_id;
    if (hasCondo) signals.push("condo_match");

    let hasApartment = false;
    if (apartmentNumber && owner.apartment) {
      const ownerApt = normalizeApartment(owner.apartment);
      if (ownerApt && ownerApt === apartmentNumber) {
        hasApartment = true;
        signals.push(`apartment_match(${apartmentNumber})`);
      }
    }

    let nameOverlap = 0;
    if (payerTokens.size > 0) {
      nameOverlap = tokenOverlap(payerTokens, normalizeName(owner.name));
      if (nameOverlap > 0) signals.push(`name_match(${(nameOverlap * 100).toFixed(0)}%)`);
    }

    // Priority-based scoring (not an average) so that corroborating signals
    // always raise confidence, never dilute it: apartment + condo together
    // is near-certain regardless of name overlap; condo alone leans on name
    // overlap as a tiebreaker; with no condo, name overlap alone decides.
    let confidence: number;
    if (hasCondo && hasApartment) {
      confidence = Math.min(1, thresholds.apartment_match * 0.95 + nameOverlap * 0.05);
    } else if (hasCondo) {
      confidence = Math.min(0.89, thresholds.condo_match * 0.55 + nameOverlap * 0.4);
    } else {
      confidence = nameOverlap;
    }

    if (confidence > 0) {
      matches.push({ owner, confidence, signals });
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length > 0 && matches[0].confidence >= thresholds.combined_threshold) {
    return {
      owner_id: matches[0].owner.id,
      owner_name: matches[0].owner.name,
      condominium_id: matches[0].owner.condominium_id,
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
      owner_id: null,
      owner_name: null,
      condominium_id: condoMatch.association_id,
      confidence: matches[0].confidence,
      reasons: [
        `Low confidence: ${(matches[0].confidence * 100).toFixed(1)}% (threshold: ${(thresholds.combined_threshold * 100).toFixed(1)}%)`,
        `Best candidate: "${matches[0].owner.name}" (matched by: ${matches[0].signals.join(", ")})`,
      ],
      matched_by: [],
    };
  }

  return {
    owner_id: null,
    owner_name: null,
    condominium_id: condoMatch.association_id,
    confidence: 0,
    reasons: ["No matching owners found"],
    matched_by: [],
  };
}
