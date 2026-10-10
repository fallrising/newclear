import { Toaster as Sonner, toast } from "sonner";

/** One per app, next to the router (U-04). Colours come from the tokens, not from a theme provider. */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{ className: "border bg-surface text-foreground", style: { fontFamily: "var(--font-body)" } }}
    />
  );
}

export { toast };
