import { useParams } from 'react-router'
import { AiSummaryView } from '@/components/AiSummaryView'

/** AI Summary tab on the client detail page — same view, fixed company. */
export function ClientAiSummary() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <AiSummaryView companyId={id} />
}
