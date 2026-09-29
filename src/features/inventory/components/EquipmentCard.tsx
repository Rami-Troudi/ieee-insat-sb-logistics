import React, { useState } from "react";
import { Link } from "react-router-dom";
import { BorrowerCatalogItem } from "@/types";
import { useBorrowCart } from "@/features/cart";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_EQUIPMENT_IMAGE } from "@/assets/equipmentImages";

interface EquipmentCardProps {
  item: BorrowerCatalogItem;
}

export const EquipmentCard: React.FC<EquipmentCardProps> = ({ item }) => {
  const { state: cartState, addItem, updateQuantity, removeItem } = useBorrowCart();
  const [imageError, setImageError] = useState(false);

  const cartEntry = cartState.items.find((i) => i.item.id === item.id);
  const inCart = Boolean(cartEntry);
  const currentQuantity = cartEntry ? cartEntry.quantity : 0;

  const requestable = item.action === "REQUEST";
  const availabilityLabel =
    item.availability === "AVAILABLE"
      ? "Available"
      : item.availability === "LIMITED"
        ? "Limited"
        : "Unavailable";

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(item, 1);
  };

  const handleIncrement = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentQuantity < 99) {
      updateQuantity(item.id, currentQuantity + 1);
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentQuantity <= 1) {
      removeItem(item.id);
    } else {
      updateQuantity(item.id, currentQuantity - 1);
    }
  };

  return (
    <div className="group flex flex-col justify-between rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all shadow-sm hover:shadow-md">
      {/* Clickable Card Header & Photo */}
      <Link to={`/app/inventory/${item.id}`} className="block relative focus:outline-none">
        {/* Photo Container with fixed 4:3 aspect ratio */}
        <div className="relative aspect-[4/3] w-full bg-muted/40 overflow-hidden">
          <img
            src={imageError || !item.imageUrl ? DEFAULT_EQUIPMENT_IMAGE : item.imageUrl}
            alt={item.name}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />

          {/* Availability Dot Badge overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-xs text-[11px] font-medium">
            <span
              className={cn("w-2 h-2 rounded-full", {
                "bg-emerald-500": item.availability === "AVAILABLE",
                "bg-amber-500": item.availability === "LIMITED",
                "bg-rose-500": item.availability === "UNAVAILABLE",
              })}
            />
            <span className="text-foreground text-[10px]">{availabilityLabel}</span>
          </div>

          {/* Subtle in-cart badge */}
          {inCart && (
            <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
              <Check className="w-2.5 h-2.5 stroke-[3]" />
              <span>{currentQuantity}</span>
            </div>
          )}

          {/* Flagged Badge if level restriction */}
          {item.flagged && (
            <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-amber-500/90 text-amber-950 font-bold text-[9px] shadow-xs backdrop-blur-xs">
              ⚠️ Clearance Flagged
            </div>
          )}
        </div>

        {/* Card Body */}
        <div className="p-3">
          <span className="text-[11px] font-medium text-muted-foreground block line-clamp-1 mb-0.5">
            {item.category}
          </span>
          <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1">
            {item.name}
          </h3>
        </div>
      </Link>

      {/* Card Action Footer */}
      <div className="p-3 pt-0">
        {requestable ? (
          inCart ? (
            <div className="flex items-center justify-between border border-primary/40 bg-primary/5 rounded-lg p-1">
              <button
                type="button"
                onClick={handleDecrement}
                className="w-11 h-11 rounded-md bg-background border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Decrease ${item.name} quantity`}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-bold text-foreground px-2">{currentQuantity}</span>
              <button
                type="button"
                onClick={handleIncrement}
                disabled={currentQuantity >= 99}
                className="w-11 h-11 rounded-md bg-background border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Increase ${item.name} quantity`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleAdd}
              className="w-full text-xs font-semibold gap-1.5 min-h-11 rounded-lg shadow-xs active:scale-95 transition-all duration-150 hover:shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add</span>
            </Button>
          )
        ) : (
          <Link
            to={`/app/inventory/${item.id}`}
            className="w-full min-h-11 flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/50 hover:bg-muted border border-border/70 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span>
              {item.action === "WORKSPACE"
                ? "At workspace"
                : item.action === "ASK_OPERATOR"
                  ? "Ask logistics team"
                  : "Unavailable"}
            </span>
            <ArrowRight className="w-3 h-3 text-muted-foreground" />
          </Link>
        )}
      </div>
    </div>
  );
};
