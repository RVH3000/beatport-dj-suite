# LLM Handoff — Beatport DJ Suite: Engine DJ Read-Layer Refactoring

Erstellt: 2026-04-13
Von: Cowork (Claude Desktop, Opus 4.6)
Nach: Claude Code CLI (Agenten-Modus)

## Aktueller Stand

- **Branch:** `feature/groof-integration`
- **Letzter Commit:** `b8a815a feat(sync): optional Soundiiz monitoring and trigger integration`
- **Was gerade läuft:** Engine DJ Read-Layer erweitern — neue Datenbanken, BLOB-Decoder, Multi-DB-Diff, History-Merge
- **Alle Änderungen direkt in die Suite bauen** (Backend + IPC + UI zusammen pro Feature)

## Projekt-Kontext

Die Beatport DJ Suite liest Engine DJ Datenbanken read-only über `engine_tools.py` (Python, via `runPythonJson()` aus Electron). Die bestehende Pipeline:

```
UI (automation.js) → IPC (preload.mjs) → main.mjs → engine_tools.py → JSON
```

Aktuell werden nur `m.db` und `hm.db` genutzt. In einer Cowork-Session wurde das komplette Engine DJ DB-Ökosystem analysiert (7 DBs) und ein Implementierungsplan erstellt.

## Kern-Erkenntnisse aus der Analyse

### Die 7 Datenbanken (alle Schema v3.0.1)

| DB | Zweck | Inhalt | Aktion |
|---|---|---|---|
| m.db | Haupt-Library | 1817 Tracks (1815 Beatport Streaming!), 574 Playlists | ✅ Bereits aktiv |
| hm.db | History | 84 Sessions, 1964 Plays, 3 Quellen (synchbaerDJ/AMIN_STUDIO/RAminDJ) | ✅ Bereits aktiv |
| rbm.db | Rekordbox-Import | 5048 lokale Tracks, 51 Playlists, 4 Tracks mit Cues | 🆕 NEU aktivieren |
| sm.db | Settings | LEER (0 rows) | ❌ Ignorieren |
| stm.db | Statistics | LEER (0 rows) | ❌ Ignorieren |
| itm.db | iTunes-Import | LEER (0 rows) | ❌ Ignorieren |
| trm.db | Traktor-Import | LEER (0 rows) | ❌ Ignorieren |

### BLOB-Format (geknackt!)

Alle PerformanceData-BLOBs: **4-Byte Längen-Header + zlib-komprimierte Daten** (`789c` magic byte)

**trackData** (28 bytes decompressed):
```
Offset 0-7:  double (big-endian) = sampleRate (44100.0)
Offset 8-15: int64 (big-endian)  = totalSamples
Offset 16-27: padding (zeros)
Verifiziert: totalSamples ÷ sampleRate = exakte Track.length
```

**quickCues** (152 bytes decompressed, max 8 Slots):
```
Header: 4 bytes unknown + 4 bytes max_cues (uint32 BE = 8)
Per Cue-Slot:
  1 byte    name_length
  N bytes   name (ASCII)
  8 bytes   position (double BE, in Samples; ÷44100 = Sekunden)
  4 bytes   color (ARGB: alpha + R + G + B)
Leere Slots: position = -1.0 (0xBFF0...)
```

**Verifiziertes Beispiel:**
```
Track #5719 "Surrender (Martin Landsky Remix)"
  Cue 0: "Start"           @  0.3s  #b4be04 (grün)
  Cue 1: "Drop"            @ 31.3s  #e62828 (rot)
  Cue 2: "End / Fade-out"  @217.1s  #b432ff (lila)
```

### Track-Overlap

- m.db: 1815 Beatport Streaming Tracks (uri = `streaming://Beatport%20LINK/Track/...`)
- rbm.db: 5048 lokale Tracks (path = `i:/Alles suenchbaer/...`, `f:/AUDIO/...`)
- **0 Overlap** zwischen m.db und rbm.db — komplett getrennte Welten

## Offene TODOs (6 Schritte, in Reihenfolge)

Jeder Schritt = Backend + IPC + UI zusammen. Conventional Commit pro Schritt.

### Schritt 1: DATABASE_FILES erweitern + rbm.db aktivieren
- [x] `DATABASE_FILES` in `engine_tools.py` um `"rekordbox": "rbm.db"` erweitern
- [x] `discover_all_engine_databases()` findet rbm.db
- [x] `build_summary()` zeigt `rekordboxTrackCount`
- [x] Neuer IPC-Handler in `main.mjs`
- [x] Preload-Bridge in `preload.mjs`
- [x] UI-Anzeige im Automation-Tab

### Schritt 2: PerformanceData BLOB-Decoder (Read-Only)
- [x] `parse_trackdata_blob(blob)` → `{ sample_rate, total_samples, duration_sec }`
- [x] `parse_quickcues_blob(blob)` → `[{ name, position_samples, position_seconds, color_hex }]`
- [x] `parse_loops_blob(blob)` → analog (Format noch zu verifizieren, gleiche Struktur erwartet)
- [x] In `dump_tracks_with_history()` integrieren: pro Track `performance: { has_cues, cue_count, cues: [...] }`
- [x] UI: Stats-Anzeige im Automation-Tab ("423/1200 mit Cues, 1817/1817 mit TrackData")

