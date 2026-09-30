import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground border-border bg-card",
        success: "border-[#b3e6c9] bg-[#e6f6ed] text-[#00843d]",
        warning: "border-amber-300 bg-amber-50 text-amber-800",
        danger: "border-[#f2b3c1] bg-[#fbe6eb] text-[#ba0c2f]",
        info: "border-[#b3d7ec] bg-[#e6f2f8] text-[#00629b]",
        // Semantic IEEE Reservation States
        pending: "border-[#d9e2e8] bg-[#eef3f6] text-[#667085]",
        approved: "border-[#b3d7ec] bg-[#e6f2f8] text-[#00629b]",
        borrowed: "border-[#e6bce6] bg-[#f7e8f7] text-[#981d97]",
        returned: "border-[#b3e6c9] bg-[#e6f6ed] text-[#00843d]",
        overdue: "border-[#f2b3c1] bg-[#fbe6eb] text-[#ba0c2f]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
