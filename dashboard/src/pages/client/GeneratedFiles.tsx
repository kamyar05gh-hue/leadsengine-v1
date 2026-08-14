import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Download, ExternalLink, FileText, ListChecks } from 'lucide-react'
import { fileUrl, getCompanyFiles, type CompanyFile } from '@/lib/api'
import { Card } from '@/components/primitives/Card'
import { Badge } from '@/components/primitives/Badge'
import { EmptyState } from '@/components/primitives/EmptyState'
import { PanelSkeleton } from '@/components/primitives/Skeleton'
import { PdfThumb } from '@/components/PdfThumb'
import { PagePreviewCard } from '@/components/PagePreviewCard'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d, yyyy')
}

/** DE/EN language flag for report cards; neutral doc glyph otherwise. */
function langFlag(lang?: string): string {
  if (lang === 'de') return '🇩🇪'
  if (lang === 'en') return '🇬🇧'
  return '📄'
}

/** Report variant parsed from the filename: avatar-scoped vs. general. */
function variantOf(file: CompanyFile): 'avatar' | 'general' {
  const hay = `${file.name} ${file.scope ?? ''}`.toLowerCase()
  return hay.includes('avatar') ? 'avatar' : 'general'
}

function isPdf(file: CompanyFile): boolean {
  return file.name.toLowerCase().endsWith('.pdf')
}

/** Action-plan files (kind 'playbook') — now PDFs, legacy runs left .md. */
function isActionPlanPdf(file: CompanyFile): boolean {
  return file.kind === 'playbook' && isPdf(file)
}

/** Language parsed from action-plan filenames (…_DE.pdf / …_EN.pdf). */
function planLang(file: CompanyFile): string | undefined {
  const m = /_(de|en)\.pdf$/i.exec(file.name)
  return m ? m[1].toLowerCase() : file.lang
}

/** Inset empty message used inside gallery cards (consistent across sections). */
function InsetEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[120px] items-center justify-center rounded-[10px] border border-[#16161A] bg-[#0E0E11] px-6 text-center text-[13px] text-[#5C5C66]">
      {children}
    </div>
  )
}

const linkClass =
  'inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8A8A93] transition-colors duration-150 hover:text-white'

/** Styled fallback face when a PDF's first page cannot be rasterized. */
function PdfThumbFallback({ file }: { file: CompanyFile }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0E0E11]">
      <span className="text-[34px] leading-none" aria-hidden>
        {langFlag(file.lang)}
      </span>
    </div>
  )
}

/**
 * PDF card with a real first-page thumbnail (pdf.js render, cached per URL).
 * Used for both audit reports (DE/EN × general/avatar) and action plans.
 */
