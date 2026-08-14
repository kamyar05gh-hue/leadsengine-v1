/**
 * charts.ts — PDFKit vector primitives for the AI-visibility intelligence
 * dossier (template.ts).
 *
 * Design system: pure vector, Helvetica/Helvetica-Bold only, dark ground
 * (#000), card surfaces (#101014), thin rules, generous negative space.
 * Every primitive takes TOP-DOWN page points (y grows downward) and the
 * top-left corner of its bounding box; measurements are done in mm via MM.
 *
 * Primitives:
 *   chip           — pill badge (outline or filled), returns consumed width
 *   deltaChip      — ▲/▼ delta pill drawn with vector triangles (no glyphs)
 *   statTile       — KPI tile: dot + micro label, big value, sub line
 *   sectionHead    — in-page section marker: accent tick, spaced title, rule
 *   heatMatrix     — rows × cols matrix, cells color-interpolated CARD→accent
 *   segmentedBand  — proportional horizontal band (sentiment, citation mix)
 *   sparkline      — thin polyline with end dot
 *   steppedLadder  — stair-step ascent chart (geo tiers)
 *   pipeline       — n-node gate diagram with chevron connectors
 *   rankedBars     — leaderboard rows: rank medal, name, track bar, value
 *   ringGauge      — circular progress ring (hero index)
 *
 * groupedBarChart is kept verbatim — digest.ts renders with it.
 */
import type PDFDocument from 'pdfkit'

/** Points per millimetre — every measurement is done in mm. */
export const MM = 72 / 25.4

/** Shared Future Media dark theme — the single color source for the deck. */
export const THEME = {
  BG: '#000000',
  CARD: '#101014',
  PURPLE: '#A78BFA',
  LAVENDER: '#CECBF6',
  BLUE: '#38BDF8',
  GRAY: '#545454',
  LIGHT: '#A6A6A6',
  WHITE: '#FFFFFF',
  FAINT: '#3A3A45',
  RED: '#F87171',
  GREEN: '#34D399',
} as const

type Doc = InstanceType<typeof PDFDocument>

// ─── Color math ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(n: number): string {
  return Math.round(Math.min(Math.max(n, 0), 255)).toString(16).padStart(2, '0')
}

/** Linear mix between two hex colors, t ∈ [0,1]. */
export function mixColor(a: string, b: string, t: number): string {
  const ta = hexToRgb(a)
  const tb = hexToRgb(b)
  const k = Math.min(Math.max(t, 0), 1)
  return `#${toHex(ta[0] + (tb[0] - ta[0]) * k)}${toHex(ta[1] + (tb[1] - ta[1]) * k)}${toHex(ta[2] + (tb[2] - ta[2]) * k)}`
}

/** Heat-cell fill: CARD → PURPLE/BLUE, perceptually eased so low values
 * still separate from the empty surface. */
export function heatColor(t: number, tone: 'purple' | 'blue' = 'purple'): string {
  const target = tone === 'blue' ? THEME.BLUE : THEME.PURPLE
  return mixColor(THEME.CARD, target, Math.pow(Math.min(Math.max(t, 0), 1), 0.72))
}

// ─── Atoms ──────────────────────────────────────────────────────────────────

export interface ChipOpts {
  /** Text + border/dot color. */
  color?: string
  /** Filled pill instead of outline. */
  fill?: string
  size?: number
  bold?: boolean
  /** Leading status dot in `color`. */
  dot?: boolean
}

/** Pill badge. Draws at (x, y) top-left, returns the width consumed so
 * callers can pack chips horizontally. Height = size + 5.5pt. */
