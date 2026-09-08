import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  FileText,
  Home,
  Building2,
  Tag,
  ScrollText,
  LogOut,
  Sparkles,
  History,
  LineChart,
  DollarSign,
  Wallet,
  Settings,
  ChevronDown,
  Menu,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { logoutFn } from "../lib/auth";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const linkBase =
  "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
const activeClass = "bg-accent text-foreground";

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

const GROUPS: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}[] = [
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

export function AppNav() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logoutFn();
      toast.success("Successfully logged out");
      router.navigate({ to: "/login" });
    } catch (e) {
      toast.error("Failed to log out");
    }
  };

  return (
    <header className="border-b bg-card">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <Link to="/" className="font-semibold text-foreground">
          Receipt Tracker
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-between">
          <nav className="flex items-center gap-1 flex-wrap ml-4">
            <Link
              to="/"
              className={linkBase}
              activeOptions={{ exact: true }}
              activeProps={{ className: cn(linkBase, activeClass) }}
            >
              <Home className="h-4 w-4" /> Dashboard
            </Link>

            {GROUPS.map((group) => {
              const isActive = group.items.some((item) => pathname.startsWith(item.to));
              const GroupIcon = group.icon;
              return (
                <DropdownMenu key={group.label}>
                  <DropdownMenuTrigger
                    className={cn(linkBase, isActive && activeClass, "outline-none")}
                  >
                    <GroupIcon className="h-4 w-4" /> {group.label}
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const itemActive = pathname.startsWith(item.to);
                      return (
                        <DropdownMenuItem key={item.to} asChild>
                          <Link
                            to={item.to}
                            className={cn(
                              "flex items-center gap-2 w-full",
                              itemActive && "font-semibold",
                            )}
                          >
                            <ItemIcon className="h-4 w-4" /> {item.label}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Log Out
          </button>
        </div>

        {/* Mobile nav */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              className="md:hidden flex items-center justify-center h-10 w-10 rounded-md text-foreground hover:bg-accent transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-3/4 sm:max-w-xs flex flex-col">
            <SheetHeader>
              <SheetTitle>Receipt Tracker</SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
              <Link
                to="/"
                className={linkBase}
                activeOptions={{ exact: true }}
                activeProps={{ className: cn(linkBase, activeClass) }}
                onClick={() => setMobileOpen(false)}
              >
                <Home className="h-4 w-4" /> Dashboard
              </Link>

              {GROUPS.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <GroupIcon className="h-3.5 w-3.5" /> {group.label}
                    </div>
                    <div className="flex flex-col gap-1">
                      {group.items.map((item) => {
                        const ItemIcon = item.icon;
                        const itemActive = pathname.startsWith(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            className={cn(linkBase, itemActive && activeClass)}
                            onClick={() => setMobileOpen(false)}
                          >
                            <ItemIcon className="h-4 w-4" /> {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
            <button
              onClick={() => {
                setMobileOpen(false);
                handleLogout();
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-4 w-4" /> Log Out
            </button>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
