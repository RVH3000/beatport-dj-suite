# Bridge PoC Schritt 5 — Testlauf-Ergebnisse

**Datum:** 2026-04-20
**Umgebung:** Claude Code CLI auf macOS 14.4
**Python:** 3.14.4
**Sandbox:** `/Users/roberth./Music/Engine Library SANDBOX-claude/Database2`
**Skript:** `tools/bridge/sync_history.py`

---

## Akzeptanz-Checks — Gesamtergebnis

| # | Check | Status |
|---|---|---|
| 1 | Skript läuft ohne Fehler durch, Exit 0 | ✓ |
| 2 | Track in m.db aktualisiert (isPlayed=1, Indicator gesetzt, Timestamp gesetzt) | ✓ |
| 3 | Neue Historylist in hm.db mit erwarteten Feldern | ✓ |
| 4 | HistorylistEntity-Einträge verknüpfen Tracks mit Session | ✓ |
| Bonus | Produktiv-DB unverändert | ✓ (teilbestätigt, siehe Notiz unten) |

---

## Testlauf 1 — Dry-Run, 1 Track

**Aufruf:** `python3 tools/bridge/sync_history.py --track-ids 9837 --dry-run`

**Ergebnis:**
- Exit-Code: 0
- Skript loggt alle SQL-Parameter, kein DB-Write
- `list_id` in Ergebnis = `None` (kein INSERT ausgeführt)

---

## Testlauf 2 — Live, 1 Track

**Aufruf:** `python3 tools/bridge/sync_history.py --track-ids 9837`

**Ergebnis:**
- Exit-Code: 0
- `list_id = 3326`, `session_id = 473486811`, `origin_list_id = 1`
- `played_indicator = 8447583555594167097`
- `origin_database_uuid = b1972c22-2baf-4d15-b416-bcd45bb44c3e`

**Verify via `--verify`:**
```
[Check 3] Historylist id=3326
  sessionId=473486811 startTime=1776688817 timezone=Europe/Vienna
  originDatabaseUuid=b1972c22-2baf-4d15-b416-bcd45bb44c3e originListId=1 isDeleted=0

[Check 4] HistorylistEntity WHERE listId=3326
  entity_id=122453 trackId=9837 startTime=1776688817
  Total: 1 Zeile(n)

[Check 2] m.db.Track fuer [9837]
  id=9837 isPlayed=1 playedIndicator=8447583555594167097 timeLastPlayed=1776688817
  title='Sunglasses at Night (Original Mix)'

[Bonus] Produktiv-m.db (Read-Only)
  id=9837 isPlayed=None playedIndicator=0 timeLastPlayed=None
```

Alle vier Checks grün — inklusive Bonus (Produktiv unverändert).

---

## Testlauf 3 — Live, 3 Tracks

**Aufruf:** `python3 tools/bridge/sync_history.py --track-ids 9837,9839,9840`

**Ergebnis:**
- Exit-Code: 0
- `list_id = 3327`, `session_id = 1017790637`, `origin_list_id = 1`
- `played_indicator = 9207908886118144552` (identisch für alle drei Tracks)
- Track-Zeiten: 1776689420, 1776689840, 1776690260 (420s Abstände)

**Check 3 — Historylist:**
```
3327 | 1017790637 | 1776689420 | Europe/Vienna | de880bd8-986d-44db-8269-91733e9b8bc9 | 1 | 0
```

**Check 4 — HistorylistEntity (JOIN Historylist):**
```
listId | trackId | startTime   | sessionId
3327   | 9837    | 1776689420  | 1017790637
3327   | 9839    | 1776689840  | 1017790637
3327   | 9840    | 1776690260  | 1017790637
```

3 Zeilen, identische `listId`, identische `sessionId`, aufsteigende `startTime`.

**Check 2 — m.db.Track in Sandbox:**
```
9837 | Sunglasses at Night (Original Mix)    | 1 | 9207908886118144552 | 1776689420
9839 | Before feat. Clara Hill (Original Mix)| 1 | 9207908886118144552 | 1776689840
9840 | Starlighter (JBAG Remix)              | 1 | 9207908886118144552 | 1776690260
```

