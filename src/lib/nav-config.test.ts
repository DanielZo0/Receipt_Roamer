import { describe, it, expect } from "vitest";
import { NAV_GROUPS, isNavItemActive, type NavItem } from "./nav-config";

describe("NAV_GROUPS", () => {
  it("has the three expected groups with their current items", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Money", "Setup", "History"]);
    expect(NAV_GROUPS[0].items.map((i) => i.to)).toEqual(["/income", "/expenses"]);
    expect(NAV_GROUPS[1].items.map((i) => i.to)).toEqual(["/associations", "/categories", "/settings"]);
    expect(NAV_GROUPS[2].items.map((i) => i.to)).toEqual([
      "/upload-logs",
      "/rules",
      "/corrections",
      "/insights",
    ]);
  });
});

describe("isNavItemActive", () => {
  const item: NavItem = { to: "/expenses", label: "Expenses", icon: NAV_GROUPS[0].items[1].icon };
  const dashboard: NavItem = { to: "/", label: "Dashboard", icon: NAV_GROUPS[0].items[1].icon };

  it("matches an exact path", () => {
    expect(isNavItemActive("/expenses", item)).toBe(true);
  });

  it("matches a nested path via startsWith", () => {
    expect(isNavItemActive("/expenses/123", item)).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isNavItemActive("/income", item)).toBe(false);
  });

  it("treats the dashboard root as exact-only, not a prefix match for everything", () => {
    expect(isNavItemActive("/", dashboard)).toBe(true);
    expect(isNavItemActive("/expenses", dashboard)).toBe(false);
  });
});
