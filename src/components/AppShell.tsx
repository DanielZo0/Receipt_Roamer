import type { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const MAX_WIDTH_CLASS = {
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
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
        <div className={cn("mx-auto w-full px-4 py-8", MAX_WIDTH_CLASS[maxWidth])}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
