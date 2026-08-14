import { Download, ExternalLink } from 'lucide-react'

const linkClass =
  'inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8A8A93] transition-colors duration-150 hover:text-white'

/**
 * PagePreviewCard — landing-page tile with a scaled-down live preview. The
 * iframe renders the real page at 4× the card width and scales to 25%,
 * fully sandboxed and inert (clicks fall through to the overlay link, which
 * opens the page in a new tab). Used by the Generated Files gallery and the
 * Landing Pages tab so both always share the same working preview.
 */
export function PagePreviewCard({
  url,
  title,
  subtitle,
  downloadUrl,
  downloadName,
  index = 0,
}: {
  /** Absolute URL of the page (also the preview + open target). */
  url: string
  title: string
  /** Small gray line under the title (date, path, …). */
  subtitle?: string
  /** Optional explicit download href; defaults to the page URL. */
  downloadUrl?: string
  downloadName?: string
  index?: number
}) {
  return (
    <div
      className="tile stagger-item overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${title}`}
        className="relative block aspect-[16/10] overflow-hidden rounded-t-[13px] border-b border-[#16161A] bg-[#0E0E11]"
      >
        <iframe
          src={url}
          title={`Preview of ${title}`}
          loading="lazy"
          sandbox=""
          tabIndex={-1}
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left border-0"
          style={{ transform: 'scale(0.25)' }}
        />
        {/* Click shield: keeps the whole preview a single open-in-new-tab hit area. */}
        <span className="absolute inset-0" />
      </a>
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[#C9C9D1]" title={title}>
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 truncate text-[11px] tabular-nums text-[#5C5C66]" title={subtitle}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={downloadUrl ?? url}
            download={downloadName}
            className={linkClass}
            aria-label={`Download ${title}`}
          >
            <Download size={14} strokeWidth={1.5} />
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
            aria-label={`Open ${title} full size`}
          >
            <ExternalLink size={14} strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </div>
  )
}
