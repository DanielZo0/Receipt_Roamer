import { describe, it, expect } from "vitest";
import { conditionsMatch, evaluateRules, type RuleCondition, type RuleEvaluationTarget } from "./rule-engine";

const target: RuleEvaluationTarget = {
  supplier: "Shell Gas Station",
  amount: 42.5,
  category: null,
  currency: "USD",
  association_id: null,
  sender_email: "billing@shell.com",
};

describe("conditionsMatch", () => {
  it("returns false for an empty condition list", () => {
    expect(conditionsMatch([], target)).toBe(false);
  });

  it("returns true when every condition matches (AND semantics)", () => {
    const conditions: RuleCondition[] = [
      { field: "supplier", operator: "contains", value: "shell" },
      { field: "amount", operator: "gte", value: 40 },
    ];
    expect(conditionsMatch(conditions, target)).toBe(true);
  });

  it("returns false when any condition fails to match", () => {
    const conditions: RuleCondition[] = [
      { field: "supplier", operator: "contains", value: "shell" },
      { field: "amount", operator: "gt", value: 100 },
    ];
    expect(conditionsMatch(conditions, target)).toBe(false);
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