### Schritt 3: SmartList + isPersisted in list_playlists()
- [x] `isPersisted` Feld in `list_playlists()` Output hinzufügen
- [x] `SELECT title FROM Smartlist` als eigene Kategorie
- [x] UI: 📛-Symbol für nicht-persistierte Playlists

### Schritt 4: Multi-DB Diff-Funktion
- [x] `diff_databases(db_folder_a, db_folder_b)` implementieren
- [x] Matching über `filename` (lokal) und `uri` (Streaming)
- [x] Output: `{ only_in_a, only_in_b, in_both, metadata_differs }`
- [x] CLI-Subcommand: `engine_tools.py diff --db-a PATH --db-b PATH`
- [x] IPC + UI: Dropdown für DB-Auswahl + Diff-Tabelle

### Schritt 5: Unified History Merge
- [x] `unify_history([path1, path2, ...])` — hm.db aus mehreren Quellen
- [x] Session-Matching über `startTime + originDriveName`
- [x] Deduplizierung + chronologische Timeline
- [x] CLI: `engine_tools.py unify-history --sources PATH1 PATH2`
- [x] IPC + UI: Quellen-Auswahl + Merged Timeline

### Schritt 6: Legacy-Code Cleanup
- [x] `_sanitize_for_json()` für PerformanceData: statt `<BLOB 26 bytes>` dekodierte Daten
- [x] Leere DBs (sm/stm/itm/trm) als `optional` markieren
- [x] Kein `<BLOB N bytes>` String mehr in Output

## Wichtige Dateipfade

```
electron-app/integrations/python/engine_tools.py   ← Backend (HAUPTDATEI)
electron-app/main.mjs                               ← IPC-Handler (ab Zeile ~1306)
electron-app/preload.mjs                             ← Bridge (Zeile 65-87)
electron-app/renderer/tabs/automation.js             ← UI (Automation-Tab)
electron-app/data/export-formats.mjs                 ← Export (Rekordbox/Traktor)
```

## Architektur-Pattern (für jeden neuen Feature identisch)

```python
# 1. engine_tools.py: Neue Funktion
def neue_funktion(database_folder: Path, ...) -> dict:
    db_path = database_folder / DATABASE_FILES["main"]
    with connect_readonly(db_path) as conn:
        # PRAGMA query_only = ON (automatisch)
        rows = conn.execute("SELECT ...").fetchall()
    return {"ok": True, "data": [...]}

# 2. engine_tools.py: CLI-Subcommand registrieren (in build_parser())
subparsers.add_parser("neuer-befehl", ...)

# 3. main.mjs: IPC-Handler (~15 Zeilen)
ipcMain.handle("unified:neuer-befehl", async (_event, options = {}) => {
    return runPythonJson("electron-app/integrations/python/engine_tools.py",
        ["--database-folder", String(options.engineDatabaseFolder || ""), "neuer-befehl"],
        { pythonCommand: options.pythonCommand });
});

# 4. preload.mjs: Bridge (~1 Zeile)
neuerBefehl: (options) => ipcRenderer.invoke("unified:neuer-befehl", options),

# 5. automation.js: Button + State + Render
```

## Geschützte Dateien (NIEMALS umbenennen/löschen)

- `*.als`, `*.maxpat`, `*.vstpreset` — Ableton/Max/MSP Assets
- `electron-app/data/sync-presets.json` — User-Presets
- `electron-app/cache/` — Laufzeit-Cache

## Constraints

- **ALLES READ-ONLY** — `PRAGMA query_only = ON`, kein Schreiben in Engine DBs
- **Cue-Point-Export nach Rekordbox/Traktor ist KEINE Priorität** (erstmal nur lesen)
- **Lexicon + Engine Desktop** übernehmen Schreiboperationen
- **Python 3.10+** für engine_tools.py
- **Conventional Commits** pro Schritt

## Quelle: EngineSynchronize (Referenz-Code)

Repo: https://github.com/DJABO-dev/EngineSynchronize
- Zeigt wie PerformanceData gelesen wird (Zeilen 1095-1099)
- BLOBs werden dort nur als Byte-Copy übertragen, NICHT geparst
- Unser BLOB-Parser geht weiter als EngineSynchronize (wir dekodieren)
- Geklontes Repo zur Referenz: `./EngineSynchronize/EngineSynchronize-1.1.2.py`

## Startbefehl

```bash
cd ~/Projects/_local/beatport-dj-suite
claude "Lies LLM_HANDOFF.md und implementiere alle 6 Schritte. Starte mit Schritt 1+2 parallel (rbm.db + BLOB-Decoder). Nutze Agenten für parallele Arbeit. Conventional Commits pro Schritt."
```