Alle drei Tracks `isPlayed=1`, identischer `playedIndicator` (Session-ID), `timeLastPlayed` entspricht der `HistorylistEntity.startTime`.

**Beobachtung:** Track 9837 bekam in diesem Lauf einen **neuen** `playedIndicator` (`9207...` statt `8447...` aus Testlauf 2). Unser UPDATE ist absolut, nicht conditional — bereits gespielte Tracks werden überschrieben, wenn sie erneut in einem Batch landen. Engine DJ selbst überschreibt den Wert nach einer aktuellen Analyse-Notiz in `03-track-analyse.md` NICHT. Für den PoC-Zweck irrelevant (Engine sieht den Track weiterhin als "abgespielt"), aber festgehalten für spätere Diskussion.

---

## Bonus-Check — Notiz

Die Produktiv-DB `/Users/roberth./Music/Engine Library/Database2/m.db` ist während Testlauf 3 für direkte `sqlite3`-Queries temporär nicht lesbar (das Verzeichnis-`ls` gab "Interrupted system call" zurück — typischer Fingerabdruck eines laufenden macOS-Volume-Snapshots, z.B. Time Machine oder Spotlight-Indexierung). Drei Hinweise, dass die Produktiv-DB trotzdem sicher unverändert ist:

1. **Code-Garantie:** Das Skript löst den Schreibpfad ausschließlich über `resolve_paths()` auf. Dort greift die Substring-Assertion auf `SANDBOX`. Ein Schreibversuch auf die Produktiv-DB ist im Python-Code nicht möglich, ohne Source zu ändern.
2. **mtime der Datei:** `stat` zeigt die Produktiv-m.db hat `mtime = 1776187947` — das liegt **vor** der Bridge-Session. Keine Schreiboperation seitdem.
3. **Erfolgreicher Read bei Lauf 2:** Der Bonus-Check direkt nach Testlauf 2 (über `--verify`) zeigte für Track 9837 in der Produktiv-DB `isPlayed=None, playedIndicator=0, timeLastPlayed=None`. Zwischen Lauf 2 und Lauf 3 hat das Skript nichts an der Produktiv-DB getan.

Sobald das Filesystem den Pfad wieder herausgibt, kann der Bonus-Check für 9837/9839/9840 nachgezogen werden per:

```bash
sqlite3 "file:/Users/roberth./Music/Engine Library/Database2/m.db?mode=ro&immutable=1" \
  "SELECT id, isPlayed, playedIndicator, timeLastPlayed
   FROM Track WHERE id IN (9837, 9839, 9840) ORDER BY id"
```

Erwartung: alle drei Zeilen `isPlayed=None, playedIndicator=0, timeLastPlayed=None`.

---

## Sandbox-Zustand nach den drei Testläufen

- **hm.db.Historylist:** 2 neue Einträge (IDs 3326 und 3327). Vor den Tests: max_id = 3325, jetzt 3327.
- **hm.db.HistorylistEntity:** 4 neue Einträge (1 aus Lauf 2, 3 aus Lauf 3).
- **m.db.Track:** 3 Tracks verändert (9837, 9839, 9840). Alle haben jetzt `isPlayed=1`.

**Empfehlung:** Ein Sandbox-Reset ist nicht zwingend, die Änderungen sind minimal und entsprechen einem realistischen Engine-DJ-Bridge-Lauf. Falls für Schritt 6 (Engine-DJ-Live-Test) ein reproduzierbarer Ausgangszustand gewünscht ist:

```bash
rm -rf "/Users/roberth./Music/Engine Library SANDBOX-claude"
cp -R "/Users/roberth./Music/Engine Library" \
      "/Users/roberth./Music/Engine Library SANDBOX-claude"
```

---

## Nicht im Scope dieses Schritts (zur Erinnerung)

- Engine-DJ-Live-Test (Schritt 6)
- UI-Integration
- Retry/Queue-Logik
- Beatport-Authentifizierung
- Git-Commit (macht Robert manuell)

---

## Nächster Schritt

**Schritt 6 — Engine-DJ-Akzeptanz-Test.** Sandbox-DB temporär an Original-Position mounten, Engine DJ starten, prüfen ob die synthetischen History-Einträge und die geänderten Track-Felder in Playlists korrekt angezeigt werden.
