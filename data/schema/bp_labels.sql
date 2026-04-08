-- beatport-dj-suite: bp_labels Tabelle
-- Quelle: GET /v4/my/beatport/labels/ (Robert, 2026-04-08)
-- Feldshape bestätigt aus echtem Response (~490 Labels gefolgt)

CREATE TABLE IF NOT EXISTS bp_labels (
  id              INTEGER PRIMARY KEY,        -- Beatport label_id
  name            TEXT NOT NULL,
  release_count   INTEGER DEFAULT 0,          -- "count" aus API
  image_id        INTEGER,
  image_uri       TEXT,                       -- statische URL (500x500 o. 60x60)
  image_dynamic   TEXT,                       -- Template mit {w}x{h}
  is_followed     INTEGER DEFAULT 1,          -- aus /my/beatport/labels/
  last_synced_at  TEXT NOT NULL,              -- ISO timestamp UTC
  first_seen_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bp_labels_name     ON bp_labels(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_bp_labels_followed ON bp_labels(is_followed);
CREATE INDEX IF NOT EXISTS idx_bp_labels_count    ON bp_labels(release_count DESC);

-- Optional: Trigger um first_seen_at bei INSERT zu schützen
CREATE TRIGGER IF NOT EXISTS bp_labels_first_seen_lock
BEFORE UPDATE OF first_seen_at ON bp_labels
BEGIN
  SELECT RAISE(IGNORE);
END;