export function chip(doc: Doc, x: number, y: number, text: string, opts: ChipOpts = {}): number {
  const size = opts.size ?? 6.5
  const color = opts.color ?? THEME.LIGHT
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
  const tw = doc.widthOfString(text)
  const h = size + 5.5
  const dotW = opts.dot ? size + 1 : 0
  const w = tw + 11 + dotW
  if (opts.fill) {
    doc.roundedRect(x, y, w, h, h / 2).fill(opts.fill)
  } else {
    doc.save().lineWidth(0.6).roundedRect(x, y, w, h, h / 2).stroke(THEME.FAINT).restore()
  }
  if (opts.dot) doc.circle(x + 6.5, y + h / 2, size * 0.28 + 0.8).fill(color)
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .fillColor(color)
    .text(text, x + 5.5 + dotW, y + (h - size) / 2 - 0.8, { lineBreak: false })
  return w
}

/** Delta pill: vector ▲ (green) / ▼ (red) + signed value. Triangle is drawn
 * as a polygon — ▲/▼ glyphs sit outside Helvetica's WinAnsi set. */
export function deltaChip(doc: Doc, x: number, y: number, delta: number, suffix = ' pt'): number {
  const up = delta >= 0
  const col = up ? THEME.GREEN : THEME.RED
  const text = `${up ? '+' : '-'}${Math.abs(delta).toFixed(1)}${suffix}`
  doc.font('Helvetica-Bold').fontSize(6.5)
  const tw = doc.widthOfString(text)
  const h = 12
  const w = tw + 19
  doc.save().lineWidth(0.6).roundedRect(x, y, w, h, h / 2).stroke(THEME.FAINT).restore()
  const cx = x + 8.5
  const cy = y + h / 2
  if (up) doc.polygon([cx - 2.8, cy + 2], [cx + 2.8, cy + 2], [cx, cy - 2.4]).fill(col)
  else doc.polygon([cx - 2.8, cy - 2], [cx + 2.8, cy - 2], [cx, cy + 2.4]).fill(col)
  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(col)
    .text(text, x + 13.5, y + (h - 6.5) / 2 - 0.8, { lineBreak: false })
  return w
}

export interface StatTileSpec {
  label: string
  value: string
  sub?: string
  accent?: string
}

/** KPI tile: card surface, colored status dot + spaced micro label on top,
 * large value, optional sub line pinned to the bottom. */
export function statTile(doc: Doc, x: number, y: number, w: number, h: number, t: StatTileSpec): void {
  doc.roundedRect(x, y, w, h, 5).fill(THEME.CARD)
  const pad = 4 * MM
  doc.circle(x + pad + 1.6, y + pad + 2.2, 1.7).fill(t.accent ?? THEME.PURPLE)
  doc
    .font('Helvetica')
    .fontSize(6.3)
    .fillColor(THEME.LIGHT)
    .text(t.label.toUpperCase(), x + pad + 7, y + pad - 0.5, {
      width: w - 2 * pad - 7,
      lineBreak: false,
      characterSpacing: 0.7,
    })
  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(THEME.WHITE)
    .text(t.value, x + pad, y + pad + 4.6 * MM, { width: w - 2 * pad, lineBreak: false })
  if (t.sub) {
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(THEME.GRAY)
      .text(t.sub, x + pad, y + h - 5.4 * MM, { width: w - 2 * pad, lineBreak: false })
  }
}

/** In-page section marker: accent tick, letter-spaced bold title, thin rule
 * filling the rest of the row. Returns the y where content starts. */
export function sectionHead(doc: Doc, x: number, y: number, w: number, title: string, accent: string = THEME.PURPLE): number {
  doc.rect(x, y + 0.6, 2.4, 8).fill(accent)
  doc.font('Helvetica-Bold').fontSize(8)
  const label = title.toUpperCase()
  const tw = doc.widthOfString(label, { characterSpacing: 1.1 })
  doc.fillColor(THEME.WHITE).text(label, x + 7, y + 1.2, { lineBreak: false, characterSpacing: 1.1 })
  const ruleX = x + 7 + tw + 10
  if (ruleX < x + w) {
    doc
      .save()
      .lineWidth(0.5)
      .moveTo(ruleX, y + 4.6)
      .lineTo(x + w, y + 4.6)
      .stroke(THEME.FAINT)
      .restore()
  }
  return y + 7 * MM
}

