# Receipt Roamer Redesign — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Receipt Roamer's dropdown-menu navigation with a persistent sidebar + mobile drawer, add a light/dark/system theme toggle, introduce a shared responsive `DataTable` component (proven on the Settings page), and rebuild the `/rules` automation UI as a decomposed condition/action builder with a live match preview — all without touching how any data is fetched, stored, or mutated.

**Architecture:** A new `AppShell` layout component (built on the existing-but-unused shadcn `Sidebar` primitives) replaces the current `AppNav` dropdown/Sheet component across every authenticated route; both desktop sidebar and mobile drawer read from one shared nav-config data file. A new `DataTable` component absorbs the repeated desktop-`<Table>` / mobile-`<MobileCard>` split, demonstrated end-to-end on Settings (the smallest and fully-understood table page). The `/rules` page is decomposed into row components and gains a preview panel that reuses `rule-engine.ts`'s matching logic directly (no reimplementation). Vitest is added for the first time in this repo, scoped to the pure-logic units introduced here (nav active-state, theme persistence, rule condition matching) — UI composition (layout, sidebar, dark mode rendering, table rendering) is verified manually against the running dev server, since this repo has no component-testing setup and adding one is out of scope for a navigation/layout redesign.

**Tech Stack:** TanStack Start / React 19 / TanStack Router, shadcn/ui (Radix primitives) + Tailwind v4, `@tanstack/react-query`, Supabase JS client, Vitest (new) for pure-logic unit tests.

**Scope note:** This is Phase 1 of the Receipt Roamer redesign spec (`docs/superpowers/specs/2026-09-09-receipt-roamer-redesign-design.md`). It covers spec sections 1 (Navigation), 2 (Theme toggle + AlertDialog consistency, for the settings.tsx and rules.tsx `confirm()` call sites — the only two in the codebase), 3 (the `DataTable` component itself, proven on Settings), and part of section 4 (rule builder decomposition into row components, the live match preview, and its own `AlertDialog` delete-confirm). Two section-4 items are explicitly deferred to a later phase: drag-to-reorder priority and the full plain-English card-list redesign of the rules list (the existing list already renders `summarizeRule()` text per rule, just not yet as a reordering priority-driven card list) — both are additive UI-only follow-ups once Phase 1's decomposition lands. The six other pages that currently hand-roll a desktop-`<Table>`/mobile-card pair (`expenses.tsx`, `income.tsx`, `corrections.tsx`, `upload-logs.tsx`, `associations.tsx`, `categories.tsx`) are large, independently-scoped migrations onto the `DataTable` component this plan introduces — each needs its own accurate plan written against its actual current code, so they are follow-up plans (Phase 2), not tasks here. Section 5's remaining visual-only passes (Dashboard, Upload, Insights, Login) are Phase 3. No task in this plan changes a Supabase migration, a query, a mutation, or deletes any data — every change here is presentation-layer only.

---

## Task 1: Add Vitest test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest and jsdom**

Run: `npm install -D vitest jsdom @testing-library/jest-dom`
Expected: `package.json` devDependencies gain `vitest`, `jsdom`, `@testing-library/jest-dom`.

- [ ] **Step 2: Add a standalone Vitest config**

Create `vitest.config.ts` (kept separate from `vite.config.ts` so the TanStack Start SSR/nitro plugins never load under test):

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] }), react()],
  test: {
    environment: "jsdom",
    globals: false,
  },
});
```

- [ ] **Step 3: Add the `test` script**

In `package.json`, add to `"scripts"` (alongside the existing `"lint"` entry):

```json
    "test": "vitest run",
```

- [ ] **Step 4: Verify the runner works with a throwaway smoke test**

Create `src/lib/__smoke.test.ts` temporarily:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: `1 passed`. Then delete `src/lib/__smoke.test.ts` — it was only to confirm the runner works.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add Vitest for pure-logic unit tests"
```

---

## Task 2: Shared nav config

**Files:**
- Create: `src/lib/nav-config.ts`
- Test: `src/lib/nav-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/nav-config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nav-config`
Expected: FAIL — `Cannot find module './nav-config'`.

- [ ] **Step 3: Implement `nav-config.ts`**

