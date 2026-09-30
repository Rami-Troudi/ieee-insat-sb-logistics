import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EquipmentItem {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  availableQuantity: number;
}

interface EquipmentCardProps {
  item: EquipmentItem;
  quantity?: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}

export const EquipmentCard: React.FC<EquipmentCardProps> = ({
  item,
  quantity = 0,
  onAdd,
  onIncrement,
  onDecrement,
}) => {
  const [imageError, setImageError] = useState(false);
  const inCart = quantity > 0;
  const isAvailable = item.availableQuantity > 0;

  const availabilityLabel = isAvailable ? "Available" : "Unavailable";

  return (
    <div className="group flex flex-col justify-between rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-all shadow-sm hover:shadow-md">
      {/* Photo Container with fixed 4:3 aspect ratio */}
      <div className="relative aspect-[4/3] w-full bg-muted/40 overflow-hidden">
        <img
          src={imageError || !item.imageUrl ? "/equipment/fallback.svg" : item.imageUrl}
          alt={item.name}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />

        {/* Availability Dot Badge overlay */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/90 backdrop-blur-sm border border-border shadow-xs text-[11px] font-medium">
          <span
            className={cn("w-2 h-2 rounded-full", {
              "bg-emerald-500": isAvailable,
              "bg-rose-500": !isAvailable,
            })}
          />
          <span className="text-foreground text-[10px]">{availabilityLabel}</span>
        </div>

        {/* Subtle in-cart badge */}
        {inCart && (
          <div className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
            <span>{quantity}</span>
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
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.description}</p>
        )}
      </div>

      {/* Card Action Footer */}
      <div className="p-3 pt-0">
        {inCart ? (
          <div className="flex items-center justify-between border border-primary/40 bg-primary/5 rounded-lg p-1">
            <button
              type="button"
              onClick={onDecrement}
              className="w-10 h-10 rounded-md bg-background border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Decrease ${item.name} quantity`}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-bold text-foreground px-2">{quantity}</span>
            <button
              type="button"
              onClick={onIncrement}
              disabled={quantity >= item.availableQuantity}
              className="w-10 h-10 rounded-md bg-background border border-border flex items-center justify-center text-foreground hover:bg-muted active:scale-95 disabled:opacity-40 transition-all focus-visible:ring-2 focus-visible:ring-primary"
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
            disabled={!isAvailable}
            onClick={onAdd}
            aria-label={`Select item: ${item.name}`}
            className="w-full text-xs font-semibold gap-1.5 min-h-10 rounded-lg shadow-xs active:scale-95 transition-all duration-150 hover:shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Select item</span>
          </Button>
        )}
      </div>
    </div>
  );
};
