import { describe, it, expect } from "vitest";
import { matchesAllConditions, evaluateRules, type RuleCondition, type RuleEvaluationTarget } from "./rule-engine";

const target: RuleEvaluationTarget = {
  supplier: "Shell Gas Station",
  amount: 42.5,
  category: null,
  currency: "USD",
  association_id: null,
  sender_email: "billing@shell.com",
};

describe("matchesAllConditions", () => {
  it("returns false for an empty condition list", () => {
    expect(matchesAllConditions([], target)).toBe(false);
  });

  it("returns true when every condition matches (AND semantics)", () => {
    const conditions: RuleCondition[] = [
      { field: "supplier", operator: "contains", value: "shell" },
      { field: "amount", operator: "gte", value: 40 },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("returns false when any condition fails to match", () => {
    const conditions: RuleCondition[] = [
      { field: "supplier", operator: "contains", value: "shell" },
      { field: "amount", operator: "gt", value: 100 },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("equals matches case-insensitively", () => {
    const conditions: RuleCondition[] = [{ field: "currency", operator: "equals", value: "usd" }];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("not_equals returns false when the value matches", () => {
    const conditions: RuleCondition[] = [{ field: "currency", operator: "not_equals", value: "USD" }];
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("not_equals returns true when the value differs", () => {
    const conditions: RuleCondition[] = [{ field: "currency", operator: "not_equals", value: "EUR" }];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("regex matches against the field value case-insensitively", () => {
    const conditions: RuleCondition[] = [
      { field: "sender_email", operator: "regex", value: "^billing@.*\\.com$" },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("regex with a malformed pattern returns false instead of throwing", () => {
    const conditions: RuleCondition[] = [{ field: "sender_email", operator: "regex", value: "(unclosed" }];
    expect(() => matchesAllConditions(conditions, target)).not.toThrow();
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("lt returns true when the numeric field is below the value", () => {
    const conditions: RuleCondition[] = [{ field: "amount", operator: "lt", value: 50 }];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("lte returns true when the numeric field equals the value", () => {
    const conditions: RuleCondition[] = [{ field: "amount", operator: "lte", value: 42.5 }];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("lte returns false when the numeric field is above the value", () => {
    const conditions: RuleCondition[] = [{ field: "amount", operator: "lte", value: 42.49 }];
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("between matches when the value falls within the bounds", () => {
    const conditions: RuleCondition[] = [
      { field: "amount", operator: "between", value: 40, value2: 50 },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("between normalizes reversed bounds (value2 < value)", () => {
    const conditions: RuleCondition[] = [
      { field: "amount", operator: "between", value: 100, value2: 50 },
    ];
    // 42.5 falls between the normalized min (50) and max (100)? No - it's below 50,
    // so this should NOT match; confirms min/max normalization is applied rather
    // than a naive value <= x <= value2 check.
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("between with reversed bounds still matches a value inside the normalized range", () => {
    const conditions: RuleCondition[] = [
      { field: "amount", operator: "between", value: 50, value2: 30 },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });

  it("returns false for a contains condition on a field that is null on the target", () => {
    const conditions: RuleCondition[] = [{ field: "category", operator: "contains", value: "fuel" }];
    expect(matchesAllConditions(conditions, target)).toBe(false);
  });

  it("evaluates a realistic multi-condition rule-builder combination", () => {
    const conditions: RuleCondition[] = [
      { field: "supplier", operator: "contains", value: "shell" },
      { field: "amount", operator: "between", value: 20, value2: 60 },
      { field: "sender_email", operator: "equals", value: "billing@shell.com" },
    ];
    expect(matchesAllConditions(conditions, target)).toBe(true);
  });
});

describe("evaluateRules still passes with the extracted helper", () => {
  it("resolves a set_category action from a single matching rule", () => {
    const result = evaluateRules(target, [
      {
        id: "r1",
        name: null,
        active: true,
        priority: 0,
        conditions: [{ field: "supplier", operator: "contains", value: "shell" }],
        actions: [{ type: "set_category", value: "Fuel" }],
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(result.actions.category).toBe("Fuel");
    expect(result.matchedRuleIds).toEqual(["r1"]);
  });
});
