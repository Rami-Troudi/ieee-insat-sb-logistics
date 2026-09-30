import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs active:scale-[0.98]",
        secondary:
          "border border-primary/30 text-primary bg-card hover:bg-surface-subtle shadow-xs active:scale-[0.98]",
        outline:
          "border border-border bg-card text-foreground hover:bg-muted hover:text-foreground active:scale-[0.98]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs active:scale-[0.98]",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        scanner:
          "bg-brand-cyan text-brand-navy font-bold hover:bg-brand-cyan/90 shadow-sm active:scale-[0.98]",
      },
      size: {
        default: "min-h-[44px] h-11 sm:h-10 sm:min-h-[40px] px-4 py-2",
        sm: "min-h-[44px] sm:min-h-[36px] sm:h-9 rounded-md px-3 text-xs",
        lg: "min-h-[44px] h-12 sm:h-11 rounded-md px-8 text-base",
        icon: "h-11 w-11 min-w-[44px] min-h-[44px] sm:h-10 sm:w-10 sm:min-w-[40px] sm:min-h-[40px] rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
