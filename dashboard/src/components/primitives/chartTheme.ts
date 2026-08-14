// Chart tokens — exact per the design system (DATA VISUALIZATION RULES).
export const CHART = {
  line: '#8FB4F2',
  grid: '#1a1a1a',
  tick: '#5C5C66',
  green: '#A78BFA', // positive tone — light purple (key kept for API stability)
  red: '#F06A6A',
} as const

// Categorical series order (fixed): slot 1 → 4.
export const SERIES = ['#5B8DEF', '#E8A04C', '#A78BFA', '#D5518A'] as const

export const axisTick = { fill: '#5C5C66', fontSize: 11 } as const

export const tooltipStyle = {
  backgroundColor: '#16161A',
  border: '1px solid #1C1C21',
  borderRadius: 8,
  fontSize: 12,
  color: '#fff',
} as const

// Tooltip label + crosshair cursor — muted, never a series color.
export const tooltipLabelStyle = { color: '#8A8A93' } as const
export const cursorStyle = { stroke: '#33333C', strokeWidth: 1 } as const
