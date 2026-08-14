/**
 * HTTP API — the boundary the dashboard (and client-site snippets) talk to.
 * Fastify + CORS + static report hosting. All workflow triggers are async:
 * POST returns a job id immediately, progress is polled at /api/jobs/:id.
 *
 * Directory URLs (/reports/<companyId>/, /reports/<companyId>/site/) render
 * a small HTML file index — the static plugin serves files only.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { registerRoutes } from './routes.js'
import { API_PORT, PATHS } from '../config.js'
import { detectBot } from '../tracking/bots.js'
import { insertBotVisit } from '../db/repo.js'

export async function buildServer() {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })
  await app.register(fastifyStatic, {
    root: PATHS.reports,
    prefix: '/reports/',
    decorateReply: false,
  })
  registerBotLogging(app)
  registerRoutes(app)
  registerReportIndex(app)
  return app
}

/**
 * AI-crawler logging for our hosted pages (the "CDN layer"): every AI-bot
 * request to /reports/<companyId>/... is recorded in bot_visits. Crawlers
 * don't execute JS, so this server-side log is the only way to see them.
 * Fire-and-forget: the insert runs after the response is sent, inside
 * try/catch — tracking must never block or break page delivery.
 */
function registerBotLogging(app: FastifyInstance): void {
  app.addHook('onResponse', (req, reply, done) => {
    done()
    try {
      const url = req.raw.url ?? ''
      if (!url.startsWith('/reports/')) return
      const bot = detectBot(req.headers['user-agent'])
      if (!bot) return
      const rest = url.slice('/reports/'.length)
      const companyId = rest.split('/')[0]?.replace(/[^\w-]/g, '')
      if (!companyId) return
      insertBotVisit({
        companyId,
        bot,
        path: (url.split('?')[0] ?? '').slice(0, 500),
        status: reply.statusCode,
        at: new Date().toISOString(),
      })
    } catch {
      /* tracking must never break page delivery */
    }
  })
}

/** Simple HTML file index for /reports/<companyId>/ and .../site/. */
function registerReportIndex(app: FastifyInstance): void {
  const handler =
    (sub: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { companyId: raw } = req.params as { companyId: string }
      const companyId = raw.replace(/[^\w-]/g, '')
      const dir = sub
        ? path.join(PATHS.reports, companyId, sub)
        : path.join(PATHS.reports, companyId)
      if (!fs.existsSync(dir)) {
        return reply
          .code(404)
          .type('text/html')
          .send('<h1>404 — no reports for this company</h1>')
      }
      const base = `/reports/${companyId}/${sub ? sub + '/' : ''}`
      const links = fs
        .readdirSync(dir)
        .filter(
          (f) =>
            !f.startsWith('.') &&
            (sub !== '' || f.endsWith('.pdf') || f.endsWith('.md') || f === 'site'),
        )
        .map((f) => {
          const href = f === 'site' ? `${base}site/` : base + encodeURIComponent(f)
          return `<li style="margin:8px 0"><a style="color:#2563EB;font-size:16px" href="${href}">${f}</a></li>`
        })
        .join('\n')
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reports — ${companyId}</title></head>
<body style="background:#0A0A0C;color:#F4F4F5;font-family:Inter,system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px">
<h1 style="color:#7C3AED">LeadEngine Reports — ${companyId}${sub ? ' / site' : ''}</h1>
<ul style="list-style:none;padding:0">${links}</ul>
${sub ? `<p><a style="color:#9CA3AF" href="/reports/${companyId}/">← back</a></p>` : ''}
</body></html>`
      return reply.type('text/html').send(html)
    }
  app.get('/reports/:companyId/', handler(''))
  app.get('/reports/:companyId/site/', handler('site'))
}

export async function startApi(): Promise<void> {
  const app = await buildServer()
  await app.listen({ port: API_PORT, host: '0.0.0.0' })
  console.log(`[api] LeadEngine API listening on http://localhost:${API_PORT}`)
}
