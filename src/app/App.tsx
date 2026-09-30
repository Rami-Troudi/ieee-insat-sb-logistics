import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { BrowserQRCodeReader } from "@zxing/browser";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Clock3,
  FileClock,
  Package,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  X,
  XCircle,
} from "lucide-react";

import { DesktopSidebar } from "@/components/shared/DesktopSidebar";
import { TopBar } from "@/components/shared/TopBar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { SearchInput } from "@/components/shared/SearchInput";
import { StatusBadge, type DomainStatus } from "@/components/shared/StatusBadge";
import { Metric } from "@/components/shared/Metric";
import { EmptyState, ErrorState } from "@/components/shared/FeedbackStates";
import { LoadingState } from "@/components/shared/LoadingState";
import { EquipmentCard, type EquipmentItem } from "@/components/equipment/EquipmentCard";
import { BorrowerAuthModal } from "@/components/auth/BorrowerAuthModal";
import {
  AssetQrStickerModal,
  type AssetStickerData,
} from "@/components/equipment/AssetQrStickerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TZ = "Africa/Tunis";
export type Role = "USER" | "BOARD" | "SUPERADMIN";
export type User = { id: string; name: string; email: string; role: Role };
export type Item = EquipmentItem;
export type Reservation = {
  id: string;
  requestedBy: { id: string; name: string; email: string };
  borrower: { type: "PERSON" | "CHAPTER"; id: string; name: string };
  items: Array<{
    lineId: string;
    equipmentItemId: string;
    name: string;
    quantity: number;
    assignedAssets?: Array<{ id: string; assetCode: string; state: string }>;
  }>;
  pickupAt: string;
  returnAt: string;
  note: string | null;
  status: string;
  derivedStatus: string;
  collectedCount: number;
  returnedCount: number;
  totalQuantity: number;
  createdAt: string;
};
export type InventoryItem = Item & {
  active: boolean;
  assets: Array<{
    id: string;
    assetCode: string;
    qrUrl: string;
    serialNumber: string | null;
    state: string;
    active: boolean;
  }>;
};
export type AllocationCandidate = {
  lineId: string;
  assets: Array<{ id: string; assetCode: string; serialNumber: string | null; state: string }>;
};
type ApiError = { error?: { message?: string; code?: string } };

const fmtDay = (iso: string) => DateTime.fromISO(iso).setZone(TZ).toFormat("ccc, d LLL");
const fmtTime = (iso: string) => DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
const fmtWindow = (start: string, end: string) =>
  `${fmtDay(start)} · ${fmtTime(start)}–${fmtTime(end)}`;
const dateInput = (date: DateTime) => date.setZone(TZ).toFormat("yyyy-LL-dd'T'HH:mm");
const isoFromInput = (value: string) =>
  DateTime.fromFormat(value, "yyyy-LL-dd'T'HH:mm", { zone: TZ }).toUTC().toISO() ?? "";
const initialStart = () =>
  DateTime.now()
    .setZone(TZ)
    .plus({ days: 1 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
  return body;
}
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body ?? {}),
});
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

function useNotice() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { notice, setNotice };
}

function roleLabel(role: Role) {
  return role === "SUPERADMIN" ? "Superadmin" : role === "BOARD" ? "Board Member" : "Member";
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function generateSecurePassword(length = 16): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%&*?";
  const all = upper + lower + numbers + symbols;

  const passwordChars = [
    upper[crypto.getRandomValues(new Uint32Array(1))[0] % upper.length],
    lower[crypto.getRandomValues(new Uint32Array(1))[0] % lower.length],
    numbers[crypto.getRandomValues(new Uint32Array(1))[0] % numbers.length],
    symbols[crypto.getRandomValues(new Uint32Array(1))[0] % symbols.length],
  ];

  const randomValues = new Uint32Array(length - 4);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length - 4; i++) {
    passwordChars.push(all[randomValues[i] % all.length]);
  }

  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join("");
}

