# Bridge Schritt 6 — Engine DJ Live-Verifikation

**Erstellt:** 2026-05-09
**Vorausgesetzt:** Schritt 5 (PoC) abgeschlossen — siehe `RESULT.md` im engine-dj-manager-Repo
**Repo:** Test-Lauf gegen `~/Music/Engine Library SANDBOX-claude/`
**Ziel:** verifizieren, dass die synthetischen History-Einträge von Engine DJ als „abgespielt" akzeptiert werden — sichtbar im UI

---

## Status nach diesem Bridge-Lauf

**Sandbox-Pfad:** `/Users/roberth./Music/Engine Library SANDBOX-claude/`

**Bridge-Run vom 2026-05-09:**
- Skript: `~/Projects/_github/engine-dj-manager/tools/bridge/sync_history.py`
- Test-Tracks (alle aus Playlist „Techno", id=35): `26888, 26966, 26976, 27069, 27114`
- Historylist-id: `52`
- sessionId: `1095413285`
- playedIndicator (für alle 5): `-6721445176229469549`
- startTime der Session: `1778290825` (= 2026-05-09 01:53:45 lokal)
- Track-Offsets: 0s / 420s / 840s / 1260s / 1680s

**SQL-Akzeptanz-Checks gegen Sandbox: 4/4 ✓**
- m.db.Track: alle 5 Tracks `isPlayed=1`, `playedIndicator` gesetzt, `timeLastPlayed` plausibel
- hm.db.Historylist: id=52 mit erwarteten Feldern (timezone, UUID, originListId=1, isDeleted=0)
- hm.db.HistorylistEntity: 5 Einträge, alle mit listId=52
- Produktiv-DB unverändert (isPlayed=0/NULL, playedIndicator=0 — keine -67214… Werte)

---

## Was Schritt 6 zeigen soll

Engine DJ ist eine proprietäre Anwendung. Die SQL-Schreiboperationen technisch korrekt zu fahren ist eine Sache — ob Engine DJ die Daten **als ob sie aus einer echten Wiedergabe stammen** behandelt, ist eine andere.

Die Validierung muss **visuell** in Engine DJ erfolgen: die 5 Test-Tracks sollten in der Engine-DJ-UI als bereits abgespielt sichtbar sein und in einer neuen History-Session erscheinen.

---

## Sandbox-Switch (Pflicht-Schritt vor Engine DJ Start)

Engine DJ liest die Library hardcoded aus `~/Music/Engine Library/`. Um die Sandbox zu testen, muss die Library temporär umgehängt werden.

### Vorbereitung

1. **Engine DJ schließen**, falls offen.
2. Prüfen, dass kein Engine-DJ-Prozess läuft:
   ```bash
   pgrep -fl "Engine DJ"
   ```
   Wenn ein Treffer: erst diesen Prozess sauber beenden.

### Switch auf Sandbox

```bash
# Original parken
mv "$HOME/Music/Engine Library" "$HOME/Music/Engine Library.PROD-PARKED"

# Sandbox aktivieren
mv "$HOME/Music/Engine Library SANDBOX-claude" "$HOME/Music/Engine Library"
```

### Visueller Sicherheitscheck (vor Engine-DJ-Start)

```bash
ls -la "$HOME/Music/" | grep -i "engine library"
```

Erwartung:
- `Engine Library` → das ist jetzt die Sandbox
- `Engine Library.PROD-PARKED` → das ist die echte Library, geparkt
- KEIN `Engine Library SANDBOX-claude` mehr

Wenn beides da ist (Original UND Sandbox): **STOPP** — Switch hat nicht funktioniert.

### Switch zurück (PFLICHT nach dem Test)

```bash
# Sandbox zurück in den Sandbox-Slot
mv "$HOME/Music/Engine Library" "$HOME/Music/Engine Library SANDBOX-claude"

# Original wieder aktiv
mv "$HOME/Music/Engine Library.PROD-PARKED" "$HOME/Music/Engine Library"
```

Danach `ls`-Check wiederholen.

---

## Live-Test in Engine DJ

Nach dem Switch:

1. Engine DJ starten.
2. Library-Indexierung abwarten (kann 30s–2min dauern, je nachdem ob Engine den Lock-Status erkennt).
3. **Test 1 — History-Session sichtbar:**
   - In Engine DJ zur „History"-Ansicht navigieren
   - Eine Session vom 2026-05-09 ~01:53 Uhr lokal sollte erscheinen
   - Diese Session sollte 5 Tracks enthalten (Reihenfolge: Behind The Glass / Espionnage / Makers / BraSex / Sahara)
4. **Test 2 — Tracks in Playlist „Techno" als gespielt markiert:**
   - Zur Playlist „Techno" navigieren (id 35)
   - Die fünf Test-Tracks finden (Behind The Glass, Espionnage, Makers, BraSex, Sahara)
   - Engine DJ sollte sie visuell als „bereits abgespielt" anzeigen — typischerweise grauer/halb-transparenter Track-Eintrag oder ein „last played"-Datum
5. **Test 3 — Streaming-Tracks rendern korrekt in gemischter Playlist:**
   - Das ist der eigentliche Bridge-USP: bei einer Playlist mit Streaming + lokalen Tracks sollten die Streaming-Tracks **direkt** mit Cover/Metadaten erscheinen, nicht erst nach manuellem Anklicken
   - Idealer Test: eine Playlist öffnen, die die Test-Tracks enthält, und prüfen ob die fünf Beatport-LINK-Tracks ohne Vorab-Wiedergabe vollständig dargestellt werden

---

## Erfolgs-Kriterien

| Check | Erwartung | Status |
|---|---|---|
| Test 1 — History-Session vom 2026-05-09 sichtbar | Session mit 5 Tracks taucht in History-Liste auf | ⚠️ partial |
| Test 2 — Tracks visuell als abgespielt markiert | Engine DJ zeigt graue/transparente Darstellung oder „last played"-Datum | ✗ (siehe Befund) |
| Test 3 — Streaming-Tracks rendern in Playlist | Cover, Metadaten, BPM ohne manuelle Wiedergabe sichtbar | – (nicht testbar) |

**Mindestens Test 1 + Test 2 müssen ✓ sein**, damit der USP belegt ist. Test 3 ist der Beweis für „die letzte Meile" — wenn der nicht klappt, ist die Bridge zwar technisch korrekt, aber das eigentliche Produkt-Feature greift nicht.

---

## Live-Test-Ergebnis 2026-05-13

**Umgebung:** Engine DJ Release v4.3.4.7d5a3fd8bc auf macOS (Mac Mini Pro M4 Pro)
**Library:** Sandbox `~/Music/Engine Library SANDBOX-claude/` temporär auf den Library-Slot geswitcht, nach Test sauber zurückgeschoben. Produktiv-DB war zu jeder Zeit als `Engine Library.PROD-PARKED` außen vor.

### Test 1 — ⚠️ partial pass

**Sichtbar:**
- History-Session vom 2026-05-09 ~01:53 erscheint in der History-Liste (Engine DJ akzeptiert `Historylist 52` als gültige Session).

**Nicht sichtbar:**
- Die 5 zugehörigen Tracks (Behind The Glass / Espionnage / Makers / BraSex / Sahara) tauchen in der Session-Detailansicht NICHT auf. Die Session bleibt scheinbar leer.

**Wahrscheinliche Ursache (SQL-Diagnose nach dem Test):**
- `Historylist 52` hat `originDriveName = NULL` und `originDatabaseUuid = 33238f3a-2c5d-44a7-befa-0d1cca6cbad8`.
- Vergleich mit echter Session #51: `originDriveName = MOVESPEED` (externe Drive), `originDatabaseUuid = 16e16436-933e-4735-87e9-8e390b32cf90` (passend zur aktiven Library).
- Engine DJ scheint die Session-Tracks über `(originDriveName, originDatabaseUuid, trackId)` aufzulösen. Wenn `originDriveName` fehlt und/oder `originDatabaseUuid` nicht zur aktiven Library passt, findet Engine die Tracks der Session nicht.

### Test 2 — ✗ Doku-Fehler in Schritt 6, kein Bridge-Bug

Die Anweisung „In Engine DJ zur Playlist „Techno" navigieren (id 35)" war irreführend. Nachträgliche SQL-Prüfung:

```sql
-- Playlist 35 enthält Track-IDs 2043, 2045, 2052, ... mit
-- databaseUuid = 03399503-d22d-47b9-aff9-752231bdd75b
-- Die Bridge-Tracks (26888, 26966, 26976, 27069, 27114) sind NICHT in Playlist 35.
-- Es gibt keine Playlist namens exakt „Techno"; nur Genre-Varianten wie
-- „1994–1999 Genre Techno MP3", „Melodic House & Techno", …
```

Der Test-Track-Status (`isPlayed = 1`, `playedIndicator` gesetzt, `timeLastPlayed`) ist auf m.db-Ebene korrekt — aber die Visual-Verifikation braucht eine Playlist, in der diese Tracks tatsächlich enthalten sind.

### Test 3 — nicht testbar

Test 3 hing logisch an Test 2 (Playlist mit den Bridge-Tracks öffnen). Da Test 2 nicht stattfinden konnte, blieb auch Test 3 ohne Befund.

---

## Schritt 7 (Folge-Iteration) — Schema-Verfeinerung

Was Schritt 7 lösen muss, basierend auf dem Befund:

1. **`originDriveName` setzen:** Bei macOS in der Regel `Macintosh HD`, bei externer Drive (z.B. MOVESPEED) deren Volume-Label.
2. **`originDatabaseUuid` an die aktive Library binden:** Aus der aktiven Engine-DB den `Information`-Eintrag oder eine andere UUID-Quelle lesen, statt selbst eine zu generieren.
3. **Sinnvollen visuellen Test-Fall wählen:** Eine echte Playlist in der Sandbox identifizieren, die die Bridge-Tracks enthält, ODER neue Tracks gezielt in eine Test-Playlist legen (PlaylistEntity-Insert) bevor die Bridge fährt.
4. **Optional: `editTime` auf Historylist setzen.** Trigger `trigger_after_update_Historylist` aktualisiert `editTime` nur bei Title-Updates; ein INSERT setzt es nicht. Prüfen ob Engine das bei der Anzeige nutzt.

**Sandbox-Zustand für Schritt 7 bleibt erhalten** unter `~/Music/Engine Library SANDBOX-claude/` (Bridge-Daten vom 2026-05-09 plus History 52 mit den 5 Tracks noch drin). Neue Iteration kann darauf aufsetzen oder eine frische Sandbox anlegen.

---

## Was tun bei Misserfolg

### Test 1 schlägt fehl (keine History-Session sichtbar)

- Engine DJ erwartet möglicherweise zusätzliche Felder in `Historylist` oder `HistorylistEntity`, die wir noch nicht setzen
- Mögliche Kandidaten: `originDriveName` (aktuell NULL), eine Hash-Spalte, oder die `nextEntityId`-Verkettung in PlaylistEntity-Style
- Action: Engine DJ schließen, mit `sqlite3` die letzten 3 echten History-Einträge mit unseren Bridge-Einträgen vergleichen — gibt es ein Feld, das in echten Sessions immer gesetzt ist und in unserer Bridge-Session NULL?

### Test 2 schlägt fehl (Tracks nicht als gespielt markiert)

- Möglicherweise gibt es eine Cache-Tabelle (PerformanceData?) die zusätzlich aktualisiert werden muss
- Oder Engine wertet `isPlayed=1` nur in Verbindung mit einem zusätzlichen Indikator
- Action: einen Track manuell in der ECHTEN Library spielen, dann m.db-Snapshot machen, mit unserem Bridge-Output diffen

### Test 3 schlägt fehl (Streaming-Tracks rendern noch immer nicht)

- Der USP ist nicht durch History-Einträge alleine lösbar
- Action: Streaming-Track-Cache-Mechanismus von Engine DJ tiefer analysieren — möglicherweise gibt es eine `stm.db` (Streaming) oder eine `cache`-Spalte, die wir nicht angerührt haben
- Das wäre ein Schritt 7 mit erweitertem Schema

---

## Sandbox aufräumen nach erfolgreichem Test

Wenn alle Tests grün sind:

1. Engine DJ schließen
2. Switch zurück (siehe oben)
3. Optional: Sandbox neu erstellen (frischer Stand, falls weitere Test-Runs geplant)
   ```bash
   rm -rf "$HOME/Music/Engine Library SANDBOX-claude"
   cp -R "$HOME/Music/Engine Library" "$HOME/Music/Engine Library SANDBOX-claude"
   ```
4. Ergebnis in dieser Datei unter „Erfolgs-Kriterien" eintragen (✓ statt ⏳)

---

## Nächster Schritt nach Schritt 6

Bei Erfolg:
- `@bpdjs/engine-bridge` als Paket-Skelett im v4.2-Monorepo anlegen (eigenes Paket — Bridge ist groß genug)
- Integration in die Suite-UI als Pro-Feature überlegen (Lizenz-Gate)
- Beatport-API für Track-ID-Discovery integrieren (aktuell: Track-IDs müssen manuell aus der DB kommen)

Bei Misserfolg eines Tests:
- Schritt 7 — erweitertes Schema-Mapping basierend auf Engine-DJ-Verhalten
