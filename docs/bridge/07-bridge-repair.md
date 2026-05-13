# Bridge Schritt 7 — Schema-Verfeinerung

**Erstellt:** 2026-05-13
**Vorausgesetzt:** Schritt 6 (Live-Test) abgeschlossen — siehe `06-engine-live-validation.md`
**Skript:** `packages/engine-db-core/tools/bridge/sync_history_v7.py`
**Sandbox-Pfad (Empfehlung):** `~/Music/Engine Library SANDBOX-v7/` (frische Kopie aus Produktiv)

---

## Was Schritt 7 anders macht als Schritt 5

| Aspekt | Schritt 5 (`sync_history.py`) | Schritt 7 (`sync_history_v7.py`) |
|---|---|---|
| `originDatabaseUuid` | frische `uuid4()` pro Bridge-Lauf | aus `m.db.Information.uuid` der Sandbox gelesen |
| `originDriveName` | hartcodiert NULL | CLI-Parameter `--drive-name` (default NULL für interne Drive) |
| `originListId`-Counter | gegen die frische UUID (immer 1) | gegen die echte Library-UUID (1 wenn neu, sonst MAX+1) |
| Erwartung | Engine zeigt Session, weiß aber nichts vom Library-Kontext | Engine kann Session der lokalen Library zuordnen → Tracks sichtbar |

## Befund aus Schritt 6 als Ausgangspunkt

- Engine DJ akzeptiert eine `Historylist` mit *frischer* UUID — sie erscheint in der History-Liste — kann aber die zugehörigen `HistorylistEntity.trackId`-Einträge offenbar nicht der lokalen Library zuordnen.
- Echte Sessions in `hm.db` haben durchweg `originDatabaseUuid`, die NICHT mit der `m.db.Information.uuid` der aktuellen Library übereinstimmt; sie tragen Drive-Labels wie `MOVESPEED`, `AMIN_STUDIO`, `1TB-Ext`. Das bedeutet: die echten Sessions stammen alle von externen Drives. Was Engine DJ macht, wenn eine Session aus der LOKALEN Library kommt, war im Datenbestand bisher nicht beobachtbar.
- Schritt 7 testet genau diesen Fall: Session mit lokaler `m.db.uuid` und ohne `originDriveName`.

## Test-Setup (Vorbereitung)

```bash
# 1) Engine DJ schließen, falls offen
pgrep -fl "Engine DJ" || echo "(beendet)"

# 2) Frische Sandbox aus Produktiv anlegen (nicht die alte überschreiben!)
cp -a "$HOME/Music/Engine Library" "$HOME/Music/Engine Library SANDBOX-v7"
ls -la "$HOME/Music/" | grep -i "engine library"

# 3) v7-Skript Dry-Run gegen die neue Sandbox
python3 packages/engine-db-core/tools/bridge/sync_history_v7.py \
  --db-dir "$HOME/Music/Engine Library SANDBOX-v7/Database2" \
  --track-ids 26888,26966,26976,27069,27114 \
  --dry-run

# 4) Live-Lauf
python3 packages/engine-db-core/tools/bridge/sync_history_v7.py \
  --db-dir "$HOME/Music/Engine Library SANDBOX-v7/Database2" \
  --track-ids 26888,26966,26976,27069,27114
```

## SQL-Akzeptanz-Checks (nach Live-Lauf)

```bash
# Erwartung: 1 neue Historylist, 5 neue HistorylistEntity, 5 Tracks isPlayed=1
SBX="$HOME/Music/Engine Library SANDBOX-v7/Database2"

sqlite3 "file:$SBX/hm.db?mode=ro" \
  "SELECT id, sessionId, originDriveName, originDatabaseUuid, originListId \
   FROM Historylist WHERE originDatabaseUuid = '9673391e-c3f4-46cd-afe9-63f814cdf58d';"

sqlite3 "file:$SBX/hm.db?mode=ro" \
  "SELECT listId, trackId, startTime FROM HistorylistEntity \
   WHERE listId IN (SELECT id FROM Historylist WHERE originDatabaseUuid = '9673391e-c3f4-46cd-afe9-63f814cdf58d');"

sqlite3 "file:$SBX/m.db?mode=ro" \
  "SELECT id, isPlayed, playedIndicator FROM Track WHERE id IN (26888,26966,26976,27069,27114);"
```

## Sandbox-Switch + Engine-DJ-Test

```bash
# Original parken
mv "$HOME/Music/Engine Library" "$HOME/Music/Engine Library.PROD-PARKED-v7"

# v7-Sandbox aktivieren
mv "$HOME/Music/Engine Library SANDBOX-v7" "$HOME/Music/Engine Library"
```

In Engine DJ starten und prüfen:

1. **History-Ansicht:** neue Session mit 5 Tracks erscheint und ist klickbar → 5 Track-Zeilen erkennbar.
2. **Playlist „Techno" (id 35) öffnen:** die fünf Bridge-Tracks (Behind The Glass, Espionnage, Makers, BraSex, Sahara) erscheinen als „bereits abgespielt" (grau oder mit „last played"-Datum).
3. **Streaming-Tracks rendern:** Cover, Titel, BPM erscheinen ohne manuelle Wiedergabe.

## Switch zurück

```bash
mv "$HOME/Music/Engine Library" "$HOME/Music/Engine Library SANDBOX-v7"
mv "$HOME/Music/Engine Library.PROD-PARKED-v7" "$HOME/Music/Engine Library"
```

## Wenn Schritt 7 immer noch fehlschlägt

Hypothesen für Schritt 8:

1. **`PerformanceData`-Tabelle ebenfalls aktualisieren** — `isPlayed`/`playedIndicator` könnten in einer zweiten Tabelle gespiegelt sein, die Engine als Cache nutzt.
2. **`originDriveName` doch setzen** (z.B. `"Macintosh HD"` oder der Volume-Name aus `diskutil info /`).
3. **Engine cached die History pro Session-Start** — die `editTime` der `Historylist` mitschreiben, evtl. zusätzlich `ChangeLog` ergänzen.
4. **Tracks gehören laut Engine zu einer anderen `originDatabaseUuid`** — wenn die Tracks aus einer externen Drive importiert wurden, könnte Engine erwarten, dass die Session denselben Drive-UUID-Stamp trägt wie die Tracks selbst (PlaylistEntity.databaseUuid).

## Erfolgs-Kriterien

| Check | Erwartung | Status |
|---|---|---|
| Test 1 — History-Session sichtbar **mit Tracks darin** | Klick auf Session zeigt 5 Track-Zeilen | ⏳ |
| Test 2 — Playlist „Techno" zeigt Tracks als gespielt | Graue Schrift oder „last played" Datum | ⏳ |
| Test 3 — Streaming-Tracks rendern in Playlist | Cover, Metadaten, BPM ohne manuelle Wiedergabe | ⏳ |

Mindestens Test 1 muss ✓ sein, damit Schritt 7 den USP-Bridge-Pfad belegt. Test 2 + 3 belegen den vollen Workflow.
