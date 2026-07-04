import { Link, useRouter } from "@tanstack/react-router";
import { FileText, Home, Upload, Building2, Tag, ScrollText, LogOut, Sparkles, History } from "lucide-react";
import { logoutFn } from "../lib/auth";
import { toast } from "sonner";

export function AppNav() {
  const router = useRouter();
  const linkBase =
    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";
  const activeProps = {
    className:
      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-accent text-foreground",
  };

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
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/" className="font-semibold text-foreground mr-4">
            Receipt Tracker
          </Link>
          <nav className="flex items-center gap-1 flex-wrap">
            <Link to="/" className={linkBase} activeOptions={{ exact: true }} activeProps={activeProps}>
              <Home className="h-4 w-4" /> Dashboard
            </Link>
            <Link to="/upload" className={linkBase} activeProps={activeProps}>
              <Upload className="h-4 w-4" /> Upload
            </Link>
            <Link to="/upload-logs" className={linkBase} activeProps={activeProps}>
              <ScrollText className="h-4 w-4" /> Logs
            </Link>
            <Link to="/expenses" className={linkBase} activeProps={activeProps}>
              <FileText className="h-4 w-4" /> Expenses
            </Link>
            <Link to="/associations" className={linkBase} activeProps={activeProps}>
              <Building2 className="h-4 w-4" /> Associations
            </Link>
            <Link to="/categories" className={linkBase} activeProps={activeProps}>
              <Tag className="h-4 w-4" /> Categories
            </Link>
            <Link to="/rules" className={linkBase} activeProps={activeProps}>
              <Sparkles className="h-4 w-4" /> Rules
            </Link>
            <Link to="/corrections" className={linkBase} activeProps={activeProps}>
              <History className="h-4 w-4" /> Corrections
            </Link>
          </nav>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors ml-auto"
        >
          <LogOut className="h-4 w-4" /> Log Out
        </button>
      </div>
    </header>
  );
}