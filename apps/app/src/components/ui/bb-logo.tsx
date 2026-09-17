import { cn } from "@bb/shared-ui/lib/utils";
import arcGlyphUrl from "../../../../../assets/arc-glyph.svg";

// Small Arc Agent glyph used beside built-in rows and provenance pills.
// (Component name is historical; it now renders the Arc glyph.)
export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={arcGlyphUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}
