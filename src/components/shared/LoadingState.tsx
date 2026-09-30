import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  variant?: "table" | "cards" | "section" | "list";
  count?: number;
  message?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  variant = "section",
  count = 3,
  message,
  className,
}) => {
  if (variant === "table") {
    return (
      <div className={cn("rounded-lg border border-border bg-card p-4 space-y-3", className)}>
        {message && <p className="text-xs text-muted-foreground animate-pulse">{message}</p>}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/6" />
        </div>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-1/4" />
            <Skeleton className="h-5 w-1/6" />
            <Skeleton className="h-5 w-16 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className="space-y-3">
        {message && <p className="text-xs text-muted-foreground animate-pulse">{message}</p>}
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", className)}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-card space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-5/6" />
              <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className={cn("space-y-2", className)}>
        {message && <p className="text-xs text-muted-foreground animate-pulse">{message}</p>}
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
          >
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="space-y-1 flex-1">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-4 w-12 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  // default: section loading
  return (
    <div className={cn("p-6 rounded-xl border border-border bg-card space-y-4", className)}>
      {message && (
        <p className="text-xs font-medium text-muted-foreground animate-pulse">{message}</p>
      )}
      <div className="space-y-2">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-2 pt-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
};

export const LoadingSkeleton = LoadingState;
