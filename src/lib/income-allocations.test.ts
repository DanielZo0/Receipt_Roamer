import { describe, it, expect } from "vitest";
import { allocationStatus, allocatedTotal, remainderOf, needsAttention } from "./income-allocations";

const alloc = (amount: number) => ({ amount });

describe("allocatedTotal", () => {
  it("is 0 for no allocations", () => {
    expect(allocatedTotal([])).toBe(0);
  });

  it("sums allocation amounts", () => {
    expect(allocatedTotal([alloc(100), alloc(50.5)])).toBe(150.5);
  });

  it("treats a null amount as 0", () => {
    expect(allocatedTotal([{ amount: null }])).toBe(0);
  });
});

describe("remainderOf", () => {
  it("is the payment amount when nothing is allocated", () => {
    expect(remainderOf(550, [])).toBe(550);
  });

  it("is 0 when fully allocated", () => {
    expect(remainderOf(550, [alloc(300), alloc(250)])).toBe(0);
  });

  it("is negative when over-allocated", () => {
    expect(remainderOf(100, [alloc(150)])).toBe(-50);
  });

  it("treats a null payment amount as 0", () => {
    expect(remainderOf(null, [alloc(10)])).toBe(-10);
  });
});

describe("allocationStatus", () => {
  it("is 'unallocated' with no allocation rows", () => {
    expect(allocationStatus(550, [])).toBe("unallocated");
  });

  it("is 'allocated' when the remainder is zero", () => {
    expect(allocationStatus(550, [alloc(300), alloc(250)])).toBe("allocated");
  });

  it("is 'partial' when money is left over", () => {
    expect(allocationStatus(550, [alloc(300)])).toBe("partial");
  });

  it("is 'partial' when over-allocated", () => {
    expect(allocationStatus(550, [alloc(600)])).toBe("partial");
  });

  it("tolerates sub-cent float noise", () => {
    expect(allocationStatus(0.3, [alloc(0.1), alloc(0.1), alloc(0.1)])).toBe("allocated");
  });

  it("does not tolerate a whole cent", () => {
    expect(allocationStatus(550, [alloc(549.99)])).toBe("partial");
  });

  it("is 'partial' when the payment amount is unknown", () => {
    expect(allocationStatus(null, [alloc(300)])).toBe("partial");
  });

  it("is 'partial' when any slice amount is unknown", () => {
    expect(allocationStatus(550, [{ amount: null }, alloc(550)])).toBe("partial");
  });

  it("is 'partial', not 'allocated', when nothing at all is known", () => {
    expect(allocationStatus(null, [{ amount: null }])).toBe("partial");
  });
});

describe("needsAttention", () => {
  it("is true when nothing is allocated", () => {
    expect(needsAttention(550, [])).toBe(true);
  });

  it("is true when the split does not balance", () => {
    expect(needsAttention(550, [alloc(300)])).toBe(true);
  });

  it("is false when fully allocated", () => {
    expect(needsAttention(550, [alloc(550)])).toBe(false);
  });

  it("is true when nothing at all is known", () => {
    expect(needsAttention(null, [{ amount: null }])).toBe(true);
  });
});
