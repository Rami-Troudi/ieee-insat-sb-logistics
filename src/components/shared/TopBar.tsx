import React from "react";
import { Link } from "react-router-dom";
import { AppBrand } from "@/components/shared/AppBrand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Compass, LogIn, LogOut, ShieldCheck, ShoppingBag, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  isBoard?: boolean;
  user: { id: string; name: string; email: string; role: string } | null;
  cartCount?: number;
  onOpenAuth: () => void;
  onSignOut: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  isBoard = false,
  user,
  cartCount = 0,
  onOpenAuth,
  onSignOut,
}) => {
  const hasBoardAccess = user?.role === "BOARD" || user?.role === "SUPERADMIN";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-card/95 backdrop-blur-sm select-none">
      {/* Mobile Brand (Compact) */}
      <div className="flex items-center gap-2 lg:hidden">
        <AppBrand to={isBoard ? "/board" : "/app"} />
      </div>

      {/* Desktop Context Hierarchy */}
      <div className="hidden lg:flex items-center gap-3">
        {isBoard ? (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-surface-subtle px-3 py-1 rounded-md border border-border">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-foreground font-semibold">IEEE INSAT Student Branch</span>
            <span>•</span>
            <span className="font-mono text-muted-foreground">Logistics Console</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-surface-subtle px-3 py-1 rounded-md border border-border">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-foreground font-semibold">IEEE INSAT Student Branch</span>
            <span>•</span>
            <span>Equipment Reservations</span>
          </div>
        )}
      </div>

      {/* Right Controls: Switcher, Cart & User Account */}
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Quick Workspace Switcher for Board / Superadmin */}
        {hasBoardAccess && (
          <Link
            to={isBoard ? "/app/equipment" : "/board"}
            className={cn(
              "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-xs min-h-[34px]",
              isBoard
                ? "bg-surface-subtle border border-border text-foreground hover:bg-muted"
                : "bg-[#002855] text-white hover:bg-[#003875]"
            )}
          >
            {isBoard ? (
              <>
                <Compass className="w-3.5 h-3.5 text-primary" />
                <span className="hidden xs:inline">Member View</span>
                <span className="xs:hidden">Member</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-[#00B5E2]" />
                <span className="hidden xs:inline">Board Console</span>
                <span className="xs:hidden">Board</span>
              </>
            )}
          </Link>
        )}

        {!user && (
          <button
            type="button"
            onClick={onOpenAuth}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs min-h-[36px]"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}

        {!isBoard && (
          <Link
            to="/app/selection"
            className="relative flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-w-[44px] min-h-[44px]"
            aria-label={cartCount > 0 ? `Shopping cart (${cartCount} items)` : "Shopping cart"}
          >
            <ShoppingBag className="w-5 h-5" />
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-primary rounded-full animate-in zoom-in-50 duration-150">
                {cartCount}
              </span>
            )}
          </Link>
        )}

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 p-1 rounded-full sm:rounded-md hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px] min-w-[44px]"
                aria-label="User menu"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center border border-primary/20">
                  {user.name ? user.name.charAt(0).toUpperCase() : <UserIcon className="w-4 h-4" />}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-semibold text-foreground leading-none">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {user.role === "SUPERADMIN"
                      ? "Superadmin"
                      : user.role === "BOARD"
                        ? "Board Staff"
                        : "Member"}
                  </span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-md">
              <DropdownMenuLabel className="font-normal p-2">
                <div className="flex flex-col space-y-1">
                  <p className="text-xs font-bold text-foreground leading-none">{user.name}</p>
                  <p className="text-[11px] text-muted-foreground leading-none">{user.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2">
                <Badge
                  variant={user.role === "USER" ? "secondary" : "default"}
                  className="w-full justify-center text-[10px]"
                >
                  {user.role === "SUPERADMIN"
                    ? "Clearance: Superadmin"
                    : user.role === "BOARD"
                      ? "Clearance: Board Staff"
                      : "Clearance: Member"}
                </Badge>
              </div>

              {hasBoardAccess && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link
                      to={isBoard ? "/app/equipment" : "/board"}
                      className="gap-2 cursor-pointer text-xs font-medium"
                    >
                      {isBoard ? (
                        <>
                          <Compass className="w-4 h-4 text-primary" />
                          <span>Switch to Member View</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4 text-[#00B5E2]" />
                          <span>Switch to Board Console</span>
                        </>
                      )}
                    </Link>
                  </DropdownMenuItem>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onSignOut}
                className="gap-2 text-destructive focus:text-destructive cursor-pointer min-h-[36px]"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {user && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-lg transition-colors min-h-[34px] border border-destructive/20 hover:border-destructive/40"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        )}
      </div>
    </header>
  );
};
