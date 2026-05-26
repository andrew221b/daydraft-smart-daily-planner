import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // iOS-26 spring on release. y2=1.05 in the cubic-bezier is the *visible*
  // overshoot — enough that the button feels "alive" but not so much that
  // it looks rubbery. Press itself (active:scale-[0.965]) uses a separate
  // 110ms transition with a 60ms delay so a touch that turns into a scroll
  // never triggers the compression. Aligned with `.pressable` in index.css.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,box-shadow,transform,filter] duration-[200ms] ease-[cubic-bezier(0.25,0.46,0.45,1.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:transition-[transform,filter,background-color] active:duration-[110ms] active:delay-[60ms] active:ease-[cubic-bezier(0.25,0.46,0.45,0.94)] [-webkit-tap-highlight-color:transparent] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // iOS 26 buttons: press compresses to ~0.965, brightness dims, and
        // the spring-back is timed in the transition above. Hover is kept
        // (for keyboard / pointer users) but no longer the primary feedback.
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.08)] hover:bg-primary/92 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_22px_-12px_hsl(var(--primary)/0.55)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_3px_rgba(0,0,0,0.2)] active:scale-[0.965] active:brightness-95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-destructive/92 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-2px_hsl(var(--destructive)/0.35)] active:scale-[0.965] active:brightness-95",
        outline:
          "border border-soft bg-background/55 text-foreground backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-accent/40 hover:border-strong hover:text-accent-foreground dark:bg-background/40 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-[0.965] active:bg-accent/60",
        secondary:
          "border border-soft bg-secondary/80 text-secondary-foreground backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-secondary/92 hover:border-strong dark:bg-secondary/70 active:scale-[0.965] active:bg-secondary",
        ghost: "hover:bg-accent/50 hover:text-accent-foreground active:scale-[0.965] active:bg-accent/55",
        link: "text-primary underline-offset-4 hover:underline shadow-none",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
