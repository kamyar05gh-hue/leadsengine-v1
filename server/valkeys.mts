import { openaiValidate } from './src/providers/openai.js'
import { geminiValidate } from './src/providers/gemini.js'
import { anthropicValidate } from './src/providers/anthropic.js'
import { perplexityValidate } from './src/providers/perplexity.js'
const checks: [string, () => Promise<{ok:boolean;detail:string}>][] = [
  ['OpenAI', openaiValidate], ['Gemini', geminiValidate],
  ['Anthropic', anthropicValidate], ['Perplexity', perplexityValidate],
]
for (const [n, fn] of checks) {
  try { const r = await fn(); console.log(`[${r.ok ? 'OK  ' : 'FAIL'}] ${n} — ${r.detail}`) }
  catch (e) { console.log(`[FAIL] ${n} — ${(e as Error).message}`) }
}
