# LeadEngine

[English](README.md) | **فارسی**

<div dir="rtl">

LeadEngine یک پلتفرم ممیزی و پایش GEO/AEO (بهینه‌سازی برای موتورهای پاسخ هوش مصنوعی) است که توسط Future Media ساخته شده است. این پلتفرم می‌سنجد که یک برند در موتورهای پاسخ هوش مصنوعی (ChatGPT، Gemini، Perplexity، Claude) چقدر دیده می‌شود: یک کتابخانهٔ پرامپت مبتنی بر تقاضای واقعی برای حوزهٔ کاری مشتری می‌سازد، همهٔ پرامپت‌ها را روی موتورهای اندازه‌گیری‌شده اجرا می‌کند، بررسی می‌کند کدام URLهای استنادشده واقعاً نام برند را ذکر کرده‌اند، نرخ اشاره/استناد/سهم صدا (SoV) را امتیازدهی می‌کند، رقبای برندهٔ آن پاسخ‌ها را مهندسی معکوس می‌کند و یافته‌ها را به گزارش‌های PDF مدیریتی، دفترچهٔ برنامهٔ اقدام و یک مینی‌سایت قابل استقرار از صفحات فرود بهینه‌شده برای AEO تبدیل می‌کند — و سپس با ممیزی‌های مجدد هفتگی و پایشگرهای زمان‌بندی‌شده، وضعیت را زیر نظر نگه می‌دارد.

## معماری

<div dir="ltr">

```
┌──────────────────┐        ┌───────────────────────────────────────────────┐
│    dashboard/    │  HTTP  │                 server/  (:7002)              │
│  React + Vite    │◄──────►│  Fastify API (src/api) ── zod at the edges    │
│     (:7001)      │        │        │                                      │
└──────────────────┘        │  workflow DAG (src/workflow)                  │
                            │  intake → promptgen → audit → verify → score  │
                            │  → reverse → competitors → report → actions   │
                            │  → pages  (+ completion hooks: content gaps,  │
                            │             monitoring arm)                   │
                            │        │                                      │
                            │  agents (src/agents, 24 single-purpose)       │
                            │  cron monitors (src/cron, src/tracking)       │
                            │        │                                      │
                            │  providers (src/providers)                    │
                            │   measured: chatgpt · gemini · perplexity ·   │
                            │             claude                            │
                            │   labor:    kimi · deepseek · exa · openai ·  │
                            │             gemini (never measured surfaces)  │
                            │        │                                      │
                            │  SQLite (node:sqlite, leadengine.db)          │
                            │  reports/<companyId>/  (PDFs, site/, static   │
                            │  hosting at /reports/* with AI-bot logging)   │
                            └───────────────────────────────────────────────┘
```

</div>

- **`server/`** — بک‌اند اصلی و فعال به زبان TypeScript (فریم‌ورک Fastify روی پورت 7002، اجرا با `tsx`، بدون مرحلهٔ build). تمام مستندات این فایل مربوط به همین بخش است.
- **`dashboard/`** — اپلیکیشن تک‌صفحه‌ای React 19 + Vite + Tailwind + TanStack Query روی پورت 7001. مستقیماً با `http://localhost:7002/api` صحبت می‌کند (با `VITE_API_BASE_URL` قابل تغییر است؛ CORS در سرور فعال است).
- کل پروژه **صددرصد TypeScript** است — سرور و داشبورد، بدون پایتون و بدون ماژول‌های native — بنابراین روی هر هاست Node (مثلاً Node مدیریت‌شدهٔ Hostpoint) قابل استقرار است: `cd server && npm ci && npm start` به‌علاوهٔ خروجی استاتیک `dist/` داشبورد از `npm run build`. پوشهٔ قدیمی `pipeline/` (پایتون) اگر در نسخه‌های محلی قدیمی وجود داشته باشد، کاملاً جایگزین شده، از این مخزن حذف شده و نباید توسعه یابد.

## شروع سریع

### پیش‌نیازها

- **Node.js نسخهٔ ۲۳.۴ یا بالاتر** — لایهٔ دیتابیس از ماژول داخلی `node:sqlite` (کلاس `DatabaseSync`) استفاده می‌کند و نیازی به کامپایل native نیست.
- **npm** — اسکریپت `postinstall` سرور دستور `npx playwright install chromium` را اجرا می‌کند (برای رندر PDF و شبیه‌سازی طراحی سایت مشتری).

### پیکربندی `server/.env`

سرور در زمان بوت فایل `server/.env` را می‌خواند (مقدار اول برنده است؛ متغیرهایی که قبلاً در محیط تنظیم شده باشند هرگز بازنویسی نمی‌شوند).