Create `src/lib/nav-config.ts` (values ported directly from the current `GROUPS` array in `src/components/AppNav.tsx`, plus the standalone Dashboard entry):

```ts
import {
  FileText,
  Home,
  Building2,
  Tag,
  ScrollText,
  Sparkles,
  History,
  LineChart,
  DollarSign,
  Wallet,
  Settings,
  Upload,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; icon: LucideIcon; items: NavItem[] };

export const DASHBOARD_ITEM: NavItem = { to: "/", label: "Dashboard", icon: Home };
export const UPLOAD_ITEM: NavItem = { to: "/upload", label: "Upload", icon: Upload };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Money",
    icon: Wallet,
    items: [
      { to: "/income", label: "Income", icon: DollarSign },
      { to: "/expenses", label: "Expenses", icon: FileText },
    ],
  },
  {
    label: "Setup",
    icon: Settings,
    items: [
      { to: "/associations", label: "Associations", icon: Building2 },
      { to: "/categories", label: "Categories", icon: Tag },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "History",
    icon: History,
    items: [
      { to: "/upload-logs", label: "Logs", icon: ScrollText },
      { to: "/rules", label: "Automations", icon: Sparkles },
      { to: "/corrections", label: "Corrections", icon: History },
      { to: "/insights", label: "Insights", icon: LineChart },
    ],
  },
];

/** True if `pathname` is on `item`'s route. The dashboard root only matches
 *  exactly (otherwise it would match every other route as a prefix); every
 *  other item matches its own path or any nested path under it. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname.startsWith(item.to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nav-config`
Expected: `4 passed` (plus the `NAV_GROUPS` describe block) — all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav-config.ts src/lib/nav-config.test.ts
git commit -m "feat: extract shared nav config for sidebar + drawer"
```

---

## Task 3: Theme persistence utility

**Files:**
- Create: `src/lib/theme.ts`
- Test: `src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- theme`
Expected: FAIL — `Cannot find module './theme'`.

- [ ] **Step 3: Implement `theme.ts`**

Create `src/lib/theme.ts`:

```ts
export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "receipt-roamer-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the user's stored theme preference, defaulting to "system" if
 *  nothing (or something invalid) is stored. Safe to call during SSR. */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(value) ? value : "system";
}

export function setStoredTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** Resolves a theme preference to an actual light/dark value, given whether
 *  the OS/browser currently prefers dark mode. */
export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- theme`
Expected: `5 passed` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat: add theme persistence utility (light/dark/system)"
```

---

## Task 4: Theme toggle component

**Files:**
- Create: `src/components/theme-toggle.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/theme-toggle.tsx`. It applies the `.dark` class to `<html>` on mount and whenever the choice changes, listens for OS-level scheme changes while set to "system", and persists via the Task 3 utility:

