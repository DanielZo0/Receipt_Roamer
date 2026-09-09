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
