import React from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  AlertTriangle,
  Info,
  RotateCcw,
} from "lucide-react";

export type DomainStatus =
  | "PENDING"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "WAITING"
  | "HANDED_OVER"
  | "ACTIVE"
  | "CLOSED"
  | "RETURNED"
  | "PARTIALLY_RETURNED"
  | "RETURN_REQUESTED"
  | "AVAILABLE"
  | "BORROWED"
  | "DAMAGED"
  | "MAINTENANCE"
  | "LOST"
  | "RETIRED"
  | "DUE_SOON"
  | "OVERDUE"
  | "COMPLETED"
  | string;

export interface StatusConfigItem {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  badgeClass?: string;
}

export const STATUS_CONFIG: Record<string, StatusConfigItem> = {
  // --- 1. Pending (Neutral / Slate) ---
  PENDING: {
    label: "Pending",
    variant: "pending",
    icon: Clock,
    iconClass: "text-[#667085]",
  },
  WAITING: {
    label: "Waiting Handover",
    variant: "pending",
    icon: Clock,
    iconClass: "text-[#667085]",
  },

  // --- 2. Approved (IEEE Blue #00629B) ---
  APPROVED: {
    label: "Approved",
    variant: "approved",
    icon: CheckCircle2,
    iconClass: "text-[#00629b]",
  },
  PARTIALLY_APPROVED: {
    label: "Partially Approved",
    variant: "approved",
    icon: CheckCircle2,
    iconClass: "text-[#00629b]",
  },

  // --- 3. Borrowed / Active (INSAT Violet #981D97) ---
  ACTIVE: {
    label: "Borrowed",
    variant: "borrowed",
    icon: Info,
    iconClass: "text-[#981d97]",
  },
  BORROWED: {
    label: "Borrowed",
    variant: "borrowed",
    icon: Info,
    iconClass: "text-[#981d97]",
  },
  HANDED_OVER: {
    label: "Handed Over",
    variant: "borrowed",
    icon: CheckCircle2,
    iconClass: "text-[#981d97]",
  },

  // --- 4. Returned / Completed (Green #00843D) ---
  RETURNED: {
    label: "Returned",
    variant: "returned",
    icon: CheckCircle2,
    iconClass: "text-[#00843d]",
  },
  COMPLETED: {
    label: "Completed",
    variant: "returned",
    icon: CheckCircle2,
    iconClass: "text-[#00843d]",
  },
  AVAILABLE: {
    label: "Available",
    variant: "returned",
    icon: CheckCircle2,
    iconClass: "text-[#00843d]",
  },

  // --- 5. Overdue / Danger (Red #BA0C2F) ---
  OVERDUE: {
    label: "Overdue",
    variant: "overdue",
    icon: AlertTriangle,
    iconClass: "text-[#ba0c2f]",
  },
  DAMAGED: {
    label: "Damaged",
    variant: "danger",
    icon: AlertCircle,
    iconClass: "text-[#ba0c2f]",
  },
  LOST: {
    label: "Lost",
    variant: "danger",
    icon: AlertCircle,
    iconClass: "text-[#ba0c2f]",
  },
  REJECTED: {
    label: "Declined",
    variant: "danger",
    icon: XCircle,
    iconClass: "text-[#ba0c2f]",
  },

  // --- 6. Cancelled / Muted Gray (#98A2B3) ---
  CANCELLED: {
    label: "Cancelled",
    variant: "pending",
    icon: XCircle,
    iconClass: "text-[#98a2b3]",
  },
  CLOSED: {
    label: "Closed",
    variant: "pending",
    icon: XCircle,
    iconClass: "text-[#98a2b3]",
  },
  EXPIRED: {
    label: "Expired",
    variant: "pending",
    icon: Clock,
    iconClass: "text-[#98a2b3]",
  },
  RETIRED: {
    label: "Retired",
    variant: "pending",
    icon: XCircle,
    iconClass: "text-[#98a2b3]",
  },

  // --- 7. Warnings / Transitions ---
  DUE_SOON: {
    label: "Due Soon",
    variant: "warning",
    icon: Clock,
    iconClass: "text-[#d97706]",
  },
  MAINTENANCE: {
    label: "Maintenance",
    variant: "warning",
    icon: AlertTriangle,
    iconClass: "text-[#d97706]",
  },
  PARTIALLY_RETURNED: {
    label: "Partially Returned",
    variant: "warning",
    icon: AlertTriangle,
    iconClass: "text-[#d97706]",
  },
  RETURN_REQUESTED: {
    label: "Return Requested",
    variant: "warning",
    icon: RotateCcw,
    iconClass: "text-[#d97706]",
  },
};

export interface StatusBadgeProps {
  status: DomainStatus;
  className?: string;
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className, showIcon = true }) => {
  const normalizedKey = (status || "").toUpperCase();
  const config = STATUS_CONFIG[normalizedKey] || {
    label: status ? status.replaceAll("_", " ") : "Unknown",
    variant: "outline" as const,
    icon: Info,
    iconClass: "text-muted-foreground",
  };

  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold select-none",
        config.badgeClass,
        className
      )}
    >
      {showIcon && <Icon className={cn("w-3.5 h-3.5 shrink-0 stroke-[2.25]", config.iconClass)} />}
      <span>{config.label}</span>
    </Badge>
  );
};
