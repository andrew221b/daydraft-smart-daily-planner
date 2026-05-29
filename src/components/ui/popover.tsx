import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // iOS-style popover: scale 0.95 → 1 plus a subtle slide *from* the
      // trigger edge so the popover feels physically anchored. Faster than
      // a sheet (180ms) — popovers are micro-surfaces and lingering animation
      // feels sluggish. Closing snaps off in 140ms with a steeper easing.
      className={cn(
        "z-50 w-72 rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none will-change-transform",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
        "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
        "data-[state=open]:duration-[180ms] data-[state=closed]:duration-[140ms]",
        "data-[state=open]:[animation-timing-function:cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:[animation-timing-function:cubic-bezier(0.4,0,0.4,1)]",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
