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
      {/* IEEE Official Mark — SVG from ieee.tn */}
      <div className="flex-shrink-0 flex items-center justify-center">
        {isDark ? (
          <img
            src="/assets/ieee_mb.svg"
            alt="IEEE"
            className="h-5 w-auto object-contain"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        ) : (
          <img
            src="/assets/ieee_mb_blue.svg"
            alt="IEEE"
            className="h-5 w-auto object-contain"
          />
        )}
      </div>

      {/* Brand Hierarchy: IEEE INSAT SB / Equipment Reservations */}
      <div className="flex flex-col text-left">
        <span
          className={cn(
            "text-sm font-bold tracking-tight leading-tight",
            isDark ? "text-white" : "text-foreground"
          )}
        >
          INSAT Student Branch
        </span>
        <span
          className={cn(
            "text-[11px] leading-tight",
            isDark ? "text-white/70" : "text-muted-foreground"
          )}
        >
          Equipment Reservations
        </span>
      </div>
    </Link>
  );
};
