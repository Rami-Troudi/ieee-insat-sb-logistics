import { useEffect, useState, type ReactNode } from "react";
import { DateTime } from "luxon";
import FullCalendar from "@fullcalendar/react";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { ReservationDTO as Reservation } from "@/shared/contracts";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/FeedbackStates";
import { StatusBadge, type DomainStatus } from "@/components/shared/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const TZ = "Africa/Tunis";
const fmtWindow = (start: string, end: string) =>
  DateTime.fromISO(start).setZone(TZ).toFormat("ccc, d LLL HH:mm") +
  " – " +
  DateTime.fromISO(end).setZone(TZ).toFormat("ccc, d LLL HH:mm");
async function api<T>(path: string, signal: AbortSignal): Promise<T> {
  const all: unknown[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(path + (path.includes("?") ? "&" : "?") + "offset=" + offset, {
      signal,
    });
    if (!response.ok) throw Error("Could not load calendar. Please retry.");
    const data = (await response.json()) as unknown[];
    all.push(...data);
    if (data.length < 100) break;
  }
  return all as T;
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

export default function BoardCalendar() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [range, setRange] = useState({
    start: DateTime.now().setZone(TZ).startOf("week").toISO()!,
    end: DateTime.now().setZone(TZ).startOf("week").plus({ weeks: 1 }).toISO()!,
  });
  const [selectedEvent, setSelectedEvent] = useState<EventInput | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Reservation[]>(
      `/api/v1/board/reservations?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`,
      controller.signal
    )
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
          const isBorrowed = ["BORROWED", "PARTIALLY_RETURNED", "OVERDUE"].includes(
            r.derivedStatus
          );
          const isApproved = r.status === "APPROVED";

          let bgColor =
            (
              {
                PENDING: "#B7791F",
                DECLINED: "#667085",
                CANCELLED: "#667085",
                RETURNED: "#39892F",
              } as Record<string, string>
            )[r.derivedStatus] ?? "#00629B";
          if (isOverdue)
            bgColor = "#BA0C2F"; // Red
          else if (isReturningToday && isBorrowed) bgColor = "#00B5E2";
          else if (isBorrowed)
            bgColor = "#981D97"; // INSAT Violet
          else if (isApproved) bgColor = "#00629B"; // IEEE Blue

          const itemCodes = r.items
            .map((i) =>
              `${i.quantity}× ${i.name} ${i.assignedAssets?.map((a) => a.assetCode).join(" ") || ""}`.trim()
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
        if (!controller.signal.aborted) setEvents(calEvents);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry, range]);

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

      {error && <ErrorState description={error} onRetry={() => setRetry((r) => r + 1)} />}
      <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
        {loading && <LoadingState message="Loading calendar schedule…" />}
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
          datesSet={(info) =>
            setRange((current) =>
              Date.parse(current.start) === info.start.getTime() &&
              Date.parse(current.end) === info.end.getTime()
                ? current
                : { start: info.startStr, end: info.endStr }
            )
          }
          eventClick={handleEventClick}
          height="auto"
        />
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
