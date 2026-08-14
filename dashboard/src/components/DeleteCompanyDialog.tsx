import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, cancelJob, deleteCompany } from '@/lib/api'
import { OutlineButton } from '@/components/primitives/Button'

/**
 * Confirmation dialog for deleting a company. Handles the 409 "live job"
 * case with a chained cancel-job-then-delete affordance, invalidates the
 * companies/audits queries on success and reports back via onDeleted.
 */
export function DeleteCompanyDialog({
  companyId,
  companyName,
  jobId,
  onClose,
  onDeleted,
}: {
  companyId: string
  companyName: string
  /** Live job id (if known) — enables the cancel-and-delete chain on 409. */
  jobId?: string | null
  onClose: () => void
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()
  const [liveJobBlocked, setLiveJobBlocked] = useState(false)

  // Escape closes (while no request is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mutation = useMutation({
    mutationFn: async ({ cancelFirst }: { cancelFirst: boolean }) => {
      if (cancelFirst && jobId) {
        // Best-effort: a job that finished in the meantime 409s the cancel,
        // but then the delete goes through anyway.
        await cancelJob(jobId).catch(() => undefined)
      }
      // force on the cancel path: the backend stops the running executor and
      // waits for it to unwind before removing rows, so a live workflow can
      // never write records for a company that is being deleted.
      return deleteCompany(companyId, cancelFirst)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] })
      queryClient.invalidateQueries({ queryKey: ['audits'] })
      queryClient.removeQueries({ queryKey: ['company', companyId] })
      queryClient.removeQueries({ queryKey: ['ai-summary', companyId] })
      queryClient.removeQueries({ queryKey: ['company-files', companyId] })
      toast.success(`${companyName} deleted`, {
        description: 'All audits, reports and landing pages were removed.',
      })
      onDeleted?.()
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setLiveJobBlocked(true)
      }
    },
  })

  const busy = mutation.isPending
  const error = mutation.error
  const showGenericError = mutation.isError && !liveJobBlocked

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${companyName}`}
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        className="w-full max-w-[440px] rounded-[14px] border border-[#1C1C21] bg-[#0B0B0D] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#F06A6A]/40 bg-[#F06A6A]/10">
            <AlertTriangle size={16} strokeWidth={1.5} className="text-[#F06A6A]" />
          </span>
          <div className="min-w-0">
            <div className="text-[16px] font-medium text-white">
              Delete {companyName}?
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#8A8A93]">
              This deletes all audits, reports and landing pages{' '}
              <span className="text-[#F06A6A]">permanently</span>. There is no undo.
            </p>
          </div>
        </div>

        {liveJobBlocked && (
          <div className="mt-4 rounded-[10px] border border-[#E8A04C]/40 bg-[#E8A04C]/10 px-4 py-3">
            <div className="text-[13px] font-medium text-[#E8A04C]">
              A pipeline job is still running
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[#C9C9D1]">
              {jobId
                ? 'Cancel the live job first, then the deletion goes through.'
                : 'Cancel the live job from its audit view first, then retry the deletion.'}
            </p>
          </div>
        )}

        {showGenericError && (
          <p className="mt-4 break-words text-[12px] leading-relaxed text-[#F06A6A]">
            Deletion failed: {error instanceof Error ? error.message : 'unknown error'}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <OutlineButton onClick={onClose} disabled={busy}>
            Cancel
          </OutlineButton>
          {liveJobBlocked && jobId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => mutation.mutate({ cancelFirst: true })}
              className="rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: '#F06A6A' }}
            >
              {busy ? 'Canceling & deleting…' : 'Cancel job & delete'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || (liveJobBlocked && !jobId)}
              onClick={() => mutation.mutate({ cancelFirst: false })}
              className="rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: '#F06A6A' }}
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
