import { EquipmentClass } from "./inventory";

// Multi-dimensional request statuses
export type RequestDecisionStatus = "PENDING" | "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED";
export type RequestHandoverStatus = "WAITING" | "HANDED_OVER";
export type RequestLifecycleStatus = "ACTIVE" | "CLOSED" | "CANCELLED" | "EXPIRED";

// Backward-compatible compound status type
export type RequestStatus =
  | "PENDING"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "HANDED_OVER";

export type RequestLineStatus = "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED";

export interface RequestLineItem {
  id: string;
  itemId: string;
  itemName: string;
  category: string;
  equipmentClass: EquipmentClass;
  requestedQuantity: number;
  approvedQuantity: number;
  handedOverQuantity: number;
  returnedQuantity: number;
  damagedQuantity: number;
  lostQuantity: number;
  status: RequestLineStatus;
  rejectionReason?: string;
  flagged?: boolean;
  flagReason?: string;
}

export type PickupWindowStatus = "NORMAL" | "DUE_SOON" | "URGENT" | "EXPIRED";

export interface BorrowRequest {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userClearance: string;
  projectId?: string;
  projectName?: string;
  note?: string;
  expectedReturnDate: string;
  // Multi-dimensional state fields
  decisionStatus: RequestDecisionStatus;
  handoverStatus: RequestHandoverStatus;
  lifecycleStatus: RequestLifecycleStatus;
  // Derived / compound display status
  status: RequestStatus;
  items: RequestLineItem[];
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  decisionNotes?: string;
  rejectionReason?: string;
  flagged?: boolean;
  flagReason?: string;
  pickupDeadline?: string; // 48h window from approval
  pickupStatus?: PickupWindowStatus;
  timeline: {
    status: string;
    timestamp: string;
    description: string;
    actor?: string;
  }[];
}

export interface CreateBorrowRequestPayload {
  note?: string;
  expectedReturnDate: string;
  items: {
    itemId: string;
    quantity: number;
  }[];
}

export function getRequestDisplayStatus(req: {
  lifecycleStatus?: RequestLifecycleStatus;
  handoverStatus?: RequestHandoverStatus;
  decisionStatus?: RequestDecisionStatus;
  status?: RequestStatus;
}): RequestStatus {
  if (req.lifecycleStatus === "CANCELLED") return "CANCELLED";
  if (req.lifecycleStatus === "EXPIRED") return "EXPIRED";
  if (req.handoverStatus === "HANDED_OVER") return "HANDED_OVER";
  if (req.decisionStatus === "APPROVED") return "APPROVED";
  if (req.decisionStatus === "PARTIALLY_APPROVED") return "PARTIALLY_APPROVED";
  if (req.decisionStatus === "REJECTED") return "REJECTED";
  if (req.status) return req.status;
  return "PENDING";
}
