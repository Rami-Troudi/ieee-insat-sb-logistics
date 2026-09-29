import React from "react";
import { Link } from "react-router-dom";
import { AppBrand } from "@/components/shared/AppBrand";
import { UserMenu } from "@/components/shared/UserMenu";
import { Bell, LogIn, ShieldCheck, ShoppingBag } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useBorrowCart } from "@/features/cart";
import { useUserNotifications } from "@/features/profile/hooks/useProfile";

interface TopBarProps {
  isBoard?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({ isBoard = false }) => {
  const { currentPersona, openBorrowerAuthModal } = useSession();
  const { totalItemCount } = useBorrowCart();

  const isBoardRole =
    isBoard || currentPersona.role === "OPERATOR" || currentPersona.role === "SUPERADMIN";

  const { data: notifications = [] } = useUserNotifications(currentPersona.id);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const notificationPath = isBoardRole ? "/board/notifications" : "/app/notifications";

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-card/95 backdrop-blur-sm">
      {/* Mobile Brand (Desktop brand lives in sidebar) */}
      <div className="flex items-center gap-2 lg:hidden">
        <AppBrand to={isBoard ? "/board" : "/app"} />
      </div>

      {/* Desktop Operational Context Indicator */}
      <div className="hidden lg:flex items-center gap-3">
        {isBoard ? (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md border border-border">
            <ShieldCheck className="w-4 h-4 text-secondary" />
            <span>Operational Logistics Console</span>
            <span>•</span>
            <span className="font-mono text-foreground font-semibold">
              Clearance Level V+ Authority
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span>
              {currentPersona.name && currentPersona.name !== "Guest"
                ? currentPersona.name
                : "Robotics Logistics Desk"}
            </span>
            <span>•</span>
            <span className="text-foreground font-semibold">
              {currentPersona.affiliation
                ? `${currentPersona.affiliation} Member`
                : "INSAT Student Workspace"}
            </span>
          </div>
        )}
      </div>

      {/* Right Controls: Cart (Member), Dev Persona Switcher, Notifications, Reusable UserMenu */}
      <div className="flex items-center gap-1 sm:gap-2.5">
        {!isBoardRole && (!currentPersona.email || currentPersona.id === "anonymous") && (
          <button
            type="button"
            onClick={openBorrowerAuthModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs min-h-[36px]"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}

        {!isBoardRole && (
          <Link
            to="/app/cart"
            className="relative hidden items-center justify-center w-10 h-10 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-w-[44px] min-h-[44px] sm:flex"
            aria-label={`View Borrow Cart (${totalItemCount} items)`}
          >
            <ShoppingBag className="w-4 h-4" />
            {totalItemCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-primary rounded-full">
                {totalItemCount}
              </span>
            )}
          </Link>
        )}

        {/* In-App Notifications Button with real unread state */}
        <Link
          to={notificationPath}
          className="relative flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-w-[44px] min-h-[44px]"
          aria-label={`View In-App Notifications (${unreadCount} unread)`}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
          )}
        </Link>

        {/* Reusable User Menu Component */}
        <UserMenu isBoard={isBoardRole} />
      </div>
    </header>
  );
};
