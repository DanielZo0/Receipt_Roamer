import { getValidationConfig } from "./loader";
import type { ValidationConfig } from "./loader";

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

const getValidationRules = (): ValidationConfig => getValidationConfig();

/**
 * Phase 2: Deterministic validation of extracted fields.
 * Runs BEFORE Gemini — catches obvious errors and format issues.
 */
export function validateExtractedFields(extraction: {
  supplier: string | null;
  expense_date: string | null;
  amount: number | null;
  currency: string | null;
  category?: string | null;
  association_id?: string | null;
}): DeterministicValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const rules = getValidationRules();

  // ─── SUPPLIER ──────────────────────────────────────────────────────────
  const supplierRules = rules.deterministic_checks.supplier;
  if (!extraction.supplier) {
    if (supplierRules.must_not_be_empty) {
      errors.push({
        field: "supplier",
        value: extraction.supplier,
        reason: "Supplier name is required",
        severity: "error",
      });
    }
  } else {
    if (
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
  }

  // ─── EXPENSE_DATE ──────────────────────────────────────────────────────
  const dateRules = rules.deterministic_checks.expense_date;
  if (!extraction.expense_date) {
    if (dateRules.must_not_be_empty) {
      errors.push({
        field: "expense_date",
        value: extraction.expense_date,
        reason: "Expense date is required",
        severity: "error",
      });
    }
  } else {
    // Validate format (basic YYYY-MM-DD check)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extraction.expense_date)) {
      errors.push({
        field: "expense_date",
        value: extraction.expense_date,
        reason: `Date must be in YYYY-MM-DD format, got "${extraction.expense_date}"`,
        severity: "error",
      });
    } else {
      // Parse and check date bounds
      const date = new Date(extraction.expense_date);
      if (isNaN(date.getTime())) {
        errors.push({
          field: "expense_date",
          value: extraction.expense_date,
          reason: "Invalid date",
          severity: "error",
        });
      } else {
        const now = new Date();
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

        if (date < twoYearsAgo) {
          warnings.push({
            field: "expense_date",
            value: extraction.expense_date,
            reason: `Date is older than 2 years (${extraction.expense_date})`,
            severity: "warning",
          });
        }

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (date > tomorrow) {
          errors.push({
            field: "expense_date",
            value: extraction.expense_date,
            reason: `Date is in the future (${extraction.expense_date})`,
            severity: "error",
          });
        }
      }
    }
  }

  // ─── AMOUNT ────────────────────────────────────────────────────────────
  const amountRules = rules.deterministic_checks.amount;
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
  const currencyRules = rules.deterministic_checks.currency;
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
    if (!currencyRules.allowed_codes.includes(upperCurrency)) {
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

/**
 * Checks if any validation errors or warnings should trigger LLM re-check
 */
export function shouldTriggerLLMRecheck(
  validationResult: DeterministicValidationResult
): boolean {
  // If there are errors (not just warnings), ask LLM to fix them
  return validationResult.errors.length > 0;
}