// ─── Matrices & bands ───────────────────────────────────────────────────────

export interface HeatMatrixOpts {
  rowLabels: readonly string[]
  colLabels: readonly string[]
  /** rows × cols; null = no data (renders an empty cell with an em dash). */
  values: ReadonlyArray<ReadonlyArray<number | null>>
  fmt?: (v: number) => string
  tone?: 'purple' | 'blue'
  labelW?: number
  cellH?: number
  /** Normalization ceiling; defaults to the matrix max (min 1). */
  max?: number
}

/** Heat matrix — color-interpolated cells CARD→accent by value. Returns the
 * y below the matrix. */
export function heatMatrix(doc: Doc, x: number, y: number, w: number, opts: HeatMatrixOpts): number {
  const { rowLabels, colLabels, values } = opts
  const labelW = opts.labelW ?? 34 * MM
  const cellH = opts.cellH ?? 9 * MM
  const fmt = opts.fmt ?? ((v: number) => `${v.toFixed(1)}%`)
  const tone = opts.tone ?? 'purple'
  const cols = colLabels.length
  const cellW = (w - labelW) / Math.max(cols, 1)
  const flat = values.flat().filter((v): v is number => v !== null)
  const max = opts.max ?? Math.max(...flat, 1)

  // column headers
  doc.font('Helvetica').fontSize(6.5).fillColor(THEME.LIGHT)
  colLabels.forEach((c, j) => {
    doc.text(c.toUpperCase(), x + labelW + j * cellW, y, {
      width: cellW,
      align: 'center',
      lineBreak: false,
      characterSpacing: 0.5,
    })
  })
  let cy = y + 5 * MM
  rowLabels.forEach((r, i) => {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(THEME.LIGHT)
      .text(r, x, cy + cellH / 2 - 4.5, { width: labelW - 6, lineBreak: false })
    for (let j = 0; j < cols; j++) {
      const v = values[i]?.[j] ?? null
      const cx = x + labelW + j * cellW
      if (v === null) {
        doc.roundedRect(cx + 1, cy + 1, cellW - 2, cellH - 2, 2.5).fill(THEME.CARD)
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(THEME.GRAY)
          .text('—', cx, cy + cellH / 2 - 4, { width: cellW, align: 'center', lineBreak: false })
      } else {
        const t = v / max
        doc.roundedRect(cx + 1, cy + 1, cellW - 2, cellH - 2, 2.5).fill(heatColor(t, tone))
        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor(t > 0.55 ? THEME.BG : THEME.WHITE)
          .text(fmt(v), cx, cy + cellH / 2 - 4.2, { width: cellW, align: 'center', lineBreak: false })
      }
    }
    cy += cellH
  })
  return cy
}

export interface BandSegment {
  label: string
  value: number
  color: string
}

/** Proportional horizontal band with rounded ends; segments labelled inside
 * when wide enough, legend chips below when `legend`. Returns y below. */
export function segmentedBand(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  segments: readonly BandSegment[],
  legend = true,
): number {
  const total = segments.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return y
  doc.save()
  doc.roundedRect(x, y, w, h, h / 2).clip()
  let bx = x
  for (const seg of segments) {
    const bw = (w * seg.value) / total
    if (bw <= 0) continue
    doc.rect(bx, y, bw, h).fill(seg.color)
    bx += bw
  }
  doc.restore()
  // inside labels — only where the segment is wide enough to carry text
  bx = x
  for (const seg of segments) {
    const bw = (w * seg.value) / total
    const p = Math.round((100 * seg.value) / total)
    doc.font('Helvetica-Bold').fontSize(7.5)
    if (bw > doc.widthOfString(`${p}%`) + 10) {
      doc.fillColor(THEME.BG).text(`${p}%`, bx, y + h / 2 - 3.8, {
        width: bw,
        align: 'center',
        lineBreak: false,
      })
    }
    bx += bw
  }
  let ny = y + h + 3.5 * MM
  if (legend) {
    let lx = x
    for (const seg of segments) {
      const p = Math.round((100 * seg.value) / total)
      lx += chip(doc, lx, ny, `${seg.label} ${seg.value} (${p}%)`, { color: seg.color, dot: true }) + 6
    }
    ny += 8 * MM
  }
  return ny
}

