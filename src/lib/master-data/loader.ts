import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

export interface MasterDataAssociation {
  id: string;
  name: string;
  keywords: string[];
  postal_codes: string[];
  address_patterns: string[];
  category_hint?: string;
  typical_amount_range: {
    min: number;
    max: number;
  };
  validation_rules: string[];
}

export interface CategoryValidationRule {
  amount_range: {
    min: number;
    max: number;
  };
  must_have_date: boolean;
}

export interface MasterDataCategory {
  name: string;
  keywords: string[];
  validation_rules: CategoryValidationRule;
}

export interface DeterministicValidationRules {
  supplier: {
    must_not_be_empty: boolean;
    min_length: number;
    max_length: number;
  };
  expense_date: {
    must_not_be_empty: boolean;
    format: string;
    not_before: string;
    not_after: string;
  };
  amount: {
    must_be_positive: boolean;
    max_amount: number;
    warn_if_over: number;
  };
  currency: {
    must_not_be_empty: boolean;
    allowed_codes: string[];
  };
}

export interface AssociationMatchingThresholds {
  keyword_match_threshold: number;
  exact_name_match: number;
  postal_code_match: number;
  address_pattern_match: number;
  combined_threshold: number;
}

export interface LLMRecheckThresholds {
  association_confidence_threshold: number;
  category_confidence_threshold: number;
}

export interface ValidationConfig {
  deterministic_checks: DeterministicValidationRules;
  association_matching: AssociationMatchingThresholds;
  llm_recheck: LLMRecheckThresholds;
}

export interface CurrencyMappings {
  symbols: Record<string, string>;
  locale_hints: Record<string, string>;
}

export interface MasterData {
  version: string;
  description: string;
  associations: MasterDataAssociation[];
  categories: MasterDataCategory[];
  validation: ValidationConfig;
  currency_mappings: CurrencyMappings;
  date_parsing: Record<string, unknown>;
  rule_base: unknown[];
}

let cachedMasterData: MasterData | null = null;

/**
 * Loads and parses master_data.yaml. Caches in memory.
 * Throws if file not found or YAML is invalid.
 */
export function loadMasterData(): MasterData {
  if (cachedMasterData) return cachedMasterData;

  const masterDataPath = path.join(
    process.cwd(),
    "src",
    "lib",
    "master-data",
    "master_data.yaml"
  );

  if (!fs.existsSync(masterDataPath)) {
    throw new Error(
      `master_data.yaml not found at ${masterDataPath}. Make sure to create it in src/lib/master-data/`
    );
  }

  const content = fs.readFileSync(masterDataPath, "utf-8");
  const data = yaml.load(content) as MasterData;

  // Validate basic structure
  if (!data.version || !data.associations || !data.categories) {
    throw new Error("Invalid master_data.yaml: missing required fields");
  }

  cachedMasterData = data;
  return data;
}

/**
 * Get all associations (refreshes on each call; use sparingly)
 */
export function getAssociations(): MasterDataAssociation[] {
  return loadMasterData().associations;
}

/**
 * Get all categories
 */
export function getCategories(): MasterDataCategory[] {
  return loadMasterData().categories;
}

/**
 * Get validation configuration
 */
export function getValidationConfig(): ValidationConfig {
  return loadMasterData().validation;
}

/**
 * Get a specific association by ID
 */
export function getAssociationById(id: string): MasterDataAssociation | null {
  const assoc = getAssociations().find((a) => a.id === id);
  return assoc || null;
}

/**
 * Get a specific category by name (case-insensitive)
 */
export function getCategoryByName(name: string): MasterDataCategory | null {
  const cat = getCategories().find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  return cat || null;
}

/**
 * Get currency mappings
 */
export function getCurrencyMappings(): CurrencyMappings {
  return loadMasterData().currency_mappings;
}

/**
 * Invalidate cache (useful for testing or hot-reloading)
 */
export function clearMasterDataCache(): void {
  cachedMasterData = null;
}
