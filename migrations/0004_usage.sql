-- Forward-only and additive. Opt-in aggregate counts only.
-- No row may identify a person, device, network address, request URL or visit.
-- Nothing records an IP address, user agent, referrer, cookie, session, visitor
-- identifier, raw URL or query string. Rows are one UTC day, one allowlisted
-- kind, one bounded public key and a capped count.
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL CHECK(
    day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(day, 6, 2) BETWEEN '01' AND '12'
    AND substr(day, 9, 2) BETWEEN '01' AND '31'
    AND date(day) = day
  ),
  kind TEXT NOT NULL CHECK(kind IN ('profile_open', 'link_action', 'share_action')),
  key TEXT NOT NULL CHECK(
    length(key) BETWEEN 1 AND 64
    AND (
      (kind = 'profile_open' AND key = 'profile')
      OR (kind = 'share_action' AND key IN ('copy', 'native', 'download'))
      OR (kind = 'link_action' AND key NOT GLOB '*[^a-zA-Z0-9-]*')
    )
  ),
  count INTEGER NOT NULL CHECK(typeof(count) = 'integer' AND count > 0 AND count <= 100000),
  PRIMARY KEY(day, kind, key)
);
-- Seeded disabled. Enabling recording and publishing the optional public proof
-- are two independent owner choices; the public proof requires recording.
CREATE TABLE IF NOT EXISTS usage_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  public_block INTEGER NOT NULL DEFAULT 0 CHECK(public_block IN (0, 1)),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 20 AND 40)
);
INSERT INTO usage_settings(id, enabled, public_block, updated_at)
VALUES(1, 0, 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT(id) DO NOTHING;
