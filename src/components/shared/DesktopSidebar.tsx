import React from "react";
import { Link, useLocation } from "react-router-dom";
import { AppBrand } from "@/components/shared/AppBrand";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Compass,
  FileClock,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Package,
  PackageCheck,
  QrCode,
  ShieldCheck,
  Users,
} from "lucide-react";

interface DesktopSidebarProps {
  isBoard?: boolean;
  user: { id: string; name: string; email: string; role: string } | null;
  onSignOut: () => void;
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  isBoard = false,
  user,
  onSignOut,
}) => {
  const location = useLocation();
  const hasBoardAccess = user?.role === "BOARD" || user?.role === "SUPERADMIN";

  type NavItemDef = {
    name: string;
    path: string;
    icon: React.ComponentType<{ className?: string }>;
    end?: boolean;
  };

  // Section 14: Board Primary Navigation
  const boardNavItems: NavItemDef[] = [
    { name: "Dashboard", path: "/board", icon: LayoutDashboard, end: true },
    { name: "Calendar", path: "/board/calendar", icon: CalendarDays },
    { name: "Reservations", path: "/board/reservations", icon: ClipboardList },
    { name: "Inventory", path: "/board/inventory", icon: Package },
    { name: "Scan", path: "/board/scan", icon: QrCode },
    { name: "Chapters", path: "/board/chapters", icon: Users },
    ...(user?.role === "SUPERADMIN"
      ? [{ name: "Accounts & Roles", path: "/board/accounts", icon: Users }]
      : []),
    { name: "Activity Log", path: "/board/audit", icon: FileClock },
  ];

  // Section 13: USER Navigation (Catalogue, Reservations)
  const memberNavItems: NavItemDef[] = [
    { name: "Catalogue", path: "/app/equipment", icon: Compass },
    { name: "Reservations", path: "/app/reservations", icon: PackageCheck },
  ];

  const items = isBoard ? boardNavItems : memberNavItems;

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col w-64 h-screen sticky top-0 select-none z-30 transition-colors",
        isBoard
          ? "bg-[#002855] text-white border-r border-[#001D40]"
          : "bg-card text-foreground border-r border-border"
      )}
    >
      {/* Brand Header */}
      <div className={cn("p-4 border-b", isBoard ? "border-white/10" : "border-border")}>
        <AppBrand to={isBoard ? "/board" : "/app"} isDark={isBoard} />
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Sidebar Navigation">
        {/* Workspace Switcher for Board Staff / Admin */}
        {hasBoardAccess && (
          <div className="pb-3 mb-2 border-b border-border/60">
            {isBoard ? (
              <Link
                to="/app/equipment"
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/10 text-white font-semibold text-xs hover:bg-white/15 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[#00B5E2]" />
                  <span>Member Catalogue</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 opacity-70" />
              </Link>
            ) : (
              <Link
                to="/board"
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#002855] text-white font-semibold text-xs shadow-xs hover:bg-[#003875] transition-all"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#00B5E2]" />
                  <span>Board Console</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 opacity-80" />
              </Link>
            )}
          </div>
        )}

        <div
          className={cn(
            "px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider",
            isBoard ? "text-white/60" : "text-muted-foreground"
          )}
        >
          {isBoard ? "Board Operations" : "Member Workspace"}
        </div>
        {items.map((item) => {
          const isActive = item.end
            ? location.pathname === item.path
            : location.pathname === item.path ||
              (item.path !== "/app" &&
                item.path !== "/board" &&
                location.pathname.startsWith(item.path));
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[40px]",
                isBoard
                  ? isActive
                    ? "bg-white/12 text-white font-semibold shadow-xs"
                    : "text-white/75 hover:bg-white/8 hover:text-white"
                  : isActive
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Support Card */}
      <div className={cn("p-3 border-t", isBoard ? "border-white/10" : "border-border")}>
        <div
          className={cn(
            "p-3 rounded-xl border space-y-1.5",
            isBoard
              ? "border-white/10 bg-white/5 text-white"
              : "border-border bg-surface-subtle text-foreground"
          )}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <LifeBuoy className={cn("w-4 h-4", isBoard ? "text-brand-cyan" : "text-primary")} />
            <span>Equipment Desk</span>
          </div>
          <p
            className={cn(
              "text-[11px] leading-relaxed",
              isBoard ? "text-white/70" : "text-muted-foreground"
            )}
          >
            Handover location: INSAT SB Workspace (Ground Floor).
          </p>
        </div>
      </div>

      {/* Profile & Sign Out Footer */}
      <div
        className={cn(
          "p-3 border-t flex items-center justify-between gap-2",
          isBoard ? "border-white/10" : "border-border"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
              isBoard ? "bg-white/15 text-white" : "bg-primary/10 text-primary"
            )}
          >
            {user?.name ? user.name.charAt(0).toUpperCase() : "G"}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-xs font-semibold truncate",
                isBoard ? "text-white" : "text-foreground"
              )}
            >
              {user?.name ?? "Guest User"}
            </div>
            <div
              className={cn(
                "text-[10px] truncate",
                isBoard ? "text-white/60" : "text-muted-foreground"
              )}
            >
              {user
                ? user.role === "SUPERADMIN"
                  ? "Superadmin"
                  : user.role === "BOARD"
                    ? "Board Staff"
                    : "Member"
                : "Sign in to reserve"}
            </div>
          </div>
        </div>

        {user && (
          <button
            type="button"
            onClick={onSignOut}
            className={cn(
              "p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[36px] min-w-[36px] flex items-center justify-center",
              isBoard
                ? "text-white/70 hover:text-white hover:bg-white/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};