| کلید | کاربرد |
| --- | --- |
| `OPENAI_API_KEY` | موتور اندازه‌گیری‌شدهٔ ChatGPT (جستجوی وب اجباری) + مدل `gpt-5-mini` برای ساخت صفحات |
| `GEMINI_API_KEY` | موتور اندازه‌گیری‌شدهٔ Gemini (اتصال به Google Search) + کارهای بینایی (vision) |
| `PERPLEXITY_API_KEY` | موتور اندازه‌گیری‌شدهٔ Perplexity (مدل `sonar`) + کارهای پژوهشی |
| `ANTHROPIC_API_KEY` | موتور اندازه‌گیری‌شدهٔ Claude (با جستجوی وب) |
| `KIMI_API_KEY` / `MOONSHOT_API_KEY` | Kimi (Moonshot) — مغز اصلی نگارش/استدلال داخلی؛ هرگز سطح اندازه‌گیری نیست |
| `DEEPSEEK_API_KEY` | DeepSeek — ارزان‌ترین نیروی کار داخلی (ویرایش متن، تحلیل احساسات، جایگزین JSON) |
| `EXA_API_KEY` | جستجوی Exa — اعتبارسنجی تقاضا در promptgen و پژوهش (اختیاری؛ بدون آن promptgen به حالت فقط-LLM برمی‌گردد) |

متغیرهای بازنویسی مهم (همه اختیاری؛ مقدار پیش‌فرض داخل پرانتز):

