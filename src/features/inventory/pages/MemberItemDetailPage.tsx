import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/FeedbackStates";
import { useBorrowCart } from "@/features/cart";
import { useInventoryItem } from "../hooks/useInventory";
import { DEFAULT_EQUIPMENT_IMAGE } from "@/assets/equipmentImages";

export const MemberItemDetailPage: React.FC = () => {
  const { itemId = "" } = useParams<{ itemId: string }>();
  const { data: item, isLoading, error } = useInventoryItem(itemId);
  const { addItem } = useBorrowCart();
  const [imageError, setImageError] = useState(false);

  if (isLoading) return <LoadingState message="Loading equipment..." />;
  if (error || !item) {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <ErrorState title="Equipment not found" description="This item is not in your catalogue." />
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/app/inventory">Back to Catalogue</Link>
        </Button>
      </div>
    );
  }

  const availability =
    item.availability === "AVAILABLE"
      ? "Available"
      : item.availability === "LIMITED"
        ? "Limited"
        : "Unavailable";

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <Link
        to="/app/inventory"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Catalogue
      </Link>
      <article className="overflow-hidden rounded-xl border border-border bg-card">
        <img
          src={imageError || !item.imageUrl ? DEFAULT_EQUIPMENT_IMAGE : item.imageUrl}
          alt={item.name}
          onError={() => setImageError(true)}
          className="aspect-[4/3] w-full object-contain bg-muted"
        />
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">{item.category}</p>
          <h1 className="text-2xl font-bold">{item.name}</h1>
          <p className="text-sm leading-relaxed">{item.description}</p>
          <p className="font-semibold">{availability}</p>
          {item.datasheetUrl && (
            <a
              href={item.datasheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm text-primary underline"
            >
              View datasheet
            </a>
          )}
          {item.action === "REQUEST" ? (
            <Button type="button" onClick={() => addItem(item)} className="w-full min-h-11 gap-2">
              <Plus className="w-4 h-4" /> Add to cart
            </Button>
          ) : (
            <p className="rounded-lg bg-muted p-3 text-sm">
              {item.action === "WORKSPACE"
                ? "Available at RAS workspace"
                : item.action === "ASK_OPERATOR"
                  ? "Ask logistics team"
                  : "Currently unavailable"}
            </p>
          )}
        </div>
      </article>
    </div>
  );
};
