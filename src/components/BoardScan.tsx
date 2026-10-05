import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, QrCode, CheckCircle2, XCircle } from "lucide-react";
import type { ReservationDTO as Reservation } from "@/shared/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, post } from "@/lib/api";
import { fmtDay, fmtTime, titleCase } from "@/lib/format";
export default function BoardScan({
  initialToken,
  setNotice,
}: {
  initialToken: string;
  setNotice: (message: string) => void;
}) {
  const [token, setToken] = useState(initialToken);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const openReservation = useCallback(async (id: string) => {
    const detail = await api<Reservation>(`/api/v1/board/reservations/${encodeURIComponent(id)}`);
    if (!["APPROVED", "COMPLETED", "CANCELLED"].includes(detail.status))
      throw new Error("This reservation has not been approved.");
    setReservation(detail);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("res");
    if (id) void openReservation(id).catch((e: Error) => setNotice(e.message));
  }, [openReservation, setNotice]);
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanError, setScanError] = useState<{ title: string; message: string } | null>(null);
  const [result, setResult] = useState<{
    operation: string;
    assetName: string;
    assetCode: string;
    borrowerName?: string;
    returnAt?: string;
  } | null>(null);
  const [selectionPrompt, setSelectionPrompt] = useState<{
    qrToken: string;
    assetName: string;
    assetCode: string;
    reservations: Array<{
      id: string;
      borrowerName: string;
      chapterName?: string | null;
      pickupAt: string;
      returnAt: string;
      quantity: number;
      uncollectedCount: number;
    }>;
  } | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);
  const reader = useRef<import("@zxing/browser").BrowserQRCodeReader | null>(null);
  const isScanningRef = useRef(false);
  const lastScannedRef = useRef<{ code: string; time: number } | null>(null);
  const selectionPromptRef = useRef(selectionPrompt);
  selectionPromptRef.current = selectionPrompt;

  const stop = () => {
    controls.current?.stop();
    controls.current = null;
    isScanningRef.current = false;
    setCameraActive(false);
  };
  useEffect(() => () => stop(), []);

  const executeScan = async (rawCode: string, explicitReservationId?: string) => {
    setBusy(true);
    setResult(null);
    setScanError(null);
    const value = rawCode.match(/[a-f0-9]{64}/i)?.[0] ?? rawCode.trim();
    try {
      let reservationId: string | null = null;
      try {
        reservationId = new URL(rawCode.trim(), window.location.origin).searchParams.get("res");
      } catch {
        /* A raw material token is also accepted. */
      }
      if (reservationId) {
        await openReservation(reservationId);
        setToken("");
        setNotice("Reservation opened. Scan equipment to record borrow or return.");
        setTimeout(() => {
          isScanningRef.current = false;
        }, 1500);
        return;
      }
      const targetReservationId = explicitReservationId ?? reservation?.id;
      const scanned = await api<
        | {
            operation: string;
            assetName: string;
            assetCode: string;
            borrowerName?: string;
            returnAt?: string;
            code?: undefined;
          }
        | {
            code: "RESERVATION_SELECTION_REQUIRED";
            assetName: string;
            assetCode: string;
            reservations: Array<{
              id: string;
              borrowerName: string;
              chapterName?: string | null;
              pickupAt: string;
              returnAt: string;
              quantity: number;
              uncollectedCount: number;
            }>;
            operation?: undefined;
          }
      >("/api/v1/board/scan", {
        ...post({
          qrToken: value,
          ...(targetReservationId ? { reservationId: targetReservationId } : {}),
        }),
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });

      if (scanned && scanned.code === "RESERVATION_SELECTION_REQUIRED") {
        setSelectionPrompt({
          qrToken: value,
          assetName: scanned.assetName,
          assetCode: scanned.assetCode,
          reservations: scanned.reservations,
        });
        return;
      }

      setResult(scanned);
      setToken("");
      if (reservation)
        setReservation(await api<Reservation>(`/api/v1/board/reservations/${reservation.id}`));
      setNotice(
        scanned?.operation === "RETURNED"
          ? `${scanned.assetName} #${scanned.assetCode} returned to the desk.`
          : `${scanned.assetName} #${scanned.assetCode} checked out to ${scanned.borrowerName || "borrower"}.`
      );
      setTimeout(() => {
        isScanningRef.current = false;
      }, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan could not be processed.";
      setScanError({
        title: msg.includes("cooldown") ? "Scan cooldown active" : "Handover rejected",
        message: msg,
      });
      setTimeout(() => {
        isScanningRef.current = false;
      }, 2000);
    } finally {
      setBusy(false);
    }
  };

  const executeScanRef = useRef(executeScan);
  useEffect(() => {
    executeScanRef.current = executeScan;
  });

  const beginCamera = async () => {
    if (!video.current) return;
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      reader.current ??= new BrowserQRCodeReader();
      controls.current = await reader.current.decodeFromVideoDevice(
        undefined,
        video.current,
        (decoded) => {
          if (!decoded) return;
          if (isScanningRef.current || selectionPromptRef.current) return;

          const text = decoded.getText();
          const matched = text.match(/(?:^|\/)([a-f0-9]{64})(?:\?.*)?$/i);
          const code = matched?.[1] ?? text;

          const now = Date.now();
          if (
            lastScannedRef.current &&
            lastScannedRef.current.code === code &&
            now - lastScannedRef.current.time < 3000
          ) {
            return;
          }

          isScanningRef.current = true;
          lastScannedRef.current = { code, time: now };
          setToken(code);
          void executeScanRef.current(code);
        }
      );
      setCameraActive(true);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Camera is unavailable. Use manual token entry below."
      );
    }
  };

  const scan = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!token.trim()) return;
    await executeScan(token);
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
            Scan an equipment QR to record its checkout or return.
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
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setReservation(null)}
            >
              Close reservation
            </Button>
          </div>
          <ul className="text-sm space-y-1">
            {reservation.items.map((item) => (
              <li key={item.lineId}>
                {item.quantity} × {item.name} ·{" "}
                {
                  (item.assignedAssets ?? []).filter((asset) =>
                    ["BORROWED", "RETURNED"].includes(asset.state)
                  ).length
                }{" "}
                collected
              </li>
            ))}
            {reservation.items.flatMap((item) =>
              (item.assignedAssets ?? []).map((asset) => (
                <li key={asset.id}>
                  {item.name} · {asset.assetCode} · {titleCase(asset.state)}
                </li>
              ))
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Scan equipment QR to record checkout or return. All materials must be returned before
            the reservation is completed.
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
            {!cameraActive && (
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
            onClick={cameraActive ? stop : beginCamera}
            className="gap-2 px-5 min-h-[44px]"
          >
            <QrCode className="w-4 h-4" />
            <span>{cameraActive ? "Stop Camera" : "Start Camera"}</span>
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

      {/* Disambiguation Dialog when multiple reservations match */}
      <Dialog
        open={Boolean(selectionPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectionPrompt(null);
            setTimeout(() => {
              isScanningRef.current = false;
            }, 500);
          }
        }}
      >
        <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl space-y-4">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Select Eligible Reservation</DialogTitle>
            <DialogDescription className="text-xs">
              Multiple approved reservations qualify for {selectionPrompt?.assetName} #
              {selectionPrompt?.assetCode}. Select which reservation to allocate this asset to:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {selectionPrompt?.reservations.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  const pendingToken = selectionPrompt.qrToken;
                  setSelectionPrompt(null);
                  void executeScan(pendingToken, r.id);
                }}
                className="w-full text-left p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-surface-subtle transition-all space-y-1"
              >
                <div className="flex items-center justify-between font-semibold text-xs text-foreground">
                  <span>
                    {r.chapterName ? `${r.chapterName} — ` : ""}
                    {r.borrowerName}
                  </span>
                  <span className="text-[11px] text-primary">
                    {r.uncollectedCount} {r.uncollectedCount === 1 ? "unit" : "units"} remaining
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Return {fmtTime(r.returnAt)}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectionPrompt(null);
                setTimeout(() => {
                  isScanningRef.current = false;
                }, 500);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