/** Thin polyline sparkline with an end dot. Caller adds labels. */
export function sparkline(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  values: readonly number[],
  color: string = THEME.BLUE,
): void {
  if (values.length < 2) return
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1e-6)
  const px = (i: number) => x + (w * i) / (values.length - 1)
  const py = (v: number) => y + h - ((v - min) / span) * h
  doc.save().lineWidth(1.2).lineJoin('round').lineCap('round')
  doc.moveTo(px(0), py(values[0] ?? 0))
  values.forEach((v, i) => {
    if (i > 0) doc.lineTo(px(i), py(v))
  })
  doc.stroke(color).restore()
  const last = values[values.length - 1] ?? 0
  doc.circle(px(values.length - 1), py(last), 2.2).fill(color)
}

export interface LadderStep {
  label: string
  value: number
}

/** Stair-step ascent chart: one riser per step from a shared baseline, value
 * on top, label below, dashed line connecting the tops. */
export function steppedLadder(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  steps: readonly LadderStep[],
  maxValue?: number,
): void {
  const n = steps.length
  if (n === 0) return
  const slot = w / n
  const barW = Math.min(slot * 0.52, 22 * MM)
  const base = y + h - 7 * MM
  const topPad = 6 * MM
  const area = base - y - topPad
  const max = Math.max(maxValue ?? 0, ...steps.map((s) => s.value), 1)
  const tops: [number, number][] = []
  steps.forEach((s, i) => {
    const bx = x + i * slot + (slot - barW) / 2
    const bh = Math.max((area * s.value) / max, 1.6)
    const t = s.value / max
    doc.roundedRect(bx, base - bh, barW, bh, 2).fill(s.value > 0 ? mixColor(THEME.FAINT, THEME.PURPLE, Math.pow(t, 0.7)) : THEME.CARD)
    tops.push([bx + barW / 2, base - bh])
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(s.value > 0 ? THEME.WHITE : THEME.GRAY)
      .text(`${s.value.toFixed(1)}%`, x + i * slot, base - bh - 5 * MM, {
        width: slot,
        align: 'center',
        lineBreak: false,
      })
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(THEME.LIGHT)
      .text(s.label, x + i * slot, base + 2.2 * MM, { width: slot, align: 'center', lineBreak: false })
  })
  // dashed connector across the step tops
  doc.save().lineWidth(0.7).dash(2, { space: 2.5 })
  tops.forEach(([tx, ty], i) => {
    if (i === 0) doc.moveTo(tx, ty - 1.5)
    else doc.lineTo(tx, ty - 1.5)
  })
  doc.stroke(THEME.FAINT).undash().restore()
  // baseline
  doc.save().lineWidth(0.5).moveTo(x, base).lineTo(x + w, base).stroke(THEME.FAINT).restore()
}

// ─── Pipeline (gates) ───────────────────────────────────────────────────────

export type GateStatus = 'pass' | 'warn' | 'fail'

export const GATE_COLOR: Record<GateStatus, string> = {
  pass: THEME.GREEN,
  warn: THEME.BLUE,
  fail: THEME.RED,
}

export interface PipelineNode {
  kicker: string
  title: string
  value: string
  status: GateStatus
  statusLabel: string
  note: string
}

/** Horizontal n-node gate pipeline with chevron connectors. Node cards carry
 * a status strip, kicker, title, value, status chip and a wrapped note.
 * Returns the y below the diagram. */