| متغیر | اثر |
| --- | --- |
| `LE_API_PORT` | پورت API (`7002`) |
| `LE_DB`، `LE_REPORTS` | مسیر فایل دیتابیس / پوشهٔ گزارش‌ها (`server/leadengine.db`، `server/reports`) |
| `LE_ENGINES` | موتورهای اندازه‌گیری‌شدهٔ فعال، جداشده با ویرگول (`chatgpt,gemini,perplexity,claude`) — برای حذف موقت موتوری که کلیدش از کار افتاده |
| `LE_RUNS_PER_PROMPT` | تعداد اجرا به‌ازای هر پرامپت در هر موتور (`2`) |
| `LE_AUDIT_CONCURRENCY` | تعداد worker های موازی برای فراخوانی‌های ممیزی (`8`) |
| `LE_MAX_CALLS_PER_JOB` | سقف سخت هزینهٔ ممیزی برحسب تعداد فراخوانی (`1400`) |
| `LE_MODEL_OPENAI` / `LE_MODEL_GEMINI` / `LE_MODEL_PERPLEXITY` / `LE_MODEL_CLAUDE` | مدل اندازه‌گیری‌شدهٔ هر موتور (`gpt-4o-mini`، `gemini-2.5-flash-lite`، `sonar`، `claude-haiku-4-5-20251001`) |
| `LE_MODEL_KIMI` / `LE_MODEL_PAGES` / `LE_MODEL_POLISH` / `LE_MODEL_PROMPTGEN` / `LE_MODEL_RESEARCH` / `LE_MODEL_VISION` | مسیریابی مدل‌های نیروی کار داخلی (`kimi-k2.6`، `gpt-5-mini`، `deepseek-chat`، `kimi-k2.6`، `sonar`، `gemini-2.5-flash`) |
| `LE_SCOPE_B_LABEL` | عبارت‌بندی حوزهٔ دوم ممیزی (`DACH-Region`؛ با مقدار `Deutschschweiz` سوئیس آلمانی‌زبان هدف می‌شود — کلید DB همان `dach` می‌ماند) |
| `LE_RESUME_ORPHANS` | مقدار `0` ازسرگیری jobهای یتیم در زمان بوت را غیرفعال می‌کند |
| `LE_AUTO_MONITORING` | مقدار `0` فعال‌سازی خودکار پایشگرها در زمان بوت را غیرفعال می‌کند |
| `LE_KIMI_TIMEOUT_MS` | بودجهٔ زمانی فراخوانی‌های Kimi (`300000`) — نگارش متن بلند بیشتر از بودجهٔ ۹۰ ثانیه‌ای ممیزی زمان می‌برد |
| `LE_KIMI_THINKING` | مقدار `1` حالت استدلال (reasoning) مدل kimi-k2.6 را دوباره فعال می‌کند (به‌طور پیش‌فرض خاموش؛ حدود ۵ برابر کندتر) |
| `LE_MOCK_PROVIDERS` | مقدار `1` = provider های ساختگیِ قطعی، بدون هیچ تماس شبکه‌ای (اجرای آزمایشی) |
| `LE_WEEKLY_CRON` | زمان‌بندی ممیزی مجدد هفتگی (`23 6 * * 1`) |
| `LE_CRON_*` | بازنویسی cron هر پایشگر — بخش [زمان‌بندی](#زمان‌بندی-و-پایش) را ببینید |
| `LE_REVERSE_TOP_N` | تعداد تحلیل‌های عمیق رقبا (`5`) |
| `LE_PACK_FOLDER` | نام پوشهٔ بستهٔ خزش هوش مصنوعی روی دامنهٔ اصلی (`ki`) |
| `LE_REPORT_SCOPE_DECKS` | مقدار `1` گزارش‌های قدیمی به تفکیک حوزه (regional/dach) را دوباره فعال می‌کند |
| `LE_PROMPTGEN_MULTILINGUAL` | مقدار `0` لایهٔ پرامپت‌های فرانسوی/ایتالیایی را غیرفعال می‌کند |
| `LE_PROJECT_VALUE_CHF`، `LE_QUERIES_MONTH`، `LE_LLM_ADOPTION` | فرض‌های مدل اثرگذاری مالی (150000، 400، 40) |

### اجرا

<div dir="ltr">

```bash
# backend (port 7002)
cd server
npm install
npm start            # tsx src/index.ts   (npm run dev = watch mode)

# dashboard (port 7001)
cd dashboard
npm install
npm run dev

# type gate (no emit — tsx runs TS directly)
cd server && npm run typecheck
```

</div>

بررسی سلامت: `GET http://localhost:7002/api/health` کلید همهٔ موتورهای فعال را اعتبارسنجی می‌کند.

خط فرمان (اجرای مراحل به‌صورت جداگانه بدون API):

<div dir="ltr">

```bash
cd server
npm run stage -- --company <id> --stage promptgen|audit|score|report|reverse|actions|pages|weekly|all
npm run stage -- --add '{"name":"…","sector":"…","location":"…","website":"…"}'

# full dry run, zero network
LE_MOCK_PROVIDERS=1 npm run stage -- --company demo --stage all
```

</div>

## پایپ‌لاین

درخواست `POST /api/companies` (یا `/api/audits` از داشبورد) یک job می‌سازد و DAG موجود در `src/workflow/pipeline.ts` را اجرا می‌کند. همهٔ مراحل **idempotent** هستند؛ بنابراین `POST /api/jobs/:id/retry` — و همچنین ازسرگیری jobهای یتیم در زمان بوت — از همان مرحلهٔ شکست‌خورده ادامه می‌دهد بدون آن‌که هزینهٔ کارهای انجام‌شده دوباره پرداخت شود.

| مرحله | چه می‌کند | Providerها | Idempotency / نکات |
| --- | --- | --- | --- |
| `intake` | اعتبارسنجی (zod `NewCompanySchema`)، ساخت شناسهٔ slug، استخراج domain hint ها، ذخیرهٔ شرکت | — | فقط نوشتن در DB |
| `promptgen` | ساخت کتابخانهٔ پرامپت: برداشت تقاضای واقعی از Exa (سؤالات «people also ask» + گسترش query fan-out + اعتبارسنجی حجم جستجوی زنده) به‌عنوان شواهد به پیش‌نویس JSON مدل Kimi تزریق می‌شود؛ قالب‌های قطعی جاهای خالی را پر می‌کنند. ۱۰۰ پرامپت آلمانی هسته (۵۰ regional / ۵۰ حوزهٔ B؛ در هر حوزه ۲۵ `general` + ۲۵ `avatar`، لایه‌بندی جغرافیایی `city`→`dach`) + تا ۱۶ پرامپت فرانسوی/ایتالیایی | Exa (اختیاری)، Kimi (با جایگزین DeepSeek از طریق `jsonAgent`) | کتابخانهٔ موجود را دوباره استفاده می‌کند مگر force شود؛ ممیزی‌های هفتگی همان نسخه را نگه می‌دارند تا روندها قابل مقایسه بمانند |
| `audit` | اجرای اندازه‌گیری‌شده: پرامپت‌ها × موتورهای فعال × `LE_RUNS_PER_PROMPT`. سهمیهٔ `enginePlan` هر موتور، برشی از نمای **اولویت‌بندی‌شدهٔ** کتابخانه را اجرا می‌کند (regional قبل از DACH، ترتیب لایهٔ `city`→`dach`، پرسوناها یک‌درمیان با نسبت ~۵۰/۵۰) تا بودجه‌های کوچک صرف محلی‌ترین پرامپت‌ها شود. اجراهای `avatar` پرسونای خریدار واقعی شرکت را بازی می‌کنند. یک تلاش مجدد به‌ازای هر فراخوانی ناموفق؛ احساسِ هر اشاره به برند روی پنجرهٔ ±۱۰۰ کاراکتری قضاوت می‌شود | اندازه‌گیری‌شده: chatgpt (جستجوی اجباری)، gemini (grounded، با حل redirect-stub)، perplexity، claude. نیروی کار: DeepSeek → Gemini برای احساسات | رکوردها به‌صورت جریانی در DB ذخیره می‌شوند؛ ازسرگیری، کلیدهای `(engine, prompt, run)` موجود را رد می‌کند؛ سقف سخت `LE_MAX_CALLS_PER_JOB` |
| `verify` | واکشی همهٔ URLهای استنادشده و تأیید این‌که صفحه واقعاً برند را ذکر می‌کند → `verified_citations` (تفکیک «cited» از «verified» در گزارش‌ها) | واکشی HTTP (عامل citationVerifier) | رکوردهایی که قبلاً ردیف تأیید دارند رد می‌شوند |
| `score` | محاسبهٔ خالص: نرخ اشاره، نرخ استناد، SoV، رتبهٔ میانگین به تفکیک موتور/حوزه/ترکیبی، کشف رقبا، کلاس‌بندی استنادها؛ نوشتن ردیف‌های روند و مدل اثرگذاری | — | قطعی؛ قابل اجرای مجدد |
| `reverse` | تحلیل عمیق `LE_REVERSE_TOP_N` رقیب برتر (پیش‌فرض ۵) از نظر سهم اشاره: چرا برنده‌اند و با چه تاکتیک‌هایی (content/schema/directories/earned/entity) | پژوهش Perplexity + Exa | برای هر رقیب کش می‌شود؛ ردیف‌های کش‌شده دوباره با قواعد کیفیت نام اعتبارسنجی می‌شوند |
| `competitors` | خزیدن صفحاتی که استناد AI می‌گیرند و تحلیل ساختار محتوا (schema markup، FAQ، جدول مقایسه، آمار، قالب پاسخ) → `competitor_pages` + الگوهای مشترک | خزیدن HTTP | upsert روی `(company_id, url)` (مهاجرت 008) |
| `report` | روایت + گزارش‌های PDF مدیریتی به تفکیک پرسونا: `general` (نمای کلی بازار) و `avatar` (از نگاه پرسونای خریدار)، هرکدام روی برش رکوردهای خودش امتیازدهی می‌شود، هرکدام DE + EN. مسیر HTML → PDF با Chromium بدون‌سر | روایت Kimi (ویرایش/جایگزین DeepSeek)؛ Playwright | گزارش‌های قدیمی به تفکیک حوزه پشت `LE_REPORT_SCOPE_DECKS=1` |
| `actions` | عامل‌های برنامه‌ریزی موازی → `ActionPlan` (مشخصات صفحات، قطعه‌های JSON-LD، ثبت در دایرکتوری‌ها، وظایف entity، راه‌اندازی اندازه‌گیری) + PDF طراحی‌شدهٔ برنامهٔ اقدام (DE + EN) | Kimi و نیروی کار از طریق `jsonAgent`؛ Playwright | برنامه در `action_plans` ذخیره و PDFها با نوع `playbook` ثبت می‌شوند |
| `pages` | تبدیل برنامه به یک **بستهٔ خزش هوش مصنوعی آمادهٔ FTP** برای یک پوشه روی *دامنهٔ اصلی* مشتری (`https://<domain>/<LE_PACK_FOLDER>/`، پیش‌فرض `ki` — پوشه اعتبار دامنه را به ارث می‌برد؛ ساب‌دامین از صفر شروع می‌کند): صفحات AEO با طراحی شبیه‌سازی‌شده و JSON-LD، به‌علاوهٔ `sitemap.xml`، فایل سراسری `graph.jsonld`، FAQ یکپارچهٔ مخصوص هوش مصنوعی (`faq.html` + `faq.json` خام)، `llms.txt`، `robots.txt` و راهنمای آلمانی `DEPLOY.md` (مراحل FTP + رهگیری خزش بات‌ها از طریق CDN/لاگ). همهٔ فایل‌ها به دامنهٔ اصلی بک‌لینک دارند | مدل `gpt-5-mini` برای صفحات (جایگزین Gemini/Kimi)، بینایی Gemini | شبیه‌سازی طراحی به‌ازای هر شرکت کش می‌شود؛ نام فایل‌ها قطعی است؛ فایل‌های قدیمی اجراهای قبلی حذف می‌شوند |
| *هوک‌های پایانی* | تحلیل شکاف‌های محتوایی (تب Gaps را بلافاصله پر می‌کند) + فعال‌سازی مجموعهٔ پایش + اسنپ‌شات پایهٔ پایش از رکوردهای همین اجرا (رایگان) + تولید پیشاپیش خلاصهٔ مدیریتی هوش مصنوعی + **رترو** (پایین را ببینید) | — | best-effort — هرگز یک ممیزی تمام‌شده را شکست نمی‌دهد |

### حلقهٔ یادگیری (رترو)

پس از هر ممیزی کامل، `agents/retroAnalyzer.ts` اجرا را به درس‌های ماندگار در جدول `learnings` تقطیر می‌کند: متن پرامپت‌های برنده به‌صورت قطعی (محاسبه‌شده از رکوردهای امتیازدهی‌شده) نمونه‌های few-shot می‌شوند و یک فراخوان Kimi درس‌های قابل‌انتقال از نوع `prompt_pattern` / `pitfall` / `insight` / `action` را با دامنهٔ `global` یا مخصوص هر صنعت تعمیم می‌دهد. درس تکراری به‌جای انباشت، وزن تأیید (`weight`) می‌گیرد. اجرای **بعدی** — برای هر شرکتی — درس‌های مرتبط را در تولید پرامپت (`promptgen`) و برنامه‌ریزی اقدام (`actionPlanner`) تزریق می‌کند؛ سیستم نسل به نسل به‌طور قابل‌اندازه‌گیری بهتر می‌شود. حافظه از طریق `GET /api/learnings` قابل مشاهده است.

## مدل داده

SQLite از طریق `node:sqlite` با حالت WAL. مهاجرت‌های مرتب در `src/db/` (فایل `schema.sql` پایه است، سپس `002_…` به بعد). همهٔ دسترسی‌ها از `src/db/repo.ts` عبور می‌کند.

| جدول | یک‌خطی |
| --- | --- |
| `companies` | پروفایل مشتری: حوزهٔ کاری، مکان‌ها، نام‌های جایگزین، domain hint ها، رقبا، پرسونای خریدار، engine plan |
| `jobs` / `job_events` | اجراهای workflow (وضعیت/مرحله/پیشرفت ۰–۱۰۰) و لاگ رویدادهایشان |
| `prompt_libraries` | آرایهٔ JSON از `PromptItem[]` نسخه‌بندی‌شده به‌ازای هر شرکت |
| `audit_records` | یک ردیف به‌ازای هر فراخوانی اندازه‌گیری‌شده — موتور، پرامپت، scope/persona/tier، شمارهٔ اجرا، متن پاسخ، URLهای استنادشده، احساسات؛ قید `UNIQUE(company, library, engine, prompt, run)` موتور ازسرگیری است |
| `verified_citations` | URLهای استنادشدهٔ واکشی‌شده با حکم «واقعاً برند را ذکر می‌کند» + زمینهٔ صفحه |
| `scores` | payload جیسون `ScopedScore` (regional/dach/combined) به‌ازای هر ممیزی |
| `trends` | سری زمانی اشاره/استناد/SoV به تفکیک حوزه |
| `reverse_reports` | تحلیل‌های عمیق رقبا (JSON از `ReverseReport`) |
| `competitor_pages` | صفحات خزیده‌شدهٔ رقبا با تحلیل ساختار محتوا |
| `competitor_snapshots` | اسنپ‌شات‌های روزانهٔ title/meta/headings/pricing رقبا برای diff گرفتن |
| `action_plans` | payload های JSON از `ActionPlan` |
| `reports` | دفتر ثبت فایل‌های تولیدشده — `pdf` \| `playbook` \| `page` \| `digest` همراه scope/lang/path |
| `content_gaps` | پرامپت‌هایی که رقبا در آن‌ها ظاهر می‌شوند ولی مشتری نه، با قالب پیشنهادی؛ `UNIQUE(company, prompt)` |
| `tracking_snapshots` | اسنپ‌شات‌های پایش هفتگی + JSON تفاوت‌ها (`TrackingChanges`) |
| `citation_sources` | دامنه‌های استنادشده برای مشتری در برابر رقبا (تشخیص فرصت) |
| `referral_events` | بازدید/سرنخ‌های ارجاعی از AI که اسنیپت سایت مشتری ثبت می‌کند |
| `bot_visits` | بازدید خزنده‌های AI از صفحات میزبانی‌شدهٔ `/reports/*` (یا لاگ‌های ارسال‌شدهٔ سرور مشتری) |
| `freshness_checks` | ردیف‌های بررسی تازگی محتوای هفتگی (`ok` \| `undated` \| `stale` \| `no-main-links`) |
| `api_cost_log` | یک ردیف به‌ازای هر فراخوانی provider (فروشنده، مدل، `measured`\|`labor`\|`research`) — بدون شمارش توکن |

## مرجع API

همهٔ مسیرها در `src/api/routes.ts` تعریف شده‌اند؛ شناسهٔ «audit» در داشبورد **همان** شناسهٔ job است.

**شرکت‌ها و jobها**

| متد | مسیر | کاربرد |
| --- | --- | --- |
| POST | `/api/companies` | اعتبارسنجی، ذخیره، شروع workflow ← `{ jobId }` |
| POST | `/api/companies/lookup` | پژوهش سریع شرکت برای پیش‌پر کردن فرم (هرگز خطا پرتاب نمی‌کند) |
| GET | `/api/companies` | فهرست همراه آخرین امتیاز + خلاصهٔ job |
| GET | `/api/companies/:id` | جزئیات + روندها + attribution + برنامهٔ اقدام + تحلیل رقبا |
| DELETE | `/api/companies/:id` | حذف آبشاری ردیف‌های DB + پوشهٔ `reports/<id>/` (با job زنده، پاسخ 409) |
| GET | `/api/companies/:id/ai-summary` | خلاصهٔ مدیریتی Kimi — در پایان ممیزی پیشاپیش تولید و از کش پایدار `ai_summaries` سرو می‌شود |
| GET | `/api/learnings` | حافظهٔ رترو: درس‌های تقطیرشده که در اجراهای بعدی اعمال می‌شوند |
| GET | `/api/jobs/:id` | وضعیت/مرحله/پیشرفت + ۵۰ رویداد آخر (polling داشبورد) |
| POST | `/api/jobs/:id/retry` | ازسرگیری job شکست‌خورده از مرحلهٔ فعلی |
| POST | `/api/jobs/:id/cancel` | علامت‌گذاری به‌عنوان failed / حذف از ازسرگیری زمان بوت |

**سازگاری با داشبورد (auditها و صفحات فرود)**

| متد | مسیر | کاربرد |
| --- | --- | --- |
| GET | `/api/audits` | آخرین job هر شرکت در قالب یک audit (شامل تایم‌لاین مراحل + هزینه) |
| POST | `/api/audits` | ساخت شرکت + شروع workflow (موتورها، تعداد پرامپت هر موتور، avatar) |
| GET | `/api/audits/:id` | جزئیات audit |
| GET | `/api/audits/:id/pdf` | ریدایرکت به آخرین گزارش PDF |
| GET | `/api/landing-pages/:companyId` | فهرست صفحات تولیدشدهٔ سایت |
| POST | `/api/landing-pages` | تولید یک صفحه از یک شکاف محتوایی |

**لایهٔ شواهد** (فقط خواندن از `audit_records`، بدون فراخوانی خارجی)

| متد | مسیر | کاربرد |
| --- | --- | --- |
| GET | `/api/evidence/:companyId` | بستهٔ کامل: خوشه‌های موضوعی، ماتریس دیده‌شدن، snippet ها، زنجیرهٔ تأمین استناد، قالب پاسخ‌ها |
| GET | `/api/evidence/:companyId/topics` | خوشه‌های موضوعی پرامپت‌ها + ماتریس دیده‌شدن |
| GET | `/api/evidence/:companyId/citations` | زنجیرهٔ تأمین استناد (دامنه‌ها، هاب‌ها) |
| GET | `/api/evidence/:companyId/answer-shapes` | کدام قالب پاسخ استناد می‌گیرد |
| GET | `/api/evidence/:companyId/sentiment` | تفکیک احساسات + روند روزانه |

**مجموعهٔ پایش**

| متد | مسیر | کاربرد |
| --- | --- | --- |
| GET | `/api/tracking/:companyId` (`/latest`) | تاریخچه / آخرین اسنپ‌شات پایش هفتگی |
| POST | `/api/tracking/:companyId/run` | اجرای فوری چک‌آپ (بازپرس‌وجوی زنده؛ `?stored=1` = اسنپ‌شات رایگان از رکوردهای ذخیره‌شده) |
| GET | `/api/citations/:companyId` | منابع استناد + دامنه‌های فرصت |
| GET | `/api/gaps/:companyId` | پرامپت‌های شکاف محتوایی |
| GET | `/api/competitors/:companyId/changes` | تغییرات اخیر اسنپ‌شات رقبا |
| POST | `/api/monitoring/start/:companyId` · `/api/monitoring/stop/:companyId` | فعال / متوقف کردن همهٔ پایشگرهای cron |

**هزینه‌ها، جزئیات شرکت، ردیابی و متفرقه**

| متد | مسیر | کاربرد |
| --- | --- | --- |
| GET | `/api/costs/summary` | حجم فراخوانی + هزینهٔ تخمینی (امروز/هفته/ماه/کل، به تفکیک vendor/model/روز/شرکت) |
| GET | `/api/companies/:id/mentions` | همهٔ پاسخ‌های ممیزی که برند را ذکر کرده‌اند (پنجرهٔ زمینه، احساسات) |
| GET | `/api/companies/:id/prompts` | آخرین کتابخانهٔ پرامپت؛ `?refresh=1` پرامپت‌های جدید اضافه می‌کند |
| GET | `/api/companies/:id/files` | فایل‌های تولیدشدهٔ دسته‌بندی و یکتاسازی‌شده |
| GET | `/api/companies/:id/freshness` | آخرین اجرای بررسی تازگی محتوا (صفحات کهنه) |
| GET | `/api/companies/:id/attribution` | قیف کلیک/سرنخ AI به تفکیک ماه |
| GET | `/api/companies/:id/ai-traffic` | بازدید خزنده‌های AI + ارجاع‌های انسانی از منابع AI |
| POST | `/api/track/pageview` · `/api/track/lead` | رویدادهای اسنیپت سایت مشتری |
| POST | `/api/track/bot` | لاگ ارسال‌شدهٔ سرور/CDN از بازدید خزندهٔ AI |
| GET | `/track.js?company=<id>` | خود اسنیپت ردیابی |
| POST | `/api/design/extract` | اسکرین‌شات از یک URL + استخراج توکن‌های طراحی (vision) |
| GET | `/api/health` | وضعیت اعتبارسنجی کلید موتورها |
| GET | `/reports/*` | میزبانی استاتیک همهٔ خروجی‌ها (+ فهرست HTML پوشه‌ها؛ درخواست‌های بات‌های AI در `bot_visits` ثبت می‌شود) |

## گزارش‌ها و خروجی‌ها

هر چیزی که یک job تولید می‌کند در `server/reports/<companyId>/` قرار می‌گیرد و در جدول `reports` ثبت می‌شود:

<div dir="ltr">

```
reports/<companyId>/
├── LeadEngine_Audit_<Name>_regional_general_DE.pdf   ← executive audit dossier
├── LeadEngine_Audit_<Name>_regional_general_EN.pdf     (general persona × DE/EN)
├── LeadEngine_Audit_<Name>_regional_avatar_DE.pdf    ← same, avatar persona lens
├── LeadEngine_Audit_<Name>_regional_avatar_EN.pdf
├── LeadEngine_Audit_…​.md                             ← narrative markdown twins
├── LeadEngine_ActionPlan_<Name>_DE.pdf               ← action-plan playbook
├── LeadEngine_ActionPlan_<Name>_EN.pdf
├── LeadEngine_Digest_… (weekly/monthly, from cron)
├── master-style.json / master-style.txt              ← cached design clone
└── site/                                             ← deployable mini-site
    ├── index.html, <slug>.html …                       (AEO pages w/ JSON-LD)
    ├── llms.txt                                        (AI-crawler site map)
    └── robots.txt                                      (AI bots explicitly allowed)
```

</div>

گزارش‌های ممیزی از مسیر HTML → PDF با Chromium بدون‌سر رندر می‌شوند (`src/report/executive/`)؛ digest ها از PDFKit استفاده می‌کنند (`src/report/digest.ts`).

## زمان‌بندی و پایش

دو لایه، هر دو داخل همان پروسه:

۱. **حلقهٔ ممیزی مجدد هفتگی** (`src/tracking/weekly.ts`، متغیر `LE_WEEKLY_CRON`، پیش‌فرض دوشنبه ۰۶:۲۳) — ممیزی را با *همان* نسخهٔ کتابخانهٔ پرامپت دوباره اجرا می‌کند، با خط پایهٔ قبلی مقایسه می‌کند، ردیف‌های روند را ذخیره و در صورت تنظیم webhook، یک بریفینگ نوشته‌شده با Kimi به Slack شرکت می‌فرستد.

۲. **مجموعهٔ پایش** (`src/cron/scheduler.ts`) — jobهای `node-cron` به‌ازای هر شرکت، که با `POST /api/monitoring/start/:companyId` و به‌طور خودکار در پایان هر ممیزی فعال می‌شوند:

| پایشگر | زمان‌بندی پیش‌فرض | متغیر بازنویسی |
| --- | --- | --- |
| اسنپ‌شات ردیابی هفتگی | دوشنبه 09:00 | `LE_CRON_WEEKLY_TRACKING` |
| پایش منابع استناد | هر روز 00:00 | `LE_CRON_CITATIONS` |
| تحلیل شکاف محتوایی | یکشنبه 18:00 | `LE_CRON_GAPS` |
| دیده‌بان رقبا | هر روز 03:00 | `LE_CRON_COMPETITORS` |
| تازه‌سازی پرامپت‌ها | هر ۳ روز 04:30 | `LE_CRON_PROMPT_REFRESH` |
| PDF خلاصهٔ هفتگی | دوشنبه 08:00 | `LE_CRON_DIGEST_WEEKLY` |
| PDF خلاصهٔ ماهانه | اولِ ماه 08:15 | `LE_CRON_DIGEST_MONTHLY` |
| بررسی تازگی محتوا | یکشنبه 07:00 | `LE_CRON_FRESHNESS` |

**رفتار زمان بوت** (`src/index.ts`): jobهایی که به دلیل مرگ پروسهٔ قبلی در وضعیت `running`/`queued` گیر کرده‌اند از سر گرفته می‌شوند (`LE_RESUME_ORPHANS=0` برای غیرفعال‌سازی)، و پایشگرها برای هر شرکتی که ممیزی کامل دارد دوباره فعال می‌شوند (`LE_AUTO_MONITORING=0` برای غیرفعال‌سازی) — رجیستری زمان‌بند در حافظه است و بدون این کار، هر ری‌استارت سرور کل چرخهٔ پایش را بی‌سروصدا از بین می‌برد.

## مدل هزینه

جدول `api_cost_log` به‌ازای هر فراخوانی provider یک ردیف ذخیره می‌کند ولی شمارش توکن ندارد؛ بنابراین هزینه یک **تخمین به‌ازای هر فراخوانی** است (`COST_PER_CALL_USD` در `src/api/routes.ts`):

| فروشنده | تخمین دلار/فراخوانی | فروشنده | تخمین دلار/فراخوانی |
| --- | --- | --- | --- |
| openai | 0.03 | anthropic | 0.02 |
| perplexity | 0.01 | moonshot / kimi | 0.01 |
| exa | 0.01 | google / gemini | 0.005 |
| deepseek | 0.002 | *(پیش‌فرض ناشناخته)* | 0.01 |

یک ممیزی کامل معمولی (engine plan پیش‌فرض، ۲ اجرا به‌ازای هر پرامپت، به‌علاوهٔ نیروی کار برای روایت/برنامه/صفحات) حدود **۲ تا ۲.۵ دلار** هزینه دارد؛ مرحلهٔ audit علاوه بر آن سقف `LE_MAX_CALLS_PER_JOB` را هم اعمال می‌کند. اعداد زنده: `GET /api/costs/summary` یا صفحهٔ Costs داشبورد؛ هزینهٔ هر مرحله در تایم‌لاین audit دیده می‌شود.

## نکات توسعه

- **همه‌جا TypeScript، بدون مرحلهٔ build** — سرور مستقیماً با `tsx` اجرا می‌شود؛ دروازهٔ کیفیت `npm run typecheck` (یعنی `tsc --noEmit`) است.
- **قراردادها**
  - فایل `src/db/repo.ts` تنها مرز لایهٔ ذخیره‌سازی است — خارج از `src/db/` هیچ SQL نوشته نمی‌شود.
  - هر فراخوانی provider از طریق `logCost()` در `api_cost_log` ثبت می‌شود؛ اجراکنندهٔ job با `setCallContext()` زمینهٔ job/شرکت را تنظیم می‌کند.
  - zod در مرزهای API (`routes.ts`، `intake.ts`) و دور هر خروجی JSON مدل‌های زبانی (`jsonAgent`) اعتبارسنجی می‌کند.
  - تمام مسیریابی مدل/فروشنده در `MODELS` داخل `src/config.ts` است — هرگز نام مدلی را جای دیگری hard-code نکنید.
  - providerها برای خطاهای انتقال exception پرتاب نمی‌کنند: `{ ok, status, error }` برمی‌گردانند (`status -1` = خطای شبکه/timeout).
- **افزودن یک موتور اندازه‌گیری‌شده**: توابع `run`/`validate` را در `src/providers/<engine>.ts` پیاده کنید، در `getMeasuredEngines()` (فایل `src/providers/index.ts`) ثبت کنید، `MEASURED_ENGINES` در `src/config.ts` و union type `Engine` در `src/types.ts` را گسترش دهید و یک mock در `providers/mock.ts` اضافه کنید.
- **افزودن یک agent**: یک ماژول تک‌منظوره در `src/agents/` که providerهای نیروی کار را از طریق `src/providers/index.ts` صدا می‌زند (برای خروجی JSON با اعتبارسنجی schema از `jsonAgent` استفاده کنید). agent ها باید graceful degrade داشته باشند — کلید خراب یک provider نیروی کار هرگز نباید ممیزی را شکست دهد.
- **افزودن یک بخش گزارش**: مدل نمایشی را در `src/report/executive/model.ts` گسترش دهید، آن را در `html.ts` رندر کنید (نمودارها در `charts.ts`) و هر دو زبان را به `strings.ts` اضافه کنید.
- **فقط TypeScript**: پروژهٔ منتشرشده هیچ پایتونی و هیچ وابستگی native کامپایل‌شده‌ای ندارد؛ `server/package.json` مقدار `engines.node >= 23.4` را تثبیت می‌کند (الزام `node:sqlite`). هر چیزی در پوشهٔ محلی قدیمی `pipeline/` خارج از این مخزن است و کد قدیمی محسوب می‌شود.

</div>
