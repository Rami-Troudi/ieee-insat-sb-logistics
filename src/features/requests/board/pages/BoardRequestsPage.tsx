import { Link } from "react-router-dom";
import { useState } from "react";
import { useBoardRequests } from "../hooks/useBoardRequests";
import { LoadingState } from "@/components/shared/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const BoardRequestsPage = () => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [handoverStatus, setHandoverStatus] = useState<"ALL" | "WAITING" | "HANDED_OVER">(
    "WAITING"
  );
  const { data: requests = [], isLoading } = useBoardRequests({
    search,
    decisionStatus: status,
    handoverStatus,
  });
  if (isLoading) return <LoadingState message="Loading requests" />;
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Review member requests and confirm physical handovers.
        </p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          className="h-11"
          placeholder="Search member or item"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Request status"
          className="h-11 rounded-md border bg-background px-3"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="ALL">All requests</option>
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Declined</option>
        </select>
        <select
          aria-label="Handover status"
          className="h-11 rounded-md border bg-background px-3"
          value={handoverStatus}
          onChange={(event) => setHandoverStatus(event.target.value as typeof handoverStatus)}
        >
          <option value="WAITING">Awaiting handover</option>
          <option value="HANDED_OVER">Completed handover</option>
          <option value="ALL">All handovers</option>
        </select>
      </div>
      <div className="space-y-3">
        {requests.map((request) => (
          <article
            key={request.id}
            className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_1.3fr_auto] md:items-center"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{request.userName}</p>
                {request.flagged && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    ⚠️ Flagged
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {new Date(request.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-sm">
                {request.items
                  .map((item) => `${item.itemName} ×${item.requestedQuantity}`)
                  .join(" · ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expected return {new Date(request.expectedReturnDate).toLocaleDateString()}
              </p>
            </div>
            <Button asChild className="min-h-11">
              <Link to={`/board/requests/${request.id}`}>
                {request.decisionStatus === "PENDING"
                  ? "Review"
                  : request.handoverStatus === "WAITING" && request.decisionStatus !== "REJECTED"
                    ? "Confirm handover"
                    : "View details"}
              </Link>
            </Button>
          </article>
        ))}
      </div>
      {requests.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No requests found.
        </p>
      )}
    </main>
  );
};
