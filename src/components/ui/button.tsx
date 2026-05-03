import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,box-shadow,transform,filter] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.08)] hover:bg-primary/92 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_-2px_hsl(var(--primary)/0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_3px_rgba(0,0,0,0.2)] active:scale-[0.985]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-destructive/92 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-2px_hsl(var(--destructive)/0.35)] active:scale-[0.985]",
        outline:
          "border border-border/60 bg-background/55 text-foreground backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-accent/40 hover:border-border hover:text-accent-foreground dark:bg-background/40 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] active:scale-[0.985]",
        secondary:
          "border border-border/45 bg-secondary/80 text-secondary-foreground backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-secondary/92 hover:border-border/55 dark:bg-secondary/70 active:scale-[0.985]",
        ghost: "hover:bg-accent/50 hover:text-accent-foreground active:scale-[0.985]",
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
