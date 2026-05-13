# Bridge — PoC Schritt 5: synthetische History-Einträge

`sync_history.py` erzeugt in der Engine-DJ-Sandbox-Datenbank einen synthetischen
"abgespielt"-Zustand für eine Liste von Track-IDs. Engine DJ behandelt diese
Tracks danach als mindestens einmal abgespielt — das ist die Voraussetzung,
damit Streaming-Tracks (Beatport LINK, SoundCloud) in gemischten Playlists
korrekt angezeigt werden.

**Scope:** reines CLI-Skript, Standard-Library only. Keine UI, keine API.

---

## Sicherheits-Regeln

Diese Regeln sind im Skript hart verdrahtet. Sie dürfen nicht aufgeweicht werden.

1. **Nur Sandbox.** Der DB-Pfad muss den Substring `SANDBOX` enthalten.
   Produktiv-Pfad (`~/Music/Engine Library/Database2`) wird durch Assertion
   blockiert.
2. **Engine DJ darf nicht laufen.** `pgrep -f "Engine DJ"` wird vor jedem Lauf
   geprüft. Falls Engine läuft: Abbruch mit Hinweis. Das Skript killt Engine
   nie selbst.
3. **Nur INSERT / UPDATE.** Kein DELETE, DROP, TRUNCATE. Aufräumen manuell.
4. **Atomare Transaktionen.** Zwei DB-Connections (m.db, hm.db). Im Fehlerfall
   werden beide zurückgerollt. m.db wird zuerst committet, dann hm.db.
5. **Keine Git-Ops, keine Paket-Installationen.**
6. **Produktiv-DB im Bonus-Check nur lesend.** Der `--verify`-Modus öffnet die
   Produktiv-DB im URI-Read-Only-Modus (`file:...?mode=ro`).

---

## Nutzung

### Standard-Lauf (Live)

```bash
python3 tools/bridge/sync_history.py --track-ids 9837,9839,9840
```

Default-Sandbox ist:

```
/Users/roberth./Music/Engine Library SANDBOX-claude/Database2
```

### Andere Sandbox verwenden

```bash
BRIDGE_DB_DIR="/Users/roberth./Music/Engine Library SANDBOX/Database2" \
  python3 tools/bridge/sync_history.py --track-ids 9837
```

Der Pfad muss `SANDBOX` enthalten, sonst Abbruch mit Exit-Code 1.

### Dry-Run (nichts schreiben, nur planen)

```bash
python3 tools/bridge/sync_history.py --track-ids 9837 --dry-run
```

Loggt alle SQL-Parameter, öffnet keine Writes.

### Verify (letzten Bridge-Lauf prüfen)

```bash
python3 tools/bridge/sync_history.py --verify
```

Zeigt die zuletzt eingefügte `Historylist`, alle zugehörigen
`HistorylistEntity`-Zeilen, den Zustand der betroffenen Tracks in der Sandbox
und den Bonus-Check gegen die Produktiv-DB.

Optional mit spezifischer List-ID oder Track-Filter:

```bash
python3 tools/bridge/sync_history.py --verify --list-id 3326
python3 tools/bridge/sync_history.py --verify --track-ids 9837,9839
```

### Timezone überschreiben

```bash
python3 tools/bridge/sync_history.py --track-ids 9837 --timezone "Europe/Berlin"
```

Default ist `Europe/Vienna` (entspricht allen 2.466 realen Sessions in der
Sandbox).

---

## Exit-Codes

| Code | Bedeutung |
|---|---|
| 0 | Erfolg |
| 1 | Pfad-Check (Sandbox-Marker fehlt oder DB-Datei nicht gefunden) |
| 2 | Engine DJ läuft |
| 3 | Eine oder mehrere Track-IDs fehlen in `m.db.Track` |
| 4 | SQLite-Fehler während Bridge-Ausführung |
| 5 | CLI-Nutzungsfehler (z.B. `--track-ids` fehlt) |

---

## Was das Skript tut

Pro Bridge-Lauf mit N Tracks:

1. Genau **ein** INSERT in `hm.db.Historylist` → neue Session
   - `sessionId` = zufälliger positiver Int32 (`secrets.randbits(31)`)
   - `originDatabaseUuid` = frische UUID4
   - `originListId` = `MAX(originListId) WHERE originDatabaseUuid = ?` + 1
     (bei frischer UUID immer 1)
   - `timezone` = CLI-Parameter
   - `startTime` = `int(time.time())`
   - `isDeleted = 0`, `title = NULL`
2. **N** INSERTs in `hm.db.HistorylistEntity` → Tracks pro Session
   - `listId` = die `id` aus Schritt 1
   - `startTime` = Session-Start + 7 Minuten * Track-Index
3. **N** UPDATEs in `m.db.Track` → Abspiel-Zustand
   - `isPlayed = 1`
   - `playedIndicator` = zufälliger Signed Int64 (einmalig pro Bridge-Lauf,
     identisch für alle Tracks der Session)
   - `timeLastPlayed` = selber Timestamp wie `HistorylistEntity.startTime`
     des zugehörigen Tracks

Commit-Reihenfolge: **m.db zuerst, dann hm.db.** Begründung im Plan-Dokument
(`~/.claude/plans/ultraplan-ich-will-schritt-wondrous-catmull.md`, Abschnitt
"Adversarial Testing", Szenario 5).

---

## Bekannte Grenzen

- **Kein Engine-DJ-Live-Test.** Dass Engine DJ die Einträge akzeptiert und
  Streaming-Tracks korrekt anzeigt, wird in Schritt 6 separat geprüft.
- **Keine Retry-Logik.** Bei DB-Fehler: Rollback und Exit, keine
  Wiederholungen.
- **Kein Schreibschutz auf OS-Ebene.** Die Assertion wirkt nur im Python-Prozess.
  Wer die Assertion ausbaut und gleichzeitig `BRIDGE_DB_DIR` auf Produktion
  setzt, kann Schaden anrichten. Review jede Änderung.
- **Keine Deduplizierung.** Wird dieselbe Track-ID doppelt übergeben, erzeugt
  das zwei `HistorylistEntity`-Einträge mit derselben `trackId`. Engine DJ
  toleriert das (entspricht "zweimal abgespielt in einer Session").

---

## Beispiele für die Verifikations-Checks (manuell via sqlite3)

```bash
# Check 2 — Track in m.db
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX-claude/Database2/m.db" \
  "SELECT id, title, isPlayed, playedIndicator, timeLastPlayed
   FROM Track WHERE id = 9837"

# Check 3 — neueste Historylist
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX-claude/Database2/hm.db" \
  "SELECT id, sessionId, startTime, timezone,
          originDatabaseUuid, originListId, isDeleted
   FROM Historylist ORDER BY id DESC LIMIT 1"

# Check 4 — Entity-Join
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX-claude/Database2/hm.db" \
  "SELECT hle.listId, hle.trackId, hle.startTime,
          hl.sessionId, hl.originDatabaseUuid
   FROM HistorylistEntity hle
   JOIN Historylist hl ON hl.id = hle.listId
   ORDER BY hle.id DESC LIMIT 5"

# Bonus — Produktiv-DB unverändert
sqlite3 "/Users/roberth./Music/Engine Library/Database2/m.db" \
  "SELECT id, isPlayed, playedIndicator FROM Track WHERE id = 9837"
```

Oder kompakt via `--verify`-Modus (siehe oben).
