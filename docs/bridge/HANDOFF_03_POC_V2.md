# PoC Link-Bridge — Version 2

**Erstellt:** 20. April 2026
**Vorgänger:** `EINFRIER-STATUS-2026-04-19.md` (eingefroren), `01-engine-tools-analysis.md`, `HANDOFF_02_SANDBOX.md`
**Ziel:** Synthetische History-Einträge in Engine DJ schreiben, damit Beatport-LINK-Tracks in Playlisten sofort korrekt angezeigt werden — ohne echte Wiedergabe.

---

## Was seit Version 1 klar geworden ist

Der Material-Scan (FragmentIndex, 19. April) hat ergeben: **fast alle Bausteine existieren bereits.** Der PoC muss nicht von Null aufgebaut werden — er setzt auf vorhandene Werkzeuge auf.

### Vorhandenes Material

| Was | Wo | Status |
|---|---|---|
| Engine-DB lesen | `~/Projects/_local/beatport-dj-suite/electron-app/integrations/python/engine_tools.py` | Read-Only, funktioniert |
| Engine-DB schreiben (m.db) | `~/Projects/_github/engine-dj-manager/src/app/api/tracks/[id]/route.ts` | PATCH-Endpoint, funktioniert |
| Backup-System | `~/Projects/_github/engine-dj-manager/src/app/api/backup/route.ts` | Funktioniert, ISO-8601 |
| History lesen | `~/Projects/_github/engine-dj-manager/src/lib/engine-history-db.ts` | Read-Only |
| History schreiben | — | **fehlt** |
| Analyse-Report | `~/Projects/_github/engine-dj-manager/ANALYSE_REPORT.md` | 12 KB, vom 4. Februar |

### Was das bedeutet

Der Engine DJ Manager (Next.js, läuft auf localhost:3000) ist der **Schreib-Kanal**. Er hat bereits:
- SQLite-Zugriff via better-sqlite3
- Prepared Statements gegen SQL-Injection
- Backup-Endpoint mit Zeitstempel
- API-Routen-Struktur (Next.js App Router)

Das einzige was fehlt: ein **`POST /api/history`** Endpoint, der in `hm.db` schreibt. Aktuell ist die History-DB dort read-only geöffnet — das muss auf read-write umgestellt werden.

---

## Sandbox-Strategie

**Regel:** Echte Engine-Library niemals anfassen. Alle Experimente auf einer Sandbox-Kopie.

### Ordner-Struktur

```
/Users/roberth./Music/Engine Library/           ← Original, niemals anfassen
/Users/roberth./Music/Engine Library SANDBOX/   ← Arbeits-Kopie für PoC
```

### Sandbox anlegen

**Voraussetzung:** Engine DJ Desktop ist geschlossen (sonst sind DB-Dateien gelockt).

```bash
cp -a "/Users/roberth./Music/Engine Library" \
      "/Users/roberth./Music/Engine Library SANDBOX"
```

**Warum `cp -a`:** Kopiert Rechte, Zeitstempel und alle Unterordner exakt.

**Warum ganzer Ordner:** Die DB-Dateien (m.db, hm.db, stm.db, sm.db, rbm.db, itm.db, trm.db) referenzieren sich gegenseitig. Einzelne Datei kopieren = inkonsistenter Zustand.

### Sandbox-Inhalt

```
Engine Library SANDBOX/
├── Database2/
│   ├── m.db          (59 MB, Haupt-Library)
│   ├── hm.db         (66 MB, History)
│   ├── stm.db        (124 KB, Statistics)
│   ├── sm.db         (1 MB, Settings)
│   ├── rbm.db        (16 MB, Rekordbox-Import)
│   ├── itm.db        (4 MB, iTunes-Import)
│   ├── trm.db        (132 KB)
│   ├── backups/
│   ├── downloads/
│   ├── Beatport LINK/
│   ├── Beatsource LINK/
│   └── ...
├── Artwork/
└── Stems/
```

### engine-dj-manager auf Sandbox umleiten

In der Next.js-App gibt es eine Umgebungsvariable für den DB-Pfad. Aus dem Report:

```bash
DATABASE_PATH=~/Music/Engine Library/Database2
```

Für die Sandbox auf:

```bash
DATABASE_PATH="/Users/roberth./Music/Engine Library SANDBOX/Database2"
```

**Wie gesetzt:** Im engine-dj-manager-Repo eine `.env.local` anlegen (wird von Next.js automatisch gelesen). Pfad:

```
/Users/roberth./Projects/_github/engine-dj-manager/.env.local
```

**Wichtig:** `.env.local` ist in `.gitignore` — landet nicht im Git, keine Sorge wegen Leaks.

---

## PoC-Schritte

### Schritt 1 — Vorbereitung (5 Min)

1. Engine DJ Desktop schließen
2. Git-Tag im beatport-dj-suite-Repo setzen:
   ```bash
   cd ~/Projects/_local/beatport-dj-suite
   git tag poc-bridge-start-$(date +%Y%m%d)
   ```
3. Git-Tag im engine-dj-manager-Repo setzen:
   ```bash
   cd ~/Projects/_github/engine-dj-manager
   git tag poc-bridge-start-$(date +%Y%m%d)
   ```
4. Sandbox anlegen (siehe oben)
5. Verifikation:
   ```bash
   ls -lh "/Users/roberth./Music/Engine Library SANDBOX/Database2/"*.db
   ```
   Erwartetes Ergebnis: alle DB-Dateien vorhanden, gleiche Größen wie im Original.

### Schritt 2 — Sandbox in engine-dj-manager einbinden (10 Min)

1. `.env.local` anlegen:
   ```bash
   cat > /Users/roberth./Projects/_github/engine-dj-manager/.env.local <<'EOF'
   DATABASE_PATH=/Users/roberth./Music/Engine Library SANDBOX/Database2
   EOF
   ```
