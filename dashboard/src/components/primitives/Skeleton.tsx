/**
 * Shimmer skeletons — shown ONLY on genuinely first-ever loads (react-query
 * `isLoading`, i.e. no cached data at all). Cached tab switches never render
 * these; they crossfade straight to data.
 */

/** Single shimmer bar. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return <div aria-hidden className={`shimmer ${className}`} style={style} />
}

/**
 * Standard first-load placeholder for a tab panel or card body: a few
 * staggered shimmer lines inside the panel's own silhouette.
 */
export function PanelSkeleton({
  lines = 4,
  className = 'h-64',
  framed = false,
}: {
  lines?: number
  /** Height utility (and any extras) for the block. */
  className?: string
  /** Wrap in a card frame — for full-page/tab placeholders outside a Card. */
  framed?: boolean
}) {
  const frame = framed ? 'rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-6' : ''
  return (
    <div
      aria-hidden
      aria-busy="true"
      className={`flex flex-col justify-center gap-3.5 ${frame} ${className}`}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3.5"
          style={{ width: `${88 - ((i * 23) % 55)}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  )
}
