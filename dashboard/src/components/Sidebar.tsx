import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Users,
  FileSearch,
  Sparkles,
  Activity,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { getAudits, type Audit } from '@/lib/api'

const NAV_ITEMS: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/audit', label: 'Audit', icon: FileSearch },
  { to: '/ai-summary', label: 'AI Summary', icon: Sparkles },
  { to: '/check-ups', label: 'Check-ups', icon: Activity },
  { to: '/admin', label: 'Admin', icon: ShieldCheck },
]

function isActive(pathname: string, to: string, end?: boolean): boolean {
  return end ? pathname === to : pathname.startsWith(to)
}

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  // Shared audits query on a 30s poll — this is what the "Live" footer
  // claims, so the timestamp comes from the query's real dataUpdatedAt.
  const auditsQuery = useQuery<Audit[]>({
    queryKey: ['audits'],
    queryFn: getAudits,
    refetchInterval: 30_000,
  })

  return (
    <aside className="sticky top-0 flex h-screen w-[250px] shrink-0 flex-col border-r border-[#1C1C21] bg-black px-4 py-6">
      {/* Brand block — client wordmark with the platform attribution beneath,
          mirroring the header of every generated PDF page. */}
      <div className="px-3">
        {/* The PNG is trimmed to its artwork, so the wordmark and the
            sub-line share one left edge — no manual nudging. */}
        <img
          src="/fm_logo.png"
          alt="Future Media"
          className="block h-[26px] w-auto opacity-95"
        />
        <div className="mt-2 text-[9.5px] uppercase tracking-[0.17em] text-[#5C5C66]">
          Powered by LeadEngine
        </div>
      </div>

      {/* Section label */}
      <div className="mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5C5C66]">
        Platform
      </div>

      {/* Nav */}
      <nav className="mt-2 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(location.pathname, item.to, item.end)
          const Icon = item.icon
          return (
            <button
              key={item.to}
              type="button"
              data-active={active}
              onClick={() => navigate(item.to)}
              className="navitem flex items-center gap-3 px-3 py-2.5 text-left text-[13.5px]"
            >
              <Icon
                size={16}
                strokeWidth={1.5}
                className={active ? 'text-white' : 'text-[#5C5C66]'}
              />
              <span className={active ? 'font-medium text-white' : 'text-[#8A8A93]'}>
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Live-status footer — the pulsing dot alone signals liveness; the
          clock text was noise, so only the indicator remains. */}
      <div className="mt-auto px-3">
        <span
          className="pulse-dot block h-1.5 w-1.5 rounded-full bg-[#A78BFA]"
          aria-label={auditsQuery.dataUpdatedAt > 0 ? 'Live' : 'Connecting'}
        />
      </div>
    </aside>
  )
}