function AppFrame() {
  const [user, setUser] = useState<User | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("sb-item-selection") ?? "{}");
    } catch {
      return {};
    }
  });
  const startInitial = useMemo(() => initialStart(), []);
  const [start, setStart] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem("sb-reservation-window");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.start && parsed.end) return parsed.start;
      }
    } catch {
      /* Fall back to the default reservation window. */
    }
    return dateInput(startInitial);
  });
  const [end, setEnd] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem("sb-reservation-window");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.start && parsed.end) return parsed.end;
      }
    } catch {
      /* Fall back to the default reservation window. */
    }
    return dateInput(startInitial.plus({ hours: 2 }));
  });

  useEffect(() => {
    try {
      sessionStorage.setItem("sb-reservation-window", JSON.stringify({ start, end }));
    } catch {
      /* Reservation selection still works if storage is unavailable. */
    }
  }, [start, end]);

  const { notice, setNotice } = useNotice();
  const location = useLocation();
  const isBoardPath = location.pathname.startsWith("/board");
  const boardAccess = user?.role === "BOARD" || user?.role === "SUPERADMIN";
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  useEffect(() => {
    sessionStorage.setItem("sb-item-selection", JSON.stringify(cart));
  }, [cart]);

  const refreshUser = useCallback(async () => {
    try {
      const { user: current } = await api<{ user: User | null }>("/api/v1/me");
      setUser(current);
    } catch (error) {
      if (error instanceof Error) setNotice(error.message);
    } finally {
      setIdentityLoaded(true);
    }
  }, [setNotice]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    const tokenPath = location.pathname.match(/^\/scan\/([a-f0-9]{64})$/i);
    if (tokenPath) window.history.replaceState(null, "", `/board/scan?token=${tokenPath[1]}`);
  }, [location.pathname]);

  const handleSignOut = async () => {
    try {
      await fetch("/api/v1/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      }).catch(() => {});
    } catch {
      // Ignore network error on signout
    }
    document.cookie = "better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;";
    document.cookie = "better-auth.session_data=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;";
    setUser(null);
    window.location.assign("/app/equipment");
  };

  return (
    <div className="app-shell flex min-h-screen bg-background text-foreground antialiased selection:bg-primary/20">
      {/* Persistent Desktop Sidebar (Board uses IEEE Navy, Member uses clean card) */}
      <DesktopSidebar isBoard={isBoardPath} user={user} onSignOut={handleSignOut} />

      {/* Main Column Pane */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <TopBar
          isBoard={isBoardPath}
          user={user}
          cartCount={cartCount}
          onOpenAuth={() => setShowAuthModal(true)}
          onSignOut={handleSignOut}
        />

        <main className="flex-1 overflow-y-auto">
          {/* Toast / Feedback Notice */}
          {notice && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
              <div
                className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-primary text-sm shadow-xs animate-in fade-in duration-200"
                role="status"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                    <Check size={14} className="stroke-[3]" />
                  </span>
                  <span className="font-medium text-foreground">{notice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setNotice("")}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}

          {!identityLoaded ? (
            <div className="py-16">
              <LoadingState message="Loading your workspace…" />
            </div>
          ) : (
            <PageRouter
              user={user}
              boardAccess={Boolean(boardAccess)}
              cart={cart}
              setCart={setCart}
              setNotice={setNotice}
              onOpenAuth={() => setShowAuthModal(true)}
              start={start}
              end={end}
              setStart={setStart}
              setEnd={setEnd}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav isBoard={isBoardPath} cartCount={cartCount} user={user} />

      {/* Borrower & Board Staff Auth Modal (Identical to RAS) */}
      <BorrowerAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode="BORROWER"
        title="Sign in to reserve"
        onSuccess={() => {
          setShowAuthModal(false);
          void refreshUser();
        }}
      />
    </div>
  );
}

function PageRouter(props: {
  user: User | null;
  boardAccess: boolean;
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  setNotice: (message: string) => void;
  onOpenAuth: () => void;
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
}) {
  const { pathname, search } = useLocation();
  const route = pathname.replace(/\/$/, "") || "/app";
  const params = new URLSearchParams(search);

  if (route === "/board/scan" && !props.boardAccess) {
    return (
      <AccessGate
        user={props.user}
        setNotice={props.setNotice}
        title="Board credentials required"
      />
    );
  }
  if (route.startsWith("/board") && !props.boardAccess) {
    return (
      <AccessGate user={props.user} setNotice={props.setNotice} title="Board access required" />
    );
  }

  switch (route) {
    case "/app":
    case "/app/equipment":
      return (
        <Catalogue
          user={props.user}
          cart={props.cart}
          setCart={props.setCart}
          setNotice={props.setNotice}
          onOpenAuth={props.onOpenAuth}
          start={props.start}
          end={props.end}
          setStart={props.setStart}
          setEnd={props.setEnd}
        />
      );
    case "/app/selection":
    case "/app/cart":
      return (
        <SelectionPage
          cart={props.cart}
          setCart={props.setCart}
          user={props.user}
          setNotice={props.setNotice}
          onOpenAuth={props.onOpenAuth}
          start={props.start}
          end={props.end}
          setStart={props.setStart}
          setEnd={props.setEnd}
        />
      );
    case "/app/reservations":
      return props.user ? (
        <MyReservations user={props.user} />
      ) : (
        <AccessGate
          user={props.user}
          setNotice={props.setNotice}
          title="Sign in to view your reservations"
        />
      );
    case "/board":
      return <BoardDashboard />;
    case "/board/reservations":
      return <BoardReservations setNotice={props.setNotice} />;
    case "/board/calendar":
      return <BoardCalendar />;
    case "/board/inventory":
      return <BoardInventory setNotice={props.setNotice} />;
    case "/board/chapters":
      return <BoardChapters setNotice={props.setNotice} />;
    case "/board/scan":
      return <BoardScan initialToken={params.get("token") ?? ""} setNotice={props.setNotice} />;
    case "/board/accounts":
      return props.user?.role === "SUPERADMIN" ? (
        <Accounts setNotice={props.setNotice} />
      ) : (
        <AccessGate
          user={props.user}
          setNotice={props.setNotice}
          title="Superadmin role required"
        />
      );
    case "/board/audit":
      return <AuditLog />;
    default:
      return (
        <div className="py-16">
          <EmptyState
            title="Page not found"
            description="The requested page does not exist or has been moved."
            actionLabel="Return to catalogue"
            onAction={() => window.location.assign("/app/equipment")}
          />
        </div>
      );
  }
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/80">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-primary mb-1">
          {eyebrow}
        </div>
        <h1 className="text-2xl sm:text-[32px] sm:leading-[40px] font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 max-w-2xl">{description}</p>
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

function AccessGate({
  user,
  setNotice: _setNotice,
  title,
  onSuccess,
}: {
  user: User | null;
  setNotice: (message: string) => void;
  title: string;
  onSuccess?: () => void;
}) {
  const isStaff =
    title.toLowerCase().includes("board") || title.toLowerCase().includes("superadmin");
  const [isOpen, setIsOpen] = useState(true);

  if (user) {
    return (
      <div className="max-w-md mx-auto p-6 bg-card border border-border rounded-2xl shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          ACCOUNT STATUS
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          Signed in as <strong className="text-foreground">{user.name}</strong>. Your role is{" "}
          <strong className="text-primary">{roleLabel(user.role)}</strong>.
        </p>
        <Button asChild className="w-full min-h-11">
          <Link to="/app/equipment">
            <span>Browse equipment catalogue</span>
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-md mx-auto p-6 bg-card border border-border rounded-2xl shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          AUTHENTICATION REQUIRED
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {isStaff
            ? "Sign in with your staff email and assigned password to access the Board workspace."
            : "Sign up or sign in as a borrower to manage your equipment reservations."}
        </p>
        <Button onClick={() => setIsOpen(true)} className="w-full min-h-11 font-bold gap-2">
          {isStaff ? "Board Staff Sign In" : "Borrower Sign Up"}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <BorrowerAuthModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        initialMode={isStaff ? "STAFF" : "BORROWER"}
        title={title}
        onSuccess={() => {
          setIsOpen(false);
          if (onSuccess) onSuccess();
          else window.location.reload();
        }}
      />
    </>
  );
}

function DateWindow({
  start,
  end,
  setStart,
  setEnd,
  compact = false,
}: {
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle/50 p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">Time Window</div>
              <div className="text-[11px] text-muted-foreground">
                Availability checks full period
              </div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground bg-card px-2 py-0.5 rounded border border-border shrink-0">
            UTC+1 · Tunis
          </span>
        </div>

        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Pick up *
            </label>
            <div className="flex items-center bg-card border border-input rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
              <input
                aria-label="Pick up"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="bg-transparent text-xs font-semibold focus:outline-none text-foreground w-full cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Return *
            </label>
            <div className="flex items-center bg-card border border-input rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
              <input
                aria-label="Return"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="bg-transparent text-xs font-semibold focus:outline-none text-foreground w-full cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <CalendarDays className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs sm:text-sm font-semibold text-foreground">
            When do you need it?
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            Availability checks the complete time window.
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 bg-surface-subtle border border-input rounded-lg px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground font-medium shrink-0">Pick up:</span>
          <input
            aria-label="Pick up"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="bg-transparent text-xs font-semibold focus:outline-none text-foreground min-w-0"
          />
        </label>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hidden sm:block shrink-0" />
        <label className="flex items-center gap-2 bg-surface-subtle border border-input rounded-lg px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground font-medium shrink-0">Return:</span>
          <input
            aria-label="Return"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="bg-transparent text-xs font-semibold focus:outline-none text-foreground min-w-0"
          />
        </label>
        <span className="text-[11px] font-medium text-muted-foreground bg-surface-subtle px-2 py-1 rounded-md border border-border shrink-0">
          UTC+1 · Tunis
        </span>
      </div>
    </div>
  );
}

function Catalogue({
  user,
  cart,
  setCart,
  setNotice,
  onOpenAuth,
  start,
  end,
  setStart,
  setEnd,
}: {
  user: User | null;
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  setNotice: (message: string) => void;
  onOpenAuth: () => void;
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [availableOnly, setAvailableOnly] = useState(false);

  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  useEffect(() => {
    if (!start || !end || Date.parse(isoFromInput(end)) <= Date.parse(isoFromInput(start))) return;
    setLoading(true);
    api<Item[]>(
      `/api/v1/catalogue?pickupAt=${encodeURIComponent(isoFromInput(start))}&returnAt=${encodeURIComponent(isoFromInput(end))}`
    )
      .then(setItems)
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setLoading(false));
  }, [start, end, setNotice]);

  const categories = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.category)));
  }, [items]);

  const displayedItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== "ALL" && item.category !== selectedCategory) return false;
      if (availableOnly && item.availableQuantity < 1) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, selectedCategory, availableOnly, search]);

  const handleAdd = (item: Item) => {
    if (item.availableQuantity < 1) return;
    if (!user) {
      onOpenAuth();
      return;
    }
    const currentQty = cart[item.id] ?? 0;
    if (currentQty >= item.availableQuantity) return;
    setCart({ ...cart, [item.id]: currentQty + 1 });
    setNotice(`${item.name} added to selection.`);
  };

  const handleIncrement = (item: Item) => {
    handleAdd(item);
  };

  const handleDecrement = (item: Item) => {
    const next = { ...cart };
    if (!next[item.id]) return;
    if (next[item.id] <= 1) delete next[item.id];
    else next[item.id]--;
    setCart(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Top Header: Section 15 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Equipment catalogue
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Find the equipment you need.
          </p>
        </div>

        {/* View Selection button */}
        <Button
          asChild
          variant="default"
          size="sm"
          className="gap-2 min-h-11 px-3.5 shadow-xs shrink-0"
        >
          <Link to="/app/selection" aria-label="View selection">
            <ShoppingBag className="w-4 h-4" />
            <span className="font-semibold">View selection</span>
            {cartCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 bg-white text-primary rounded-full text-xs font-bold">
                {cartCount}
              </span>
            )}
          </Link>
        </Button>
      </div>

      {/* Date Window */}
      <DateWindow start={start} end={end} setStart={setStart} setEnd={setEnd} />

      {/* Prominent Search & Filters */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search equipment (projector, HDMI, power strip, router)..."
            />
          </div>

          {/* Quick "In stock" Toggle pill */}
          <button
            type="button"
            onClick={() => setAvailableOnly(!availableOnly)}
            className={cn(
              "min-h-11 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-primary",
              availableOnly
                ? "bg-[#e6f6ed] border-[#b3e6c9] text-[#00843d] font-bold"
                : "bg-card border-input text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={availableOnly}
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                availableOnly ? "bg-[#00843d]" : "bg-muted-foreground/40"
              )}
            />
            <span className="hidden xs:inline">In stock</span>
          </button>
        </div>

        {/* Clean Quick Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          {["ALL", ...categories].map((category) => {
            const isSelected = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={cn(
                  "min-h-11 px-3.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 border active:scale-95 focus-visible:ring-2 focus-visible:ring-primary",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary font-bold shadow-xs"
                    : "bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-surface-subtle"
                )}
              >
                <span>{category === "ALL" ? "All Equipment" : category}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Equipment Grid: Section 15 */}
      {loading ? (
        <LoadingState message="Checking equipment availability for your dates…" />
      ) : displayedItems.length === 0 ? (
        <EmptyState
          title="No equipment found"
          description="Try another search term or clear your category filters."
          actionLabel="View all equipment"
          onAction={() => {
            setSearch("");
            setSelectedCategory("ALL");
            setAvailableOnly(false);
          }}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 pb-20 sm:pb-6">
          {displayedItems.map((item) => (
            <EquipmentCard
              key={item.id}
              item={item}
              quantity={cart[item.id] ?? 0}
              onAdd={() => handleAdd(item)}
              onIncrement={() => handleIncrement(item)}
              onDecrement={() => handleDecrement(item)}
            />
          ))}
        </div>
      )}

      {/* Floating Sticky Mobile Cart Bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-16 sm:bottom-6 left-4 right-4 z-40 max-w-lg mx-auto animate-in slide-in-from-bottom-4 duration-300">
          <Link
            to="/app/selection"
            aria-label="Review cart and reserve"
            className="flex min-h-11 items-center justify-between px-4 py-3.5 bg-primary text-primary-foreground rounded-2xl shadow-elevation hover:bg-primary/95 active:scale-[0.99] transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-bold text-xs">
                {cartCount}
              </div>
              <div className="text-left">
                <span className="text-xs font-bold block leading-tight">
                  {cartCount === 1 ? "1 item selected" : `${cartCount} items selected`}
                </span>
                <span className="text-[10px] text-white/80 block">Tap to review & reserve</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold bg-white text-primary px-3 py-1.5 rounded-xl shadow-xs group-hover:translate-x-0.5 transition-transform">
              <span>Review Selection</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}

function SelectionPage({
  cart,
  setCart,
  user,
  setNotice,
  onOpenAuth,
  start,
  end,
  setStart,
  setEnd,
}: {
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  user: User | null;
  setNotice: (message: string) => void;
  onOpenAuth: () => void;
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [chapters, setChapters] = useState<Array<{ id: string; name: string; shortCode: string }>>(
    []
  );
  const [borrowerType, setBorrowerType] = useState<"PERSON" | "CHAPTER">("PERSON");
  const [chapterId, setChapterId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Item[]>(
      `/api/v1/catalogue?pickupAt=${encodeURIComponent(isoFromInput(start))}&returnAt=${encodeURIComponent(isoFromInput(end))}`
    )
      .then(setItems)
      .catch((e: Error) => setNotice(e.message));
  }, [start, end, setNotice]);

  useEffect(() => {
    api<Array<{ id: string; name: string; shortCode: string }>>("/api/v1/chapters")
      .then(setChapters)
      .catch(() => setChapters([]));
  }, []);

  const cartItems = items.filter((item) => cart[item.id]);

  const submit = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setBusy(true);
    try {
      const result = await api<Reservation>(
        "/api/v1/reservations",
        post({
          borrowerType,
          ...(borrowerType === "CHAPTER" ? { chapterId } : {}),
          pickupAt: isoFromInput(start),
          returnAt: isoFromInput(end),
          note,
          items: cartItems.map((item) => ({ equipmentItemId: item.id, quantity: cart[item.id] })),
        })
      );
      setCart({});
      setNotice("Reservation request submitted for Board approval.");
      navigate("/app/reservations?created=" + result.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit reservation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Selected items
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            The Board confirms individual asset codes before your reservation is approved.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/app/equipment">
            <span>Continue browsing</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Items List */}
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Selected Equipment ({cartItems.length})
            </span>
          </div>

          {cartItems.length > 0 ? (
            <div className="space-y-3">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card shadow-xs"
                >
                  <img
                    src={item.imageUrl || "/equipment/fallback.svg"}
                    alt={item.name}
                    className="h-16 w-16 shrink-0 rounded-lg object-contain bg-surface-subtle p-1 border border-border"
                    onError={(e) => {
                      e.currentTarget.src = "/equipment/fallback.svg";
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{item.category}</p>
                    <h3 className="font-semibold text-sm text-foreground truncate">{item.name}</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {item.availableQuantity > 0
                        ? "Available for this window"
                        : "Unavailable for this window"}
                    </p>
                  </div>
                  <div className="flex items-center border border-border rounded-lg bg-surface-subtle p-1">
                    <button
                      type="button"
                      aria-label={`Decrease ${item.name} quantity`}
                      onClick={() => {
                        const next = { ...cart };
                        if (next[item.id] <= 1) delete next[item.id];
                        else next[item.id]--;
                        setCart(next);
                      }}
                      className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 transition-all text-sm font-bold"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-xs font-bold text-foreground">
                      {cart[item.id]}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase ${item.name} quantity`}
                      disabled={cart[item.id] >= item.availableQuantity}
                      onClick={() => setCart({ ...cart, [item.id]: cart[item.id] + 1 })}
                      className="w-8 h-8 rounded-md bg-card border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 transition-all text-sm font-bold disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      const next = { ...cart };
                      delete next[item.id];
                      setCart(next);
                    }}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No items selected"
              description="Select equipment from the catalogue to prepare a reservation request."
              actionLabel="Explore equipment"
              onAction={() => navigate("/app/equipment")}
            />
          )}
        </section>

        {/* Right Column: Reservation Details & Submit Form (Section 17) */}
        <aside className="space-y-4">
          <div className="p-4 sm:p-5 rounded-xl border border-border bg-card shadow-xs space-y-4">
            <div>
              <h2 className="text-base font-bold text-foreground">Reservation Details</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Times in Africa/Tunis local time
              </p>
            </div>

            <DateWindow start={start} end={end} setStart={setStart} setEnd={setEnd} compact />

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground block">
                Who is borrowing?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBorrowerType("PERSON")}
                  className={cn(
                    "min-h-10 px-3 rounded-lg text-xs font-semibold border transition-all",
                    borrowerType === "PERSON"
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-surface-subtle border-input text-muted-foreground hover:text-foreground"
                  )}
                >
                  Myself / Member
                </button>
                <button
                  type="button"
                  onClick={() => setBorrowerType("CHAPTER")}
                  className={cn(
                    "min-h-10 px-3 rounded-lg text-xs font-semibold border transition-all",
                    borrowerType === "CHAPTER"
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-surface-subtle border-input text-muted-foreground hover:text-foreground"
                  )}
                >
                  Chapter
                </button>
              </div>
            </div>

            {borrowerType === "CHAPTER" && (
              <div className="space-y-1.5 animate-in fade-in duration-150">
                <label className="text-xs font-semibold text-foreground block">
                  Select Chapter
                </label>
                <select
                  value={chapterId}
                  onChange={(e) => setChapterId(e.target.value)}
                  className="w-full min-h-10 rounded-lg border border-input bg-card px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="">Select a chapter...</option>
                  {chapters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} ({ch.shortCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Purpose / Notes (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Event, workshop, or project details..."
                className="w-full min-h-[70px] rounded-lg border border-input bg-card p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-none"
              />
            </div>

            <Button
              className="w-full min-h-11 font-semibold gap-2 shadow-xs"
              disabled={busy || !cartItems.length || (borrowerType === "CHAPTER" && !chapterId)}
              onClick={submit}
            >
              {busy ? "Submitting request…" : "Send reservation request"}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MyReservations({ user }: { user: User }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedQr, setSelectedQr] = useState<Reservation | null>(null);
  const [activeTab, setActiveTab] = useState<"ALL" | "BORROWED" | "UPCOMING" | "PENDING" | "PAST">(
    "ALL"
  );

  const refresh = () =>
    api<Reservation[]>("/api/v1/reservations")
      .then(setReservations)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
  }, []);

  const cancel = async (id: string) => {
    try {
      await api(`/api/v1/reservations/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel reservation.");
    }
  };

  // Section 18 Grouped Filter Categories
  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (activeTab === "ALL") return true;
      if (activeTab === "BORROWED")
        return ["ACTIVE", "BORROWED", "HANDED_OVER"].includes(r.derivedStatus);
      if (activeTab === "UPCOMING") return r.derivedStatus === "APPROVED";
      if (activeTab === "PENDING") return ["PENDING", "WAITING"].includes(r.derivedStatus);
      if (activeTab === "PAST")
        return ["RETURNED", "COMPLETED", "CANCELLED", "REJECTED", "EXPIRED", "CLOSED"].includes(
          r.derivedStatus
        );
      return true;
    });
  }, [reservations, activeTab]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            My Reservations
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Reservation schedule and handover status for {user.name}.
          </p>
        </div>
        <Button asChild variant="default" size="sm" className="gap-1.5">
          <Link to="/app/equipment">
            <Plus className="w-4 h-4" />
            <span>New reservation</span>
          </Link>
        </Button>
      </div>

      {/* Section 18: Clear grouped sections / tabs */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: "ALL", label: "All" },
          { id: "BORROWED", label: "Currently Borrowed" },
          { id: "UPCOMING", label: "Upcoming" },
          { id: "PENDING", label: "Pending" },
          { id: "PAST", label: "Past" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={cn(
              "min-h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border active:scale-95 focus-visible:ring-2 focus-visible:ring-primary",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground border-primary shadow-xs font-bold"
                : "bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-surface-subtle"
            )}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {error && (
        <ErrorState
          title="Could not load reservations"
          description={error}
          onRetry={() => refresh()}
        />
      )}

      {loading ? (
        <LoadingState message="Loading your reservations…" />
      ) : filteredReservations.length ? (
        <div className="space-y-3">
          {filteredReservations.map((r) => (
            <article
              key={r.id}
              className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex flex-col items-center justify-center text-primary font-bold text-xs shrink-0">
                    <span>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("dd")}</span>
                    <span className="text-[9px] uppercase font-semibold">
                      {DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("LLL")}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">
                      {r.items.map((i) => i.name).join(", ")}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Borrowing for <strong className="text-foreground">{r.borrower.name}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <StatusBadge status={r.derivedStatus as DomainStatus} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    {fmtWindow(r.pickupAt, r.returnAt)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span>Handover progress:</span>
                  <span className="font-bold text-foreground">
                    {r.collectedCount}/{r.totalQuantity} items collected
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {r.items.map((item) => (
                  <span
                    key={item.lineId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-subtle border border-border text-xs text-foreground"
                  >
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>
                      {item.quantity} × {item.name}
                    </span>
                    {item.assignedAssets && item.assignedAssets.length > 0 && (
                      <span className="font-mono text-[10px] text-primary font-semibold">
                        ({item.assignedAssets.map((a) => a.assetCode).join(", ")})
                      </span>
                    )}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                {["PENDING", "APPROVED"].includes(r.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => cancel(r.id)}
                    className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Cancel reservation
                  </Button>
                )}
                {r.status === "APPROVED" && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setSelectedQr(r)}
                    className="text-xs gap-1.5"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Show Handover QR</span>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={PackageCheck}
          title="No reservations found"
          description="Your approved, upcoming, and completed equipment reservations will show up here."
          actionLabel="Browse equipment"
          onAction={() => window.location.assign("/app/equipment")}
        />
      )}

      {/* Handover QR Dialog */}
      <Dialog open={Boolean(selectedQr)} onOpenChange={() => setSelectedQr(null)}>
        <DialogContent className="max-w-sm p-6 bg-card border-border text-center space-y-4">
          <DialogHeader>
            <DialogTitle>Desk Handover QR</DialogTitle>
            <DialogDescription>
              Present this reservation QR to the Board for pickup or return. They will scan each
              material to record the handover.
            </DialogDescription>
          </DialogHeader>
          {selectedQr && (
            <div className="p-4 bg-white rounded-xl border border-border inline-block mx-auto shadow-sm">
              <QRCodeSVG
                value={`${window.location.origin}/board/scan?res=${selectedQr.id}`}
                size={180}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground font-mono">
            Reservation ID: {selectedQr?.id.slice(0, 12)}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardDashboard() {
  const [data, setData] = useState<{
    pickupsToday: number;
    returnsToday: number;
    currentlyBorrowed: number;
    overdue: number;
    nextPickups: Reservation[];
    nextReturns: Reservation[];
  } | null>(null);

  useEffect(() => {
    api<typeof data>("/api/v1/board/dashboard")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · OVERVIEW"
        title="Logistics Dashboard"
        description="Current reservation, pickup, return, and inventory activity."
        action={
          <Button asChild variant="default" size="sm" className="gap-2">
            <Link to="/board/scan">
              <QrCode className="w-4 h-4" />
              <span>Open Desk Scanner</span>
            </Link>
          </Button>
        }
      />

      {/* Metric Cards Grid: Section 19 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric
          label="Pickups Today"
          value={data?.pickupsToday ?? "—"}
          description="Handover scheduled today"
          icon={ArrowDownToLine}
        />
        <Metric
          label="Returns Today"
          value={data?.returnsToday ?? "—"}
          description="Equipment expected back"
          icon={Check}
          variant="success"
        />
        <Metric
          label="Currently Borrowed"
          value={data?.currentlyBorrowed ?? "—"}
          description="Out with members"
          icon={Package}
          variant="secondary"
        />
        <Metric
          label="Past Return Time"
          value={data?.overdue ?? "—"}
          description="Overdue check-ins"
          icon={Clock3}
          variant={data?.overdue ? "danger" : "default"}
        />
      </div>

      {/* Operational Schedules Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Next Pickups */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-border/70">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <ArrowDownToLine className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-foreground">Next Scheduled Pickups</h3>
                <p className="text-[11px] text-muted-foreground">Members collecting equipment</p>
              </div>
            </div>
            <Link
              to="/board/reservations"
              className="text-xs font-semibold text-primary hover:underline"
            >
              View queue →
            </Link>
          </div>

          {data?.nextPickups?.length ? (
            <div className="space-y-3">
              {data.nextPickups.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-lg border border-border bg-surface-subtle space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-foreground">{r.borrower.name}</span>
                    <StatusBadge status={r.derivedStatus as DomainStatus} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {fmtWindow(r.pickupAt, r.returnAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No upcoming pickups scheduled.
            </p>
          )}
        </section>

        {/* Next Returns */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-border/70">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#e6f6ed] text-[#00843d] flex items-center justify-center">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-foreground">Expected Returns</h3>
                <p className="text-[11px] text-muted-foreground">Due back at the desk</p>
              </div>
            </div>
            <Link to="/board/scan" className="text-xs font-semibold text-primary hover:underline">
              Scan returns →
            </Link>
          </div>

          {data?.nextReturns?.length ? (
            <div className="space-y-3">
              {data.nextReturns.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-lg border border-border bg-surface-subtle space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-foreground">{r.borrower.name}</span>
                    <StatusBadge status={r.derivedStatus as DomainStatus} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Return by: {fmtDay(r.returnAt)} · {fmtTime(r.returnAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No equipment returns due.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function BoardReservations({ setNotice }: { setNotice: (message: string) => void }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [assigningReservation, setAssigningReservation] = useState<Reservation | null>(null);
  const [candidates, setCandidates] = useState<AllocationCandidate[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [handoverTarget, setHandoverTarget] = useState<Reservation | null>(null);
  const [handingOver, setHandingOver] = useState(false);

  const refresh = useCallback(
    () =>
      api<Reservation[]>("/api/v1/board/reservations")
        .then(setReservations)
        .catch((e: Error) => setNotice(e.message))
        .finally(() => setLoading(false)),
    [setNotice]
  );

  const handleForceDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/v1/board/reservations/${deleteTarget.id}/force`, { method: "DELETE" });
      setNotice(`Reservation for ${deleteTarget.borrower.name} was permanently force-deleted.`);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to force delete reservation.");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openAllocation = async (reservation: Reservation) => {
    try {
      const detail = await api<Reservation & { allocationCandidates: AllocationCandidate[] }>(
        `/api/v1/board/reservations/${reservation.id}`
      );
      const defaults = Object.fromEntries(
        detail.items.map((item) => [
          item.lineId,
          (detail.allocationCandidates.find((line) => line.lineId === item.lineId)?.assets ?? [])
            .slice(0, item.quantity)
            .map((asset) => asset.id),
        ])
      );
      setCandidates(detail.allocationCandidates);
      setSelectedAssets(defaults);
      setAssigningReservation(reservation);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load available assets.");
    }
  };

  const act = async (id: string, action: "approve" | "decline") => {
    try {
      if (action === "approve") {
        await api(
          `/api/v1/board/reservations/${id}/approve`,
          post({ assignments: selectedAssets })
        );
        setAssigningReservation(null);
      } else {
        await api(`/api/v1/board/reservations/${id}/decline`, post());
      }
      setNotice(
        action === "approve" ? "Reservation approved and assets assigned." : "Reservation declined."
      );
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update reservation.");
    }
  };

  const shown = reservations.filter((r) => filter === "ALL" || r.status === filter);
  const confirmHandover = async () => {
    if (!handoverTarget || handingOver) return;
    setHandingOver(true);
    try {
      const result = await api<{ handedOverCount: number }>(
        `/api/v1/board/reservations/${handoverTarget.id}/handover`,
        post()
      );
      setNotice(
        result.handedOverCount
          ? "Equipment marked as handed over."
          : "Equipment was already handed over."
      );
      setHandoverTarget(null);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not record handover.");
    } finally {
      setHandingOver(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · RESERVATIONS"
        title="Reservation requests"
        description="Review the requested window and assign actual physical assets before approving."
        action={
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/board/calendar">
              <CalendarDays className="w-4 h-4" />
              <span>Open Calendar</span>
            </Link>
          </Button>
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {["ALL", "PENDING", "APPROVED", "COMPLETED"].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={cn(
              "min-h-10 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border active:scale-95 focus-visible:ring-2 focus-visible:ring-primary",
              filter === status
                ? "bg-primary text-primary-foreground border-primary shadow-xs"
                : "bg-card border-border/80 text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{status === "ALL" ? "All Requests" : titleCase(status)}</span>
            <span
              className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px]",
                filter === status ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
              )}
            >
              {status === "ALL"
                ? reservations.length
                : reservations.filter((r) => r.status === status).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState message="Loading reservation requests…" />
      ) : shown.length ? (
        <div className="space-y-3">
          {shown.map((r) => (
            <article
              key={r.id}
              className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex flex-col items-center justify-center text-primary font-bold text-xs shrink-0">
                    <span>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("dd")}</span>
                    <span className="text-[9px] uppercase font-semibold">
                      {DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("LLL")}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">{r.borrower.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      Requested by <strong className="text-foreground">{r.requestedBy.name}</strong>{" "}
                      ({r.requestedBy.email})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <StatusBadge status={r.derivedStatus as DomainStatus} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    {fmtWindow(r.pickupAt, r.returnAt)}
                  </span>
                </div>
                {r.note && (
                  <p className="text-xs text-foreground bg-surface-subtle px-2.5 py-1 rounded-md border border-border">
                    Note: "{r.note}"
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {r.items.map((item) => (
                  <span
                    key={item.lineId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-subtle border border-border text-xs text-foreground"
                  >
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>
                      {item.quantity} × {item.name}
                    </span>
                    {item.assignedAssets && item.assignedAssets.length > 0 && (
                      <span className="font-mono text-[10px] text-primary font-semibold">
                        ({item.assignedAssets.map((a) => a.assetCode).join(", ")})
                      </span>
                    )}
                  </span>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(r)}
                  className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-8 px-2.5"
                  title="Force delete this reservation request"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Force delete</span>
                </Button>

                <div className="flex items-center gap-2">
                  {r.status === "APPROVED" &&
                    r.items.some((item) =>
                      item.assignedAssets?.some((asset) => asset.state === "RESERVED")
                    ) && (
                      <>
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <Link to="/board/scan">
                            <QrCode className="w-3.5 h-3.5" />
                            Scan QR
                          </Link>
                        </Button>
                        <Button size="sm" onClick={() => setHandoverTarget(r)}>
                          Mark as handed over
                        </Button>
                      </>
                    )}
                  {r.status === "PENDING" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(r.id, "decline")}
                        className="text-xs text-destructive hover:bg-destructive/10"
                      >
                        Decline
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => openAllocation(r)}
                        className="text-xs gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Assign assets</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No requests found"
          description="There are currently no reservations matching this filter."
        />
      )}

      {/* Asset Allocation Dialog: Matches E2E test selectors & accessible dialog */}
      <Dialog
        open={Boolean(handoverTarget)}
        onOpenChange={(open) => {
          if (!open && !handingOver) setHandoverTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm equipment handover</DialogTitle>
            <DialogDescription>
              Confirm that {handoverTarget?.borrower.name} has received all the equipment listed
              below. Equipment already collected by QR scan is excluded.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {handoverTarget?.items.flatMap((item) =>
              (item.assignedAssets ?? [])
                .filter((asset) => asset.state === "RESERVED")
                .map((asset) => (
                  <li key={asset.id}>
                    {item.name} — {asset.assetCode}
                  </li>
                ))
            )}
          </ul>
          <p className="text-sm text-muted-foreground">
            Return deadline:{" "}
            {handoverTarget && fmtWindow(handoverTarget.pickupAt, handoverTarget.returnAt)}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={handingOver}
              onClick={() => setHandoverTarget(null)}
            >
              Cancel
            </Button>
            <Button disabled={handingOver} onClick={confirmHandover}>
              {handingOver ? "Saving…" : "Confirm handover"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(assigningReservation)}
        onOpenChange={() => setAssigningReservation(null)}
      >
        <DialogContent className="max-w-lg p-6 bg-card border-border sm:rounded-2xl space-y-4">
          <DialogHeader>
            <DialogTitle>Assign assets</DialogTitle>
            <DialogDescription>
              Choose the physical units to allocate for {assigningReservation?.borrower.name}.
            </DialogDescription>
          </DialogHeader>

          {assigningReservation && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {assigningReservation.items.map((item) => {
                const lineCandidates =
                  candidates.find((c) => c.lineId === item.lineId)?.assets ?? [];
                const currentAssigned = selectedAssets[item.lineId] ?? [];

                return (
                  <div
                    key={item.lineId}
                    className="p-3.5 rounded-xl border border-border bg-surface-subtle space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-foreground">
                        {item.quantity} × {item.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Selected {currentAssigned.length} of {item.quantity}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {lineCandidates.map((asset) => {
                        const isChecked = currentAssigned.includes(asset.id);
                        return (
                          <label
                            key={asset.id}
                            className={cn(
                              "allocation-option flex items-center gap-2 p-2 rounded-lg border text-xs font-mono cursor-pointer transition-colors",
                              isChecked
                                ? "bg-primary/10 border-primary text-primary font-bold"
                                : "bg-card border-input text-foreground hover:bg-muted"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...currentAssigned, asset.id]
                                  : currentAssigned.filter((id) => id !== asset.id);
                                setSelectedAssets({ ...selectedAssets, [item.lineId]: next });
                              }}
                              className="rounded text-primary focus:ring-primary"
                            />
                            <span>{asset.assetCode}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setAssigningReservation(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => assigningReservation && act(assigningReservation.id, "approve")}
            >
              Confirm allocation
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Force Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>Force Delete Reservation?</span>
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete the reservation request for{" "}
              <strong>{deleteTarget?.borrower.name}</strong> (requested by{" "}
              {deleteTarget?.requestedBy.name})?
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 text-xs text-muted-foreground bg-destructive/10 border border-destructive/20 rounded-lg p-3 space-y-1">
            <p className="font-semibold text-destructive">⚠️ Permanent Action</p>
            <p>
              This will completely remove the reservation request from the system and automatically
              release any allocated physical units back to available inventory.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleForceDelete}
              disabled={deleting}
              className="gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>{deleting ? "Deleting…" : "Force Delete"}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardCalendar() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventInput | null>(null);

  useEffect(() => {
    api<Reservation[]>("/api/v1/board/reservations")
      .then((reservations) => {
        // Section 20 Calendar Event State Colors:
        // APPROVED → IEEE Blue (#00629B)
        // BORROWED / ACTIVE → INSAT Violet (#981D97)
        // RETURNING / due today → IEEE Cyan (#00B5E2)
        // OVERDUE → Red (#BA0C2F)
        const todayStr = DateTime.now().setZone(TZ).toISODate();
        const calEvents: EventInput[] = reservations.map((r) => {
          const isOverdue = r.derivedStatus === "OVERDUE";
          const isReturningToday =
            DateTime.fromISO(r.returnAt).setZone(TZ).toISODate() === todayStr;
          const isBorrowed = ["ACTIVE", "BORROWED"].includes(r.status);
          const isApproved = r.status === "APPROVED";

          let bgColor = "#00629B"; // default IEEE Blue
          if (isOverdue)
            bgColor = "#BA0C2F"; // Red
          else if (isBorrowed)
            bgColor = "#981D97"; // INSAT Violet
          else if (isReturningToday)
            bgColor = "#00B5E2"; // IEEE Cyan
          else if (isApproved) bgColor = "#00629B"; // IEEE Blue

          const itemCodes = r.items
            .map((i) =>
              `${i.name} ${i.assignedAssets?.map((a) => a.assetCode).join(" ") || ""}`.trim()
            )
            .join(", ");

          return {
            id: r.id,
            title: `${r.borrower.name} (${itemCodes})`,
            start: r.pickupAt,
            end: r.returnAt,
            backgroundColor: bgColor,
            borderColor: "transparent",
            textColor: "#FFFFFF",
            extendedProps: {
              reservation: r,
              borrower: r.borrower.name,
              items: itemCodes,
              status: r.derivedStatus,
            },
          };
        });
        setEvents(calEvents);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const handleEventClick = (info: EventClickArg) => {
    setSelectedEvent(info.event.extendedProps);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · SCHEDULE"
        title="Reservation Calendar"
        description="Temporal view of all approved, active, and pending equipment loans."
      />

      {/* Calendar Legend: Section 20 */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground font-medium">Event Legend:</span>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#00629B]" />
          <span>Approved</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#981D97]" />
          <span>Borrowed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#00B5E2]" />
          <span>Due Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#BA0C2F]" />
          <span>Overdue</span>
        </div>
      </div>

      <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
        {loading ? (
          <LoadingState message="Loading calendar schedule…" />
        ) : (
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView="timeGridWeek"
            timeZone={TZ}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            events={events}
            eventClick={handleEventClick}
            height="auto"
          />
        )}
      </div>

      {/* Event Details Dialog */}
      <Dialog open={Boolean(selectedEvent)} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl space-y-3">
          <DialogHeader>
            <DialogTitle>{selectedEvent?.borrower}</DialogTitle>
            <DialogDescription>Reservation Schedule Details</DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3 text-xs text-foreground">
              <div>
                <span className="text-muted-foreground block font-medium">Status</span>
                <StatusBadge status={selectedEvent.status as DomainStatus} className="mt-1" />
              </div>
              <div>
                <span className="text-muted-foreground block font-medium">Equipment Assigned</span>
                <p className="font-semibold text-sm mt-0.5">{selectedEvent.items}</p>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium">Window</span>
                <p className="mt-0.5">
                  {fmtWindow(
                    selectedEvent.reservation.pickupAt,
                    selectedEvent.reservation.returnAt
                  )}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BoardInventory({ setNotice }: { setNotice: (message: string) => void }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [assetCodes, setAssetCodes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState("");
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState<AssetStickerData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "equipment" | "asset";
    id: string;
    name: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = useCallback(
    () =>
      api<InventoryItem[]>("/api/v1/board/inventory")
        .then(setInventory)
        .catch((e: Error) => setNotice(e.message))
        .finally(() => setLoading(false)),
    [setNotice]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createEquipment = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const item = await api<InventoryItem>(
        "/api/v1/board/equipment",
        post({ name, category, description })
      );
      setName("");
      setCategory("");
      setDescription("");
      setShowAddModal(false);
      setNotice("Equipment type added to inventory.");
      setOpen(item.id);
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not add equipment.");
    }
  };

  const addAsset = async (event: FormEvent, item: InventoryItem) => {
    event.preventDefault();
    const assetCode = assetCodes[item.id]?.trim();
    if (!assetCode) return;
    try {
      await api(`/api/v1/board/equipment/${item.id}/assets`, post({ assetCode }));
      setAssetCodes({ ...assetCodes, [item.id]: "" });
      setNotice(`Asset label ${assetCode} created.`);
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not add asset.");
    }
  };

  const toggleEquipment = async (item: InventoryItem) => {
    try {
      await api(`/api/v1/board/equipment/${item.id}`, patch({ active: !item.active }));
      setNotice(item.active ? "Equipment hidden from new reservations." : "Equipment reactivated.");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update equipment.");
    }
  };

  const setAssetState = async (assetId: string, state: string) => {
    try {
      await api(`/api/v1/board/assets/${assetId}`, patch({ state }));
      setNotice(`Asset status updated to ${titleCase(state)}.`);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update asset state.");
    }
  };

  const filtered = inventory.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · INVENTORY"
        title="Equipment Inventory"
        description="Manage equipment types, individually tracked physical assets, and printable QR labels."
        action={
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowAddModal(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Equipment</span>
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="px-3 py-1 text-xs font-semibold gap-1.5">
            <Package className="w-3.5 h-3.5 text-primary" />
            <span>{inventory.length} Types</span>
          </Badge>
          <Badge variant="outline" className="px-3 py-1 text-xs font-semibold gap-1.5">
            <QrCode className="w-3.5 h-3.5 text-primary" />
            <span>{inventory.reduce((s, i) => s + i.assets.length, 0)} Tracked Assets</span>
          </Badge>
        </div>

        <div className="w-full sm:w-72">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search inventory..."
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading inventory items…" />
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-surface-subtle p-1 flex items-center justify-center border border-border overflow-hidden shrink-0">
                    <img
                      src={item.imageUrl || "/equipment/fallback.svg"}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = "/equipment/fallback.svg";
                      }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-foreground">{item.name}</h3>
                      <Badge variant="secondary" className="text-[10px]">
                        {item.category}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <div className="text-right mr-2">
                    <div className="text-xs font-bold text-foreground">
                      {item.assets.filter((a) => a.state === "AVAILABLE").length} /{" "}
                      {item.assets.length}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Available</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleEquipment(item)}
                    className="text-xs"
                  >
                    {item.active ? "Disable" : "Reactivate"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDeleteConfirm({ type: "equipment", id: item.id, name: item.name })
                    }
                    className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1"
                    title="Permanently delete this equipment type"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setOpen(open === item.id ? "" : item.id)}
                    className="text-xs gap-1.5"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>Assets ({item.assets.length})</span>
                  </Button>
                </div>
              </div>

              {open === item.id && (
                <div className="pt-3 border-t border-border/60 space-y-3 animate-in fade-in duration-150">
                  <form onSubmit={(e) => addAsset(e, item)} className="flex items-center gap-2">
                    <Input
                      placeholder="New Asset Code (e.g. PRJ-004)"
                      value={assetCodes[item.id] ?? ""}
                      onChange={(e) => setAssetCodes({ ...assetCodes, [item.id]: e.target.value })}
                      className="text-xs font-mono max-w-xs"
                    />
                    <Button type="submit" variant="default" size="sm" className="text-xs">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Asset
                    </Button>
                  </form>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {item.assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface-subtle text-xs gap-2"
                      >
                        <div className="flex items-center gap-2 font-mono font-bold text-foreground min-w-0 truncate">
                          <QrCode className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{asset.assetCode}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setSelectedSticker({
                                id: asset.id,
                                assetCode: asset.assetCode,
                                equipmentName: item.name,
                                category: item.category,
                                serialNumber: asset.serialNumber,
                                qrUrl: asset.qrUrl,
                              })
                            }
                            className="text-[11px] h-7 px-2 font-semibold text-primary border-primary/30 hover:bg-primary/5 gap-1"
                            title="View and print printable QR sticker label"
                          >
                            <QrCode className="w-3 h-3" />
                            <span>Sticker</span>
                          </Button>

                          <select
                            value={asset.state}
                            onChange={(e) => setAssetState(asset.id, e.target.value)}
                            className="text-[11px] font-semibold bg-card border border-input rounded px-2 py-1"
                          >
                            <option value="AVAILABLE">Available</option>
                            <option value="OUT_OF_SERVICE">Out of Service</option>
                            <option value="RETIRED">Retired</option>
                            {["BORROWED", "RESERVED"].includes(asset.state) && (
                              <option value={asset.state} disabled>
                                {titleCase(asset.state)}
                              </option>
                            )}
                          </select>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDeleteConfirm({
                                type: "asset",
                                id: asset.id,
                                name: asset.assetCode,
                              })
                            }
                            className="text-[11px] h-7 px-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1"
                            title="Permanently delete this asset"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Add Equipment Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add Equipment Type</DialogTitle>
            <DialogDescription>
              Define a new category of equipment in the catalogue.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createEquipment} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Name</label>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HDMI Cable 5m"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Category</label>
              <Input
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Cables & Adapters"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Specifications, details, requirements..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default">
                Create Equipment
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Asset Printable QR Sticker Modal */}
      <AssetQrStickerModal
        asset={selectedSticker}
        isOpen={Boolean(selectedSticker)}
        onClose={() => setSelectedSticker(null)}
      />

      {/* Delete Confirmation Modal */}
      <Dialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteConfirm(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>
                Delete {deleteConfirm?.type === "equipment" ? "Equipment" : "Tracked Asset"}?
              </span>
            </DialogTitle>
            <DialogDescription>
              {deleteConfirm?.type === "equipment"
                ? `Are you sure you want to permanently delete "${deleteConfirm?.name}" and all its physical assets? This cannot be undone.`
                : `Are you sure you want to permanently delete asset "${deleteConfirm?.name}"? This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteBusy}
              onClick={async () => {
                if (!deleteConfirm) return;
                setDeleteBusy(true);
                try {
                  if (deleteConfirm.type === "equipment") {
                    await api(`/api/v1/board/equipment/${deleteConfirm.id}`, { method: "DELETE" });
                    setNotice(`Equipment "${deleteConfirm.name}" permanently deleted.`);
                  } else {
                    await api(`/api/v1/board/assets/${deleteConfirm.id}`, { method: "DELETE" });
                    setNotice(`Asset "${deleteConfirm.name}" permanently deleted.`);
                  }
                  setDeleteConfirm(null);
                  refresh();
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : "Deletion failed.");
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete Permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Section 21, 22, 23: Dedicated QR Scanner Implementation
function BoardScan({
  initialToken,
  setNotice,
}: {
  initialToken: string;
  setNotice: (message: string) => void;
}) {
  const [token, setToken] = useState(initialToken);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [operation, setOperation] = useState<"CHECKED_OUT" | "RETURNED">("CHECKED_OUT");
  const openReservation = useCallback(async (id: string) => {
    const detail = await api<Reservation>(`/api/v1/board/reservations/${encodeURIComponent(id)}`);
    if (!["APPROVED", "COMPLETED", "CANCELLED"].includes(detail.status))
      throw new Error("This reservation has not been approved.");
    setReservation(detail);
    setOperation(
      detail.items.some((item) => item.assignedAssets?.some((asset) => asset.state === "BORROWED"))
        ? "RETURNED"
        : "CHECKED_OUT"
    );
    setToken("");
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("res");
    if (id) void openReservation(id).catch((e: Error) => setNotice(e.message));
  }, [openReservation, setNotice]);
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<{ title: string; message: string } | null>(null);
  const [result, setResult] = useState<{
    operation: string;
    assetName: string;
    assetCode: string;
    borrowerName?: string;
    returnAt?: string;
  } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);
  const reader = useRef<BrowserQRCodeReader | null>(null);

  const stop = () => {
    controls.current?.stop();
    controls.current = null;
  };
  useEffect(() => () => stop(), []);

  const beginCamera = async () => {
    if (!video.current) return;
    try {
      reader.current ??= new BrowserQRCodeReader();
      controls.current = await reader.current.decodeFromVideoDevice(
        undefined,
        video.current,
        (decoded) => {
          if (!decoded) return;
          const text = decoded.getText();
          const matched = text.match(/(?:^|\/)([a-f0-9]{64})(?:\?.*)?$/i);
          setToken(matched?.[1] ?? text);
          stop();
        }
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Camera is unavailable. Use manual token entry below."
      );
    }
  };

  const scan = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setResult(null);
    setScanError(null);
    const value = token.match(/[a-f0-9]{64}/i)?.[0] ?? token.trim();
    try {
      let reservationId: string | null = null;
      try {
        reservationId = new URL(token.trim(), window.location.origin).searchParams.get("res");
      } catch {
        /* A raw material token is also accepted. */
      }
      if (reservationId) {
        await openReservation(reservationId);
        setNotice("Reservation opened. Choose pickup or return, then scan each material.");
        return;
      }
      const scanned = await api<typeof result>("/api/v1/board/scan", {
        ...post({
          qrToken: value,
          ...(reservation ? { reservationId: reservation.id, operation } : {}),
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setResult(scanned);
      setToken("");
      if (reservation)
        setReservation(await api<Reservation>(`/api/v1/board/reservations/${reservation.id}`));
      setNotice(
        scanned?.operation === "RETURNED"
          ? "Equipment returned to the desk."
          : "Equipment checked out."
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan could not be processed.";
      setScanError({
        title: msg.includes("cooldown") ? "Scan cooldown active" : "Handover rejected",
        message: msg,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border/70">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-primary mb-1">
            BOARD · HANDOVER
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Scan equipment</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scan the borrower’s reservation QR, then scan each material for pickup or return.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/board">
            <ArrowLeft className="w-4 h-4" />
            <span>Dashboard</span>
          </Link>
        </Button>
      </div>

      {/* Section 21: Scanner Visual Identity (Base Navy #002855, Viewfinder Cyan #00B5E2) */}
      {reservation && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="font-semibold">
            {reservation.borrower.name} · {titleCase(reservation.derivedStatus)}
          </h2>
          <p className="text-sm">
            {reservation.collectedCount}/{reservation.totalQuantity} collected ·{" "}
            {reservation.returnedCount}/{reservation.totalQuantity} returned
          </p>
          <div className="flex gap-2">
            <Button
              variant={operation === "CHECKED_OUT" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setOperation("CHECKED_OUT")}
            >
              Pickup
            </Button>
            <Button
              variant={operation === "RETURNED" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setOperation("RETURNED")}
            >
              Return
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setReservation(null)}>
              Close reservation
            </Button>
          </div>
          <ul className="text-sm space-y-1">
            {reservation.items.flatMap((item) =>
              (item.assignedAssets ?? []).map((asset) => (
                <li key={asset.id}>
                  {item.name} · {asset.assetCode} · {titleCase(asset.state)}
                </li>
              ))
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Scan every material. The Board member and time are saved for each pickup and return. All
            materials must be returned before the reservation is completed.
          </p>
        </section>
      )}
      <div className="rounded-2xl bg-[#002855] text-white p-6 shadow-elevation space-y-5 border border-[#003B7A]">
        {/* Camera Viewport with Dominant Viewfinder */}
        <div className="relative aspect-video w-full rounded-xl bg-black/80 overflow-hidden flex items-center justify-center border-2 border-[#00B5E2]/40">
          <video
            ref={video}
            muted
            playsInline
            className="w-full h-full object-cover"
            aria-label="QR scanner preview"
          />

          {/* Cyan Scanner Frame Reticle */}
          <div className="absolute inset-8 sm:inset-12 pointer-events-none flex flex-col justify-between">
            <div className="flex justify-between">
              <span className="w-6 h-6 border-t-2 border-l-2 border-[#00B5E2]" />
              <span className="w-6 h-6 border-t-2 border-r-2 border-[#00B5E2]" />
            </div>
            {!controls.current && (
              <div className="text-center space-y-1">
                <QrCode className="w-10 h-10 text-[#00B5E2] mx-auto animate-pulse" />
                <p className="text-xs text-white/90 font-medium">Keep QR code inside frame</p>
              </div>
            )}
            <div className="flex justify-between">
              <span className="w-6 h-6 border-b-2 border-l-2 border-[#00B5E2]" />
              <span className="w-6 h-6 border-b-2 border-r-2 border-[#00B5E2]" />
            </div>
          </div>
        </div>

        {/* Camera Controls */}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="scanner"
            size="sm"
            onClick={controls.current ? stop : beginCamera}
            className="gap-2 px-5 min-h-[44px]"
          >
            <QrCode className="w-4 h-4" />
            <span>{controls.current ? "Stop Camera" : "Start Camera"}</span>
          </Button>
        </div>

        {/* Manual Token Fallback */}
        <form onSubmit={scan} className="flex gap-2 pt-2 border-t border-white/15">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste reservation QR URL or material QR token..."
            className="font-mono text-xs flex-1 bg-white/10 text-white placeholder:text-white/50 border-white/20 focus-visible:ring-[#00B5E2]"
          />
          <Button
            type="submit"
            variant="scanner"
            size="sm"
            disabled={busy || !token.trim()}
            className="shrink-0"
          >
            {busy ? "Processing…" : "Record Handover"}
          </Button>
        </form>

        {/* Section 22: Scanner Success State */}
        {result && (
          <div className="p-4 rounded-xl border border-emerald-400/40 bg-emerald-950/80 text-white space-y-2 animate-in fade-in duration-200 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>✓ {result.operation === "RETURNED" ? "Returned" : "Checked out"}</span>
            </div>
            <div className="text-xs space-y-0.5 pl-7">
              <p className="font-semibold text-white">
                {result.assetName} #{result.assetCode}
              </p>
              {result.operation === "RETURNED" ? (
                <p className="text-emerald-300">is available again</p>
              ) : (
                <>
                  {result.borrowerName && <p className="text-white/80">{result.borrowerName}</p>}
                  {result.returnAt && (
                    <p className="text-emerald-300">
                      Return: {fmtDay(result.returnAt)} · {fmtTime(result.returnAt)}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Section 23: Reusable Scanner Error State */}
        {scanError && (
          <div className="p-4 rounded-xl border border-rose-400/40 bg-rose-950/80 text-white space-y-2 animate-in fade-in duration-200 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-sm text-rose-300">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{scanError.title}</span>
            </div>
            <p className="text-xs text-white/90 pl-7">{scanError.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardChapters({ setNotice }: { setNotice: (message: string) => void }) {
  const [chapters, setChapters] = useState<
    Array<{ id: string; name: string; shortCode: string; active: boolean }>
  >([]);
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = useCallback(() => {
    return api<typeof chapters>("/api/v1/board/chapters")
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addChapter = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/v1/board/chapters", post({ name, shortCode }));
      setName("");
      setShortCode("");
      setNotice(`Chapter ${name} created.`);
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create chapter.");
    }
  };

  const toggleChapter = async (ch: { id: string; name: string; active: boolean }) => {
    try {
      await api(`/api/v1/board/chapters/${ch.id}`, patch({ active: !ch.active }));
      setNotice(ch.active ? `${ch.name} deactivated.` : `${ch.name} reactivated.`);
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not update chapter.");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · CHAPTERS"
        title="Chapter Borrowers"
        description="Technical chapters, affinity groups, and student branches authorized for group reservations."
      />

      <form
        onSubmit={addChapter}
        className="flex gap-2 p-4 rounded-xl border border-border bg-card shadow-xs"
      >
        <Input
          placeholder="Chapter Name (e.g. Computer Society Chapter)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="text-xs flex-1"
        />
        <Input
          placeholder="Short Code (e.g. CS)"
          value={shortCode}
          onChange={(e) => setShortCode(e.target.value)}
          required
          className="text-xs w-32 font-mono uppercase"
        />
        <Button type="submit" variant="default" size="sm" className="text-xs shrink-0">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Chapter
        </Button>
      </form>

      {loading ? (
        <LoadingState message="Loading chapters…" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {chapters.map((ch) => (
            <div
              key={ch.id}
              className="p-4 rounded-xl border border-border bg-card shadow-xs flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <h3
                  className={cn(
                    "font-bold text-sm",
                    ch.active ? "text-foreground" : "text-muted-foreground line-through"
                  )}
                >
                  {ch.name}
                </h3>
                <span className="font-mono text-xs text-primary font-bold">{ch.shortCode}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleChapter(ch)}
                  className="text-[11px] h-7 px-2"
                >
                  {ch.active ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(ch)}
                  className="text-[11px] h-7 px-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  title="Permanently delete this chapter"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Chapter Modal */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>Delete Chapter?</span>
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete chapter &ldquo;{deleteTarget?.name}
              &rdquo;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteBusy}
              onClick={async () => {
                if (!deleteTarget) return;
                setDeleteBusy(true);
                try {
                  await api(`/api/v1/board/chapters/${deleteTarget.id}`, { method: "DELETE" });
                  setNotice(`Chapter "${deleteTarget.name}" deleted.`);
                  setDeleteTarget(null);
                  refresh();
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : "Could not delete chapter.");
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete Permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Accounts({ setNotice }: { setNotice: (message: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

  // Add form state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"BOARD" | "SUPERADMIN">("BOARD");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    name: string;
    email: string;
    pass: string;
    role: string;
  } | null>(null);
  const [copiedCreatedPass, setCopiedCreatedPass] = useState(false);

  // Reset password form state
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");
  const [showResetPass, setShowResetPass] = useState(false);
  const [copiedResetPass, setCopiedResetPass] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Delete user state
  const [deleteUserTarget, setDeleteUserTarget] = useState<User | null>(null);
  const [deleteUserBusy, setDeleteUserBusy] = useState(false);

  const refresh = () =>
    api<User[]>("/api/v1/board/users")
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
  }, []);

  const openAddModal = () => {
    setNewName("");
    setNewEmail("");
    setNewRole("BOARD");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setShowPass(false);
    setShowAddModal(true);
  };

  const openResetModal = (u: User) => {
    setResetTarget(u);
    const password = generateSecurePassword(16);
    setResetPassword(password);
    setResetPasswordConfirmation(password);
    setShowResetPass(false);
    setCopiedResetPass(false);
  };

  const setRole = async (userId: string, role: Role) => {
    try {
      await api(`/api/v1/board/users/${userId}/role`, patch({ role }));
      setNotice("User role updated.");
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update user role.");
    }
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 12 || newPassword.length > 128) {
      setNotice("Choose a password between 12 and 128 characters.");
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setNotice("The passwords do not match.");
      return;
    }
    setAddBusy(true);
    try {
      await api(
        "/api/v1/board/users",
        post({
          name: newName.trim(),
          email: newEmail.trim().toLowerCase(),
          role: newRole,
          password: newPassword,
        })
      );
      setNotice(`Board account created for ${newName}.`);
      setCreatedCreds({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        pass: newPassword,
        role: newRole,
      });
      setShowAddModal(false);
      refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setAddBusy(false);
    }
  };

  const doResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 12 || resetPassword.length > 128) {
      setNotice("Choose a password between 12 and 128 characters.");
      return;
    }
    if (resetPassword !== resetPasswordConfirmation) {
      setNotice("The passwords do not match.");
      return;
    }
    setResetBusy(true);
    try {
      await api(`/api/v1/board/users/${resetTarget.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password: resetPassword }),
      });
      setNotice(`Password reset for ${resetTarget.name}.`);
      setResetTarget(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="SUPERADMIN · SECURITY"
        title="User Accounts & Role Clearances"
        description="Server-enforced role assignments. Coordinate an initial password with the new account owner, then share the account email with them."
        action={
          <Button variant="default" size="sm" onClick={openAddModal} className="gap-2">
            <Plus className="w-4 h-4" />
            <span>Add Board Member</span>
          </Button>
        }
      />

      {loading ? (
        <LoadingState message="Loading user accounts…" />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
          <table className="w-full text-xs text-left">
            <thead className="bg-surface-subtle border-b border-border text-muted-foreground uppercase text-[10px] font-semibold">
              <tr>
                <th className="p-3">User</th>
                <th className="p-3 hidden sm:table-cell">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-subtle/50 transition-colors">
                  <td className="p-3 font-semibold text-foreground">
                    <div>{u.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground sm:hidden">
                      {u.email}
                    </div>
                  </td>
                  <td className="p-3 font-mono text-muted-foreground hidden sm:table-cell">
                    {u.email}
                  </td>
                  <td className="p-3">
                    <select
                      value={u.role}
                      onChange={(e) => setRole(u.id, e.target.value as Role)}
                      className="bg-card border border-input rounded-md px-2.5 py-1 font-semibold text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <option value="USER">Member</option>
                      <option value="BOARD">Board Staff</option>
                      <option value="SUPERADMIN">Superadmin</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openResetModal(u)}
                        className="text-[11px] h-7 px-2.5 gap-1 text-primary border-primary/30 hover:bg-primary/5"
                        title="Set a new autogenerated secure password"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>Set Password</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteUserTarget(u)}
                        className="text-[11px] h-7 px-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1"
                        title="Permanently delete user account"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Board Member Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add Board Member</DialogTitle>
            <DialogDescription>
              Create a Board or Superadmin account and choose its initial password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createUser} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Full Name</label>
              <Input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Rami Ben Ali"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Email Address</label>
              <Input
                required
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="e.g. member@insat.ieee.tn"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "BOARD" | "SUPERADMIN")}
                className="w-full bg-card border border-input rounded-md px-3 py-2 font-semibold text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="BOARD">Board Staff</option>
                <option value="SUPERADMIN">Superadmin</option>
              </select>
            </div>

            {/* Initial Password */}
            <div className="space-y-1.5 p-3 rounded-xl bg-surface-subtle border border-border">
              <label htmlFor="new-board-password" className="text-xs font-semibold text-foreground">
                Initial Password
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-board-password"
                    type={showPass ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                    className="font-mono text-xs pr-9 bg-card select-all font-semibold tracking-wider text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPass ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <label
                htmlFor="new-board-password-confirmation"
                className="block pt-2 text-xs font-semibold text-foreground"
              >
                Confirm password
              </label>
              <Input
                id="new-board-password-confirmation"
                type="password"
                value={newPasswordConfirmation}
                onChange={(e) => setNewPasswordConfirmation(e.target.value)}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
                className="font-mono text-xs bg-card"
              />
              <p className="text-[10px] text-muted-foreground">
                Use at least 12 characters and coordinate this password with the new account owner.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" disabled={addBusy}>
                {addBusy ? "Creating…" : "Create Board Member"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Created Credentials Modal (Success) */}
      <Dialog
        open={Boolean(createdCreds)}
        onOpenChange={(open) => {
          if (!open) setCreatedCreds(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-emerald-600 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span>Board Account Provisioned</span>
            </DialogTitle>
            <DialogDescription>
              Share these sign-in credentials securely with <strong>{createdCreds?.name}</strong>:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div className="p-3 rounded-lg bg-surface-subtle border border-border space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Email:</span>
                <span className="font-mono font-bold text-foreground">{createdCreds?.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-semibold">Role:</span>
                <span className="font-semibold text-foreground">
                  {createdCreds?.role === "SUPERADMIN" ? "Superadmin" : "Board Staff"}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/60">
                <span className="text-muted-foreground font-semibold">Password:</span>
                <span className="font-mono font-bold text-primary tracking-wider">
                  {createdCreds?.pass}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!createdCreds) return;
                  const text = `IEEE INSAT SB Logistics Credentials:\nEmail: ${createdCreds.email}\nPassword: ${createdCreds.pass}`;
                  void navigator.clipboard.writeText(text);
                  setCopiedCreatedPass(true);
                  setTimeout(() => setCopiedCreatedPass(false), 2000);
                }}
                className="gap-1.5"
              >
                {copiedCreatedPass ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedCreatedPass ? "Copied All" : "Copy Credentials"}</span>
              </Button>
              <Button variant="default" size="sm" onClick={() => setCreatedCreds(null)}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle>Set New Password</DialogTitle>
            <DialogDescription>
              Set a password to coordinate with <strong>{resetTarget?.name}</strong>. Existing
              sessions will be invalidated.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={doResetPassword} className="space-y-4 pt-2">
            {/* New Password */}
            <div className="space-y-1.5 p-3 rounded-xl bg-surface-subtle border border-border">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="reset-user-password"
                  className="text-xs font-semibold text-foreground"
                >
                  New Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const password = generateSecurePassword(16);
                    setResetPassword(password);
                    setResetPasswordConfirmation(password);
                    setCopiedResetPass(false);
                  }}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 font-semibold"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Regenerate</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="reset-user-password"
                    type={showResetPass ? "text" : "password"}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                    className="font-mono text-xs pr-9 bg-card select-all font-semibold tracking-wider text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPass(!showResetPass)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showResetPass ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(resetPassword);
                    setCopiedResetPass(true);
                    setTimeout(() => setCopiedResetPass(false), 2000);
                  }}
                  className="text-xs shrink-0 gap-1.5 h-9"
                >
                  {copiedResetPass ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedResetPass ? "Copied" : "Copy"}</span>
                </Button>
              </div>
              <label
                htmlFor="reset-user-password-confirmation"
                className="block pt-2 text-xs font-semibold text-foreground"
              >
                Confirm password
              </label>
              <Input
                id="reset-user-password-confirmation"
                type="password"
                value={resetPasswordConfirmation}
                onChange={(e) => setResetPasswordConfirmation(e.target.value)}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
                className="font-mono text-xs bg-card"
              />
              <p className="text-[10px] text-muted-foreground">
                Use at least 12 characters. You can edit the generated password before saving.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" disabled={resetBusy}>
                {resetBusy ? "Saving…" : "Set Password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete User Modal */}
      <Dialog
        open={Boolean(deleteUserTarget)}
        onOpenChange={(open) => {
          if (!open && !deleteUserBusy) setDeleteUserTarget(null);
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>Delete User Account?</span>
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete the account for{" "}
              <strong>{deleteUserTarget?.name}</strong> (
              <code className="text-xs font-mono">{deleteUserTarget?.email}</code>
              )? This will revoke clearances, remove credentials, and terminate all active sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteUserTarget(null)}
              disabled={deleteUserBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteUserBusy}
              onClick={async () => {
                if (!deleteUserTarget) return;
                setDeleteUserBusy(true);
                try {
                  await api(`/api/v1/board/users/${deleteUserTarget.id}`, { method: "DELETE" });
                  setNotice(`User account "${deleteUserTarget.name}" deleted.`);
                  setDeleteUserTarget(null);
                  refresh();
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : "Could not delete user account.");
                } finally {
                  setDeleteUserBusy(false);
                }
              }}
            >
              {deleteUserBusy ? "Deleting…" : "Delete Account"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditLog() {
  const [events, setEvents] = useState<
    Array<{
      id: string;
      entityType: string;
      entityId: string;
      action: string;
      createdAt: number;
      data: string;
      actorName: string;
    }>
  >([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<typeof events>("/api/v1/board/audit")
      .then(setEvents)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      <PageHeading
        eyebrow="BOARD · AUDIT"
        title="Recorded Activity Log"
        description="Immutable chronological record of reservations, approvals, and physical handovers."
      />

      {error ? (
        <ErrorState title="Could not load audit log" description={error} />
      ) : events.length ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs divide-y divide-border/60">
          {events.map((event) => (
            <div
              key={event.id}
              className="p-3 sm:p-4 flex items-center justify-between gap-3 text-xs hover:bg-surface-subtle/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-foreground">
                    {titleCase(event.action.replaceAll("_", " "))}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {event.actorName} · {event.entityType.toLowerCase()}{" "}
                    <code className="font-mono">{event.entityId.slice(0, 12)}</code>
                  </div>
                </div>
              </div>

              <div className="text-right text-[11px] text-muted-foreground whitespace-nowrap font-mono">
                {DateTime.fromMillis(event.createdAt).setZone(TZ).toFormat("dd LLL · HH:mm")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FileClock}
          title="No activity recorded yet"
          description="Board actions and equipment handovers will be recorded here."
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppFrame />
    </BrowserRouter>
  );
}
