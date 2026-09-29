import { 
  LayoutDashboard, 
  Zap,
  Wrench, 
  FileText, 
  Users, 
  Package, 
  Truck, 
  DollarSign, 
  BarChart3,
  Settings
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Quick Service", url: "/quick-service", icon: Zap },
  { title: "Manage Jobs", url: "/jobs", icon: Wrench },
  { title: "Manage Invoices", url: "/invoices", icon: FileText },
  { title: "Technicians", url: "/technicians", icon: Users },
  { title: "Inventory", url: "/inventory", icon: Package },
  { title: "Suppliers", url: "/suppliers", icon: Truck },
  { title: "Expenses", url: "/expenses", icon: DollarSign },
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="none" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <Settings className="h-6 w-6 text-sidebar-primary" />
          <span className="font-semibold text-sidebar-foreground">Yasuki Motors</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isQuickService = item.url === "/quick-service";
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className={
                          isQuickService
                            ? "flex items-center gap-3 rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            : "flex items-center gap-3 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }
                        activeClassName={
                          isQuickService
                            ? "!bg-sky-500/20 font-medium !text-sky-100 hover:!bg-sky-500/25 hover:!text-sky-50 [&_svg]:!text-sky-200"
                            : "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        }
                      >
                        <item.icon className={isQuickService ? "h-4 w-4 text-sky-300/80" : "h-4 w-4"} />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
