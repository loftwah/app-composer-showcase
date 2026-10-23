-- Forward-only and additive. Existing owner cards/settings are untouched.
-- A profile retains its account owner when its public handle or grants change.
CREATE TABLE IF NOT EXISTS member_profiles (
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  handle TEXT UNIQUE,
  draft TEXT NOT NULL,
  published TEXT,
  published_revision INTEGER,
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK(visibility IN ('draft','published','hidden')),
  UNIQUE(owner_issuer,owner_subject)
);
