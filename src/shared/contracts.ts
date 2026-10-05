export interface ReservationDTO {
  id: string;
  requestedBy: { id: string; name: string; email: string };
  borrower: { type: "PERSON" | "CHAPTER"; id: string; name: string };
  items: Array<{
    lineId: string;
    equipmentItemId: string;
    name: string;
    quantity: number;
    assignedAssets?: Array<{ id: string; assetCode: string; state: string }>;
  }>;
  pickupAt: string;
  returnAt: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "COMPLETED" | "DECLINED" | "CANCELLED";
  derivedStatus:
    | "PENDING"
    | "APPROVED"
    | "BORROWED"
    | "PARTIALLY_RETURNED"
    | "RETURNED"
    | "OVERDUE"
    | "DECLINED"
    | "CANCELLED";
  collectedCount: number;
  returnedCount: number;
  totalQuantity: number;
  createdAt: string;
}

export const PAGE_SIZE = 100;
export function pagination(offset = 0, limit = PAGE_SIZE) {
  return {
    offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0,
    limit: Number.isFinite(limit) ? Math.min(PAGE_SIZE, Math.max(1, Math.floor(limit))) : PAGE_SIZE,
  };
}
