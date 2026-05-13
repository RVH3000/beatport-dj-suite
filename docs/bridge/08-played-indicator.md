# Bridge Schritt 8 — Played-Indicator-Bindung an Information

**Erstellt:** 2026-05-13
**Vorausgesetzt:** Schritt 7 (Live-Test) abgeschlossen — siehe `07-bridge-repair.md` mit Befund 3/3 ✗
**Skript:** `packages/engine-db-core/tools/bridge/sync_history_v8.py` (zu erstellen)
**Sandbox-Empfehlung:** `~/Music/Engine Library SANDBOX-v8/` (frische Kopie aus Produktiv)

---

## Hypothese aus Schritt 7

Engine DJ markiert Tracks NICHT alleine anhand `isPlayed = 1` und `playedIndicator != 0` als „bereits abgespielt". Stattdessen scheint Engine DJ eine **Cluster-Korrelation** zu erwarten:

- In echter `m.db` haben Tracks Plus-Cluster mit demselben `playedIndicator` (z.B. 72 Tracks teilen sich `-1899843733750016754`).
- `m.db.Information.currentPlayedIndiciator` zeigt auf den aktuell gültigen Wert.
- Synthetisch eingefügte Tracks mit Random-Indicator passen zu KEINEM Cluster und werden ignoriert.

## Was Schritt 8 anders macht

### Lese-Schritt
```sql
SELECT currentPlayedIndiciator FROM Information LIMIT 1;
```

Dieser Wert wird als `playedIndicator` in ALLE Track-Updates der Bridge-Session geschrieben.

### Schreib-Schritt (optional, beobachten)
Nach den Track-Updates `Information.currentPlayedIndiciator` rotieren auf einen neuen Random-int64. Das ahmt das Engine-Verhalten nach (vermutlich rotiert Engine den Indicator bei App-Start oder Session-Start).

### Erhaltene Schritt-7-Logik
- `originDatabaseUuid` weiterhin aus `m.db.Information.uuid` (lokale UUID)
- `originDriveName = NULL` (interne Drive)
- `originListId`-Counter gegen die echte UUID
- Sandbox-Pfad-Marker (`SANDBOX` im Pfad erzwungen)
- Track-Offsets 420s, Track-Validation, Engine-DJ-Aliveness-Check

## Skript-Skelett (sync_history_v8.py)

```python
SQL_READ_CURRENT_INDICATOR = (
    "SELECT currentPlayedIndiciator FROM Information LIMIT 1"
)
SQL_WRITE_CURRENT_INDICATOR = (
    "UPDATE Information SET currentPlayedIndiciator = ? WHERE id = 1"
)

# In run_bridge():
m_db_played_indicator = m_db.execute(SQL_READ_CURRENT_INDICATOR).fetchone()[0]
# Statt random: nutze den existierenden Cluster-Stempel
played_indicator = m_db_played_indicator

# Track-Updates wie gehabt (mit played_indicator)
# Optional am Ende: m_db.execute(SQL_WRITE_CURRENT_INDICATOR, (rotate_indicator,))
```

## Test-Setup

Identisch zu Schritt 7, nur Sandbox-Name und Skript-Name ändern:

```bash
cp -a "$HOME/Music/Engine Library" "$HOME/Music/Engine Library SANDBOX-v8"

python3 packages/engine-db-core/tools/bridge/sync_history_v8.py \
  --db-dir "$HOME/Music/Engine Library SANDBOX-v8/Database2" \
  --track-ids 26888,26966,26976,27069,27114 \
  --dry-run

python3 packages/engine-db-core/tools/bridge/sync_history_v8.py \
  --db-dir "$HOME/Music/Engine Library SANDBOX-v8/Database2" \
  --track-ids 26888,26966,26976,27069,27114
```

Switch-Workflow + Engine DJ Live-Test wie in `07-bridge-repair.md` beschrieben.

## Erfolgs-Kriterien (gleich wie Schritt 7)

| Check | Erwartung | Status |
|---|---|---|
| Test 1 — History-Session mit Tracks | Klick zeigt 5 Track-Zeilen | ⏳ |
| Test 2 — Tracks in Playlist „Techno" als gespielt | Grau/„last played"-Datum | ⏳ |
| Test 3 — Streaming-Tracks rendern direkt | Cover, BPM, Metadaten ohne Klick | ⏳ |

## Falls Schritt 8 auch fehlschlägt

Weitere Hypothesen für Schritt 9:

1. **`Track.lastEditTime` aktualisieren** — der `PerformanceData_after_update_Track_timestamp`-Trigger feuert auf Sub-Spalten, vielleicht erwartet Engine einen frischen Timestamp.
2. **`albumArtSourceHash` setzen** — Streaming-Tracks haben oft `albumArtSourceHash = NULL`; Engine könnte ohne Hash kein Cover-Display anzeigen.
3. **`ChangeLog` ergänzen** — Engine cached vermutlich pro Sync; ein Eintrag in `ChangeLog` mit dem Track-Update könnte den Renderer-Cache invalidieren.
4. **Beatport-LINK-spezifische Felder** — die `Beatport LINK/` Unterordner im Library-Ordner könnten Cache-JSON enthalten, die separat manipuliert werden müssen.
5. **Workflow ändern**: Track ein einziges Mal echt abspielen, dann das Schema beobachten („was ändert sich"), und exakt diese Diffs in der Bridge replizieren.
