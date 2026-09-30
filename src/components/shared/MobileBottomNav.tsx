import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  ClipboardList,
  Compass,
  FileClock,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  PackageCheck,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Users,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface MobileBottomNavProps {
  isBoard?: boolean;
  cartCount?: number;
  user: { id: string; name: string; email: string; role: string } | null;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  isBoard = false,
  cartCount = 0,
  user,
}) => {
  const location = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasBoardAccess = user?.role === "BOARD" || user?.role === "SUPERADMIN";

  if (!isBoard) {
    const memberTabs = [
      { name: "Equipment", path: "/app/equipment", icon: Compass },
      { name: "Selection", path: "/app/selection", icon: ShoppingBag, isCart: true },
      { name: "Reservations", path: "/app/reservations", icon: PackageCheck },
      ...(hasBoardAccess ? [{ name: "Board", path: "/board", icon: ShieldCheck }] : []),
    ];

    return (
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] shadow-sm"
        aria-label="Mobile Navigation"
      >
        <div className="flex items-center justify-around h-14 max-w-md mx-auto">
          {memberTabs.map((tab) => {
            const isActive =
              location.pathname === tab.path ||
              (tab.path !== "/app" && location.pathname.startsWith(tab.path));
            const Icon = tab.icon;

            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  "relative flex flex-col items-center justify-center w-full h-full min-h-[44px] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <div className="relative">
                  <Icon className={cn("w-5 h-5", isActive ? "stroke-[2.5]" : "stroke-[1.75]")} />
                  {tab.isCart && cartCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs animate-in zoom-in-50 duration-200">
                      {cartCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] mt-1 leading-none">{tab.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  // Board navigation (5 tabs with More drawer)
  const boardPrimaryTabs = [
    { name: "Overview", path: "/board", icon: LayoutDashboard },
    { name: "Queue", path: "/board/reservations", icon: ClipboardList },
    { name: "Scan", path: "/board/scan", icon: QrCode },
    { name: "Inventory", path: "/board/inventory", icon: Package },
  ];

  const boardMoreItems = [
    { name: "Calendar", path: "/board/calendar", icon: CalendarDays },
    { name: "Chapters", path: "/board/chapters", icon: Users },
    ...(user?.role === "SUPERADMIN"
      ? [{ name: "Accounts & Roles", path: "/board/accounts", icon: Users }]
      : []),
    { name: "Activity Log", path: "/board/audit", icon: FileClock },
  ];

  const isMoreActive = boardMoreItems.some((item) => location.pathname.startsWith(item.path));

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] shadow-sm"
      aria-label="Board Mobile Navigation"
    >
      <div className="grid grid-cols-5 items-center justify-items-center h-14">
        {boardPrimaryTabs.map((tab) => {
          const isActive =
            tab.path === "/board"
              ? location.pathname === "/board"
              : location.pathname.startsWith(tab.path);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full min-h-[44px] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={cn("w-5 h-5", isActive ? "stroke-[2.5]" : "stroke-[1.75]")} />
              <span className="text-[10px] mt-1 leading-none">{tab.name}</span>
            </Link>
          );
        })}

        {/* 5th Tab: More Drawer */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                "flex flex-col items-center justify-center w-full h-full min-h-[44px] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                isMoreActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="More Board Options"
            >
              <MoreHorizontal className="w-5 h-5" />
              <span className="text-[10px] mt-1 leading-none">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="pb-3 border-b border-border">
              <SheetTitle>Board Operations Menu</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-1 gap-1 py-4 max-h-[60vh] overflow-y-auto">
              {boardMoreItems.map((item) => {
                const isActive = location.pathname.startsWith(item.path);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSheetOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors min-h-[48px]",
                      isActive
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
};
