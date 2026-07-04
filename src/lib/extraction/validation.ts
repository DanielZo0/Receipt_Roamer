import { RULES } from "./rules";

export interface ValidationError {
  field: string;
  value: unknown;
  reason: string;
  severity: "error" | "warning";
}

export interface DeterministicValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ExtractedFields {
  supplier: string | null;
  expense_date: string | null;
  amount: number | null;
  currency: string | null;
  category?: string | null;
  association_id?: string | null;
}

/**
 * Phase 2: Deterministic validation of extracted fields.
 * Runs after Gemini extraction, before the fields are trusted/saved.
 */
export function validateExtractedFields(
  extraction: ExtractedFields,
): DeterministicValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const { supplier: supplierRules, expense_date: dateRules, amount: amountRules, currency: currencyRules } =
    RULES.deterministic_checks;

  // ─── SUPPLIER ──────────────────────────────────────────────────────────
  if (!extraction.supplier) {
    if (supplierRules.must_not_be_empty) {
      errors.push({
        field: "supplier",
        value: extraction.supplier,
        reason: "Supplier name is required",
        severity: "error",
      });
    }
  } else if (
    extraction.supplier.length < supplierRules.min_length ||
    extraction.supplier.length > supplierRules.max_length
  ) {
    errors.push({
      field: "supplier",
      value: extraction.supplier,
      reason: `Supplier name length must be between ${supplierRules.min_length} and ${supplierRules.max_length} characters`,
      severity: "error",
    });
  }

  // ─── EXPENSE_DATE ──────────────────────────────────────────────────────
  if (!extraction.expense_date) {
    if (dateRules.must_not_be_empty) {
      errors.push({
        field: "expense_date",
        value: extraction.expense_date,
        reason: "Expense date is required",
        severity: "error",
      });
    }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(extraction.expense_date)) {
    errors.push({
      field: "expense_date",
      value: extraction.expense_date,
      reason: `Date must be in YYYY-MM-DD format, got "${extraction.expense_date}"`,
      severity: "error",
    });
  } else {
    const date = new Date(extraction.expense_date);
    if (isNaN(date.getTime())) {
      errors.push({
        field: "expense_date",
        value: extraction.expense_date,
        reason: "Invalid date",
        severity: "error",
      });
    } else {
      const oldestAllowed = new Date();
      oldestAllowed.setFullYear(oldestAllowed.getFullYear() - dateRules.max_age_years);
      if (date < oldestAllowed) {
        warnings.push({
          field: "expense_date",
          value: extraction.expense_date,
          reason: `Date is older than ${dateRules.max_age_years} years (${extraction.expense_date})`,
          severity: "warning",
        });
      }

      const latestAllowed = new Date();
      latestAllowed.setDate(latestAllowed.getDate() + dateRules.max_days_in_future);
      if (date > latestAllowed) {
        errors.push({
          field: "expense_date",
          value: extraction.expense_date,
          reason: `Date is in the future (${extraction.expense_date})`,
          severity: "error",
        });
      }
    }
  }

  // ─── AMOUNT ────────────────────────────────────────────────────────────
  if (extraction.amount === null || extraction.amount === undefined) {
    errors.push({
      field: "amount",
      value: extraction.amount,
      reason: "Amount is required",
      severity: "error",
    });
  } else {
    if (amountRules.must_be_positive && extraction.amount <= 0) {
      errors.push({
        field: "amount",
        value: extraction.amount,
        reason: "Amount must be positive",
        severity: "error",
      });
    }
    if (extraction.amount > amountRules.max_amount) {
      errors.push({
        field: "amount",
        value: extraction.amount,
        reason: `Amount exceeds maximum (${amountRules.max_amount})`,
        severity: "error",
      });
    }
    if (extraction.amount > amountRules.warn_if_over) {
      warnings.push({
        field: "amount",
        value: extraction.amount,
        reason: `Large amount flagged for manual review (${extraction.amount} > ${amountRules.warn_if_over})`,
        severity: "warning",
      });
    }
  }

  // ─── CURRENCY ──────────────────────────────────────────────────────────
  if (!extraction.currency) {
    if (currencyRules.must_not_be_empty) {
      errors.push({
        field: "currency",
        value: extraction.currency,
        reason: "Currency code is required",
        severity: "error",
      });
    }
  } else {
    const upperCurrency = extraction.currency.toUpperCase();
    if (!(currencyRules.allowed_codes as readonly string[]).includes(upperCurrency)) {
      errors.push({
        field: "currency",
        value: extraction.currency,
        reason: `Unknown currency code. Allowed codes: ${currencyRules.allowed_codes.join(", ")}`,
        severity: "error",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Whether validation errors should trigger a Phase 4 LLM re-check. */
export function shouldTriggerLLMRecheck(result: DeterministicValidationResult): boolean {
  return result.errors.length > 0;
}
