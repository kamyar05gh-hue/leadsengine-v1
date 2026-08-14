import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { startMonitoring, stopMonitoring } from '@/lib/api'

/**
 * The backend exposes monitoring state only in the start/stop responses
 * (`monitored: string[]`); there is no GET for it. We therefore keep the set
 * of actively-monitored company ids in a never-refetched query cache entry
 * that the start/stop mutations update from the server response — and mirror
 * it to localStorage so a page reload doesn't silently report every client
 * as paused.
 */
export const MONITORED_KEY = ['monitoring', 'active'] as const

const STORAGE_KEY = 'leadengine.monitoring.active'

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    // Unavailable (private mode) or corrupt — start empty.
    return []
  }
}

function writeStored(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Persistence is a nicety; never let it break the toggle.
  }
}

export function useMonitoredCompanies(): string[] {
  const query = useQuery<string[]>({
    queryKey: MONITORED_KEY,
    queryFn: () => readStored(),
    initialData: readStored,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  return query.data ?? []
}

export function useMonitoringToggle(companyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (active: boolean) =>
      active ? stopMonitoring(companyId) : startMonitoring(companyId),
    onSuccess: (result) => {
      // The response is authoritative: it lists every monitored company.
      if (Array.isArray(result.monitored)) {
        queryClient.setQueryData(MONITORED_KEY, result.monitored)
        writeStored(result.monitored)
      }
    },
  })
}
