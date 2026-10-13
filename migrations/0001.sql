CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT,provider TEXT,item_id TEXT,position INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',CHECK(status IN ('draft','published','hidden')));
CREATE UNIQUE INDEX IF NOT EXISTS source_unique ON cards(provider,item_id) WHERE provider IS NOT NULL;
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL);