```tsx
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getStoredTheme, resolveTheme, setStoredTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function applyResolvedTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(theme, prefersDark);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Read the stored preference and apply it once the component mounts on
  // the client (localStorage/matchMedia aren't available during SSR).
  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyResolvedTheme(stored);
  }, []);

  // Keep the resolved theme in sync with OS changes while set to "system".
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyResolvedTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  const handleSelect = (value: Theme) => {
    setTheme(value);
    setStoredTheme(value);
    applyResolvedTheme(value);
  };

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
          <CurrentIcon className="h-4 w-4" /> {current.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <DropdownMenuItem key={o.value} onClick={() => handleSelect(o.value)}>
              <Icon className="h-4 w-4 mr-2" /> {o.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Manual verification (no automated test — this is DOM/browser-API driven UI, covered by the full-shell manual pass in Task 6)**

This component is exercised end-to-end once it's mounted inside `AppShell` in Task 5/6; skip standalone verification here to avoid mounting it in isolation twice.

- [ ] **Step 3: Commit**

```bash
git add src/components/theme-toggle.tsx
git commit -m "feat: add light/dark/system theme toggle component"
```

---

## Task 5: `AppSidebar` and `AppShell` components

**Files:**
- Create: `src/components/AppSidebar.tsx`
- Create: `src/components/AppShell.tsx`

- [ ] **Step 1: Implement `AppSidebar.tsx`**

Renders the grouped nav (from Task 2's `nav-config.ts`) using the shadcn `Sidebar` primitives already in `src/components/ui/sidebar.tsx`. The same component is used for both the desktop fixed sidebar and the mobile Sheet drawer — `<Sidebar>` switches between them internally based on `useIsMobile()`.

```tsx
import { Link, useRouterState, useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { DASHBOARD_ITEM, NAV_GROUPS, UPLOAD_ITEM, isNavItemActive } from "@/lib/nav-config";
import { logoutFn } from "@/lib/auth";

export function AppSidebar() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const handleLogout = async () => {
    try {
      await logoutFn();
      toast.success("Successfully logged out");
      router.navigate({ to: "/login" });
    } catch {
      toast.error("Failed to log out");
    }
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/" className="px-2 py-1 font-semibold text-foreground">
          Receipt Roamer
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {[DASHBOARD_ITEM, UPLOAD_ITEM].map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={isNavItemActive(pathname, item)}>
                    <Link to={item.to}>
                      <item.icon /> <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isNavItemActive(pathname, item)}>
                      <Link to={item.to}>
                        <item.icon /> <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <ThemeToggle />
        <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive">
          <LogOut /> <span>Log Out</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Implement `AppShell.tsx`**

Owns the page container (max-width + padding) so routes stop hand-rolling it, plus the mobile top bar with the sidebar trigger (the drawer open button):

```tsx
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const MAX_WIDTH_CLASS = {
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
} as const;

export function AppShell({
  children,
  maxWidth = "4xl",
}: {
  children: ReactNode;
  maxWidth?: keyof typeof MAX_WIDTH_CLASS;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex items-center gap-2 border-b bg-card px-4 py-3 md:hidden">
          <SidebarTrigger />
          <span className="font-semibold text-foreground">Receipt Roamer</span>
        </header>
        <main className={cn("mx-auto w-full px-4 py-8", MAX_WIDTH_CLASS[maxWidth])}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, then temporarily mount `<AppShell><p>test</p></AppShell>` in place of `index.tsx`'s existing return (don't commit this — it's just to confirm the shell renders before wiring up every route in Task 6). Open the dev server in a browser: confirm the sidebar renders on desktop with all 9 links across the 3 groups plus Dashboard/Upload, the theme toggle and Log Out appear in the footer, and resizing to a mobile width hides the sidebar and shows the hamburger trigger in the top bar which opens the drawer with the same links. Revert the temporary `index.tsx` edit afterward.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppSidebar.tsx src/components/AppShell.tsx
git commit -m "feat: add AppSidebar and AppShell layout components"
```

---

## Task 6: Migrate every route from `AppNav` to `AppShell`, delete `AppNav`

**Files:**
- Modify: `src/routes/associations.tsx:130-132,256-258`
- Modify: `src/routes/categories.tsx:92-94,192-194`
- Modify: `src/routes/corrections.tsx:115-117,223-225`
- Modify: `src/routes/expenses.tsx:364-366,711-713`
- Modify: `src/routes/income.tsx:369-371,696-698`
- Modify: `src/routes/index.tsx:96-98,249-251`
- Modify: `src/routes/insights.tsx:139-141,197-199`
- Modify: `src/routes/rules.tsx:218-220,363-365`
- Modify: `src/routes/settings.tsx:41-43,58-60`
- Modify: `src/routes/upload-logs.tsx:228-230,583-585`
- Modify: `src/routes/upload.tsx:370-372,464-466`
- Delete: `src/components/AppNav.tsx`

Every one of these 11 files has the identical wrapper pattern at both its opening and closing tags. For each file: replace the `import { AppNav } from "@/components/AppNav";` import with `import { AppShell } from "@/components/AppShell";`, then apply the open/close edits below (the `maxWidth` value matches each file's current `max-w-*` class so no visual width changes yet — that's a Phase 3 concern).

- [ ] **Step 1: `associations.tsx`**

Old:
```tsx
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
```
New:
```tsx
    <AppShell maxWidth="4xl">
```
Old (closing):
```tsx
      </main>
    </div>
  );
}
```
New:
```tsx
    </AppShell>
  );
}
```

- [ ] **Step 2: `categories.tsx`** — same edit as Step 1 (`max-w-4xl` → `maxWidth="4xl"`).

- [ ] **Step 3: `corrections.tsx`** — same edit as Step 1 (`max-w-4xl` → `maxWidth="4xl"`).

- [ ] **Step 4: `expenses.tsx`**

Old:
```tsx
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
```
New:
```tsx
    <AppShell maxWidth="6xl">
```
Closing edit same as Step 1's closing pattern.

- [ ] **Step 5: `income.tsx`** — same edit as Step 4 (`max-w-6xl` → `maxWidth="6xl"`).

- [ ] **Step 6: `index.tsx`**

Old:
```tsx
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
```
New:
```tsx
    <AppShell maxWidth="6xl">
```
Closing edit same as Step 1's closing pattern. (The bespoke `px-3 sm:px-4 py-6 sm:py-8` padding is intentionally dropped in favor of `AppShell`'s standard `px-4 py-8` — this was exactly the kind of per-page drift the redesign is meant to remove; Task 6 Step 12 below covers a full visual re-check.)

- [ ] **Step 7: `insights.tsx`** — same edit as Step 1 (`max-w-4xl` → `maxWidth="4xl"`).

- [ ] **Step 8: `rules.tsx`** — same edit as Step 1 (`max-w-4xl` → `maxWidth="4xl"`, note this file's `<main>` also carries `space-y-10` — move that class onto a wrapping `<div className="space-y-10">` as the first child inside `<AppShell>` instead, since `AppShell`'s `<main>` doesn't accept extra classes):

Old:
```tsx
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10">
```
New:
```tsx
    <AppShell maxWidth="4xl">
      <div className="space-y-10">
```
Old (closing):
```tsx
      </main>
    </div>
  );
}
```
New:
```tsx
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 9: `settings.tsx`** — same pattern as Step 8 (`max-w-4xl mx-auto px-4 py-8 space-y-10` → `maxWidth="4xl"` + inner `<div className="space-y-10">` wrapper).

- [ ] **Step 10: `upload-logs.tsx`** — same edit as Step 1 (`max-w-4xl` → `maxWidth="4xl"`).

- [ ] **Step 11: `upload.tsx`** — same edit as Step 1 but `max-w-2xl` → `maxWidth="2xl"`.

- [ ] **Step 12: Delete `AppNav.tsx` and verify nothing else imports it**

Run: `grep -rn "AppNav" src/` (or `Grep` tool with pattern `AppNav` over `src/`)
Expected: no matches remain.

Then delete the file:
```bash
git rm src/components/AppNav.tsx
```

- [ ] **Step 13: Manual verification**

Run: `npm run dev`. Visit every one of the 11 routes in a browser and confirm: the sidebar (desktop) / drawer (mobile, resize to <768px) renders identically on each page, the correct nav item is highlighted as active, page content renders with no layout breakage, and the `rules`/`settings` pages (which moved `space-y-10` onto an inner wrapper) still have the same vertical spacing between sections as before.

- [ ] **Step 14: Commit**

```bash
git add src/routes/*.tsx src/components/AppNav.tsx
git commit -m "refactor: migrate all routes from AppNav to AppShell sidebar layout"
```

---

## Task 7: Extract reusable rule-matching helper

**Files:**
- Modify: `src/lib/extraction/rule-engine.ts`
- Test: `src/lib/extraction/rule-engine.test.ts` (new)

This gives the Task 9 rule builder a matching function it can call directly for its live preview, so the preview can never drift from what `evaluateRules` actually does in production.

- [ ] **Step 1: Write the failing test**

Create `src/lib/extraction/rule-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rule-engine`
Expected: FAIL — `conditionsMatch` is not exported from `./rule-engine`.

- [ ] **Step 3: Extract and export `conditionsMatch`, reuse it in `ruleMatches`**

In `src/lib/extraction/rule-engine.ts`, replace the existing `ruleMatches` function (around line 121):

Old:
```ts
function ruleMatches(rule: RuleRow, target: RuleEvaluationTarget): boolean {
  if (!rule.active || rule.conditions.length === 0) return false;
  return rule.conditions.every((c) => conditionMatches(c, target));
}
```
New:
```ts
/** True if every condition in the list matches the target (AND semantics).
 *  An empty condition list never matches — a rule needs at least one
 *  condition to fire. Exported so the /rules live-preview UI can reuse the
 *  exact same matching logic evaluateRules uses in production. */
export function conditionsMatch(conditions: RuleCondition[], target: RuleEvaluationTarget): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((c) => conditionMatches(c, target));
}

function ruleMatches(rule: RuleRow, target: RuleEvaluationTarget): boolean {
  if (!rule.active) return false;
  return conditionsMatch(rule.conditions, target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rule-engine`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extraction/rule-engine.ts src/lib/extraction/rule-engine.test.ts
git commit -m "refactor: extract conditionsMatch helper from rule-engine for UI reuse"
```

---

## Task 8: Shared `DataTable` component

**Files:**
- Create: `src/components/data-table.tsx`
- Test: `src/components/data-table-columns.test.ts`

`DataTable` renders a desktop `<Table>` and a mobile `MobileCardList` from one `columns`/`rows` definition, replacing the hand-duplicated pair currently in `settings.tsx` (migrated in Task 9) and, in Phase 2, the other six table pages.

- [ ] **Step 1: Write the failing test for the one pure piece of logic (which columns show on mobile)**

Create `src/components/data-table-columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { visibleMobileColumns, type DataTableColumn } from "./data-table";

type Row = { id: string; email: string };

const columns: DataTableColumn<Row>[] = [
  { key: "email", header: "Email", cell: (r) => r.email },
  { key: "created", header: "Created", cell: () => "", hideOnMobile: true },
];

describe("visibleMobileColumns", () => {
  it("excludes columns marked hideOnMobile", () => {
    expect(visibleMobileColumns(columns).map((c) => c.key)).toEqual(["email"]);
  });

  it("keeps all columns when none are hidden", () => {
    const noHidden: DataTableColumn<Row>[] = [columns[0]];
    expect(visibleMobileColumns(noHidden)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- data-table-columns`
Expected: FAIL — `Cannot find module './data-table'`.

- [ ] **Step 3: Implement `data-table.tsx`**

```tsx
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MobileCardList, MobileCard, MobileCardRow, MobileCardLabel } from "@/components/ui/responsive-table";
import { Card } from "@/components/ui/card";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Omit this column from the mobile card view (e.g. a column that only
   *  makes sense in a wide table, like a secondary timestamp). */
  hideOnMobile?: boolean;
  className?: string;
};

/** Columns to render in the mobile card view — everything not marked hideOnMobile. */
export function visibleMobileColumns<T>(columns: DataTableColumn<T>[]): DataTableColumn<T>[] {
  return columns.filter((c) => !c.hideOnMobile);
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  emptyMessage,
  rowActions,
}: {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  rowActions?: (row: T) => ReactNode;
}) {
  const mobileColumns = visibleMobileColumns(columns);

  return (
    <>
      <Card className="overflow-x-auto hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
              {rowActions && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !rows || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-8">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                  {rowActions && <TableCell>{rowActions(row)}</TableCell>}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8 md:hidden">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 md:hidden">{emptyMessage}</p>
      ) : (
        <MobileCardList>
          {rows.map((row) => (
            <MobileCard key={row.id} className="space-y-2">
              {mobileColumns.map((col) => (
                <MobileCardRow key={col.key}>
                  <MobileCardLabel>{col.header}</MobileCardLabel>
                  <span className="truncate">{col.cell(row)}</span>
                </MobileCardRow>
              ))}
              {rowActions && <div className="flex justify-end">{rowActions(row)}</div>}
            </MobileCard>
          ))}
        </MobileCardList>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- data-table-columns`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/data-table.tsx src/components/data-table-columns.test.ts
git commit -m "feat: add shared responsive DataTable component"
```

---

## Task 9: Migrate Settings to `DataTable` + replace `confirm()` with `AlertDialog`

**Files:**
- Modify: `src/routes/settings.tsx`

This is the reference migration other Phase 2 pages will follow. It also fixes the one `confirm()` usage documented in the spec (section 2) — replacing it with the app's existing `AlertDialog` component.

- [ ] **Step 1: Replace the `AllowedSendersTable` body**

In `src/routes/settings.tsx`, update the imports (remove `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`MobileCardList`/`MobileCard`, add `DataTable` and the `AlertDialog` pieces):

Old imports (lines 7-19):
```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppNav } from "@/components/AppNav";
import { MobileCardList, MobileCard } from "@/components/ui/responsive-table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
```
New imports:
```tsx
import { DataTable, type DataTableColumn } from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
```

(Note: `AppNav`/`AppShell` swap here is redundant with Task 6, which already migrated this file's wrapper — if Task 6 already ran, this file already imports `AppShell`; just add the `DataTable`/`AlertDialog` imports and remove the `Table`/`MobileCardList` ones.)

- [ ] **Step 2: Replace the table/mobile-card markup with `DataTable`**

Replace the entire return statement of `AllowedSendersTable` (from `return (` through its closing `);`) with:

```tsx
  const columns: DataTableColumn<AllowedSenderRow>[] = [
    { key: "email", header: "Email", cell: (r) => <span className="font-mono text-sm">{r.email}</span> },
  ];

  return (
    <>
      <div className="flex items-center gap-2 p-4 border rounded-lg mb-4 flex-wrap bg-card">
        <Input
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="max-w-xs flex-1 min-w-0"
        />
        <Button onClick={handleAdd} disabled={add.isPending}>
          Add
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        isLoading={isLoading}
        emptyMessage="No allowed senders — inbound emails will be rejected until one is added."
        rowActions={(r) => {
          const isLast = (rows?.length ?? 0) === 1;
          return (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={isLast}
                  title={isLast ? "At least one allowed sender is required" : "Remove"}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {r.email}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Emails from this address will no longer be accepted by the inbound-email pipeline.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate(r.id)}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
        }}
      />
    </>
  );
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `/settings`. Confirm: the allowed-senders list renders as a table on desktop and cards on mobile width, adding an email still works, clicking the trash icon opens an `AlertDialog` (not a native browser `confirm()`) with the email in the title, Cancel closes it without deleting, and confirming removes the row. Confirm the "at least one required" disabled state still works when only one sender remains.

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "refactor: migrate Settings allowed-senders table to DataTable + AlertDialog"
```

---

## Task 10: Decompose the rule builder and add a live match preview

**Files:**
- Create: `src/components/rules/rule-condition-row.tsx`
- Create: `src/components/rules/rule-action-row.tsx`
- Create: `src/components/rules/rule-preview.tsx`
- Modify: `src/routes/rules.tsx`

Splits the ~250-line inline `RuleEditCard` in `rules.tsx` into row components, adds a live "which existing expenses would this match" preview using Task 7's `conditionsMatch`, and replaces the two `confirm()` calls (rule delete) with `AlertDialog`.

- [ ] **Step 1: Extract `RuleConditionRow`**

Create `src/components/rules/rule-condition-row.tsx` — this is the condition `<div className="flex flex-wrap items-center gap-2">...</div>` block currently inline in `rules.tsx` (lines 439-536), unchanged in behavior, just its own component:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { RuleCondition, RuleField, RuleOperator } from "@/lib/extraction/rule-engine";

export const FIELD_OPTIONS: { value: RuleField; label: string; kind: "text" | "number" }[] = [
  { value: "supplier", label: "Supplier", kind: "text" },
  { value: "amount", label: "Amount", kind: "number" },
  { value: "category", label: "Category", kind: "text" },
  { value: "currency", label: "Currency", kind: "text" },
  { value: "association_id", label: "Association", kind: "text" },
  { value: "sender_email", label: "Sender email", kind: "text" },
];

const TEXT_OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "regex", label: "matches regex" },
];

const NUMBER_OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "equals", label: "equals" },
  { value: "between", label: "between" },
];

