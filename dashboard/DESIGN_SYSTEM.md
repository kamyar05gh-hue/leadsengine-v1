# DARK INSTITUTIONAL DASHBOARD — DESIGN SYSTEM (NON-NEGOTIABLE)

This is the exact design system for the LeadEngine dashboard. Reproduce it literally.
Do not invent your own theme. Do not add gradients, glassmorphism, neon glows, or decorative flourishes.
Restrained, information-dense, institutional-terminal aesthetic — Bloomberg/Linear/Vercel, not a marketing site.

## STACK

- React 19 + TypeScript (.tsx), function components only, hooks only
- Tailwind CSS 3.4 with arbitrary-value syntax for exact tokens (e.g. `text-[13px]`, `bg-[#0B0B0D]`)
- Recharts 3.x for all data visualization
- framer-motion 12 — ONLY for page transitions, nothing else
- lucide-react for all icons (`strokeWidth={1.5}`, sizes 14/16)
- Vite
- One scoped stylesheet for primitives Tailwind can't express cleanly

**Font:** Inter (400, 500, 600, 700) via Google Fonts.
Apply `font-variant-numeric: tabular-nums` at the root so all numbers align in columns.

## COLOR SYSTEM — exact hex, no substitutions

### Surfaces

| Role | Hex | Use |
|---|---|---|
| Page background | `#000000` | App canvas + sidebar. True black. |
| Card surface | `#0B0B0D` | Every card, panel, tile. |
| Card border | `#1C1C21` | 1px border on every card. |
| Nested surface | `#0E0E11` | Insets inside a card. |
| Nested border | `#16161A` | Border on those insets. |
| Track / rail | `#16161A` | Empty portion of progress/meter bars. |
| Inactive bar fill | `#1C1C21` | A bar whose value is zero. |
| Hover border | `#33333C` | Border when a clickable card is hovered. |
| Tooltip surface | `#16161A` | Chart tooltip bg, border `#1C1C21`. |
| Divider (subtle) | `#131316` | Hairlines between list rows. |

Depth model: black page → `#0B0B0D` card → `#0E0E11` inset. Three steps only.

### Text (strict 6-step ink ramp)

| Role | Hex | Use |
|---|---|---|
| Primary | `#FFFFFF` | Headlines, key values, active labels. |
| Secondary | `#C9C9D1` | Emphasized body text. |
| Body | `#8A8A93` | Default body, descriptions, inactive tabs. |
| Label | `#6B6B76` | Small-caps section/stat labels. |
| Meta | `#5C5C66` | Timestamps, units, captions, axis ticks. |
| Faint | `#3F3F47` | Footnotes, quietest text. |

Text always wears an ink color, never a series color. Exception: signed deltas.

### Accent & semantic

| Role | Hex | Use |
|---|---|---|
| Primary accent | `#A78BFA` | Active-tab underline. The signature color. |
| Kicker text | `#7C9BD4` | Small uppercase eyebrow above page title. |
| Chart line | `#8FB4F2` | Default line/area stroke. |
| Series blue | `#5B8DEF` | Categorical slot 1; "today" ring; primary bars. |
| Positive | `#A78BFA` | Gains, up deltas, healthy status, live dot. |
| Negative | `#F06A6A` | Losses, down deltas, critical status. |
| Warning | `#E8A04C` | Elevated status, numbered list markers. |
| Caution | `#E3C75A` | Low-severity status. |
| Series magenta | `#D5518A` | Categorical slot 4. |

Categorical series order (fixed): `#5B8DEF` → `#E8A04C` → `#A78BFA` → `#D5518A`
Never put `#8B7CF6` (violet) next to `#5B8DEF` (indistinguishable to deuteranopes).

Status colors are reserved. Always pair with a text label or icon.

## TYPOGRAPHY SCALE — exact px, weight 400/500/600 only

Weight 700 is never used. 500 is heaviest for display; 600 for small uppercase labels.

