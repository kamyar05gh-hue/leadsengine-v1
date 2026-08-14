import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fileUrl, getLandingPages } from '@/lib/api'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { PagePreviewCard } from '@/components/PagePreviewCard'

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, yyyy')
}

export function LandingPages() {
  // Scoped to the client route — the client detail shell owns the header.
  const { id: companyId } = useParams<{ id: string }>()

  const pagesQuery = useQuery({
    queryKey: ['landing-pages', companyId],
    queryFn: () => getLandingPages(companyId!),
    enabled: Boolean(companyId),
  })
  const pages = pagesQuery.data ?? []

  if (pagesQuery.isLoading) {
    // First-ever load only — cached revisits render instantly.
    return <PanelSkeleton framed lines={5} className="h-64" />
  }

  if (pages.length === 0) {
    return (
      <EmptyState>
        No landing pages generated yet. Create them from the Content Gaps tab.
      </EmptyState>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {pages.map((page, i) => {
        // Backend URLs are backend-relative (/reports/…) — resolve them
        // against the API origin, exactly like the Generated Files gallery.
        const url = fileUrl(page.url)
        return (
          <PagePreviewCard
            key={page.id}
            index={i}
            url={url}
            title={page.title}
            subtitle={fmtDate(page.createdAt)}
            downloadUrl={fileUrl(page.htmlUrl ?? page.url)}
            downloadName={page.title}
          />
        )
      })}
    </div>
  )
}
