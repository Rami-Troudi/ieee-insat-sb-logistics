import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { BrowserRouter, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import FullCalendar from "@fullcalendar/react";
import type { EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import { BrowserQRCodeReader } from "@zxing/browser";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Compass,
  Cpu,
  FileClock,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Package,
  PackageCheck,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  Wrench,
  X,
} from "lucide-react";

const TZ = "Africa/Tunis";
type Role = "USER" | "BOARD" | "SUPERADMIN";
type User = { id: string; name: string; email: string; role: Role };
type Item = {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  availableQuantity: number;
};
type Reservation = {
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
type InventoryItem = Item & {
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
type AllocationCandidate = {
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

function AppFrame() {
  const [user, setUser] = useState<User | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const { notice, setNotice } = useNotice();
  const location = useLocation();
  const isBoardPath = location.pathname.startsWith("/board");
  const boardAccess = user?.role === "BOARD" || user?.role === "SUPERADMIN";
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  useEffect(() => {
    api<{ user: User | null }>("/api/v1/me")
      .then(({ user: current }) => setUser(current))
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setIdentityLoaded(true));
  }, [setNotice]);

  useEffect(() => {
    const tokenPath = location.pathname.match(/^\/scan\/([a-f0-9]{64})$/i);
    if (tokenPath) window.history.replaceState(null, "", `/board/scan?token=${tokenPath[1]}`);
  }, [location.pathname]);

  const activePath = location.pathname;
  const heading = activePath.includes("cart")
    ? "Your reservation"
    : activePath.includes("reservations")
      ? isBoardPath
        ? "Reservation queue"
        : "My reservations"
      : activePath.includes("calendar")
        ? "Reservation calendar"
        : activePath.includes("inventory")
          ? "Equipment inventory"
          : activePath.includes("chapters")
            ? "Chapter borrowers"
            : activePath.includes("scan")
              ? "Desk scanner"
              : activePath.includes("accounts")
                ? "Access & accounts"
                : activePath.includes("audit")
                  ? "Activity log"
                  : isBoardPath
                    ? "Board overview"
                    : "Equipment catalogue";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/app" aria-label="IEEE INSAT Student Branch home">
          <span className="brand-mark">
            <span>IEEE</span>
            <b>SB</b>
          </span>
          <span className="brand-title">
            INSAT <small>STUDENT BRANCH</small>
          </span>
        </Link>
        <div className="workspace-chip">
          <span className="status-dot" /> Equipment desk <ChevronDown size={14} />
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {boardAccess ? (
            <>
              <NavItem to="/board" label="Overview" icon={<LayoutDashboard />} end />
              <NavItem to="/board/reservations" label="Reservations" icon={<ClipboardList />} />
              <NavItem to="/board/calendar" label="Calendar" icon={<CalendarDays />} />
              <NavItem to="/board/inventory" label="Inventory" icon={<Package />} />
              <NavItem to="/board/chapters" label="Chapters" icon={<Users />} />
              <NavItem to="/board/scan" label="Desk scanner" icon={<QrCode />} />
              {user?.role === "SUPERADMIN" && (
                <NavItem to="/board/accounts" label="Accounts" icon={<Users />} />
              )}
              <NavItem to="/board/audit" label="Activity log" icon={<FileClock />} />
            </>
          ) : (
            <>
              <NavItem to="/app" label="Explore equipment" icon={<Compass />} end />
              <NavItem to="/app/reservations" label="My reservations" icon={<PackageCheck />} />
            </>
          )}
        </nav>
        <div className="sidebar-spacer" />
        <div className="help-card">
          <span className="help-icon">
            <LifeBuoy size={17} />
          </span>
          <strong>Need a hand?</strong>
          <p>Ask the Student Branch Board at the equipment desk.</p>
          <a href="mailto:ieee@insat.ucar.tn">
            Contact the team <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="profile-row">
          <div className="avatar">{user?.name?.slice(0, 1).toUpperCase() ?? "G"}</div>
          <div className="profile-info">
            <strong>{user?.name ?? "Guest access"}</strong>
            <small>{user ? roleLabel(user.role) : "Sign in to reserve"}</small>
          </div>
          {user && (
            <button
              className="icon-button quiet"
              title="Sign out"
              onClick={async () => {
                await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
                setUser(null);
                window.location.assign("/app");
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main className="main-column">
        <header className="topbar">
          <div className="crumb">
            <span>IEEE INSAT SB</span>
            <ChevronRight size={14} />
            <strong>{heading}</strong>
          </div>
          <div className="top-actions">
            <span className="time-chip">
              <span className="status-dot" /> Tunis time
            </span>
            <Link className="button button-quiet top-cart" to="/app/cart">
              <ShoppingBag size={16} /> Basket <b>{cartCount}</b>
            </Link>
            <button className="avatar avatar-small" title={user?.email ?? "Sign in"}>
              {user?.name?.slice(0, 1).toUpperCase() ?? "G"}
            </button>
          </div>
        </header>
        <div className="page-content">
          {notice && (
            <div className="toast" role="status">
              <span className="toast-mark">
                <Check size={15} />
              </span>
              {notice}
              <button className="icon-button" onClick={() => setNotice("")} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}
          {!identityLoaded ? (
            <div className="loading-panel">
              <span className="spinner" /> Loading your workspace…
            </div>
          ) : (
            <PageRouter
              user={user}
              boardAccess={Boolean(boardAccess)}
              cart={cart}
              setCart={setCart}
              setNotice={setNotice}
            />
          )}
        </div>
        <footer className="page-footer">
          <span>IEEE INSAT Student Branch</span>
          <span>
            Equipment reservations <i>·</i> All times Africa/Tunis
          </span>
        </footer>
      </main>
    </div>
  );
}

function roleLabel(role: Role) {
  return role === "SUPERADMIN" ? "Superadmin" : role === "BOARD" ? "Board member" : "Member";
}

function NavItem({
  to,
  label,
  icon,
  end = false,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function PageRouter(props: {
  user: User | null;
  boardAccess: boolean;
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  setNotice: (message: string) => void;
}) {
  const { pathname, search } = useLocation();
  const route = pathname.replace(/\/$/, "") || "/app";
  const params = new URLSearchParams(search);
  if (route === "/board/scan" && !props.boardAccess)
    return (
      <AccessGate user={props.user} setNotice={props.setNotice} title="Board access required" />
    );
  if (route.startsWith("/board") && !props.boardAccess)
    return <AccessGate user={props.user} setNotice={props.setNotice} title="Board workspace" />;
  if (route === "/board") return <BoardDashboard />;
  if (route === "/board/reservations") return <BoardReservations setNotice={props.setNotice} />;
  if (route === "/board/calendar") return <BoardCalendar />;
  if (route === "/board/inventory") return <BoardInventory setNotice={props.setNotice} />;
  if (route === "/board/chapters") return <BoardChapters setNotice={props.setNotice} />;
  if (route === "/board/scan")
    return <BoardScan initialToken={params.get("token") ?? ""} setNotice={props.setNotice} />;
  if (route === "/board/accounts" && props.user?.role === "SUPERADMIN")
    return <Accounts setNotice={props.setNotice} />;
  if (route === "/board/audit") return <AuditLog />;
  if (route === "/app/cart")
    return (
      <CartPage
        cart={props.cart}
        setCart={props.setCart}
        user={props.user}
        setNotice={props.setNotice}
      />
    );
  if (route === "/app/reservations")
    return props.user ? (
      <MyReservations user={props.user} />
    ) : (
      <AccessGate user={props.user} setNotice={props.setNotice} title="Your reservations" />
    );
  return (
    <Catalogue
      cart={props.cart}
      setCart={props.setCart}
      user={props.user}
      setNotice={props.setNotice}
    />
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function AccessGate({
  user,
  setNotice,
  title,
}: {
  user: User | null;
  setNotice: (message: string) => void;
  title: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        "/api/auth/sign-in/magic-link",
        post({ email, callbackURL: window.location.pathname })
      );
      setSent(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send a sign-in link.");
    } finally {
      setBusy(false);
    }
  };
  if (user)
    return (
      <section className="access-card">
        <span className="large-icon">
          <ShieldCheck />
        </span>
        <div className="eyebrow">SECURE WORKSPACE</div>
        <h2>{title}</h2>
        <p>
          Signed in as <strong>{user.name}</strong>. Your account is{" "}
          <strong>{roleLabel(user.role)}</strong>.
        </p>
        <Link className="button button-primary" to="/app">
          Go to equipment catalogue <ArrowRight size={16} />
        </Link>
      </section>
    );
  return (
    <div className="auth-layout">
      <div className="auth-copy">
        <div className="eyebrow">IEEE INSAT STUDENT BRANCH</div>
        <h1>
          Good tools.
          <br />
          <em>Ready when you are.</em>
        </h1>
        <p>
          Reserve the equipment your team needs, then collect it from the Board desk at the time you
          selected.
        </p>
        <div className="auth-perks">
          <span>
            <Check /> Clear availability
          </span>
          <span>
            <Check /> Board-approved handover
          </span>
          <span>
            <Check /> Shared chapter borrowing
          </span>
        </div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-card-icon">
          <ShieldCheck size={20} />
        </span>
        <div className="eyebrow">MEMBER ACCESS</div>
        <h2>{sent ? "Check your inbox" : title}</h2>
        {sent ? (
          <p className="subtle">
            If this email can access IEEE INSAT SB, a secure sign-in link is on its way. It expires
            in 10 minutes.
          </p>
        ) : (
          <>
            <p className="subtle">
              No password to remember. We’ll email you a one-time sign-in link.
            </p>
            <label className="field-label" htmlFor="sign-in-email">
              Email address
            </label>
            <input
              id="sign-in-email"
              className="text-input"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button className="button button-dark wide" disabled={busy}>
              {busy ? "Sending link…" : "Email me a sign-in link"}
              <ArrowRight size={16} />
            </button>
          </>
        )}
        <div className="auth-note">
          <ShieldCheck size={15} /> Your role is assigned by the Student Branch Board.
        </div>
      </form>
    </div>
  );
}

function DateWindow({
  start,
  end,
  setStart,
  setEnd,
}: {
  start: string;
  end: string;
  setStart: (value: string) => void;
  setEnd: (value: string) => void;
}) {
  return (
    <div className="window-panel">
      <div className="window-title">
        <span className="window-icon">
          <CalendarDays size={18} />
        </span>
        <div>
          <strong>When do you need it?</strong>
          <small>Availability checks the complete time window.</small>
        </div>
      </div>
      <div className="window-fields">
        <label>
          <span>Pick up</span>
          <input
            aria-label="Pick up"
            className="text-input"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <span className="window-arrow">
          <ArrowRight size={16} />
        </span>
        <label>
          <span>Return</span>
          <input
            aria-label="Return"
            className="text-input"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <span className="timezone-label">UTC+1 · Tunis</span>
      </div>
    </div>
  );
}

function Catalogue({
  cart,
  setCart,
  user,
  setNotice,
}: {
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  user: User | null;
  setNotice: (message: string) => void;
}) {
  const startInitial = useMemo(() => initialStart(), []);
  const [start, setStart] = useState(dateInput(startInitial));
  const [end, setEnd] = useState(dateInput(startInitial.plus({ hours: 2 })));
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All equipment");
  const [showAuth, setShowAuth] = useState(false);
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
  const categories = ["All equipment", ...new Set(items.map((item) => item.category))];
  const shown = items.filter(
    (item) =>
      (category === "All equipment" || item.category === category) &&
      item.name.toLowerCase().includes(search.toLowerCase())
  );
  const add = (item: Item) => {
    if (item.availableQuantity < 1) return;
    if (!user) {
      setShowAuth(true);
      return;
    }
    setCart({ ...cart, [item.id]: Math.min(item.availableQuantity, (cart[item.id] ?? 0) + 1) });
    setNotice(`${item.name} added to your basket.`);
  };
  return (
    <>
      <PageHeading
        eyebrow="EQUIPMENT DESK · CATALOGUE"
        title={
          <>
            Make room for
            <br className="mobile-only" /> <em>your next idea.</em>
          </>
        }
        description="Find the tools your team needs. Choose a time window to see what’s available."
        action={
          <Link className="button button-primary" to="/app/cart">
            <ShoppingBag size={16} /> View basket{" "}
            <span className="count-pill">{Object.values(cart).reduce((s, n) => s + n, 0)}</span>
          </Link>
        }
      />
      <DateWindow start={start} end={end} setStart={setStart} setEnd={setEnd} />
      <div className="catalog-toolbar">
        <div className="section-intro">
          <span className="eyebrow">THE COLLECTION</span>
          <h2>
            Equipment <span className="subtle count-text">{items.length} items</span>
          </h2>
        </div>
        <div className="toolbar-controls">
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search equipment"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search equipment"
            />
          </label>
          <label className="select-box">
            <Filter size={15} />
            <select
              aria-label="Filter category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {loading ? (
        <div className="loading-panel">
          <span className="spinner" /> Checking availability for your dates…
        </div>
      ) : shown.length ? (
        <div className="equipment-grid">
          {shown.map((item, index) => (
            <article className="equipment-card" key={item.id}>
              <div className={`equipment-image tone-${index % 5}`}>
                <img
                  src={item.imageUrl ?? "/equipment/fallback.svg"}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.src = "/equipment/fallback.svg";
                  }}
                />
                <span className="category-tag">{item.category}</span>
                <span
                  className={`availability-tag ${item.availableQuantity ? "is-available" : "is-unavailable"}`}
                >
                  <i />
                  {item.availableQuantity
                    ? `${item.availableQuantity} available`
                    : "Fully reserved"}
                </span>
              </div>
              <div className="equipment-body">
                <h3>{item.name}</h3>
                <p>
                  {item.description ||
                    "A useful piece of kit for your next build, demo, or workshop."}
                </p>
                <div className="card-footer">
                  <span className="stock-copy">
                    <Package size={14} />{" "}
                    {item.availableQuantity ? "Ready for your dates" : "Try another time"}
                  </span>
                  <button
                    className={`button ${item.availableQuantity ? "button-dark" : "button-disabled"} add-button`}
                    disabled={!item.availableQuantity}
                    onClick={() => add(item)}
                  >
                    {cart[item.id] ? (
                      <>
                        <Check size={15} /> Add one more
                      </>
                    ) : (
                      <>
                        <Plus size={15} /> Add to basket
                      </>
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Search />}
          title="No equipment found"
          body="Try another search or broaden your category filter."
        />
      )}
      <div className="catalog-note">
        <Sparkles size={16} />
        <span>
          <strong>Every reservation is reviewed by the Board.</strong> We’ll confirm specific asset
          assignments before collection.
        </span>
        <ArrowRight size={15} />
      </div>
      {showAuth && (
        <div className="modal-backdrop">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to reserve"
          >
            <button
              className="icon-button modal-close"
              onClick={() => setShowAuth(false)}
              aria-label="Close"
            >
              <X size={17} />
            </button>
            <AccessGate user={user} setNotice={setNotice} title="Sign in to reserve" />
          </div>
        </div>
      )}
    </>
  );
}

function CartPage({
  cart,
  setCart,
  user,
  setNotice,
}: {
  cart: Record<string, number>;
  setCart: (next: Record<string, number>) => void;
  user: User | null;
  setNotice: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [chapters, setChapters] = useState<Array<{ id: string; name: string; shortCode: string }>>(
    []
  );
  const [borrowerType, setBorrowerType] = useState<"PERSON" | "CHAPTER">("PERSON");
  const [chapterId, setChapterId] = useState("");
  const startInitial = useMemo(() => initialStart(), []);
  const [start, setStart] = useState(dateInput(startInitial));
  const [end, setEnd] = useState(dateInput(startInitial.plus({ hours: 2 })));
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
      setNotice("Sign in before submitting a reservation.");
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
      setNotice("Reservation sent to the Board for approval.");
      navigate("/app/reservations?created=" + result.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit reservation.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE · REQUEST"
        title={
          <>
            Build a basket.
            <br className="mobile-only" /> <em>Pick a window.</em>
          </>
        }
        description="The Board confirms the individual assets before your reservation is approved."
      />
      <div className="cart-layout">
        <section className="card basket-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">RESERVATION BASKET</span>
              <h2>
                {cartItems.length} equipment {cartItems.length === 1 ? "type" : "types"}
              </h2>
            </div>
            <Link className="text-link" to="/app">
              Continue browsing <ArrowRight size={14} />
            </Link>
          </div>
          {cartItems.length ? (
            <div className="basket-list">
              {cartItems.map((item) => (
                <div className="basket-row" key={item.id}>
                  <div className="mini-image">
                    <img src={item.imageUrl ?? "/equipment/fallback.svg"} alt="" />
                  </div>
                  <div className="basket-info">
                    <strong>{item.name}</strong>
                    <small>
                      {item.category} · {item.availableQuantity} available for this window
                    </small>
                  </div>
                  <div className="qty-control">
                    <button
                      aria-label={`Decrease ${item.name} quantity`}
                      onClick={() => {
                        const next = { ...cart };
                        if (next[item.id] <= 1) delete next[item.id];
                        else next[item.id]--;
                        setCart(next);
                      }}
                    >
                      −
                    </button>
                    <b>{cart[item.id]}</b>
                    <button
                      aria-label={`Increase ${item.name} quantity`}
                      disabled={cart[item.id] >= item.availableQuantity}
                      onClick={() => setCart({ ...cart, [item.id]: cart[item.id] + 1 })}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="icon-button remove-button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => {
                      const next = { ...cart };
                      delete next[item.id];
                      setCart(next);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ShoppingBag />}
              title="Your basket is ready"
              body="Add equipment from the catalogue and it will appear here."
              action={
                <Link className="button button-dark" to="/app">
                  Explore equipment <ArrowRight size={15} />
                </Link>
              }
            />
          )}
        </section>
        <aside className="card booking-card">
          <span className="eyebrow">RESERVATION DETAILS</span>
          <h2>Choose your window</h2>
          <p className="subtle">Times are shown in Tunis local time.</p>
          <DateWindow start={start} end={end} setStart={setStart} setEnd={setEnd} />
          <div className="form-divider" />
          <label className="field-label">Who is borrowing?</label>
          <div className="segmented">
            <button
              className={borrowerType === "PERSON" ? "selected" : ""}
              onClick={() => setBorrowerType("PERSON")}
            >
              Personally
            </button>
            <button
              className={borrowerType === "CHAPTER" ? "selected" : ""}
              onClick={() => setBorrowerType("CHAPTER")}
            >
              For a chapter
            </button>
          </div>
          {borrowerType === "CHAPTER" && (
            <label className="field-label">
              Chapter
              <select
                className="text-input"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
              >
                <option value="">Choose a chapter</option>
                {chapters.map((chapter) => (
                  <option value={chapter.id} key={chapter.id}>
                    {chapter.name} · {chapter.shortCode}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-label" htmlFor="request-note">
            Note for the Board <span className="optional">OPTIONAL</span>
          </label>
          <textarea
            id="request-note"
            className="text-input textarea"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What are you building? Anything the desk should know?"
          />
          <button
            className="button button-primary wide"
            disabled={busy || !cartItems.length || (borrowerType === "CHAPTER" && !chapterId)}
            onClick={submit}
          >
            {busy ? "Submitting…" : "Send reservation request"}
            <ArrowRight size={16} />
          </button>
          <p className="fine-print">
            <ShieldCheck size={14} /> Nothing is issued until the Board approves and scans it out.
          </p>
        </aside>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase().replaceAll("_", "-");
  const label = status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <span className={`status-pill status-${key}`}>
      <i />
      {label}
    </span>
  );
}

function MyReservations({ user }: { user: User }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  return (
    <>
      <PageHeading
        eyebrow="MEMBER WORKSPACE"
        title={
          <>
            Your next handoff,
            <br className="mobile-only" /> <em>all in one place.</em>
          </>
        }
        description={`Reservation activity for ${user.name}. The Board confirms your pickup before the desk handover.`}
        action={
          <Link className="button button-primary" to="/app">
            <Plus size={16} /> New reservation
          </Link>
        }
      />
      <div className="reservation-toolbar">
        <div className="toolbar-stats">
          <span>
            <b>{reservations.length}</b> total reservations
          </span>
          <span className="stat-divider" />
          <span>
            <i className="status-dot" /> Updates from the Board
          </span>
        </div>
      </div>
      {error && <InlineError message={error} />}
      {loading ? (
        <div className="loading-panel">
          <span className="spinner" /> Loading reservations…
        </div>
      ) : reservations.length ? (
        <div className="reservation-list">
          {reservations.map((r) => (
            <article className="reservation-card" key={r.id}>
              <div className="reservation-date">
                <span>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("LLL")}</span>
                <b>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("dd")}</b>
                <small>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("ccc")}</small>
              </div>
              <div className="reservation-main">
                <div className="reservation-title-row">
                  <h3>{r.items.map((i) => i.name).join(", ")}</h3>
                  <StatusPill status={r.derivedStatus} />
                </div>
                <p>
                  {fmtWindow(r.pickupAt, r.returnAt)} <i>·</i> Borrowing for{" "}
                  <strong>{r.borrower.name}</strong>
                </p>
                <div className="reservation-items">
                  {r.items.map((i) => (
                    <span key={i.lineId}>
                      <Package size={13} />
                      {i.quantity} × {i.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="reservation-side">
                <div>
                  <strong>
                    {r.collectedCount}/{r.totalQuantity}
                  </strong>
                  <small>collected</small>
                </div>
                {["PENDING", "APPROVED"].includes(r.status) && (
                  <button className="button button-quiet" onClick={() => cancel(r.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<PackageCheck />}
          title="No reservations yet"
          body="Your approved, upcoming, and completed reservations will show up here."
          action={
            <Link className="button button-dark" to="/app">
              Browse equipment <ArrowRight size={15} />
            </Link>
          }
        />
      )}
    </>
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
  const metrics = [
    {
      label: "Pickups today",
      value: data?.pickupsToday ?? "—",
      icon: <ArrowDownToLine />,
      tone: "blue",
    },
    { label: "Returns today", value: data?.returnsToday ?? "—", icon: <Check />, tone: "green" },
    {
      label: "Out with members",
      value: data?.currentlyBorrowed ?? "—",
      icon: <Package />,
      tone: "violet",
    },
    { label: "Past return time", value: data?.overdue ?? "—", icon: <Clock3 />, tone: "amber" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · TODAY"
        title={
          <>
            The desk,
            <br className="mobile-only" /> <em>at a glance.</em>
          </>
        }
        description="A live view of equipment handovers and reservation activity."
        action={
          <Link className="button button-dark" to="/board/scan">
            <QrCode size={16} /> Open desk scanner
          </Link>
        }
      />
      <div className="metrics-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className={`metric-icon ${metric.tone}`}>{metric.icon}</span>
            <span className="metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <span className="metric-foot">Tunis local time</span>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="card schedule-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">UP NEXT</span>
              <h2>Today’s handovers</h2>
            </div>
            <Link className="text-link" to="/board/calendar">
              Open calendar <ArrowRight size={14} />
            </Link>
          </div>
          {data?.nextPickups?.length ? (
            <div className="up-next-list">
              {data.nextPickups.map((r) => (
                <div className="up-next-row" key={r.id}>
                  <div className="time-block">
                    <b>{fmtTime(r.pickupAt)}</b>
                    <small>Pickup</small>
                  </div>
                  <span className="timeline-line" />
                  <div className="up-next-details">
                    <strong>{r.borrower.name}</strong>
                    <span>
                      {r.items.map((item) => `${item.quantity} × ${item.name}`).join(" · ")}
                    </span>
                  </div>
                  <StatusPill status={r.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<CalendarDays />}
              title="A little breathing room"
              body="No upcoming pickups are scheduled yet."
            />
          )}
        </section>
        <section className="card action-card">
          <span className="eyebrow">QUICK ACTIONS</span>
          <h2>Keep the desk moving</h2>
          <div className="quick-action-list">
            <Link to="/board/reservations">
              <span className="quick-icon green">
                <ClipboardList />
              </span>
              <span>
                <strong>Review reservations</strong>
                <small>Approve requests and assign assets</small>
              </span>
              <ArrowRight />
            </Link>
            <Link to="/board/scan">
              <span className="quick-icon blue">
                <QrCode />
              </span>
              <span>
                <strong>Scan a handover</strong>
                <small>Check equipment in or out</small>
              </span>
              <ArrowRight />
            </Link>
            <Link to="/board/inventory">
              <span className="quick-icon violet">
                <Wrench />
              </span>
              <span>
                <strong>Manage inventory</strong>
                <small>Add equipment and print QR labels</small>
              </span>
              <ArrowRight />
            </Link>
          </div>
        </section>
      </div>
      <div className="board-note">
        <Sparkles size={16} />
        <span>
          Handover first, everything else follows. Each scan is recorded in the immutable activity
          log.
        </span>
      </div>
    </>
  );
}

function BoardReservations({ setNotice }: { setNotice: (message: string) => void }) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [assigningId, setAssigningId] = useState("");
  const [candidates, setCandidates] = useState<AllocationCandidate[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<Record<string, string[]>>({});
  const refresh = useCallback(
    () =>
      api<Reservation[]>("/api/v1/board/reservations")
        .then(setReservations)
        .catch((e: Error) => setNotice(e.message))
        .finally(() => setLoading(false)),
    [setNotice]
  );
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
      setAssigningId(reservation.id);
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
        setAssigningId("");
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
  return (
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · REQUESTS"
        title={
          <>
            Good requests.
            <br className="mobile-only" /> <em>Clear decisions.</em>
          </>
        }
        description="Review the requested window and assign actual assets before approving."
        action={
          <Link className="button button-quiet" to="/board/calendar">
            <CalendarDays size={16} /> Open calendar
          </Link>
        }
      />
      <div className="queue-toolbar">
        <div className="segmented queue-filter">
          {["ALL", "PENDING", "APPROVED", "COMPLETED"].map((status) => (
            <button
              className={filter === status ? "selected" : ""}
              onClick={() => setFilter(status)}
              key={status}
            >
              {status === "ALL" ? "All" : titleCase(status)}{" "}
              <small>
                {status === "ALL"
                  ? reservations.length
                  : reservations.filter((r) => r.status === status).length}
              </small>
            </button>
          ))}
        </div>
        <span className="subtle">
          <Filter size={14} /> Sorted by handover time
        </span>
      </div>
      {loading ? (
        <div className="loading-panel">
          <span className="spinner" /> Loading requests…
        </div>
      ) : shown.length ? (
        <div className="reservation-list board-queue">
          {shown.map((r) => (
            <article className="reservation-card" key={r.id}>
              <div className="reservation-date">
                <span>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("LLL")}</span>
                <b>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("dd")}</b>
                <small>{DateTime.fromISO(r.pickupAt).setZone(TZ).toFormat("ccc")}</small>
              </div>
              <div className="reservation-main">
                <div className="reservation-title-row">
                  <h3>{r.borrower.name}</h3>
                  <StatusPill status={r.derivedStatus} />
                </div>
                <p>
                  Requested by <strong>{r.requestedBy.name}</strong> <i>·</i>{" "}
                  {fmtWindow(r.pickupAt, r.returnAt)}
                </p>
                <div className="reservation-items">
                  {r.items.map((i) => (
                    <span key={i.lineId}>
                      <Package size={13} />
                      {i.quantity} × {i.name}
                      {i.assignedAssets?.length
                        ? ` · ${i.assignedAssets.map((a) => a.assetCode).join(", ")}`
                        : ""}
                    </span>
                  ))}
                </div>
                {r.note && <div className="note-callout">“{r.note}”</div>}
              </div>
              <div className="reservation-side">
                {r.status === "PENDING" ? (
                  <>
                    <button
                      className="button button-primary"
                      onClick={() => void openAllocation(r)}
                    >
                      <PackageCheck size={15} /> Assign assets
                    </button>
                    <button
                      className="button button-quiet danger-text"
                      onClick={() => act(r.id, "decline")}
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <span className="subtle compact-count">
                    {r.collectedCount}/{r.totalQuantity} collected
                  </span>
                )}
              </div>
              {assigningId === r.id && r.status === "PENDING" && (
                <div className="allocation-panel">
                  <div className="allocation-heading">
                    <div>
                      <span className="eyebrow">ASSET ALLOCATION</span>
                      <strong>Choose the physical units</strong>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Close asset allocation"
                      onClick={() => setAssigningId("")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {r.items.map((item) => {
                    const line = candidates.find((candidate) => candidate.lineId === item.lineId);
                    const selected = selectedAssets[item.lineId] ?? [];
                    return (
                      <div className="allocation-line" key={item.lineId}>
                        <div className="allocation-line-title">
                          <strong>{item.name}</strong>
                          <small>
                            Choose {item.quantity} of {line?.assets.length ?? 0} available
                          </small>
                        </div>
                        <div className="allocation-options">
                          {(line?.assets ?? []).map((asset) => {
                            const checked = selected.includes(asset.id);
                            return (
                              <label
                                className={`allocation-option ${checked ? "chosen" : ""}`}
                                key={asset.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!checked && selected.length >= item.quantity}
                                  onChange={() =>
                                    setSelectedAssets((previous) => ({
                                      ...previous,
                                      [item.lineId]: checked
                                        ? selected.filter((id) => id !== asset.id)
                                        : [...selected, asset.id],
                                    }))
                                  }
                                />
                                <span>
                                  <strong>{asset.assetCode}</strong>
                                  <small>{asset.serialNumber ?? "No serial number"}</small>
                                </span>
                                <StatusPill status={asset.state} />
                              </label>
                            );
                          })}
                          {!line?.assets.length && (
                            <p className="empty-inline">
                              No assets are available for this requested time.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="allocation-footer">
                    <span>Confirming reserves these exact assets for this time window.</span>
                    <button
                      className="button button-primary"
                      onClick={() => void act(r.id, "approve")}
                      disabled={r.items.some(
                        (item) => (selectedAssets[item.lineId] ?? []).length !== item.quantity
                      )}
                    >
                      <Check size={15} /> Confirm allocation
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ClipboardList />}
          title="Nothing in this view"
          body="Reservations that match this filter will appear here."
        />
      )}
    </>
  );
}

function BoardCalendar() {
  const [error, setError] = useState("");
  const load = async (info: { start: Date; end: Date }): Promise<EventInput[]> => {
    try {
      const result = await api<
        Array<{
          id: string;
          title: string;
          start: string;
          end: string;
          status: string;
          borrowerName: string;
        }>
      >(
        `/api/v1/board/calendar?start=${encodeURIComponent(info.start.toISOString())}&end=${encodeURIComponent(info.end.toISOString())}`
      );
      const mapped = result.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        extendedProps: { status: event.status, borrowerName: event.borrowerName },
      }));
      setError("");
      return mapped;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load calendar.");
      return [];
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · LIVE SCHEDULE"
        title={
          <>
            Every handoff,
            <br className="mobile-only" /> <em>in view.</em>
          </>
        }
        description="Approved asset reservations shown in Africa/Tunis time. Select month, week, or day."
        action={
          <span className="timezone-badge">
            <span className="status-dot" /> Africa/Tunis · UTC+1
          </span>
        }
      />
      {error && <InlineError message={error} />}
      <section className="card calendar-card">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView="dayGridMonth"
          timeZone={TZ}
          locale="en-GB"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day" }}
          events={load}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          height="auto"
          nowIndicator
          weekends
        />
      </section>
      <div className="calendar-legend">
        <span>
          <i className="legend-dot approved" /> Approved / reserved
        </span>
        <span>
          <i className="legend-dot borrowed" /> Checked out
        </span>
        <span>
          <i className="legend-dot overdue" /> Past return time
        </span>
      </div>
    </>
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
  const [printAssetId, setPrintAssetId] = useState("");
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
  useEffect(() => {
    const clearPrintTarget = () => setPrintAssetId("");
    window.addEventListener("afterprint", clearPrintTarget);
    return () => window.removeEventListener("afterprint", clearPrintTarget);
  }, []);
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
      setNotice(
        item.active ? "Equipment type hidden from new reservations." : "Equipment type reactivated."
      );
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update equipment.");
    }
  };
  const setAssetState = async (assetId: string, state: string) => {
    try {
      await api(`/api/v1/board/assets/${assetId}`, patch({ state }));
      setNotice(`Asset status changed to ${titleCase(state.replaceAll("_", " "))}.`);
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
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · EQUIPMENT"
        title={
          <>
            The right tool.
            <br className="mobile-only" /> <em>Every time.</em>
          </>
        }
        description="Manage equipment types, individually tracked assets, and printable QR labels."
        action={
          <a className="button button-dark" href="#new-equipment">
            <Plus size={16} /> Add equipment
          </a>
        }
      />
      <div className="inventory-summary">
        <span>
          <Package size={17} /> <strong>{inventory.length}</strong> equipment types
        </span>
        <span>
          <QrCode size={17} />{" "}
          <strong>{inventory.reduce((s, item) => s + item.assets.length, 0)}</strong> tracked assets
        </span>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="Search inventory"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find equipment"
          />
        </label>
      </div>
      {loading ? (
        <div className="loading-panel">
          <span className="spinner" /> Loading inventory…
        </div>
      ) : (
        <div className="inventory-list">
          {filtered.map((item) => (
            <article className="inventory-card" key={item.id}>
              <div className="inventory-item-head">
                <div className="inventory-symbol">
                  <Cpu size={20} />
                </div>
                <div className="inventory-main">
                  <div className="inventory-name-row">
                    <h3>{item.name}</h3>
                    <span className="category-tag static-tag">{item.category}</span>
                  </div>
                  <p>{item.description || "No description added."}</p>
                </div>
                <div className="inventory-count">
                  <strong>
                    {item.assets.filter((asset) => asset.state === "AVAILABLE").length}
                  </strong>
                  <small>available</small>
                </div>
                <button
                  className="button button-quiet equipment-toggle"
                  onClick={() => void toggleEquipment(item)}
                >
                  {item.active ? "Disable" : "Reactivate"}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Manage ${item.name}`}
                  onClick={() => setOpen(open === item.id ? "" : item.id)}
                >
                  {open === item.id ? <X size={17} /> : <Settings2 size={17} />}
                </button>
              </div>
              {open === item.id && (
                <div className="asset-panel">
                  <div className="asset-panel-head">
                    <strong>
                      Individual assets <small>· {item.assets.length}</small>
                    </strong>
                    <form className="inline-add" onSubmit={(event) => addAsset(event, item)}>
                      <input
                        className="text-input"
                        aria-label="New asset code"
                        placeholder="Asset code, e.g. SB-014"
                        value={assetCodes[item.id] ?? ""}
                        onChange={(e) =>
                          setAssetCodes({ ...assetCodes, [item.id]: e.target.value })
                        }
                      />
                      <button
                        className="button button-primary"
                        disabled={!assetCodes[item.id]?.trim()}
                      >
                        <Plus size={15} /> Add asset
                      </button>
                    </form>
                  </div>
                  {item.assets.length ? (
                    <div className="asset-grid">
                      {item.assets.map((asset) => (
                        <div
                          className="asset-tile"
                          key={asset.id}
                          data-printing={printAssetId === asset.id}
                        >
                          <div className="asset-tile-top">
                            <div>
                              <strong>{asset.assetCode}</strong>
                              <small>{asset.serialNumber ?? "No serial number"}</small>
                            </div>
                            {["AVAILABLE", "OUT_OF_SERVICE", "RETIRED"].includes(asset.state) ? (
                              <select
                                className="asset-state-select"
                                aria-label={`Status for ${asset.assetCode}`}
                                value={asset.state}
                                disabled={asset.state === "RETIRED"}
                                onChange={(event) =>
                                  void setAssetState(asset.id, event.target.value)
                                }
                              >
                                <option value="AVAILABLE">Available</option>
                                <option value="OUT_OF_SERVICE">Out of service</option>
                                <option value="RETIRED">Retired</option>
                              </select>
                            ) : (
                              <StatusPill status={asset.state} />
                            )}
                          </div>
                          <div className="qr-label">
                            <QRCodeSVG value={asset.qrUrl} size={78} level="M" />
                            <span>
                              IEEE INSAT SB
                              <br />
                              <strong>{asset.assetCode}</strong>
                            </span>
                            <button
                              className="icon-button print-button"
                              title="Print QR label"
                              onClick={() => {
                                setPrintAssetId(asset.id);
                                window.setTimeout(() => window.print(), 40);
                              }}
                            >
                              <QrCode size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-inline">
                      No individual assets yet. Add an asset code to generate its unique QR label.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <form id="new-equipment" className="card create-equipment" onSubmit={createEquipment}>
        <div>
          <span className="eyebrow">GROW THE COLLECTION</span>
          <h2>Add an equipment type</h2>
          <p className="subtle">Then add individual assets to create their desk labels.</p>
        </div>
        <div className="new-equipment-fields">
          <label>
            <span>Name</span>
            <input
              className="text-input"
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Soldering station"
            />
          </label>
          <label>
            <span>Category</span>
            <input
              className="text-input"
              required
              maxLength={80}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Workshop"
            />
          </label>
          <label>
            <span>Description</span>
            <input
              className="text-input"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note for members"
            />
          </label>
          <button className="button button-dark">
            <Plus size={15} /> Create type
          </button>
        </div>
      </form>
    </>
  );
}

function BoardChapters({ setNotice }: { setNotice: (message: string) => void }) {
  const [chapters, setChapters] = useState<
    Array<{ id: string; name: string; shortCode: string; active: boolean }>
  >([]);
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const refresh = useCallback(
    () =>
      api<Array<{ id: string; name: string; shortCode: string; active: boolean }>>(
        "/api/v1/board/chapters"
      )
        .then(setChapters)
        .catch((error: Error) => setNotice(error.message)),
    [setNotice]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/v1/board/chapters", post({ name, shortCode }));
      setName("");
      setShortCode("");
      setNotice("Chapter added for future reservations.");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add chapter.");
    }
  };
  const toggle = async (chapter: (typeof chapters)[number]) => {
    try {
      await api(`/api/v1/board/chapters/${chapter.id}`, patch({ active: !chapter.active }));
      setNotice(chapter.active ? "Chapter disabled for new reservations." : "Chapter reactivated.");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update chapter.");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · CHAPTER BORROWING"
        title={
          <>
            Shared tools.
            <br className="mobile-only" /> <em>Chapter by chapter.</em>
          </>
        }
        description="Active chapters can request equipment as a group borrower. Past reservations keep their chapter history."
      />
      <div className="chapter-layout">
        <section className="card chapter-directory">
          <div className="card-heading">
            <div>
              <span className="eyebrow">ELIGIBLE BORROWERS</span>
              <h2>{chapters.filter((chapter) => chapter.active).length} active chapters</h2>
            </div>
            <Users size={19} className="subtle" />
          </div>
          <div className="chapter-list">
            {chapters.map((chapter) => (
              <div className="chapter-row" key={chapter.id}>
                <span className="chapter-mark">{chapter.shortCode.slice(0, 2)}</span>
                <div>
                  <strong>{chapter.name}</strong>
                  <small>{chapter.shortCode}</small>
                </div>
                <StatusPill status={chapter.active ? "AVAILABLE" : "RETIRED"} />
                <button className="button button-quiet" onClick={() => void toggle(chapter)}>
                  {chapter.active ? "Disable" : "Reactivate"}
                </button>
              </div>
            ))}
            {!chapters.length && (
              <EmptyState
                icon={<Users />}
                title="No chapters yet"
                body="Add a chapter so members can make shared reservations."
              />
            )}
          </div>
        </section>
        <form className="card chapter-create" onSubmit={create}>
          <span className="eyebrow">ADD A BORROWER</span>
          <h2>Register a chapter</h2>
          <p className="subtle">
            Use the chapter name and a short code the Board will recognize at handover.
          </p>
          <label className="field-label">
            Chapter name
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              placeholder="Robotics Club"
            />
          </label>
          <label className="field-label">
            Short code
            <input
              className="text-input"
              value={shortCode}
              onChange={(event) => setShortCode(event.target.value.toUpperCase())}
              maxLength={24}
              minLength={2}
              pattern="[A-Za-z0-9-]+"
              required
              placeholder="ROBO"
            />
          </label>
          <button className="button button-primary wide">
            <Plus size={15} /> Add chapter
          </button>
        </form>
      </div>
    </>
  );
}

function BoardScan({
  initialToken,
  setNotice,
}: {
  initialToken: string;
  setNotice: (message: string) => void;
}) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
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
        e instanceof Error ? e.message : "Camera is unavailable. Use the asset token below instead."
      );
    }
  };
  const scan = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setResult(null);
    const value = token.match(/[a-f0-9]{64}/i)?.[0] ?? token.trim();
    try {
      const scanned = await api<typeof result>("/api/v1/board/scan", {
        ...post({ qrToken: value }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setResult(scanned);
      setNotice(
        scanned?.operation === "RETURNED"
          ? "Equipment returned to the desk."
          : "Equipment checked out."
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Scan could not be processed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · HANDOVER"
        title={
          <>
            A quick scan.
            <br className="mobile-only" /> <em>A clear record.</em>
          </>
        }
        description="Scan the asset when it leaves the desk and again when it comes back."
        action={
          <span className="timezone-badge">
            <ShieldCheck size={15} /> Board-only operation
          </span>
        }
      />
      <div className="scanner-layout">
        <section className="card scanner-card">
          <div className="scanner-heading">
            <span className="scanner-icon">
              <QrCode size={21} />
            </span>
            <div>
              <span className="eyebrow">CAMERA SCANNER</span>
              <h2>Point at an asset label</h2>
              <p>Keep the QR code inside the frame. Camera access stays in this browser.</p>
            </div>
          </div>
          <div className="camera-frame">
            {!controls.current && (
              <div className="camera-placeholder">
                <div className="camera-corners">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="camera-placeholder-icon">
                  <QrCode size={31} />
                </span>
                <p>Camera preview appears here</p>
                <small>Allow camera access when your browser asks.</small>
              </div>
            )}
            <video
              ref={video}
              muted
              playsInline
              className="scanner-video"
              aria-label="QR scanner preview"
            />
          </div>
          <div className="scanner-actions">
            <button
              className="button button-primary"
              onClick={controls.current ? stop : beginCamera}
            >
              {controls.current ? (
                <>
                  <X size={16} /> Stop camera
                </>
              ) : (
                <>
                  <QrCode size={16} /> Start camera
                </>
              )}
            </button>
            <span>or enter a label token</span>
          </div>
          <form className="token-entry" onSubmit={scan}>
            <input
              className="text-input mono-input"
              aria-label="QR asset token"
              placeholder="Paste QR URL or token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button className="button button-dark" disabled={busy || !token.trim()}>
              {busy ? "Recording…" : "Record handover"}
              <ArrowRight size={15} />
            </button>
          </form>
          {result && (
            <div className="scan-result">
              <span className="scan-result-icon">
                <Check size={18} />
              </span>
              <div>
                <strong>
                  {result.operation === "RETURNED" ? "Returned to the desk" : "Checked out"} ·{" "}
                  {result.assetCode}
                </strong>
                <p>
                  {result.assetName}
                  {result.borrowerName ? ` · ${result.borrowerName}` : ""}
                  {result.returnAt
                    ? ` · Due ${fmtWindow(new Date().toISOString(), result.returnAt)}`
                    : ""}
                </p>
              </div>
            </div>
          )}
        </section>
        <aside className="card scan-help">
          <span className="eyebrow">AT THE DESK</span>
          <h2>One code, two moments.</h2>
          <div className="scan-step">
            <span>01</span>
            <div>
              <strong>Collection</strong>
              <p>
                Scan an approved asset after checking its condition. The reservation window must
                have started.
              </p>
            </div>
          </div>
          <div className="scan-step">
            <span>02</span>
            <div>
              <strong>Return</strong>
              <p>Scan the same asset as it comes back. A return is recorded immediately.</p>
            </div>
          </div>
          <div className="secure-note">
            <ShieldCheck size={16} />
            <span>
              Every scan is tied to your Board account and written to the append-only activity log.
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}

function Accounts({ setNotice }: { setNotice: (message: string) => void }) {
  const [users, setUsers] = useState<
    Array<{ id: string; name: string; email: string; role: Role; emailVerified: boolean }>
  >([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"BOARD" | "SUPERADMIN">("BOARD");
  const refresh = useCallback(
    () =>
      api<typeof users>("/api/v1/board/users")
        .then(setUsers)
        .catch((e: Error) => setNotice(e.message)),
    [setNotice]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/v1/board/users", post({ name, email, role }));
      setName("");
      setEmail("");
      setNotice("Access invitation is ready. The member can sign in by email.");
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not create account.");
    }
  };
  const changeRole = async (id: string, next: Role) => {
    try {
      await api(`/api/v1/board/users/${id}/role`, patch({ role: next }));
      refresh();
      setNotice("Account role updated.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not update role.");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="SUPERADMIN · ACCESS CONTROL"
        title={
          <>
            Good governance,
            <br className="mobile-only" /> <em>simple roles.</em>
          </>
        }
        description="Create Board accounts and grant access to the Student Branch equipment desk."
      />
      <form className="card account-create" onSubmit={create}>
        <span className="eyebrow">ADD BOARD ACCESS</span>
        <div className="account-form-row">
          <input
            className="text-input"
            required
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="text-input"
            required
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="text-input"
            value={role}
            onChange={(e) => setRole(e.target.value as "BOARD" | "SUPERADMIN")}
          >
            <option value="BOARD">Board</option>
            <option value="SUPERADMIN">Superadmin</option>
          </select>
          <button className="button button-primary">
            <Plus size={15} /> Add account
          </button>
        </div>
        <small className="subtle">
          Members receive a single-use email sign-in link when they request access.
        </small>
      </form>
      <section className="card accounts-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">ROLE DIRECTORY</span>
            <h2>{users.length} accounts</h2>
          </div>
          <ShieldCheck size={20} className="subtle" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Account</th>
                <th>Email status</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr key={person.id}>
                  <td>
                    <div className="table-person">
                      <span className="avatar avatar-small">{person.name.slice(0, 1)}</span>
                      <strong>{person.name}</strong>
                    </div>
                  </td>
                  <td>{person.email}</td>
                  <td>
                    <span
                      className={`verification ${person.emailVerified ? "verified" : "pending"}`}
                    >
                      {person.emailVerified ? "Verified" : "Not signed in"}
                    </span>
                  </td>
                  <td>
                    <select
                      className="role-select"
                      value={person.role}
                      onChange={(e) => changeRole(person.id, e.target.value as Role)}
                    >
                      <option value="USER">Member</option>
                      <option value="BOARD">Board</option>
                      <option value="SUPERADMIN">Superadmin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
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
    <>
      <PageHeading
        eyebrow="BOARD WORKSPACE · APPEND-ONLY"
        title={
          <>
            The work is visible.
            <br className="mobile-only" /> <em>The history stays.</em>
          </>
        }
        description="Reservation, inventory, and handover actions in chronological order."
      />
      <section className="card audit-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">RECENT ACTIVITY</span>
            <h2>{events.length} recorded events</h2>
          </div>
          <span className="immutable-chip">
            <ShieldCheck size={14} /> Immutable log
          </span>
        </div>
        {error ? (
          <InlineError message={error} />
        ) : events.length ? (
          <div className="audit-list">
            {events.map((event) => (
              <div className="audit-row" key={event.id}>
                <span className="audit-dot">
                  <Activity size={14} />
                </span>
                <div className="audit-event">
                  <strong>{titleCase(event.action.replaceAll("_", " "))}</strong>
                  <span>
                    {event.actorName} · {event.entityType.toLowerCase()}{" "}
                    <code>{event.entityId.slice(0, 14)}</code>
                  </span>
                </div>
                <time>
                  {DateTime.fromMillis(event.createdAt).setZone(TZ).toFormat("dd LLL · HH:mm")}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileClock />}
            title="No activity recorded yet"
            body="Board decisions and inventory handovers will appear here."
          />
        )}
      </section>
    </>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function InlineError({ message }: { message: string }) {
  return (
    <div className="inline-error">
      <CircleHelp size={16} />
      {message}
    </div>
  );
}
function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function App() {
  return (
    <BrowserRouter>
      <AppFrame />
    </BrowserRouter>
  );
}