| Element | Size | Weight | Color | Extra |
|---|---|---|---|---|
| Page title | 28px | 500 | white | leading-tight |
| Card title | 20px | 500 | white | |
| Hero metric | 26px | 500 | tone | tabular-nums |
| StatBox value | 24px | 500 | tone | tabular-nums |
| Header stat value | 22px | 500 | tone | tabular-nums |
| Body / list item | 13px | 400 | #8A8A93 | leading-relaxed in paragraphs |
| Meta / caption | 12px | 400 | #5C5C66 | |
| Kicker (eyebrow) | 11px | 500 | #7C9BD4 | uppercase, tracking-[0.14em] |
| Small label | 10px | 600 | #6B6B76 | uppercase, tracking-[0.14em] |
| Section label | 10px | 600 | #5C5C66 | uppercase, tracking-[0.18em] |
| Badge text | 10.5px | 600 | tone | uppercase, tracking-[0.08em] |
| Micro annotation | 9-11px | 400/600 | #5C5C66 | |

Number formatting: Unicode minus `−` (U+2212). Compact: 72K, 1.2M, $340M. Explicit `+` on positive deltas. Percentages to 2 decimals.

## GEOMETRY

**Radii:** cards 14px · stat boxes & inner tiles 12px · nested strips & callouts 10px · chips, small chart bars 8px · pills/badges 9999px (badges use 6px — rounded-md).

**Borders:** always exactly 1px solid. Never 2px except the tab underline.

**Spacing:**
- Page sections stack with gap-5 (20px) — primary vertical rhythm
- Grids: gap-3 (12px) or gap-4 (16px)
- Card padding: p-6 (24px) content cards, p-5 (20px) tiles, px-7 py-6 page header, px-5 py-4 stat boxes
- Card title → content gap: mt-5 (20px)

**Layout shell:**
```
Sidebar: w-[250px] shrink-0 border-r border-[#1C1C21] bg-black px-4 py-6
Main: flex-1 min-w-0 px-8 py-6
Inner wrapper: mx-auto max-w-[1280px]
Page content: flex flex-col gap-5
```

**Responsive grids:**
- Metric row: `grid grid-cols-2 gap-3 md:grid-cols-5`
- Card grid: `grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3`
- Asymmetric split: `grid grid-cols-1 gap-3 lg:grid-cols-5` with `lg:col-span-3` + `lg:col-span-2`

## INTERACTION LAWS — hard constraints

### LAW 1 — Surfaces never change color on hover.
A card that is #0B0B0D at rest is #0B0B0D hovered, focused, active. No fills. MOST IMPORTANT RULE.

### LAW 2 — No glassmorphism anywhere.
No backdrop-filter, no blur(), no translucent layers, no cursor-tracked sheen, no ::before gradient overlays.

### LAW 3 — The complete hover vocabulary is four moves:
| Element | Hover feedback |
|---|---|
| Tab / nav item | Text color → #FFFFFF. Only that. |
| Clickable card | Border → #33333C, translateY(-2px), shadow 0 14px 34px rgba(0,0,0,0.45) |
| List row | Background → rgba(255,255,255,0.028) |
| Icon in a card | translate-x-[1px] -translate-y-[1px] + color → #8FB4F2 |

### LAW 4 — Tabs are plain text with an underline. No container.
- No pill, capsule, box, frame, background, ever
- Inactive: #8A8A93. Hover: text → #FFFFFF only.
- Active: text → #FFFFFF + 2px bottom border #A78BFA
- 12px gap between label and underline (padding-bottom: 12px)
- Tabs in plain flex row, gap: 20px. No track, no group divider.

### LAW 5 — Sidebar nav uses identical language.
Icon + label row. Hover: label → #FFFFFF only. Active: label #FFFFFF + 2px #A78BFA underline under the label text only (not icon, not row), 6px gap. No pill, no left accent bar, no background, no translate.

