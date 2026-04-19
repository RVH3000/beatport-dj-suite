# Bridge — Schritt 1: Analyse `engine_tools.py`

**Datum:** 19. April 2026
**Kontext:** Beatport LINK → Engine Library Bridge (siehe `HANDOFF_BRIDGE_SESSION.md`)
**Status:** Read-only Analyse, keine Code-Änderungen

---

## Zusammenfassung

Die Datei `electron-app/integrations/python/engine_tools.py` ist **nicht** strikt Read-Only, wie im Handoff vermutet. Sie enthält bereits ~70 % der Infrastruktur, die für die geplante History-Bridge benötigt wird. Die eigentliche Bridge-Logik (History-Eintrag schreiben) fehlt jedoch noch.

---

## Zentrale Erkenntnis

Die Datei hat zwei parallele Verbindungs-Modi:

| Funktion | Zeile | Modus | Verwendung |
|---|---|---|---|
| `connect_readonly()` | 243–247 | `PRAGMA query_only = ON` | Alle Lese-Operationen (Schema-Inspektion, History-Unify, Track-Dumps) |
| `connect_readwrite()` | 690–695 | `PRAGMA journal_mode = WAL` (kein `query_only`) | Streaming-Track-Import, Playlist-Erstellung |

## Bereits implementiert

- **`backup_database()`** — Z. 677–687 — Timestamped Backups in `backups/` vor jeder Schreib-Operation
- **`import_streaming_tracks()`** — Z. 734–932 — vollständiger INSERT-Flow in `Track`, `Playlist`, `PlaylistEntity` inklusive Linked-List-Verkettung via `PlaylistEntity.nextEntityId`
- **Trigger-Awareness** — Kommentare Z. 782 und 795 berücksichtigen `trigger_after_insert_Track_insert_performance_data` und `trigger_after_insert_Track_fix_origin`
- **`_next_id()`** — Z. 709–722 — respektiert `sqlite_sequence`/AUTOINCREMENT (wichtig, weil Engine per Trigger validiert, dass neue IDs strikt größer sind)
- **`_build_streaming_uri()`** — Z. 704–706 — erzeugt `streaming://Beatport%20LINK/Track/{id}`
- **`_find_existing_streaming_track()`** — Z. 725–731 — Duplikat-Check via URI
- **`_extract_beatport_id()`** — Z. 474–484 — Reverse-Parsing aus der URI

## Was für die Bridge fehlt

Die eigentliche History-Bridge-Logik existiert noch nicht. Konkrete Lücken:

### 1. Schreibfunktion für History-Eintrag
- Aktueller Stand: nur Lese-Zugriffe auf `Historylist` und `HistorylistEntity` (Z. 455, 619, 1170, 1350, 1424, 1554, 1674)
- Benötigt: neue Funktion analog zu `import_streaming_tracks()`, die `INSERT INTO Historylist(...)` und `INSERT INTO HistorylistEntity(listId, trackId, ...)` schreibt

### 2. Flag-Setzer auf Track-Ebene
- `isPlayed` und `timeLastPlayed` werden aktuell **nur gelesen** (Z. 537, 1257, 1473)
- Beim INSERT neuer Streaming-Tracks werden beide Felder auf `NULL` gesetzt (Z. 844)
- Für die Bridge wird ein UPDATE auf bestehenden Tracks benötigt

### 3. Zielschema unklar
- Spaltenliste von `Historylist` und `HistorylistEntity` ist in der Datei nicht deklariert
- Muss via `inspect_schema()` (Z. 250) live auf einer Sandbox-DB ermittelt werden
- Hauptkandidaten laut Lese-Queries: `listId`, `trackId`, `originDriveName`, `date`, evtl. `startTime`/`endTime`

### 4. Session-/Session-Day-Semantik
- Engine gruppiert Plays in Historylists pro Tag/Set
- Muss geklärt werden, ob pro Playlist eine neue History-Liste entsteht oder der Insert in die aktuelle Session-Liste erfolgt

## Architektur-Integration (für spätere Umsetzung)

- **IPC-Einstieg:** `electron-app/api/sync_orchestrator.mjs` — nutzt `sendProgress()`-Pattern, lässt sich andocken
- **CLI-Einstieg:** `import-streaming` ist bereits als argparse-Subcommand registriert (Z. 1849, 1976) — ein neues `history-bridge` Subcommand wäre analog aufzubauen
- **Matching-Vorlage:** `electron-app/integrations/engine-analyze-matcher.mjs` zeigt gestuftes Beatport-ID → Fuzzy-Matching

## Streaming-Schema (Kurz-Referenz)

| Schlüsselwort | Zeile(n) | Kontext |
|---|---|---|
| `streaming://Beatport%20LINK/Track/` | 474, 706 | URI-Prefix-Konstante |
| `beatport_id` | 474–546, 1641 | Aus URI extrahiert, für Matching |
| `uri` | 538, 862–863 | Eindeutige Spalte für Streaming-Tracks |
| `streamingSource` | 839, 848 | Wert: `'Beatport LINK'` |
| `streamingFlags` | 839, 849 | Gesetzt auf `1` für Streaming |
| `originDriveName` | 1144, 1163–1164 | Session-Matching in History |
| `originTrackId`, `originDatabaseUuid` | 795–796 | Auto-gesetzt via Trigger |
| `isPlayed` | 537 | Boolean-Flag |
| `timeLastPlayed` | 536 | Timestamp in Sekunden |

## Nächste Schritte (separate Session nötig — Sandbox-DB erforderlich)

1. **DB-Schema-Dump** — via `inspect_schema()` gegen eine lokale Sandbox-Kopie von `m.db`, Fokus auf `Historylist` und `HistorylistEntity`
2. **Abspiel-Diff** — manuell in Engine DJ einen Streaming-Track einmal abspielen, dann Diff der Sandbox-DB gegen Ausgangs-Kopie (zeigt, welche Zeilen/Spalten Engine tatsächlich schreibt)
3. **PoC-Funktion** `write_history_entries(database_folder, track_ids, playlist_id)` — skizzieren, noch nicht implementieren

## Referenzen

- `electron-app/integrations/python/engine_tools.py` — Hauptdatei (78 KB)
- `electron-app/api/sync_orchestrator.mjs` — IPC-Orchestrator
- `electron-app/integrations/engine-analyze-matcher.mjs` — Match-Pattern
- `HANDOFF_BRIDGE_SESSION.md` — Handoff-Kontext aus der Vorgänger-Session
