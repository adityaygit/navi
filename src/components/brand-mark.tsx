/** The Navi logo mark (PNG, white on transparent). Static brand placements only; live status uses <Stone>. */
export function BrandMark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/navi-mark.png" alt="" aria-hidden="true" width={Math.round(size * 1.36)} height={size} className={`shrink-0 object-contain ${className}`} style={{ width: Math.round(size * 1.36), height: size }} />
  );
}
