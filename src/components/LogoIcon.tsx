import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders a custom logo image, falling back to the provided icon until the
 * image exists / loads successfully. Lets us swap a button's glyph for brand
 * art without breaking the UI if the asset is missing.
 */
export function LogoIcon({
  src,
  fallback,
  className,
  alt = "",
}: {
  src: string;
  fallback: ReactNode;
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
    />
  );
}
