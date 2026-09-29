export type EquipmentClass = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type ItemClass = EquipmentClass;

export type TrackingMode = "QUANTITY" | "INDIVIDUAL_ASSET";

export type AssetCondition = "GOOD" | "MINOR_ISSUE" | "DAMAGED" | "MAINTENANCE" | "LOST";
export type AssetState =
  "AVAILABLE" | "ALLOCATED" | "BORROWED" | "DAMAGED" | "MAINTENANCE" | "LOST";

export interface IndividualAsset {
  id: string;
  serialNumber: string;
  condition: AssetCondition;
  state: AssetState;
  notes?: string;
}

export interface InventoryItemSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  equipmentClass: EquipmentClass;
  itemClass?: EquipmentClass;
  trackingMode: TrackingMode;
  totalQuantity: number;
  availableQuantity: number;
  allocatedQuantity: number;
  borrowedQuantity: number;
  damagedQuantity: number;
  maintenanceQuantity: number;
  lostQuantity: number;
  location?: string;
  isFavorite?: boolean;
  imageUrl?: string;
  specifications?: Record<string, string>;
  datasheetUrl?: string;
  assets?: IndividualAsset[];
  aliases?: string[];
  tags?: string[];
  isDirectBoardApproval?: boolean;
  /** Whether this item is exposed in the member catalogue; defaults to Class C/E only. */
  borrowerVisible?: boolean;
}

export interface InventoryQueryFilter {
  search?: string;
  category?: string;
  availableOnly?: boolean;
}

/** Explicit public projection. Internal stock, assets and policy fields never cross this service boundary. */
export interface BorrowerCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  datasheetUrl?: string;
  availability: "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
  action: "REQUEST" | "ASK_OPERATOR" | "WORKSPACE" | "NONE";
  flagged?: boolean;
  flagReason?: string;
}