2. Prüfen ob `src/lib/engine-db.ts` und `src/lib/engine-history-db.ts` die Env-Variable tatsächlich lesen. Falls hardcoded: refaktorieren auf `process.env.DATABASE_PATH`.
3. Server starten:
   ```bash
   cd ~/Projects/_github/engine-dj-manager
   npm run dev
   ```
4. Browser: `http://localhost:3000` — Tracks werden angezeigt?
5. Verifikation: ein Track-Update via UI testen (z.B. Titel ändern). Dann SQLite-Kommandozeile:
   ```bash
   sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db" \
     "SELECT id, title FROM Track WHERE id = <TEST-ID>"
   ```
   Änderung im SANDBOX sichtbar, im Original nicht.

### Schritt 3 — Schema-Dump hm.db (15 Min)

Bevor geschrieben wird: verstehen was geschrieben werden muss.

```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  ".schema Historylist" \
  ".schema HistorylistEntity" \
  ".schema Track"
```

**Fragen die der Dump beantworten muss:**
- Welche Spalten hat `HistorylistEntity`?
- Welche Constraints (NOT NULL, FK, DEFAULT)?
- Gibt es Trigger die beim INSERT feuern?
- Gibt es AUTOINCREMENT-IDs?

Trigger-Abfrage:
```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  "SELECT name, sql FROM sqlite_master WHERE type='trigger'"
```

**Ergebnis speichern unter:** `docs/bridge/03-hm-db-schema.md` (im beatport-dj-suite Repo).

### Schritt 4 — Write-Endpoint im engine-dj-manager (30 Min)

Im Repo `~/Projects/_github/engine-dj-manager/`:

1. `src/lib/engine-history-db.ts` — Read-Only-Flag entfernen, Schreib-Funktion ergänzen:
   ```typescript
   export function insertHistoryEntry(
     listId: number,
     trackId: number,
     startTime: number
   ): { success: boolean; id?: number; error?: string } {
     // ...
   }
   ```

2. Neuer API-Endpoint: `src/app/api/history/route.ts` um `POST` erweitern (oder neuen `src/app/api/history/entry/route.ts` anlegen):
   ```typescript
   export async function POST(request: Request) {
     const { listId, trackId, startTime } = await request.json();
     // Backup vor Schreibvorgang!
     // dann insertHistoryEntry aufrufen
   }
   ```

3. **Pflicht vor jedem Schreibvorgang:** automatisches Backup der Sandbox-`hm.db`. Verwende dafür den bereits vorhandenen Backup-Endpoint-Code als Vorlage.

### Schritt 5 — Ersten Eintrag schreiben (15 Min)

1. Aus der UI oder per `curl`:
   ```bash
   curl -X POST http://localhost:3000/api/history/entry \
     -H "Content-Type: application/json" \
     -d '{"listId": <BESTEHENDE-PLAYLIST-ID>, "trackId": <TRACK-ID>, "startTime": <UNIX-TIMESTAMP>}'
   ```

2. Verifikation:
   ```bash
   sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
     "SELECT * FROM HistorylistEntity ORDER BY id DESC LIMIT 1"
   ```

3. Integrity-Check:
   ```bash
   sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
     "PRAGMA integrity_check"
   ```
   Erwartetes Ergebnis: `ok`.

### Schritt 6 — Gegenprobe in Engine DJ (Desktop)

1. engine-dj-manager Server stoppen.
2. Engine DJ Desktop öffnen, aber **mit der Sandbox-Library** — entweder:
   - Engine DJ Setting temporär auf Sandbox-Pfad umstellen, oder
   - Sandbox-Ordner temporär an die Stelle der echten Library bringen (echte Library vorher verschieben!)

**Achtung:** Dieser Schritt ist heikel. Lieber zuerst mit dem SQLite-Blick zufrieden geben und den Engine-DJ-Test auf eine extra Session verschieben.

---

## Was nicht in diese Session gehört

- Konsolidierung mit beatport-dj-suite Electron-App (das ist Integrations-Schritt, später)
- Prime 4+ Stick-DB-Variante (separater Pfad, später)
- Playback-Schwellen-Messung (Ansatz B aus Version 1, geparkt)
- Feature-Gating / Pro-vs-Core (separates Thema, 3. Mai)
- Vermarktung / Marketing / Preis-Diskussion

---

## Abbruch-Kriterien

Session sofort stoppen und dokumentieren wenn:
- Integrity-Check auf Sandbox-`hm.db` fehlschlägt
- Engine DJ öffnet die Sandbox-Library nicht mehr
- Unerwartete Trigger feuern die andere Tabellen verändern
- Schema sieht fundamental anders aus als im ANALYSE_REPORT.md beschrieben

In allen Fällen: Sandbox löschen, neu kopieren, Analyse in `docs/bridge/` ablegen, Session beenden.

---

## Nach erfolgreicher Session

Output der Session:
- `docs/bridge/03-hm-db-schema.md` (Schema-Dump + Erkenntnisse)
- `docs/bridge/04-poc-results.md` (Was hat funktioniert, was nicht)
- Im engine-dj-manager-Repo: neuer Branch `feat/history-write-poc` mit dem Write-Endpoint
- Git-Tags `poc-bridge-end-YYYYMMDD` in beiden Repos

Dann: Entscheidung ob PoC weiterentwickelt wird (Integration in beatport-dj-suite Electron-App) oder ob erst Stick-DB-Variante separat untersucht werden soll.

---

## Startbefehl für die CLI-Session

```bash
cd ~/Projects/_local/beatport-dj-suite
cat docs/bridge/HANDOFF_03_POC_V2.md
# Dann linear abarbeiten.
```
