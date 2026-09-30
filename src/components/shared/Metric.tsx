import React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface MetricProps {
  label: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  variant?: "default" | "warning" | "danger" | "success" | "secondary";
  className?: string;
}

export const Metric: React.FC<MetricProps> = ({
  label,
  value,
  description,
  icon: Icon,
  variant = "default",
  className,
}) => {
  const variantStyles = {
    default: {
      container: "border-border bg-card",
      text: "text-foreground",
      icon: "text-primary",
    },
    warning: {
      container: "border-amber-500/30 bg-amber-500/5",
      text: "text-amber-600",
      icon: "text-amber-500",
    },
    danger: {
      container: "border-destructive/30 bg-destructive/5",
      text: "text-destructive",
      icon: "text-destructive",
    },
    success: {
      container: "border-[hsl(var(--success))]/30 bg-[hsl(var(--success-surface))]",
      text: "text-[hsl(var(--success))]",
      icon: "text-[hsl(var(--success))]",
    },
    secondary: {
      container: "border-secondary/30 bg-secondary/5",
      text: "text-secondary",
      icon: "text-secondary",
    },
  };

  const style = variantStyles[variant];

  return (
    <div
      className={cn(
        "p-4 rounded-xl border space-y-1 shadow-sm transition-all",
        style.container,
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
          {label}
        </span>
        {Icon && <Icon className={cn("w-4 h-4", style.icon)} />}
      </div>
      <div className={cn("text-2xl font-bold tracking-tight", style.text)}>{value}</div>
      {description && (
        <p className="text-[11px] text-muted-foreground leading-tight">{description}</p>
      )}
    </div>
  );
};