function PdfCard({
  file,
  index,
  badges,
  caption,
}: {
  file: CompanyFile
  index: number
  badges: React.ReactNode
  caption: string
}) {
  const url = fileUrl(file.url)
  return (
    <div
      className="tile stagger-item overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${file.name}`}
        className="relative block aspect-[16/10] overflow-hidden rounded-t-[13px] border-b border-[#16161A] bg-[#0E0E11]"
      >
        <PdfThumb
          url={url}
          alt={`First page of ${file.name}`}
          className="h-full w-full object-cover object-top"
          fallback={<PdfThumbFallback file={file} />}
        />
        <span className="absolute right-2.5 top-2.5 flex flex-wrap justify-end gap-1.5">{badges}</span>
      </a>
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[#C9C9D1]" title={file.name}>
            {file.name}
          </div>
          <div className="mt-0.5 truncate text-[11px] tabular-nums text-[#5C5C66]">{caption}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={url}
            download={file.name}
            className={linkClass}
            aria-label={`Download ${file.name}`}
          >
            <Download size={14} strokeWidth={1.5} />
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
            aria-label={`Open ${file.name}`}
          >
            <ExternalLink size={14} strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </div>
  )
}

/** Audit report PDF: language flag + variant/lang badges over the thumbnail. */
function ReportCard({ file, index }: { file: CompanyFile; index: number }) {
  const variant = variantOf(file)
  return (
    <PdfCard
      file={file}
      index={index}
      badges={
        <>
          <Badge color={variant === 'avatar' ? '#A78BFA' : '#5B8DEF'}>{variant}</Badge>
          {file.lang && <Badge color="#8A8A93">{file.lang}</Badge>}
        </>
      }
      caption={`${file.scope ? `${file.scope} · ` : ''}${fmtDate(file.createdAt)}`}
    />
  )
}

/** Action-plan PDF: playbook badge + language over the thumbnail. */
function ActionPlanCard({ file, index }: { file: CompanyFile; index: number }) {
  const lang = planLang(file)
  return (
    <PdfCard
      file={file}
      index={index}
      badges={
        <>
          <Badge color="#E8A04C">action plan</Badge>
          {lang && <Badge color="#8A8A93">{lang}</Badge>}
        </>
      }
      caption={fmtDate(file.createdAt)}
    />
  )
}

/** Data & exports: compact rows (legacy .md action plans, CSVs, …). */
function DataRow({ file, index }: { file: CompanyFile; index: number }) {
  const Icon = file.kind === 'playbook' ? ListChecks : FileText
  return (
    <div
      className="row stagger-item flex items-center gap-3 border-b border-[#131316] px-3 py-2.5 last:border-0"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <Icon size={15} strokeWidth={1.5} className="shrink-0 text-[#5C5C66]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-[#C9C9D1]" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-[#5C5C66]">
          {file.kind}
          {' · '}
          {fmtDate(file.createdAt)}
        </div>
      </div>
      <a href={fileUrl(file.url)} target="_blank" rel="noreferrer" className={linkClass}>
        <ExternalLink size={13} strokeWidth={1.5} /> Open
      </a>
      <a href={fileUrl(file.url)} download={file.name} className={linkClass}>
        <Download size={13} strokeWidth={1.5} /> Download
      </a>
    </div>
  )
}

/** Generated Files — everything the pipeline produced, as organized galleries. */
export function GeneratedFiles() {
  const { id } = useParams<{ id: string }>()

  const filesQuery = useQuery({
    queryKey: ['company-files', id],
    queryFn: () => getCompanyFiles(id!),
    enabled: Boolean(id),
  })

  if (filesQuery.isLoading) {
    // First-ever load only — cached revisits render instantly.
    return <PanelSkeleton framed lines={5} className="h-64" />
  }

  if (filesQuery.isError || !filesQuery.data) {
    return <EmptyState>Could not load generated files. Is the backend running?</EmptyState>
  }

  const { reports, landingPages, data } = filesQuery.data.categories

  // Action plans are PDFs now — show them as preview cards next to the
  // reports. Legacy .md playbooks (and raw exports) stay in the row list.
  const actionPlans = data.filter(isActionPlanPdf)
  const dataRows = data.filter((f) => !isActionPlanPdf(f))

  return (
    <div className="flex flex-col gap-5">
      <Card title="Reports" meta={`${reports.length} PDF ${reports.length === 1 ? 'file' : 'files'} · DE & EN, general & avatar variants`}>
        {reports.length === 0 ? (
          <InsetEmpty>No reports generated yet. Run an audit to produce the first report.</InsetEmpty>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((f, i) => (
              <ReportCard key={f.id} file={f} index={i} />
            ))}
          </div>
        )}
      </Card>

      {actionPlans.length > 0 && (
        <Card title="Action Plan" meta={`${actionPlans.length} PDF ${actionPlans.length === 1 ? 'file' : 'files'} · prioritized playbook`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {actionPlans.map((f, i) => (
              <ActionPlanCard key={f.id} file={f} index={i} />
            ))}
          </div>
        </Card>
      )}

      <Card title="Landing Pages" meta={`${landingPages.length} generated ${landingPages.length === 1 ? 'page' : 'pages'} · live previews`}>
        {landingPages.length === 0 ? (
          <InsetEmpty>
            No landing pages generated yet. Create them from the Content Gaps tab.
          </InsetEmpty>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {landingPages.map((f, i) => (
              <PagePreviewCard
                key={f.id}
                index={i}
                url={fileUrl(f.url)}
                title={f.name}
                subtitle={fmtDate(f.createdAt)}
                downloadName={f.name}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Data & Exports" meta={`${dataRows.length} ${dataRows.length === 1 ? 'file' : 'files'} · legacy plans and raw exports`}>
        {dataRows.length === 0 ? (
          <InsetEmpty>No data exports yet.</InsetEmpty>
        ) : (
          <div>
            {dataRows.map((f, i) => (
              <DataRow key={f.id} file={f} index={i} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
