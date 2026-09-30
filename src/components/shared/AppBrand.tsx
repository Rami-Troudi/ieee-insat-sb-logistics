import React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface AppBrandProps {
  className?: string;
  to?: string;
  isDark?: boolean;
}

export const AppBrand: React.FC<AppBrandProps> = ({ className, to = "/app", isDark = false }) => {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md group transition-opacity hover:opacity-95 select-none",
        className
      )}
      aria-label="IEEE INSAT Student Branch Equipment Reservations"
    >
      {/* Official IEEE INSAT Student Branch Logo */}
      <div className="flex-shrink-0 flex items-center justify-center">
        <img
          src={isDark ? "/assets/ieee_insat_logo_white.png" : "/assets/ieee_insat_logo.png"}
          alt="IEEE INSAT Student Branch"
          className="h-8 w-auto object-contain max-w-[145px]"
        />
      </div>

      <div className={cn("flex flex-col text-left border-l pl-2", isDark ? "border-white/20" : "border-border")}>
        <span
          className={cn(
            "text-xs font-bold tracking-tight leading-tight",
            isDark ? "text-white" : "text-foreground"
          )}
        >
          Logistics
        </span>
        <span
          className={cn(
            "text-[10px] leading-tight",
            isDark ? "text-white/70" : "text-muted-foreground"
          )}
        >
          Equipment
        </span>
      </div>
    </Link>
  );
};
