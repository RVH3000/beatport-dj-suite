# Bridge — Schritt 2: Sandbox in engine-dj-manager einbinden

**Datum:** 20. April 2026
**Kontext:** Beatport LINK → Engine Library Bridge (siehe `HANDOFF_BRIDGE_SESSION.md`)
**Vorgänger:** `docs/bridge/01-engine-tools-analysis.md` (Commit `ea2af1c`, Branch `v4`)
**Status:** ✅ Abgeschlossen — alle drei Verifikations-Checks bestanden

---

## Zusammenfassung

Die Next.js-App `engine-dj-manager` wurde so umgebaut, dass sie beim Start eine Sandbox-Kopie der Engine-DJ-Datenbank verwendet statt der produktiven Library. Alle zukünftigen PoC-Experimente (History-Write-Endpoint, INSERTs in `hm.db`) laufen ab jetzt ausschließlich gegen die Sandbox — das Original unter `~/Music/Engine Library/Database2/` bleibt unangetastet.

Die Write-Isolation wurde durch einen End-to-End-Test bewiesen (siehe Abschnitt „Verifikation").

---

## Abweichung vom Original-Handoff

Der ursprüngliche Handoff `HANDOFF_03_POC_V2.md` ging davon aus, dass eine einfache `.env.local`-Datei mit `DATABASE_PATH=...` reicht. Die Exploration der CLI-Session zeigte: Die Pfade waren in `engine-db.ts:6` und `engine-history-db.ts:6` hart verdrahtet (`path.join(os.homedir(), 'Music', 'Engine Library', ...)`). Eine Umgebungsvariable alleine hätte daher nichts bewirkt — der Code liest sie gar nicht.

**Korrektur:** Vor dem Setzen der `.env.local` wurde die Pfad-Auflösung zentralisiert.

---

## Was konkret geändert wurde

Im Repo `~/Projects/_github/engine-dj-manager/`:

### Neue Datei — `src/lib/engine-paths.ts`

Zentraler Helfer, der die Pfade für `m.db` (Track-DB) und `hm.db` (History-DB) auflöst. Liest `process.env.DATABASE_PATH` als Basis-Verzeichnis; fällt auf den Original-Pfad zurück wenn die Variable nicht gesetzt ist. Loggt die aufgelösten Pfade beim Modul-Load, damit im Dev-Server-Output sofort sichtbar ist, ob die Sandbox greift.

### Änderung — `src/lib/engine-db.ts`

Die Zeile mit der hart verdrahteten Pfad-Konstante wurde entfernt; stattdessen Import aus `./engine-paths`. Imports von `path` und `os` entfernt (wurden nach dem Refactor nicht mehr gebraucht).

### Änderung — `src/lib/engine-history-db.ts`

Analog zu `engine-db.ts`: hart verdrahtete Konstante durch Import ersetzt.

### Neue Datei — `.env.local`

Inhalt:
```
DATABASE_PATH=/Users/roberth./Music/Engine Library SANDBOX/Database2
```

Steht bereits in `.gitignore` (Zeile 14) — wird nicht committet.

---

## Verifikation

### ✅ Startup-Check — bestanden

Nach `npm run dev` erscheint im Server-Log:

```
[engine-paths] Using DATABASE_PATH override: /Users/roberth./Music/Engine Library SANDBOX/Database2
```

Alle API-Routen antworten mit HTTP 200:
- `/api/tracks` → 200
- `/api/playlists` → 200
- `/api/history` → 200
- `/api/health` → 200

### ✅ UI-Check — bestanden

Browser auf `http://localhost:3000`: Track-Liste wird korrekt angezeigt, inklusive Artist und Titel. Edit-Funktion funktioniert in der UI.

### ✅ Write-Isolation-Check — bestanden

**Testaufbau:**

Track-ID aus der Sandbox-DB geholt:
```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db" \
  "SELECT id, title, artist FROM Track ORDER BY id LIMIT 10"
```

Ausgewählt: `9832 | Thee Church Ov Acid House - Waves Ov Power | Thee Church Ov Acid House`

**Aktion:** In der UI unter `http://localhost:3000` den Titel von Track 9832 auf `SANDBOX-TEST-0420` geändert und gespeichert.

**Vergleichs-Queries:**

Sandbox-DB:
```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db" \
  "SELECT id, title FROM Track WHERE id = 9832"
```
Ergebnis:
```
9832|SANDBOX-TEST-0420
```

Original-DB:
```bash
sqlite3 "/Users/roberth./Music/Engine Library/Database2/m.db" \
  "SELECT id, title FROM Track WHERE id = 9832"
```
Ergebnis:
```
9832|Thee Church Ov Acid House - Waves Ov Power
```

**Beweis:** Die Sandbox hat den neuen Titel, das Original den ursprünglichen. Die Write-Isolation funktioniert.

---

## Warum das funktioniert

Alle Call-Sites in `src/app/api/**` rufen `new EngineDB()` bzw. `new EngineHistoryDB()` ohne Pfad-Override auf. Sie bekommen daher automatisch den Sandbox-Pfad, sobald die Umgebungsvariable gesetzt ist. Die bestehende Read-Write-Unterscheidung (zweiter Konstruktor-Parameter `readonly: boolean = true`, wird z.B. in `src/app/api/history/deduplicate/route.ts:6` auf `false` gesetzt) bleibt unverändert.

---

## Was in diesem Schritt NICHT passiert ist

- Kein History-Write-Endpoint (kommt in Schritt 4)
- Kein Schema-Dump von `hm.db` (kommt in Schritt 3)
- Kein INSERT in `HistorylistEntity` (kommt in Schritt 5)
- Kein Touch an der Backup-Route
- Kein Git-Commit

---

## Geänderte Dateien — Übersicht

| Pfad | Art |
|---|---|
| `~/Projects/_github/engine-dj-manager/src/lib/engine-paths.ts` | neu |
| `~/Projects/_github/engine-dj-manager/src/lib/engine-db.ts` | Edit (4 Zeilen) |
| `~/Projects/_github/engine-dj-manager/src/lib/engine-history-db.ts` | Edit (4 Zeilen) |
| `~/Projects/_github/engine-dj-manager/.env.local` | neu, gitignored |

---

## Sandbox-Zustand nach Schritt 2

Die Sandbox-DB enthält einen Test-Eintrag: Track 9832 hat den Titel `SANDBOX-TEST-0420` statt dem Original `Thee Church Ov Acid House - Waves Ov Power`. Das ist der absichtliche Beweis-Eintrag aus dem Write-Isolation-Check und kann so stehen bleiben — oder vor Schritt 3 über die UI zurückgestellt werden, um eine saubere Sandbox-Ausgangslage zu haben.

---

## Nächster Schritt

**Schritt 3 — Schema-Dump der `hm.db`**. Ziel: verstehen, welche Tabellen und Felder beim Abspielen eines Streaming-Tracks geschrieben werden. Das ist die Analyse-Basis für den synthetischen History-Eintrag, den Schritt 4 bzw. 5 umsetzen werden.

Siehe `docs/bridge/HANDOFF_03_POC_V2.md` für den Gesamtplan.