export function pipeline(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  nodes: readonly PipelineNode[],
  nodeH = 46 * MM,
): number {
  const n = nodes.length
  if (n === 0) return y
  const gap = 7 * MM
  const nodeW = (w - gap * (n - 1)) / n
  nodes.forEach((node, i) => {
    const nx = x + i * (nodeW + gap)
    const col = GATE_COLOR[node.status]
    doc.roundedRect(nx, y, nodeW, nodeH, 5).fill(THEME.CARD)
    // status strip along the top edge, clipped to the card radius
    doc.save().roundedRect(nx, y, nodeW, nodeH, 5).clip()
    doc.rect(nx, y, nodeW, 2.2).fill(col)
    doc.restore()
    const pad = 4 * MM
    doc
      .font('Helvetica')
      .fontSize(6.3)
      .fillColor(THEME.LIGHT)
      .text(node.kicker.toUpperCase(), nx + pad, y + pad, {
        width: nodeW - 2 * pad,
        lineBreak: false,
        characterSpacing: 0.8,
      })
    doc
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .fillColor(THEME.WHITE)
      .text(node.title, nx + pad, y + pad + 4 * MM, { width: nodeW - 2 * pad, lineBreak: false })
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(col)
      .text(node.value, nx + pad, y + pad + 10 * MM, { width: nodeW - 2 * pad, lineBreak: false })
    chip(doc, nx + pad, y + pad + 17.5 * MM, node.statusLabel, { color: col, dot: true, bold: true })
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(THEME.LIGHT)
      .text(node.note, nx + pad, y + pad + 24 * MM, {
        width: nodeW - 2 * pad,
        height: nodeH - pad - 24 * MM - 2 * MM,
        ellipsis: true,
      })
    // chevron connector to the next node
    if (i < n - 1) {
      const ax = nx + nodeW + gap / 2
      const ay = y + nodeH / 2
      doc
        .polygon([ax - 2.4, ay - 3.4], [ax + 1.4, ay], [ax - 2.4, ay + 3.4])
        .fill(THEME.GRAY)
    }
  })
  return y + nodeH
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export interface RankedRow {
  name: string
  /** 0–100 share driving the bar length (normalized to the row max). */
  value: number
  /** Right-aligned display string (e.g. "23.4%"). */
  display: string
  highlight?: boolean
}

/** Leaderboard rows: rank medal, name, proportional track bar, value.
 * Returns the y below the last row. */
export function rankedBars(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  rows: readonly RankedRow[],
  rowH = 10.5 * MM,
): number {
  const max = Math.max(...rows.map((r) => r.value), 1e-6)
  const nameX = x + 11 * MM
  const nameW = 50 * MM
  const barX = x + 64 * MM
  const valW = 14 * MM
  const barW = w - (barX - x) - valW - 4 * MM
  let cy = y
  rows.forEach((r, i) => {
    const mid = cy + rowH / 2
    // rank medal
    if (i === 0) {
      doc.circle(x + 4 * MM, mid, 3.4 * MM).fill(THEME.PURPLE)
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(THEME.BG)
        .text('1', x + 1 * MM, mid - 4, { width: 6 * MM, align: 'center', lineBreak: false })
    } else {
      doc.save().lineWidth(0.7).circle(x + 4 * MM, mid, 3.4 * MM).stroke(THEME.FAINT).restore()
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(r.highlight ? THEME.PURPLE : THEME.LIGHT)
        .text(String(i + 1), x + 1 * MM, mid - 4, { width: 6 * MM, align: 'center', lineBreak: false })
    }
    doc
      .font(r.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(r.highlight ? THEME.WHITE : THEME.LIGHT)
      .text(r.name, nameX, mid - 4.6, { width: nameW, lineBreak: false, ellipsis: true, height: 12 })
    // track + bar
    doc.roundedRect(barX, mid - 1.6 * MM, barW, 3.2 * MM, 1.6 * MM).fill(THEME.CARD)
    const bw = Math.max((barW * r.value) / max, 2.4)
    doc.roundedRect(barX, mid - 1.6 * MM, bw, 3.2 * MM, 1.6 * MM).fill(r.highlight ? THEME.PURPLE : THEME.GRAY)
    doc
      .font(r.highlight ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(r.highlight ? THEME.BLUE : THEME.LIGHT)
      .text(r.display, barX + barW + 4 * MM, mid - 4.2, { width: valW, align: 'right', lineBreak: false })
    // hairline separator under each row except the last
    if (i < rows.length - 1) {
      doc
        .save()
        .lineWidth(0.4)
        .opacity(0.55)
        .moveTo(x, cy + rowH)
        .lineTo(x + w, cy + rowH)
        .stroke(THEME.FAINT)
        .restore()
    }
    cy += rowH
  })
  return cy
}

// ─── Gauge ──────────────────────────────────────────────────────────────────

/** Circular progress ring: faint full track + colored arc from 12 o'clock,
 * value/100 of the circle, round caps. Caller draws the center text. */
export function ringGauge(
  doc: Doc,
  cx: number,
  cy: number,
  r: number,
  value: number,
  color: string = THEME.PURPLE,
  thickness = 7,
): void {
  doc.save().lineWidth(thickness).circle(cx, cy, r).stroke(THEME.FAINT).restore()
  const frac = Math.min(Math.max(value, 0), 100) / 100
  if (frac <= 0.002) return
  const start = -90
  const extent = 360 * frac
  const steps = Math.max(8, Math.ceil(extent / 3))
  doc.save().lineWidth(thickness).lineCap('round')
  for (let i = 0; i <= steps; i++) {
    const a = ((start + (extent * i) / steps) * Math.PI) / 180
    const px = cx + r * Math.cos(a)
    const py = cy + r * Math.sin(a)
    if (i === 0) doc.moveTo(px, py)
    else doc.lineTo(px, py)
  }
  doc.stroke(color).restore()
}

// ─── Legacy (digest.ts renders with this) ───────────────────────────────────

/**
 * Vertical grouped bars, two series per category. Thin bars (max 4mm each),
 * flat fills, value on top of each bar, small legend top-right.
 * data maps category label -> one value per series, same order as `series`.
 */
export function groupedBarChart(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  categories: readonly string[],
  series: ReadonlyArray<readonly [string, string]>,
  data: Record<string, readonly number[]>,
): void {
  const n = categories.length
  const m = series.length
  const slot = w / Math.max(n, 1)
  const groupW = slot * 0.62
  const bw = Math.min(groupW / m, 4 * MM)
  const legendH = 6 * MM
  const base = y + h // baseline (labels go just below)
  const barArea = h - legendH

  // legend, top-right, drawn last-to-first so it packs right-aligned
  let lx = x + w
  doc.font('Helvetica').fontSize(8)
  for (let j = m - 1; j >= 0; j--) {
    const s = series[j]
    if (!s) continue
    const [name, col] = s
    const lw = doc.widthOfString(name)
    doc.fillColor(THEME.LIGHT).text(name, lx - lw, y, { width: lw, lineBreak: false })
    doc.rect(lx - lw - 10, y + 1, 7, 7).fill(col)
    lx = lx - lw - 10 - 16
  }

  categories.forEach((gname, i) => {
    const vals = data[gname] ?? []
    const groupX = x + i * slot + (slot - bw * m) / 2
    for (let j = 0; j < m; j++) {
      const v = vals[j] ?? 0
      const col = series[j]?.[1] ?? THEME.GRAY
      const bh = Math.max((barArea * Math.min(v, 100)) / 100, 1.5)
      doc.rect(groupX + j * bw, base - bh, bw - 1.5, bh).fill(col)
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(THEME.WHITE)
        .text(`${v.toFixed(0)}`, groupX + j * bw - 4, base - bh - 9, {
          width: bw + 8,
          align: 'center',
          lineBreak: false,
        })
    }
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(THEME.LIGHT)
      .text(gname, x + i * slot, base + 3, { width: slot, align: 'center', lineBreak: false })
  })
  // faint baseline — the only non-data ink allowed
  doc
    .save()
    .lineWidth(0.5)
    .opacity(0.15)
    .moveTo(x, base)
    .lineTo(x + w, base)
    .stroke(THEME.WHITE)
    .restore()
}
