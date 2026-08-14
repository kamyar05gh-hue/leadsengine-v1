import { useMemo } from 'react'
import type { EvidenceItem } from '@/lib/api'

/**
 * Visibility matrix: rows = topics, columns = engines.
 * Cell value = mention rate (0-100%) derived from evidence items.
 * Heat cells: background intensity from rgba(91,141,239,0) to
 * rgba(91,141,239,0.25); text is always an ink color, never a series color.
 */
export function TopicMatrix({ items }: { items: EvidenceItem[] }) {
  const { topics, engines, cells } = useMemo(() => {
    const engines = Array.from(new Set(items.map((i) => i.engine))).sort()
    const topics = Array.from(new Set(items.map((i) => i.topic ?? 'General'))).sort()

    const stats = new Map<string, { mentioned: number; total: number }>()
    for (const item of items) {
      const key = `${item.topic ?? 'General'}||${item.engine}`
      const s = stats.get(key) ?? { mentioned: 0, total: 0 }
      s.total += 1
      if (item.mentioned) s.mentioned += 1
      stats.set(key, s)
    }

    const cells = new Map<string, number | null>()
    for (const topic of topics) {
      for (const engine of engines) {
        const s = stats.get(`${topic}||${engine}`)
        cells.set(`${topic}||${engine}`, s && s.total > 0 ? s.mentioned / s.total : null)
      }
    }
    return { topics, engines, cells }
  }, [items])

  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#5C5C66]">
        No visibility data yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#131316]">
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]">
              Topic
            </th>
            {engines.map((e) => (
              <th
                key={e}
                className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6B6B76]"
              >
                {e}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topics.map((topic) => (
            <tr key={topic} className="row border-b border-[#131316] last:border-0">
              <td className="px-3 py-2.5 text-[13px] text-[#C9C9D1]">{topic}</td>
              {engines.map((engine) => {
                const value = cells.get(`${topic}||${engine}`) ?? null
                return (
                  <td key={engine} className="px-2 py-1.5 text-center">
                    <span
                      className="inline-block w-16 rounded-[8px] px-2 py-1 text-[12px] tabular-nums"
                      style={{
                        backgroundColor:
                          value === null
                            ? 'transparent'
                            : `rgba(91,141,239,${(value * 0.25).toFixed(3)})`,
                        color: value === null ? '#3F3F47' : value > 0 ? '#FFFFFF' : '#8A8A93',
                      }}
                    >
                      {value === null ? '—' : `${Math.round(value * 100)}%`}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
