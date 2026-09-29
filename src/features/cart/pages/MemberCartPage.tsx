import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBorrowCart } from "@/features/cart";
import { useSession } from "@/hooks/useSession";
import { useCreateRequest } from "@/features/requests/hooks/useRequests";
import { DEFAULT_EQUIPMENT_IMAGE } from "@/assets/equipmentImages";

export const MemberCartPage: React.FC = () => {
  const { currentPersona, openBorrowerAuthModal } = useSession();
  const { state, updateQuantity, removeItem, clearCart, setNote, setReturnDate } = useBorrowCart();
  const createRequest = useCreateRequest(currentPersona.id);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.items.length) return;
    setError("");

    const savedEmail = localStorage.getItem("ras_borrower_email");
    if (!savedEmail && (!currentPersona.email || currentPersona.id === "anonymous")) {
      openBorrowerAuthModal();
      return;
    }
    try {
      await createRequest.mutateAsync({
        expectedReturnDate: state.expectedReturnDate,
        ...(state.note.trim() ? { note: state.note.trim() } : {}),
        items: state.items.map(({ item, quantity }) => ({ itemId: item.id, quantity })),
      });
      clearCart();
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send request");
    }
  };

  if (sent) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center space-y-4">
        <h1 className="text-2xl font-bold">Request sent</h1>
        <p>
          The logistics team will review your request. Ask at the logistics desk for status and
          pickup instructions.
        </p>
        <Button asChild className="min-h-11">
          <Link to="/app/activity">View Activity</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 space-y-5">
      <h1 className="text-2xl font-bold">Cart</h1>
      {!state.items.length ? (
        <div className="space-y-3">
          <p>Your cart is empty.</p>
          <Button asChild className="min-h-11">
            <Link to="/app">Browse Catalogue</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-3">
            {state.items.map(({ item, quantity }) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <img
                  src={item.imageUrl || DEFAULT_EQUIPMENT_IMAGE}
                  alt={item.name}
                  className="h-16 w-16 shrink-0 rounded-lg object-contain bg-muted"
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_EQUIPMENT_IMAGE;
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                </div>
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-label={quantity === 1 ? `Remove ${item.name}` : `Decrease ${item.name}`}
                    onClick={() =>
                      quantity === 1 ? removeItem(item.id) : updateQuantity(item.id, quantity - 1)
                    }
                    className="flex h-11 w-11 items-center justify-center rounded-lg border focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {quantity === 1 ? (
                      <Trash2 className="h-4 w-4" />
                    ) : (
                      <Minus className="h-4 w-4" />
                    )}
                  </button>
                  <span className="w-7 text-center text-sm font-semibold">{quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${item.name}`}
                    onClick={() => updateQuantity(item.id, quantity + 1)}
                    disabled={quantity >= 99}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={clearCart}
            className="min-h-11 px-2 text-sm text-muted-foreground underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            Clear cart
          </button>
          <label className="block space-y-2">
            <span className="text-sm font-semibold">Expected return</span>
            <input
              type="date"
              required
              min={new Date().toISOString().slice(0, 10)}
              value={state.expectedReturnDate}
              onChange={(event) => setReturnDate(event.target.value)}
              className="block min-h-11 w-full rounded-lg border border-input bg-background px-3"
            />
          </label>
          <details className="rounded-lg border p-3">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">
              Add details
            </summary>
            <label className="block space-y-2 pt-2">
              <span className="text-sm">Optional note</span>
              <textarea
                value={state.note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-input bg-background p-3"
              />
            </label>
          </details>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={createRequest.isPending}
            className="w-full min-h-11 gap-2"
          >
            <Send className="h-4 w-4" /> {createRequest.isPending ? "Sending..." : "Send Request"}
          </Button>
        </form>
      )}
    </div>
  );
};
