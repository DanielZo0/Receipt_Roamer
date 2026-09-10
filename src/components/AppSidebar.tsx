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
