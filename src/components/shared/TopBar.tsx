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
import {
  Bell,
  CheckCheck,
  Compass,
  LogIn,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type Notification = {
  id: string;
  title: string;
  message: string;
  readAt: number | null;
  createdAt: number;
};

function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await fetch("/api/v1/notifications/refresh", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => undefined);
        const response = await fetch("/api/v1/notifications", {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Could not load notifications. Please retry.");
        const data = (await response.json()) as Notification[];
        const summary = await fetch("/api/v1/notifications/summary", {
          credentials: "same-origin",
        });
        if (!summary.ok) throw new Error("Could not load notifications. Please retry.");
        const counts = (await summary.json()) as { unread: number; total: number };
        if (active) {
          setNotifications(data);
          setUnreadCount(counts.unread);
          setTotal(counts.total);
          setError("");
        }
      } catch {
        if (active)
          setError("Notifications are temporarily unavailable. They refresh every minute.");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [userId, open]);

  const markRead = async (notification: Notification) => {
    if (notification.readAt) return;
    setLoading(true);
    try {
      const response = await fetch("/api/v1/notifications/" + notification.id + "/read", {
        method: "PATCH",
        credentials: "same-origin",
      });
      if (response.ok) {
        setUnreadCount((count) => Math.max(0, count - 1));
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, readAt: Date.now() } : item
          )
        );
      }
    } catch {
      // Keep the notification unread so the user can retry.
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/notifications?offset=${notifications.length}`);
      if (!response.ok) throw new Error("Could not load older notifications.");
      const next = (await response.json()) as Notification[];
      setNotifications((current) => [
        ...current,
        ...next.filter((item) => !current.some((old) => old.id === item.id)),
      ]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setLoading(false);
    }
  };
  const markAllRead = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/notifications/read-all", { method: "PATCH" });
      if (!response.ok) throw new Error("Could not mark notifications as read.");
      setUnreadCount(0);
      setNotifications((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt ?? Date.now() }))
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-10 min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={unreadCount ? "Notifications, " + unreadCount + " unread" : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed left-4 right-4 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-12 z-50 w-[calc(100vw-2rem)] sm:w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
              <p className="text-[11px] text-muted-foreground">
                {unreadCount ? unreadCount + " unread" : "You are all caught up"}
              </p>
            </div>
            {loading && <span className="text-[10px] text-muted-foreground">Saving…</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {error && (
              <p role="alert" className="px-4 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void markAllRead()}
                className="px-4 py-2 text-xs text-primary"
              >
                Mark all as read
              </button>
            )}
            {notifications.length ? (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void markRead(notification)}
                  className={cn(
                    "block w-full border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-surface-subtle",
                    !notification.readAt && "bg-primary/[0.04]"
                  )}
                >
                  <span className="flex items-start gap-2">
                    {!notification.readAt ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <CheckCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {notification.title}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {notification.message}
                      </span>
                      <time className="mt-1 block text-[10px] text-muted-foreground">
                        {new Intl.DateTimeFormat("en-GB", {
                          timeZone: "Africa/Tunis",
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(notification.createdAt)}
                      </time>
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications yet.
              </p>
            )}
            {notifications.length < total && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadMore()}
                className="px-4 py-3 text-xs text-primary"
              >
                Load older notifications
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
        {user && <NotificationBell key={user.id} userId={user.id} />}
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
