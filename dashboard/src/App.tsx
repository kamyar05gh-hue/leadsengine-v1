import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from '@/components/ui/sonner'
import { Sidebar } from '@/components/Sidebar'
import { Dashboard } from '@/pages/Dashboard'
import { Clients } from '@/pages/Clients'
import { ClientDetail } from '@/pages/ClientDetail'
import { GeneratedFiles } from '@/pages/client/GeneratedFiles'
import { Prompts } from '@/pages/client/Prompts'
import { Mentions } from '@/pages/client/Mentions'
import { ClientAiSummary } from '@/pages/client/Summary'
import { AiSummary } from '@/pages/AiSummary'
import { Audit } from '@/pages/Audit'
import { Checkups } from '@/pages/Checkups'
import { Costs } from '@/pages/Costs'
import { Tracking } from '@/pages/Tracking'
import { Citations } from '@/pages/Citations'
import { ContentGaps } from '@/pages/ContentGaps'
import { LandingPages } from '@/pages/LandingPages'
import { Admin } from '@/pages/Admin'
import { AdminData } from '@/pages/admin/Data'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Cached data stays fresh for a minute — switching tabs inside that
      // window renders instantly from cache, no spinner, no refetch flash.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // When a query key changes (e.g. client A -> client B) keep showing
      // the previous data while the new set loads instead of unmounting
      // into a loading state.
      placeholderData: keepPreviousData,
    },
  },
})

/**
 * Key for the page-level route transition. Everything under /clients/:id is
 * ONE page — the sub-tabs animate their own 150ms crossfade inside the
 * ClientDetail shell, so tab switches must not replay the full page
 * fade/slide (that was the "reload" feeling).
 */
function pageKeyOf(pathname: string): string {
  const client = /^\/clients\/[^/]+/.exec(pathname)
  if (client) return client[0]
  // Same rule for /admin — its sub-tabs crossfade inside the Admin shell.
  if (pathname.startsWith('/admin')) return '/admin'
  return pathname
}

function Shell() {
  const location = useLocation()
  return (
    <div className="app-scope flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-8 py-6">
        <div className="mx-auto max-w-[1280px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={pageKeyOf(location.pathname)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <Routes location={location}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/clients/:id" element={<ClientDetail />}>
                  <Route index element={<GeneratedFiles />} />
                  <Route path="summary" element={<ClientAiSummary />} />
                  <Route path="prompts" element={<Prompts />} />
                  <Route path="tracking" element={<Tracking />} />
                  <Route path="mentions" element={<Mentions />} />
                  <Route path="citations" element={<Citations />} />
                  <Route path="gaps" element={<ContentGaps />} />
                  <Route path="pages" element={<LandingPages />} />
                </Route>
                <Route path="/audit" element={<Audit />} />
                <Route path="/ai-summary" element={<AiSummary />} />
                <Route path="/check-ups" element={<Checkups />} />
                <Route path="/admin" element={<Admin />}>
                  <Route index element={<Navigate to="/admin/costs" replace />} />
                  <Route path="costs" element={<Costs />} />
                  <Route path="data" element={<AdminData />} />
                </Route>
                {/* Legacy deep links keep working. */}
                <Route path="/costs" element={<Navigate to="/admin/costs" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
        <Toaster theme="dark" />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