export function RuleConditionRow({
  condition,
  associations,
  senderEmails,
  onChange,
  onRemove,
  removable,
}: {
  condition: RuleCondition;
  associations: { id: string; name: string }[];
  senderEmails: string[];
  onChange: (patch: Partial<RuleCondition>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)!;
  const operatorOptions = fieldMeta.kind === "number" ? NUMBER_OPERATORS : TEXT_OPERATORS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={condition.field}
        onValueChange={(v) => onChange({ field: v as RuleField, operator: "contains", value: "" })}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_OPTIONS.map((f) => (
            <SelectItem key={f.value} value={f.value}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={(v) => onChange({ operator: v as RuleOperator })}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operatorOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {condition.field === "association_id" ? (
        <Select value={String(condition.value)} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Association" />
          </SelectTrigger>
          <SelectContent>
            {associations.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : condition.field === "sender_email" ? (
        <Select value={String(condition.value)} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Sender email" />
          </SelectTrigger>
          <SelectContent>
            {senderEmails.map((email) => (
              <SelectItem key={email} value={email}>
                {email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="w-40"
          type={fieldMeta.kind === "number" ? "number" : "text"}
          value={condition.value}
          onChange={(e) =>
            onChange({ value: fieldMeta.kind === "number" ? Number(e.target.value) : e.target.value })
          }
          placeholder="value"
        />
      )}
      {condition.operator === "between" && (
        <Input
          className="w-28"
          type="number"
          value={condition.value2 ?? ""}
          onChange={(e) => onChange({ value2: Number(e.target.value) })}
          placeholder="and…"
        />
      )}
      <Button size="icon" variant="ghost" onClick={onRemove} disabled={!removable}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Extract `RuleActionRow`**

Create `src/components/rules/rule-action-row.tsx` from the action block currently inline in `rules.tsx` (lines 549-603):

```tsx
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { RuleAction, RuleActionType } from "@/lib/extraction/rule-engine";

export const ACTION_OPTIONS: { value: RuleActionType; label: string }[] = [
  { value: "set_category", label: "Set category" },
  { value: "set_association", label: "Set association" },
  { value: "flag_for_review", label: "Flag for review" },
  { value: "notify", label: "Notify me" },
];

export function RuleActionRow({
  action,
  associations,
  categories,
  onChange,
  onRemove,
  removable,
}: {
  action: RuleAction;
  associations: { id: string; name: string }[];
  categories: string[];
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={action.type} onValueChange={(v) => onChange({ type: v as RuleActionType, value: "" })}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {action.type === "set_category" && (
        <Select value={action.value ?? ""} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {action.type === "set_association" && (
        <Select value={action.value ?? ""} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Association" />
          </SelectTrigger>
          <SelectContent>
            {associations.map((assoc) => (
              <SelectItem key={assoc.id} value={assoc.id}>
                {assoc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button size="icon" variant="ghost" onClick={onRemove} disabled={!removable}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create `RulePreview`**

Create `src/components/rules/rule-preview.tsx` — queries the 20 most recent expenses and shows which ones the in-progress condition list would match, using Task 7's `conditionsMatch` so the preview is guaranteed accurate:

```tsx
import { useQuery } from "@tanstack/react-query";
import { conditionsMatch, type RuleCondition, type RuleEvaluationTarget } from "@/lib/extraction/rule-engine";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

type ExpenseRow = {
  id: string;
  supplier: string | null;
  amount: number | null;
  category: string | null;
  currency: string | null;
  association_id: string | null;
  sender_email: string | null;
};

function toTarget(e: ExpenseRow): RuleEvaluationTarget {
  return {
    supplier: e.supplier,
    amount: e.amount,
    category: e.category,
    currency: e.currency,
    association_id: e.association_id,
    sender_email: e.sender_email,
  };
}

export function RulePreview({ conditions }: { conditions: RuleCondition[] }) {
  const { data: expenses, isLoading } = useQuery({
    queryKey: ["rule-preview-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, supplier, amount, category, currency, association_id, sender_email")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ExpenseRow[];
    },
  });

  const hasValidCondition = conditions.some((c) => String(c.value).trim().length > 0);
  const matches = hasValidCondition
    ? (expenses ?? []).filter((e) => conditionsMatch(conditions, toTarget(e)))
    : [];

  return (
    <Card className="p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        Preview: matches against your 20 most recent expenses
      </p>
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !hasValidCondition ? (
        <p className="text-muted-foreground">Fill in a condition value to see matches.</p>
      ) : matches.length === 0 ? (
        <p className="text-muted-foreground">No matches among the 20 most recent expenses.</p>
      ) : (
        <ul className="space-y-1">
          {matches.map((m) => (
            <li key={m.id} className="truncate">
              {m.supplier ?? "(no supplier)"} — {m.currency ?? ""} {m.amount ?? ""}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Wire the extracted rows + preview into `rules.tsx`, replace `confirm()` with `AlertDialog`**

In `src/routes/rules.tsx`:

1. Remove the now-unused `FIELD_OPTIONS`/`TEXT_OPERATORS`/`NUMBER_OPERATORS`/`ACTION_OPTIONS` consts (lines 54-84) and the inline condition/action JSX inside `RuleEditCard` — replace with:

```tsx
import { RuleConditionRow } from "@/components/rules/rule-condition-row";
import { RuleActionRow } from "@/components/rules/rule-action-row";
import { RulePreview } from "@/components/rules/rule-preview";
```

Inside `RuleEditCard`'s conditions block, replace the `conditions.map((c, i) => { ... })` JSX with:

```tsx
{conditions.map((c, i) => (
  <RuleConditionRow
    key={i}
    condition={c}
    associations={associations}
    senderEmails={senderEmails}
    onChange={(patch) => updateCondition(i, patch)}
    onRemove={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
    removable={conditions.length > 1}
  />
))}
```

Replace the `actions.map((a, i) => (...))` JSX similarly with:

```tsx
{actions.map((a, i) => (
  <RuleActionRow
    key={i}
    action={a}
    associations={associations}
    categories={categories}
    onChange={(patch) => updateAction(i, patch)}
    onRemove={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
    removable={actions.length > 1}
  />
))}
```

Add the preview panel just before the final `<div className="flex justify-end gap-2">` (Cancel/Save buttons) in `RuleEditCard`:

```tsx
<RulePreview conditions={conditions} />
```

2. Replace both `confirm("Delete this rule?")` call sites (the desktop and mobile rule-card delete buttons, around lines 288-296 and 316-324) with an `AlertDialog`. Add the import:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

Replace each occurrence of:
```tsx
<Button
  size="icon"
  variant="ghost"
  onClick={() => {
    if (confirm("Delete this rule?")) del.mutate(r.id);
  }}
>
  <Trash2 className="h-4 w-4" />
</Button>
```
with:
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button size="icon" variant="ghost">
      <Trash2 className="h-4 w-4" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
      <AlertDialogDescription>
        {r.name ?? "This rule"} will stop running against incoming receipts. This can't be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => del.mutate(r.id)}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```
(applied to both the desktop and mobile copies of the delete button).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `/rules`. Confirm: "New rule" still opens the builder with the extracted row components behaving identically (add/remove condition and action rows, association/sender-email dropdowns, between-operator second input). Type a condition matching a real expense in your data (e.g. a supplier substring) and confirm the preview panel lists matching expenses from the 20 most recent; clear the value and confirm the preview reverts to the empty-state message. Confirm deleting a rule now opens an `AlertDialog` instead of a native confirm, and Cancel vs. Delete both behave correctly.

- [ ] **Step 6: Commit**

```bash
git add src/components/rules/ src/routes/rules.tsx
git commit -m "refactor: decompose rule builder into row components, add live match preview"
```

---

## Task 11: Full Phase 1 QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass (nav-config, theme, rule-engine, data-table-columns).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors. Fix any that surface from the refactors above before proceeding.

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev`. With the browser at desktop width: click through every nav item in the sidebar and confirm the correct page loads with correct active-state highlighting. Toggle the theme to Dark, then System, then Light from the sidebar footer and confirm the whole app (not just the sidebar) re-themes each time, and that the choice survives a full page reload (persisted via `localStorage`). Resize to a mobile width (<768px) and repeat the nav walkthrough via the hamburger drawer. On `/settings`, add and remove an allowed sender via the new `DataTable` + `AlertDialog`. On `/rules`, create a rule with 2+ conditions, confirm the live preview, save it, then edit and delete it via the `AlertDialog`.

- [ ] **Step 4: Confirm no data-affecting changes were introduced**

Run: `git diff master --stat -- supabase/`
Expected: empty output — this phase touched no migrations, confirming the "no data loss" constraint held (nothing in Phase 1 required a data-layer change).

- [ ] **Step 5: Final commit (if Step 2 required fixes)**

```bash
git add -A
git commit -m "chore: fix lint issues found in Phase 1 QA pass"
```
(Skip this step if Step 2 was already clean.)
