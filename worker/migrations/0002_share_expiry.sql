-- Optional expiry on share links. NULL means the link never expires, which is
-- the behaviour every existing row already had.
ALTER TABLE share_links ADD COLUMN expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_share_links_expiry
  ON share_links (revoked, expires_at);
