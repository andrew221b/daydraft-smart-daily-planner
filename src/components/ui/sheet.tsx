import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      // Backdrop appears slightly before the sheet lands,
      // but lingers well after the sheet starts exiting.
      "fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-[400ms] data-[state=closed]:duration-[400ms] data-[state=open]:[animation-timing-function:cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:[animation-timing-function:cubic-bezier(0.32,0.72,0,1)]",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  // Spring-physics motion — mirrors UIKit's high-stiffness spring:
  // Both open and close use the iOS standard curve for smooth, native-like floating windows.
  "fixed z-50 gap-4 bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-[500ms] data-[state=closed]:duration-[400ms] data-[state=open]:[animation-timing-function:cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:[animation-timing-function:cubic-bezier(0.32,0.72,0,1)] will-change-transform",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          // zoom-in-[0.97]: sheet scales from 0.97→1 while rising — gives the
          // feeling that it's "arriving" from depth, not just sliding up.
          // md+ (iPad): centre and cap the width, and add margin/rounding so it
          // reads as an intentional floating modal column instead of a full-bleed strip.
          "inset-x-0 bottom-0 md:mb-6 md:mx-auto md:max-w-[540px] md:rounded-[28px] md:border md:shadow-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=open]:zoom-in-[0.97]",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Hide the default "X" close affordance in the top-right corner. Use this
   *  when the sheet already has its own Cancel/Done header so the X would be
   *  redundant. Defaults to false to preserve behaviour for existing sheets. */
  hideClose?: boolean;
}

let bottomSheetCount = 0;

function SheetStackEffect() {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const el = ref.current?.closest('[data-sheet-side="bottom"]');
    if (!el) return;

    let isCounted = false;

    const update = () => {
      const state = el.getAttribute("data-state");
      if (state === "open" && !isCounted) {
        bottomSheetCount++;
        if (bottomSheetCount === 1) document.body.classList.add("bottom-sheet-open");
        isCounted = true;
      } else if (state === "closed" && isCounted) {
        bottomSheetCount--;
        if (bottomSheetCount === 0) document.body.classList.remove("bottom-sheet-open");
        isCounted = false;
      }
    };

    update(); // initial state

    const obs = new MutationObserver(() => update());
    obs.observe(el, { attributes: true, attributeFilter: ["data-state"] });

    return () => {
      obs.disconnect();
      if (isCounted) {
        bottomSheetCount--;
        if (bottomSheetCount === 0) document.body.classList.remove("bottom-sheet-open");
      }
    };
  }, []);

  return <span ref={ref} style={{ display: "none" }} aria-hidden />;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  (
    {
      side = "right",
      className,
      children,
      hideClose = false,
      style,
      onPointerDownOutside,
      onInteractOutside,
      ...props
    },
    ref,
  ) => {
    // Bottom sheets: slide above the soft keyboard AND clear the home-indicator
    // safe area so the last action row is never clipped on modern iPhones.
    // Formula: safe-area (≈34px on Face ID phones, 0 elsewhere) + keyboard inset
    // + 8px breathing room on top of the sheet's base p-6 padding.
    // The per-sheet `style` prop merges on top so individual sheets can still
    // override paddingBottom (e.g. AskAiSheet manages its own swipe-aware
    // transition).
    // On Android with adjustPan the OS pans the window to show the focused
    // input — no CSS keyboard-inset padding needed. Adding it would doubly
    // shift content and create a large empty gap. On iOS / web the inset
    // padding is the only mechanism, so keep it there.
    const isNativeAndroid =
      side === "bottom" &&
      typeof document !== "undefined" &&
      document.documentElement.hasAttribute("data-capacitor-android");
    const kbStyle: React.CSSProperties =
      side === "bottom"
        ? isNativeAndroid
          ? { paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }
          : {
              paddingBottom: "max(calc(24px + env(safe-area-inset-bottom)), calc(var(--keyboard-inset, 0px) + 12px))",
              transition: "padding-bottom 220ms cubic-bezier(0.32, 0.72, 0, 1)",
            }
        : {};

    // iOS WKWebView fires a synthetic pointer event OUTSIDE the sheet content
    // whenever the soft keyboard opens. Without this guard, Radix treats that
    // event as "user tapped outside → close dialog" — the sheet dismisses the
    // moment the user taps an input. We prevent that ONLY when the keyboard is
    // actually open (data-keyboard-open on <html>), so normal outside-tap
    // dismiss still works when the keyboard is hidden.
    const handlePointerDownOutside = React.useCallback(
      (e: CustomEvent) => {
        if (document.documentElement.hasAttribute("data-keyboard-open")) {
          e.preventDefault();
          return;
        }
        (onPointerDownOutside as ((e: CustomEvent) => void) | undefined)?.(e);
      },
      [onPointerDownOutside],
    );

    const handleInteractOutside = React.useCallback(
      (e: CustomEvent) => {
        if (document.documentElement.hasAttribute("data-keyboard-open")) {
          e.preventDefault();
          return;
        }
        (onInteractOutside as ((e: CustomEvent) => void) | undefined)?.(e);
      },
      [onInteractOutside],
    );

    return (
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
          ref={ref}
          data-sheet-side={side}
          className={cn(sheetVariants({ side }), className)}
          style={{ ...kbStyle, ...style }}
          onPointerDownOutside={handlePointerDownOutside as React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>["onPointerDownOutside"]}
          onInteractOutside={handleInteractOutside as React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>["onInteractOutside"]}
          {...props}
        >
          {side === "bottom" && <SheetStackEffect />}
          {children}
          {!hideClose && (
            <SheetPrimitive.Close className="absolute right-4 top-4 z-50 p-3 -m-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full opacity-70 ring-offset-background transition-[opacity,background-color] data-[state=open]:bg-secondary hover:opacity-100 hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
