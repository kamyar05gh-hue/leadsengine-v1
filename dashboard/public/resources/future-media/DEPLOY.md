# Deployment Checklist — Future Media AG GEO Execution Package

Everything in this folder is the deliverable of a **GEO Setup (Tier 2)**.
Deploy it to the real domain in this order; the monitoring pipeline measures
the lift automatically afterwards.

## Week 2 — On-site (deploy `site/`)
- [ ] Upload `index.html` → homepage (replace placeholders: real address,
      phone, founding date, employee count, client count, revenue figure)
- [ ] Upload `faq.html` → /faq (adjust any answers that differ from reality)
- [ ] Upload `robots.txt` → domain root; verify at
      https://YOURDOMAIN/robots.txt
- [ ] Upload `llms.txt` → domain root
- [ ] Validate all JSON-LD at validator.schema.org (zero errors)
- [ ] Confirm pages are server-rendered (view-source shows the content)

## Week 2 — Entity
- [ ] Claim/complete Google Business Profile (every field, 20+ photos)
- [ ] Claim Bing Places (imports from GBP) — feeds ChatGPT local answers
- [ ] Claim Crunchbase + align LinkedIn company page
- [ ] Create the Wikidata entry per `wikidata-entry.md`; put the real QID
      into the homepage `sameAs` array

## Week 3 — Directories & consensus
- [ ] local.ch + search.ch listings — name/address/phone IDENTICAL everywhere
- [ ] Apple Business Connect + Bing Places verified
- [ ] 3 industry directories relevant to the client's vertical

## Week 4+ — Off-site (ongoing)
- [ ] Run the real 312-SME survey → replace placeholder figures in
      `pr-article.md` → pitch to Handelszeitung / NZZ / 20 Minuten
- [ ] Wire syndication for the data story
- [ ] Review acquisition: 5–10 Google reviews/month, respond to 100%
- [ ] Genuine participation in r/Switzerland, r/zurich (no promotion-first)

## Measurement (already running)
- [x] Baseline measured 2026-08-01 (ChatGPT 16.7% citation, Gemini 0%)
- [ ] Daily 06:43 Automation tracks citation rate / mention rate / SoV
- [ ] Compare Day 30 / 60 / 90 against baseline in the dashboard

**Expectation setting (from the research):** first AI citations from month ~3;
Gemini/AI Overviews 3–6 months because they follow organic rankings.
