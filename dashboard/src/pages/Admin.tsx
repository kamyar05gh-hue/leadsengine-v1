import { Outlet, useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { PageHeader } from '@/components/primitives/PageHeader'

const TABS = [
  { segment: 'costs', label: 'API Cost' },
  { segment: 'data', label: 'LeadEngine Data' },
] as const

/**
 * Admin shell — platform-wide views that are not scoped to a single client.
 * Same sub-navigation language as the client detail page: a header card, a
 * .tabs row, then the active view in the Outlet.
 */
export function Admin() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="System"
        title="Admin"
        description="Platform-wide API spend and the LeadEngine knowledge dataset — what every client run has taught the system."
      />

      <div className="tabs min-w-0 overflow-x-auto" role="tablist" aria-label="Admin sections">
        {TABS.map((tab) => {
          const to = `/admin/${tab.segment}`
          const active = location.pathname.startsWith(to)
          return (
            <button
              key={tab.segment}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              className="tab whitespace-nowrap"
              onClick={() => navigate(to)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <Outlet />
      </motion.div>
    </div>
  )
}
