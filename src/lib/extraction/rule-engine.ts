export type RuleField =
  | "supplier"
  | "amount"
  | "category"
  | "currency"
  | "association_id"
  | "sender_email";

export type RuleOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "regex"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string | number;
  /** Only used by the "between" operator, as the upper bound. */
  value2?: number;
}

export type RuleActionType = "set_category" | "set_association" | "flag_for_review" | "notify";

export interface RuleAction {
  type: RuleActionType;
  /** Category name / association id for set_* actions. Unused for flag_for_review/notify. */
  value?: string;
}

export interface RuleRow {
  id: string;
  name: string | null;
  active: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  created_at: string;
}

export interface RuleEvaluationTarget {
  supplier: string | null;
  amount: number | null;
  category: string | null;
  currency: string | null;
  association_id: string | null;
  /** The inbound email address the receipt was sent from (one of
   *  allowed_sender_emails), or null for manual uploads / when unknown. */
  sender_email: string | null;
}

export interface ResolvedActions {
  category: string | null;
  associationId: string | null;
  needsReview: boolean;
  notifyRuleIds: string[];
}

export interface EvaluateRulesResult {
  actions: ResolvedActions;
  /** Every rule whose conditions all matched, in evaluation order. */
  matchedRuleIds: string[];
}

function conditionMatches(condition: RuleCondition, target: RuleEvaluationTarget): boolean {
  const raw = target[condition.field];

  if (
    condition.operator === "gt" ||
    condition.operator === "gte" ||
    condition.operator === "lt" ||
    condition.operator === "lte" ||
    condition.operator === "between"
  ) {
    const numeric = typeof raw === "number" ? raw : null;
    if (numeric === null) return false;
    const value = Number(condition.value);
    switch (condition.operator) {
      case "gt":
        return numeric > value;
      case "gte":
        return numeric >= value;
      case "lt":
        return numeric < value;
      case "lte":
        return numeric <= value;
      case "between": {
        const upper = condition.value2 ?? value;
        return numeric >= Math.min(value, upper) && numeric <= Math.max(value, upper);
      }
    }
  }

  const text = raw == null ? null : String(raw);
  if (text === null) return false;
  const valueStr = String(condition.value);

  switch (condition.operator) {
    case "contains":
      return text.toLowerCase().includes(valueStr.toLowerCase());
    case "equals":
      return text.toLowerCase() === valueStr.toLowerCase();
    case "not_equals":
      return text.toLowerCase() !== valueStr.toLowerCase();
    case "regex":
      try {
        return new RegExp(valueStr, "i").test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function ruleMatches(rule: RuleRow, target: RuleEvaluationTarget): boolean {
  if (!rule.active || rule.conditions.length === 0) return false;
  return rule.conditions.every((c) => conditionMatches(c, target));
}

/**
 * Evaluates every active rule against a single expense/line-item target.
 * Rules are checked in `priority, created_at` order; for the two
 * "set_*" action types the first firing rule wins (mirrors the old
 * learned-rule "first match" behavior), while flag_for_review/notify
 * accumulate across every rule that fires.
 */
export function evaluateRules(target: RuleEvaluationTarget, rules: RuleRow[]): EvaluateRulesResult {
  const ordered = [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  const resolved: ResolvedActions = {
    category: null,
    associationId: null,
    needsReview: false,
    notifyRuleIds: [],
  };
  const matchedRuleIds: string[] = [];

  for (const rule of ordered) {
    if (!ruleMatches(rule, target)) continue;
    matchedRuleIds.push(rule.id);

    for (const action of rule.actions) {
      switch (action.type) {
        case "set_category":
          if (resolved.category === null && action.value) resolved.category = action.value;
          break;
        case "set_association":
          if (resolved.associationId === null && action.value)
            resolved.associationId = action.value;
          break;
        case "flag_for_review":
          resolved.needsReview = true;
          break;
        case "notify":
          resolved.notifyRuleIds.push(rule.id);
          break;
      }
    }
  }

  return { actions: resolved, matchedRuleIds };
}

/** Human-readable one-line summary of a rule, for the rules list UI and notification text. */
export function summarizeRule(
  rule: Pick<RuleRow, "conditions" | "actions">,
  opts: { associationName?: (id: string) => string } = {},
): string {
  const fieldLabel: Record<RuleField, string> = {
    supplier: "Supplier",
    amount: "Amount",
    category: "Category",
    currency: "Currency",
    association_id: "Association",
    sender_email: "Sender email",
  };
  const opLabel: Record<RuleOperator, string> = {
    contains: "contains",
    equals: "is",
    not_equals: "is not",
    regex: "matches",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    between: "is between",
  };

  const conditionText = rule.conditions
    .map((c) => {
      if (c.operator === "between")
        return `${fieldLabel[c.field]} ${opLabel[c.operator]} ${c.value} and ${c.value2}`;
      return `${fieldLabel[c.field]} ${opLabel[c.operator]} "${c.value}"`;
    })
    .join(" AND ");

  const actionText = rule.actions
    .map((a) => {
      switch (a.type) {
        case "set_category":
          return `Category: ${a.value}`;
        case "set_association":
          return `Association: ${opts.associationName?.(a.value ?? "") ?? a.value}`;
        case "flag_for_review":
          return "Flag for review";
        case "notify":
          return "Notify me";
        default:
          return a.type;
      }
    })
    .join(", ");

  return `If ${conditionText || "(no conditions)"} → ${actionText || "(no actions)"}`;
}
