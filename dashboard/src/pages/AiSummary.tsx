import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { API_HOST, getCompanies, type CompanySummary } from '@/lib/api'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Select } from '@/components/primitives/Select'
import { EmptyState } from '@/components/primitives/EmptyState'
import { OutlineButton } from '@/components/primitives/Button'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { AiSummaryView } from '@/components/AiSummaryView'

/**
 * AI Summary — an LLM-written executive brief per client, generated from the
 * latest audit (scores, competitors, cited domains, action plan). Company is
 * kept in the ?company= search param so links stay shareable.
 */
export function AiSummary() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const companiesQuery = useQuery<CompanySummary[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })
  const companies = companiesQuery.data ?? []

  const selected = params.get('company') ?? ''
  const valid = companies.some((c) => c.id === selected)

  // Default to the first company once the list arrives.
  useEffect(() => {
    if (!valid && companies.length > 0) {
      setParams({ company: companies[0].id }, { replace: true })
    }
  }, [valid, companies, setParams])

  const company = companies.find((c) => c.id === selected)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker="Intelligence"
        title="AI Summary"
        description="An AI-written executive brief per client — where you stand, who wins the AI answers, and what to do next. Prepared automatically from the latest audit."
      />

      {companiesQuery.isError ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-center">
          <div className="text-[14px] text-[#F06A6A]">Could not reach the API</div>
          <div className="text-[12px] text-[#5C5C66]">Is the backend running on {API_HOST}?</div>
        </div>
      ) : companiesQuery.isLoading ? (
        <PanelSkeleton lines={4} className="h-[40vh]" />
      ) : companies.length === 0 ? (
        <EmptyState>No clients yet. Run your first audit to onboard one.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select
              ariaLabel="Select client"
              value={valid ? selected : ''}
              onChange={(id) => setParams({ company: id })}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              className="min-w-[220px]"
            />
            {company && (
              <OutlineButton onClick={() => navigate(`/clients/${company.id}`)}>
                Open client →
              </OutlineButton>
            )}
          </div>

          {company && <AiSummaryView companyId={company.id} />}
        </>
      )}
    </div>
  )
}
