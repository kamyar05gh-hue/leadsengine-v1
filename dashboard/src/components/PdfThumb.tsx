import { useEffect, useState, type ReactNode } from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
// Vite `?url` import — the worker ships with the app bundle, no CDN involved.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Render width for page-1 thumbnails (card-sized; DPR-aware at draw time). */
const THUMB_WIDTH = 480

/**
 * Module-level cache: file URL -> blob-URL promise. Each PDF's first page is
 * rasterized exactly once per session no matter how many cards mount, and
 * concurrent mounts share the same in-flight render.
 */
const thumbCache = new Map<string, Promise<string>>()

async function renderFirstPage(url: string): Promise<string> {
  const loadingTask = pdfjs.getDocument({ url })
  const doc = await loadingTask.promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = THUMB_WIDTH / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('no 2d context')
    // White ground behind the page — PDFs assume paper.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    if (!blob) throw new Error('toBlob failed')
    return URL.createObjectURL(blob)
  } finally {
    void loadingTask.destroy()
  }
}

function getThumb(url: string): Promise<string> {
  let entry = thumbCache.get(url)
  if (!entry) {
    entry = renderFirstPage(url)
    // A failed render must not poison the cache — allow a retry on remount.
    entry.catch(() => thumbCache.delete(url))
    thumbCache.set(url, entry)
  }
  return entry
}

/**
 * PdfThumb — actual first-page thumbnail of a PDF, rendered with pdf.js.
 * While loading it shows a quiet shimmer; on any failure it renders the
 * `fallback` node (the pre-existing styled card face) instead.
 */
export function PdfThumb({
  url,
  alt,
  className = '',
  fallback = null,
}: {
  url: string
  alt: string
  className?: string
  fallback?: ReactNode
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setFailed(false)
    getThumb(url).then(
      (blobUrl) => {
        if (alive) setSrc(blobUrl)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [url])

  if (failed) return <>{fallback}</>

  if (!src) {
    return <div aria-hidden className={`shimmer ${className}`} style={{ borderRadius: 0 }} />
  }

  return <img src={src} alt={alt} className={className} draggable={false} />
}
