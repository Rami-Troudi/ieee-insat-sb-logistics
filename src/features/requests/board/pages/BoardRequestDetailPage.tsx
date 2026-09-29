import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useSession } from "@/hooks/useSession";
import {
  useBoardRequestDetail,
  useReviewBorrowRequest,
  useRejectEntireRequest,
  useConfirmHandover,
} from "../hooks/useBoardRequests";
import { LoadingState } from "@/components/shared/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const BoardRequestDetailPage = () => {
  const { requestId = "" } = useParams();
  const navigate = useNavigate();
  const { currentPersona } = useSession();
  const { data: request, isLoading } = useBoardRequestDetail(requestId);
  const review = useReviewBorrowRequest();
  const reject = useRejectEntireRequest();
  const handover = useConfirmHandover();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (isLoading) return <LoadingState message="Loading request" />;
  if (!request) return <main className="p-6">Request not found.</main>;
  const pending = request.decisionStatus === "PENDING";
  const ready =
    ["APPROVED", "PARTIALLY_APPROVED"].includes(request.decisionStatus) &&
    request.handoverStatus === "WAITING";
  const submitReview = async () => {
    setError("");
    try {
      await review.mutateAsync({
        payload: {
          requestId: request.id,
          decisionNotes: note,
          lines: request.items.map((line) => ({
            lineId: line.id,
            approvedQuantity: quantities[line.id] ?? line.requestedQuantity,
          })),
        },
        actorUserId: currentPersona.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not review request");
    }
  };
  const submitReject = async () => {
    setError("");
    try {
      await reject.mutateAsync({
        requestId: request.id,
        reason: note.trim() || "Declined by operator",
        actorUserId: currentPersona.id,
      });
      navigate("/board/requests", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject request");
    }
  };
  const confirm = async () => {
    setError("");
    try {
      await handover.mutateAsync({
        payload: { requestId: request.id, notes: note },
        actorUserId: currentPersona.id,
      });
      navigate("/board/requests", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm handover");
    }
  };
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <header>
        <p className="text-sm text-muted-foreground">
          {request.userName} · {request.userEmail}
        </p>
        <h1 className="text-2xl font-semibold">Borrow request</h1>
        {request.flagged && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            <span>⚠️ Flagged: Level Restriction</span>
            {request.flagReason && (
              <span className="font-normal opacity-90">({request.flagReason})</span>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Expected return {new Date(request.expectedReturnDate).toLocaleDateString()} · Submitted{" "}
          {new Date(request.createdAt).toLocaleDateString()}
        </p>
      </header>
      {request.note && (
        <p className="rounded-lg bg-muted p-3 text-sm">Member note: {request.note}</p>
      )}
      <section className="divide-y rounded-xl border">
        {request.items.map((line) => (
          <div
            key={line.id}
            className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{line.itemName}</p>
                {line.flagged && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Flagged: {line.flagReason || "Level Restriction"}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Requested ×{line.requestedQuantity}
                {!pending && ` · Approved ×${line.approvedQuantity}`}
              </p>
            </div>
            {pending && (
              <label className="flex items-center gap-2 text-sm">
                Approve quantity
                <Input
                  className="h-11 w-24"
                  type="number"
                  min={0}
                  max={line.requestedQuantity}
                  value={quantities[line.id] ?? line.requestedQuantity}
                  onChange={(event) =>
                    setQuantities((values) => ({
                      ...values,
                      [line.id]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            )}
          </div>
        ))}
      </section>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <label className="block space-y-1 text-sm">
        Operator note
        <Input className="h-11" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {pending && (
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={review.isPending || reject.isPending}
            onClick={submitReview}
          >
            Approve and reserve stock
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 w-full sm:w-auto"
            disabled={review.isPending || reject.isPending}
            onClick={submitReject}
          >
            Reject Request
          </Button>
        </div>
      )}
      {ready && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Check the reserved items in person, then confirm physical handover.
          </p>
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={handover.isPending}
            onClick={confirm}
          >
            Confirm handover
          </Button>
        </div>
      )}
      <section className="space-y-2">
        <h2 className="font-semibold">History</h2>
        {request.timeline.map((entry, index) => (
          <p key={`${entry.timestamp}-${index}`} className="border-l pl-3 text-sm">
            {entry.description}
            <span className="block text-xs text-muted-foreground">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
          </p>
        ))}
      </section>
    </main>
  );
};
