-- Migration 003: Citation verification and competitor analysis

-- Verified citations (after fetching cited pages)
CREATE TABLE IF NOT EXISTS verified_citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_record_id INTEGER NOT NULL REFERENCES audit_records(id),
  url TEXT NOT NULL,
  actually_cites_brand INTEGER NOT NULL,
  citation_context TEXT,
  page_title TEXT,
  page_schema TEXT,
  verified_at TEXT NOT NULL
);

-- Competitor content analysis
CREATE TABLE IF NOT EXISTS competitor_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id),
  competitor_domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  headings TEXT,
  schema_markup TEXT,
  word_count INTEGER,
  answer_format TEXT,
  has_statistics INTEGER,
  has_faq INTEGER,
  has_comparison_table INTEGER,
  scraped_at TEXT NOT NULL
);

-- Add sentiment to audit_records
ALTER TABLE audit_records ADD COLUMN sentiment TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_verified_citations ON verified_citations(audit_record_id);
CREATE INDEX IF NOT EXISTS idx_competitor_pages ON competitor_pages(company_id, competitor_domain);