### LAW 6 — Kill all focus rings, defensively.
```css
.scope button:focus,
.scope button:focus-visible {
  box-shadow: none !important;
  outline: none !important;
}
```
Keep !important OFF the base button rule.

### LAW 7 — Motion budget.
Transitions 0.12s–0.2s ease, on color, border-color, background-color, transform, box-shadow only. No bounce, spring, scale-up, infinite pulses. One exception: 2s ease-in-out opacity pulse on the single "live" status dot.

Page transitions (framer-motion, only place used):
```tsx
<AnimatePresence mode="wait">
  <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    {page}
  </motion.div>
</AnimatePresence>
```

### LAW 8 — Press state.
Clickable cards: translateY(0) scale(0.995). Tabs: no transform at all.

## THE SCOPED STYLESHEET

Wrap the whole app in `.app-scope` and ship this exact CSS:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.app-scope {
  --surface:        #0B0B0D;
  --border:         #1C1C21;
  --surface-inset:  #0E0E11;
  --border-inset:   #16161A;
  --accent:         #A78BFA;

  background-color: #000;
  color: #F2F2F2;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-variant-numeric: tabular-nums;
}

.app-scope button::before,
.app-scope button::after { display: none !important; }

.app-scope button {
  background: transparent;
  border: none;
  box-shadow: none;
  color: #fff;
  transform: none;
}
.app-scope button:hover:not(:disabled),
.app-scope button:active:not(:disabled) {
  background: transparent;
  box-shadow: none;
  color: #fff;
  transform: none;
}

.app-scope button:focus,
.app-scope button:focus-visible {
  background: transparent;
  box-shadow: none !important;
  outline: none !important;
}

.app-scope .tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  transition: border-color .16s ease, transform .16s ease, box-shadow .2s ease;
}
.app-scope button.tile:hover:not(:disabled),
.app-scope .tile:hover {
  background: var(--surface);
  border-color: #33333C;
  transform: translateY(-2px);
  box-shadow: 0 14px 34px rgba(0,0,0,.45);
}
.app-scope button.tile:active:not(:disabled) {
  background: var(--surface);
  transform: translateY(0) scale(.995);
}

