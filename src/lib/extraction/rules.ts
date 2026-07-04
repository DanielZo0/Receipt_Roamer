// Deterministic validation & matching thresholds for the extraction pipeline.
// Domain data (association/category names & keywords) lives in Supabase, not here.

export const RULES = {
  deterministic_checks: {
    supplier: {
      must_not_be_empty: true,
      min_length: 2,
      max_length: 256,
    },
    expense_date: {
      must_not_be_empty: true,
      max_age_years: 2,
      max_days_in_future: 1,
    },
    amount: {
      must_be_positive: true,
      max_amount: 100_000,
      warn_if_over: 10_000,
    },
    currency: {
      must_not_be_empty: true,
      allowed_codes: [
        "EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "NZD", "SGD", "HKD",
        "CNY", "INR", "MXN", "BRL", "ZAR", "SEK", "NOK", "DKK",
      ],
    },
  },
  association_matching: {
    keyword_match_threshold: 0.7,
    exact_name_match: 1.0,
    address_match: 0.75,
    combined_threshold: 0.6,
  },
  llm_recheck: {
    association_confidence_threshold: 0.7,
  },
} as const;
