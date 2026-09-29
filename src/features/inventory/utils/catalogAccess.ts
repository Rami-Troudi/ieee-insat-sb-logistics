import { BorrowerCatalogItem, InventoryItemSummary, UserProfile } from "@/types";
import { DEFAULT_EQUIPMENT_IMAGE } from "@/assets/equipmentImages";

export function isFormalRequestClass(item: InventoryItemSummary): boolean {
  return item.equipmentClass === "C" || item.equipmentClass === "E";
}

export function isBorrowerCatalogVisible(item: InventoryItemSummary): boolean {
  return item.borrowerVisible ?? isFormalRequestClass(item);
}

export function getBorrowerCatalogAccess(
  user: UserProfile,
  item: InventoryItemSummary
): {
  visible: boolean;
  action: BorrowerCatalogItem["action"];
  availability: BorrowerCatalogItem["availability"];
  flagged?: boolean;
  flagReason?: string;
} {
  const availability =
    item.availableQuantity <= 0
      ? "UNAVAILABLE"
      : item.availableQuantity <= 3
        ? "LIMITED"
        : "AVAILABLE";
  const flagged = false;
  const flagReason = undefined;

  const visible =
    isBorrowerCatalogVisible(item) &&
    user.role === "MEMBER" &&
    user.status === "ACTIVE" &&
    item.totalQuantity > 0;

  if (!visible || availability === "UNAVAILABLE") return { visible, action: "NONE", availability, flagged, flagReason };

  return { visible, action: "REQUEST", availability, flagged, flagReason };
}

export function toBorrowerCatalogItem(
  item: InventoryItemSummary,
  access: ReturnType<typeof getBorrowerCatalogAccess>
): BorrowerCatalogItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    imageUrl: item.imageUrl || DEFAULT_EQUIPMENT_IMAGE,
    ...(item.datasheetUrl ? { datasheetUrl: item.datasheetUrl } : {}),
    availability: access.availability,
    action: access.action,
    flagged: access.flagged,
    flagReason: access.flagReason,
  };
}