.app-scope .tabs { display: flex; align-items: center; gap: 20px; }
.app-scope button.tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0 2px 12px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  color: #8A8A93;
  transition: color .14s ease, border-color .14s ease;
}
.app-scope button.tab:hover:not(:disabled) { background: transparent; color: #fff; }
.app-scope button.tab:active:not(:disabled) { transform: none; }
.app-scope button.tab[data-active="true"] { color: #fff; border-bottom-color: var(--accent); }

.app-scope button.navitem,
.app-scope button.navitem:hover:not(:disabled),
.app-scope button.navitem[data-active="true"] { background: transparent; }
.app-scope button.navitem span {
  border-bottom: 2px solid transparent;
  padding-bottom: 6px;
  transition: color .14s ease, border-color .14s ease;
}
.app-scope button.navitem:hover:not(:disabled) span { color: #fff; }
.app-scope button.navitem[data-active="true"] span { color: #fff; border-bottom-color: var(--accent); }

.app-scope .row { border-radius: 8px; transition: background-color .12s ease; }
.app-scope .row:hover { background: rgba(255,255,255,.028); }

.app-scope ::-webkit-scrollbar { width: 6px; }
.app-scope ::-webkit-scrollbar-track { background: #000; }
.app-scope ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.app-scope ::-webkit-scrollbar-thumb:hover { background: #8A8A93; }

@keyframes pulse-dot { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.app-scope .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
```

## CORE COMPONENTS

### Sidebar
250px fixed. Brand block at top (15px semibold white name + 11px #5C5C66 subtitle), 10px/600/uppercase/tracking-[0.18em] #5C5C66 section label, nav items, live-status footer with mt-auto.

```tsx
<button data-active={active} onClick={() => onSelect(item.id)}
  className="navitem flex items-center gap-3 px-3 py-2.5 text-left text-[13.5px]">
  <Icon size={16} strokeWidth={1.5} className={active ? 'text-white' : 'text-[#5C5C66]'} />
  <span className={active ? 'font-medium text-white' : 'text-[#8A8A93]'}>{item.label}</span>
</button>
```

Footer: #A78BFA pulsing dot + "Live · refreshes every 30s" at 11px #8A8A93, last-updated at 10px #3F3F47.

### PageHeader
Card surface, px-7 py-6, rounded-[14px]. Left: kicker → title → description (max-width 620px). Right: horizontal stat cluster, each min-w-[90px] with 10px uppercase label, 22px tabular value, optional 11px sub-line.

Tone map: green: #A78BFA, red: #F06A6A, gray: #8A8A93, white: #FFFFFF.

### Card
```tsx
export function Card({ title, meta, right, children, className = '' }) {
  return (
    <div className={`rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-6 ${className}`}>
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <div className="text-[20px] font-medium text-white">{title}</div>
          {meta && <div className="truncate text-[12px] text-[#5C5C66]">{meta}</div>}
        </div>
        {right}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
```
meta sits on same baseline as title in gray. right holds tabs or filters.

### StatBox
```tsx
<div className="rounded-[12px] border border-[#1C1C21] bg-[#0B0B0D] px-5 py-4">
  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">{label}</div>
  <div className="mt-2.5 text-[24px] font-medium tabular-nums text-white">{value}</div>
  <div className="mt-1.5 text-[12px] tabular-nums text-[#8A8A93]">{delta}</div>
</div>
```

### Badge
`inline-flex items-center whitespace-nowrap rounded-md border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em]`, colored as `border-[COLOR]/40 bg-[COLOR]/10 text-[COLOR]`.

### Tabs / RangePicker
Same markup — .tabs flex row of .tab buttons with data-active. Never two tab styles.

### SummaryTile (clickable navigation card)
<button class="tile"> containing: 10px uppercase label + corner ArrowUpRight icon, then 26px metric, optional sparkline, truncated 12px takeaway. Hover: label → #A6A6AF, arrow shifts up-right → #8FB4F2.

### EmptyState
`flex h-[280px] items-center justify-center rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] text-[13px] text-[#5C5C66]`

## DATA VISUALIZATION RULES

```ts
export const CHART = {
  line:  '#8FB4F2',
  grid:  '#1a1a1a',
  tick:  '#5C5C66',
  green: '#A78BFA',
  red:   '#F06A6A',
};
export const axisTick = { fill: '#5C5C66', fontSize: 11 };
export const tooltipStyle = {
  backgroundColor: '#16161A',
  border: '1px solid #1C1C21',
  borderRadius: 8,
  fontSize: 12,
  color: '#fff',
};
```

Hard rules:
1. NEVER a dual-axis chart. Two measures of different scale → two charts or small multiples.
2. Axes: axisLine={false} tickLine={false}, grid vertical={false} in #1a1a1a. Grid recedes to near-invisibility.
3. Area charts: vertical gradient fill stopOpacity 0.18–0.25 → 0.
4. Line/area stroke 1.5px–2px. Bars maxBarSize={14}, radius only value end (e.g. [0,4,4,0] horizontal).
5. ≥2 series needs a legend; ≤4 series should also be direct-labeled.
6. Bars/dots get hover tooltip; line/area get crosshair + tooltip.
7. Sparklines: isAnimationActive={false}, hidden axes, ~44px tall.
8. Zero-value bar renders in #1C1C21 (visible empty slot), not omitted.
9. Prefer one real chart over a grid of mostly-empty tiles.

## CONTENT & LAYOUT PATTERNS

- Every page = PageHeader + flex flex-col gap-5 of Cards.
- Overview = header + grid of SummaryTiles linking to detail pages.
- Detail page = header + StatBox row + 1-2 chart Cards + list/timeline Card.
- Asymmetric pairing: lg:grid-cols-5 with col-span-3 primary + col-span-2 secondary.
- Truncate aggressively: truncate + title attribute. Density by truncation, never below 10px.
- Cap long lists at 5–8 rows with "+N more" line in #5C5C66.
- Loading: centered h-[60vh] 13px #5C5C66 message.
- Error: centered, 14px #F06A6A headline + 12px #5C5C66 detail.
- Live data: poll interval, "Live · refreshes every Ns" with pulsing accent (light purple) dot + real timestamp. Never fake — if stale, show "Offline" red badge.

## ACCESSIBILITY FLOOR

- Every colored mark carries a text label or icon.
- Body text ≥ 12px; 9–10px reserved for uppercase wide-tracking labels at weight 600.
- Tabs use role="tablist" / role="tab" / aria-selected.
- Icon-only buttons need aria-label.
- Charts get role="img" + aria-label.
- Keyboard navigation stays functional; active state independently visible via underline.

## DOMAIN — LeadEngine GEO/AEO platform

Navigation: Overview · Audits · Reports · Tracking · Citations · Content Gaps · Landing Pages · Settings

Metric vocabulary: mention rate, citation rate, share of voice, visibility rank, sentiment score, verified citations, content gaps, opportunity domains, competitor count, weekly change.

Visualization mapping:
- Engine × Topic performance → matrix table with heat cells
- Mention/citation rate over time → area chart with gradient fill
- Citation supply chain → horizontal bar chart (domains ranked), opportunity domains in warning #E8A04C
- Sentiment breakdown → donut chart (positive #A78BFA, neutral #5C5C66, negative #F06A6A)
- Competitor comparison → horizontal bars, client in series blue #5B8DEF
- Activity feed → timeline: vertical hairline rail, colored dots with ring-4 ring-[#0B0B0D] halo, timestamp + truncated text

## TIMELINE / STEPPER PATTERN

Audit progress and other multi-stage jobs render as a vertical step rail (`src/components/AuditTimeline.tsx`).

- Rail: 1px vertical hairline in `#1C1C21` connecting the step dots; the completed portion fills with `#5B8DEF` via a 0.2s height transition.
- Step dots: done = `#A78BFA` filled with a dark `Check` (size 10), running = `#5B8DEF` with the `.pulse-dot` animation, failed = `#F06A6A` with a dark `X`, pending = `#3F3F47` outline only.
- Step rows: 13px label in `#C9C9D1` (white while running), right-aligned tabular meta — duration `Xs` / `M:SS`, `$x.xxx` cost when > 0.
- The running step shows its `lastMessage` at 12px `#8A8A93` beneath the label, paired with the pulse dot.
- Steps with events expand on click into an inset detail panel (`#0E0E11`, `#16161A` border, 10px radius): lastMessage, started/finished timestamps, calls, cost. One panel open at a time.
- Expand/collapse uses max-height + opacity at 0.15s ease; the chevron rotates with transition-transform. Hover changes text to white only — never the surface (Law 1).
- Companion summary strip: inset stat tiles (12px radius) for estimated spend (rAF count-up), elapsed, ETA, and progress with a 6px `#16161A` track / `#5B8DEF` fill bar (width transition 0.2s).
- Graceful fallback: without a `timeline` payload (old backend), render the plain progress bar + "Working…" row instead of the rail.

## DEFINITION OF DONE

1. No surface anywhere turns white, light, or tinted on hover.
2. No backdrop-filter, blur, or pseudo-element sheen anywhere.
3. Hovering a tab changes ONLY the text color.
4. Clicking a tab shows #A78BFA underline with clear gap below label, NO ring/outline/box-shadow/frame.
5. Sidebar active item shows #A78BFA underline under label text only, no pill or left bar.
6. All numbers tabular, use − (U+2212) for negatives.
7. Page background pure #000000; every card #0B0B0D with #1C1C21 border.
8. No chart has two y-axes.
9. Nothing animates longer than 200ms except the live dot.
10. Layout holds at 1280px, 1024px, 768px without horizontal scroll.
