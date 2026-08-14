/**
 * svgCharts.ts — TS-generated inline-SVG charts for the Dark Executive
 * Report (v6). Replaces the former matplotlib chart farm (charts.py) — the
 * whole render path is now pure TypeScript.
 *
 * Chart language (deliberately small):
 *   · horizontal grouped bar clusters (one cluster per engine)
 *   · one 100% stacked horizontal share bar
 *   · tiny inline share bars for ranked tables
 * v6 marks are strictly rectangular — thin (≤12px), hard-edged, separated by
 * 2px surface gaps; no rounded ends anywhere (rounded caps read as widget
 * chrome). Every bar carries a direct value label, so no gridlines beyond a
 * single hairline baseline are needed. Fonts are inherited from the page CSS
 * ("Segoe UI"); all text uses text tokens (white / grey), never the series
 * color.
 */

const GREY = '#9CA3AF'
const LINE = '#262633'
const WHITE = '#FFFFFF'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface ClusterBar {
  /** Percent value 0..100, or null for "not measured". */
  value: number | null
  color: string
  /**
   * Direct label at the bar's tip. v7 passes the COUNT behind the bar
   * ("2/10") so no chart ever shows a percentage without its denominator;
   * omitted, the bar falls back to its own percentage.
   */
  label?: string
}

export interface Cluster {
  /** Cluster caption (engine name), set above the bars. */
  label: string
  bars: ClusterBar[]
}

export interface GroupedBarOptions {
  width: number
  /** Bar thickness in px (≤10 keeps the marks thin). */
  barH?: number
  /** Gap between bars of one cluster (2px surface gap). */
  barGap?: number
  /** Vertical space between clusters. */
  clusterGap?: number
  /** Label for missing values (localized "n/a"). */
  naLabel: string
  /** Fixed scale maximum (default 100 → comparable across pages). */
  max?: number
}

const fmtPct = (v: number): string => `${Math.round(v * 10) / 10}%`

/**
 * Horizontal grouped bar clusters — the v5 signature chart. One cluster per
 * engine; each bar direct-labeled at its tip. Single hairline baseline at 0,
 * no gridlines, fixed 0..max scale.
 */
export function groupedBarSvg(clusters: Cluster[], opts: GroupedBarOptions): string {
  const W = opts.width
  const barH = opts.barH ?? 9
  const barGap = opts.barGap ?? 2
  const clusterGap = opts.clusterGap ?? 15
  const max = opts.max ?? 100
  const labelH = 14 // cluster caption line
  const labelReserve = 44 // right-side room for the widest value label
  const plotW = W - labelReserve

  let y = 0
  const parts: string[] = []
  for (const c of clusters) {
    // cluster caption — caption token, grey, small caps feel via CSS class
    parts.push(
      `<text x="0" y="${y + 9}" class="sv-cap">${esc(c.label.toUpperCase())}</text>`,
    )
    let by = y + labelH
    for (const b of c.bars) {
      const cy = by + barH / 2 + 3
      if (b.value === null) {
        parts.push(
          `<text x="0" y="${cy}" class="sv-na">${esc(b.label ?? opts.naLabel)}</text>`,
        )
      } else if (b.value <= 0) {
        parts.push(
          `<rect x="0" y="${by}" width="2" height="${barH}" fill="${LINE}"/>`,
          `<text x="7" y="${cy}" class="sv-na">${esc(b.label ?? '0%')}</text>`,
        )
      } else {
        const w = Math.max(2.5, (Math.min(b.value, max) / max) * plotW)
        parts.push(
          `<rect x="0" y="${by}" width="${w.toFixed(2)}" height="${barH}" fill="${b.color}"/>`,
          `<text x="${(w + 6).toFixed(2)}" y="${cy}" class="sv-val">${esc(
            b.label ?? fmtPct(b.value),
          )}</text>`,
        )
      }
      by += barH + barGap
    }
    y = by - barGap + clusterGap
  }
  const H = Math.max(0, y - clusterGap + 2)
  // single vertical baseline hairline at x=0
  const baseline = `<line x1="0.5" y1="0" x2="0.5" y2="${H}" stroke="${LINE}" stroke-width="1"/>`
  return svgWrap(W, H, baseline + parts.join(''))
}

export interface StackSlice {
  label: string
  value: number
  color: string
  /** In-segment text; defaults to the segment's rounded share. */
  inLabel?: string
}

/**
 * One horizontal 100%-stacked share bar (thin), 2px surface gaps between
 * segments. In-segment % labels only where they comfortably fit; the legend
 * (rendered by the caller in HTML) carries the rest.
 */
export function stackedShareSvg(slices: StackSlice[], width: number): string {
  const H = 18
  const gap = 2
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return svgWrap(width, H, '')
  const usable = width - gap * (slices.length - 1)
  let x = 0
  const parts: string[] = []
  slices.forEach((sl) => {
    const w = (sl.value / total) * usable
    parts.push(
      `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}" fill="${sl.color}"/>`,
    )
    const pct = (100 * sl.value) / total
    const label = sl.inLabel ?? `${Math.round(pct)}%`
    if (w >= 34) {
      const lum = relLum(sl.color)
      parts.push(
        `<text x="${(x + w / 2).toFixed(2)}" y="${H / 2 + 3.5}" text-anchor="middle" class="sv-in" fill="${
          lum > 0.45 ? '#0B0B12' : WHITE
        }">${esc(label)}</text>`,
      )
    }
    x += w + gap
  })
  return svgWrap(width, H, parts.join(''))
}

/** Tiny inline share bar for ranked tables (track + fill, no text). */
export function shareBarSvg(pct: number, width: number, color: string = GREY): string {
  const H = 5
  const w = Math.max(pct > 0 ? 2 : 0, (Math.min(pct, 100) / 100) * width)
  const track = `<rect x="0" y="0" width="${width}" height="${H}" fill="#16161F"/>`
  const fill = w > 0 ? `<rect x="0" y="0" width="${w.toFixed(2)}" height="${H}" fill="${color}"/>` : ''
  return svgWrap(width, H, track + fill, 'display:inline-block;vertical-align:middle')
}

/** Relative luminance of a #rrggbb hex (for in-segment label ink choice). */
function relLum(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const f = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255)
}

function svgWrap(w: number, h: number, inner: string, extraStyle = ''): string {
  // Text classes are styled from the page CSS so charts share the report's
  // exact type tokens. shape-rendering default keeps the rounded ends crisp.
  return (
    `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `style="max-width:100%;height:auto;display:block;overflow:visible;${extraStyle}" ` +
    `xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
  )
}
