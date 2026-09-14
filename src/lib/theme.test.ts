import { describe, it, expect, beforeEach, vi } from "vitest";
import { getStoredTheme, setStoredTheme, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("getStoredTheme / setStoredTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to 'system' when nothing is stored", () => {
    expect(getStoredTheme()).toBe("system");
  });

  it("round-trips a stored value", () => {
    setStoredTheme("dark");
    expect(getStoredTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("falls back to 'system' for a corrupted stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "not-a-real-theme");
    expect(getStoredTheme()).toBe("system");
  });

  it("falls back to 'system' when localStorage.getItem throws", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(getStoredTheme()).toBe("system");
    spy.mockRestore();
  });

  it("silently no-ops when localStorage.setItem throws", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => setStoredTheme("dark")).not.toThrow();
    spy.mockRestore();
  });
});

describe("resolveTheme", () => {
  it("passes through an explicit light/dark choice regardless of system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system preference when set to 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
