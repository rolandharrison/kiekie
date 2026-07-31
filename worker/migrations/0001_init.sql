-- kiekie initial schema

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_updated
  ON collections (updated_at DESC);

CREATE TABLE IF NOT EXISTS screenshots (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  filename      TEXT,
  content_type  TEXT,
  width         INTEGER,
  height        INTEGER,
  source_host   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_screenshots_collection
  ON screenshots (collection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS annotations (
  id            TEXT PRIMARY KEY,
  screenshot_id TEXT NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  x REAL, y REAL, w REAL, h REAL,
  author        TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_screenshot
  ON annotations (screenshot_id, created_at);

CREATE TABLE IF NOT EXISTS share_links (
  token      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('collection', 'screenshot')),
  target_id  TEXT NOT NULL,
  created_by TEXT,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_share_links_target
  ON share_links (kind, target_id);
