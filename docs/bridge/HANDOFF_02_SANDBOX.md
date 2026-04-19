# Bridge — Schritt 2: Sandbox, Schema-Dump, Abspiel-Diff, PoC

**Erstellt:** 19. April 2026
**Von:** Claude im claude.ai Projekt `beatport-dj-suite` (Web)
**An:** Claude Code CLI, neue Session im Repo `~/Projects/_local/beatport-dj-suite/`
**Vorgänger:** `docs/bridge/01-engine-tools-analysis.md` (Commit `ea2af1c` auf Branch `v4`)

---

## Ziel dieser Session

Eine **Sandbox** für die Engine DJ SQLite-DB aufbauen und drei Dinge liefern:

1. **Schema-Dump** — welche Tabellen und Felder sind relevant für Streaming-Tracks und History
2. **Abspiel-Diff** — was verändert sich in der DB, wenn ein Streaming-Track einmal abgespielt wird
3. **PoC-Skizze** — erste, noch nicht implementierte Skizze, wie ein synthetischer History-Eintrag aussehen müsste

**Wichtig:** Keine Schreib-Operationen auf der echten DB. Keine Bridge-Implementierung. Nur Lesen, Vergleichen, Dokumentieren.

---

## Kontext aus Schritt 1 (kurze Erinnerung)

Laut `docs/bridge/01-engine-tools-analysis.md`:
- `engine_tools.py` läuft aktuell komplett read-only (`PRAGMA query_only = ON`)
- Engine-DB-Zugriff funktioniert über Python-Subprocess aus der Electron-App
- Multi-DB-Diff-Funktion und History-Merge sind bereits vorhanden — das ist gute Basis
- Streaming-Tracks und History sind zwei getrennte Themen, die für die Bridge zusammengeführt werden müssen

Das vollständige Kern-Problem ist in `HANDOFF_BRIDGE_SESSION.md` im Repo-Root dokumentiert.

---

## Erste Entscheidung — Sandbox-Ort

**Noch nicht festgelegt.** Am Anfang der Session klären.

Zwei Optionen mit Pro/Contra:

### Option A — Sandbox im Repo
**Pfad-Vorschlag:** `~/Projects/_local/beatport-dj-suite/.sandbox/engine-db/`

- **Pro:** Kopie bleibt in der Nähe des Codes, Scripts können relativ darauf zugreifen
- **Contra:** Muss unbedingt per `.gitignore` ausgeschlossen werden (DBs sind groß und privat)
- **Voraussetzung:** `.sandbox/` in `.gitignore` eintragen, **bevor** irgendeine DB kopiert wird

### Option B — Sandbox außerhalb des Repos
**Pfad-Vorschlag:** `/Users/roberth./Sandbox/engine-db/`

- **Pro:** Kein Git-Risiko (DB kann niemals versehentlich committet werden)
- **Contra:** Scripts brauchen absolute Pfade oder Env-Variablen
- **Voraussetzung:** Ordner einmal von Hand anlegen

**Empfehlung für die Session:** Erst in Option A/B entscheiden, dann erst kopieren. Bei Option A zwingend `.gitignore` zuerst.

---

## Quelle der Kopie

**Produktive Engine DJ DB auf dem Mac** — aber **nur eine Kopie**, niemals direkt auf dem Original arbeiten.

Standard-Suchorte für die Original-DB (je nach Engine-DJ-Version):
- `~/Music/Engine Library/Database2/`
- `~/Music/Engine DJ/Database2/`
- Auf externer Platte (bei Robert möglich) — USB-Stick oder SSD für Denon Prime 4+

**Ablauf für die Kopie (Vorschlag):**
```bash
# 1. Engine DJ schließen (falls offen) — sonst ist die DB gelockt
# 2. Original-Pfad finden und bestätigen
ls -lh ~/Music/Engine\ Library/Database2/*.db 2>/dev/null
ls -lh ~/Music/Engine\ DJ/Database2/*.db 2>/dev/null

# 3. Kopie anlegen (Pfad je nach Option A/B anpassen)
cp -a "QUELLE/m.db" "ZIEL/m.db"
cp -a "QUELLE/p.db" "ZIEL/p.db"
cp -a "QUELLE/hm.db" "ZIEL/hm.db"
```

**Warum `cp -a`:** Behält Rechte und Metadaten. Keine Änderung am Original.

---

## Sicherheits-Regeln für die Session

1. **Nie** direkten Schreib-Zugriff auf die Original-Engine-DB
2. **Immer** `PRAGMA query_only = ON` außer bei explizit markierten Schreib-Versuchen auf die Sandbox
3. **Vor jedem** Schreibversuch auf die Sandbox: zweite Kopie als Rücksetz-Punkt (`cp -a sandbox.db sandbox.db.before-write-YYYYMMDD-HHMM`)
4. **Keine** Änderungen an `engine_tools.py` in dieser Session — nur neue Scripts unter `tools/bridge/` oder `.sandbox/`
5. **Git-Tag vor Session-Start:** `git tag sandbox-start-$(date +%Y%m%d)` auf Branch `v4`

---

## Konkrete Aufgaben (in Reihenfolge)

### 1. Vorbereitung (5-10 Min)
- [ ] Sandbox-Ort festlegen (Option A oder B)
- [ ] Falls A: `.gitignore` erweitern, committen
- [ ] Git-Tag `sandbox-start-YYYYMMDD` setzen
- [ ] Engine-DB kopieren

### 2. Schema-Dump (15-20 Min)
- [ ] Alle Tabellen in der Sandbox-DB auflisten
- [ ] Für Streaming-Track-relevante Tabellen: CREATE TABLE-Statements dumpen
- [ ] Für History-relevante Tabellen: dasselbe
- [ ] Ergebnis als `docs/bridge/02-schema-dump.md` speichern

**Fragen, die der Dump beantworten muss:**
- Welche Tabelle speichert Streaming-Tracks (Beatport LINK)?
- Welches Feld markiert „wurde schon abgespielt"?
- Wie ist die History-Tabelle aufgebaut (Primary Key, Foreign Keys, Timestamps)?

### 3. Abspiel-Diff (20-30 Min)
- [ ] Kopie der Sandbox-DB als „Vorher"-Zustand sichern
- [ ] Engine DJ starten, **einen** Streaming-Track **einmal** abspielen, DB wieder kopieren (als „Nachher")
- [ ] Python-Script (unter `tools/bridge/diff-playback.py`) das die beiden DBs vergleicht
- [ ] Ergebnis als `docs/bridge/03-playback-diff.md` speichern

**Fragen, die das Diff beantworten muss:**
- Welche Tabellen bekommen Einträge/Updates beim Abspielen?
- Welche Felder ändern sich im Track-Eintrag selbst?
- Welche Timestamp-/Counter-Felder werden gesetzt?

### 4. PoC-Skizze (15-20 Min)
- [ ] Auf Basis von Schema + Diff: Skizze eines synthetischen History-Eintrags
- [ ] **Nur Pseudocode / SQL-Beispiel**, keine Implementierung
- [ ] Risiko-Liste: was könnte die DB korrumpieren
- [ ] Ergebnis als `docs/bridge/04-poc-sketch.md` speichern

### 5. Abschluss (5 Min)
- [ ] Alle drei Markdown-Dateien committen
- [ ] Commit-Message: `docs(bridge): Schritt 2 Sandbox Schema Diff PoC`
- [ ] Nicht pushen (wie bisher lokal halten)
- [ ] `/exit`

---

## Was diese Session NICHT tun soll

- Keine Implementierung der Bridge (kommt in Schritt 3)
- Keine Änderungen an `engine_tools.py`
- Keine Diskussion über Vermarktung, Lizenzierung, Core-vs-Pro-Trennung
- Keine Git-Aufräumarbeiten (untracked Files im Repo-Root)
- Kein Push auf GitHub
- Keine neuen Features im Electron-UI

---

## Relevante Dateien (nur lesen)

```
docs/bridge/01-engine-tools-analysis.md           ← Vorgänger-Analyse
HANDOFF_BRIDGE_SESSION.md                         ← Kern-Kontext (Repo-Root)
electron-app/integrations/python/engine_tools.py  ← nicht ändern, nur verstehen
electron-app/integrations/engine-analyze-matcher.mjs
electron-app/renderer/tabs/engine-analyze.js
CLAUDE.md                                         ← Projekt-Regeln
```

## Neue Dateien dieser Session

```
docs/bridge/02-schema-dump.md
docs/bridge/03-playback-diff.md
docs/bridge/04-poc-sketch.md
tools/bridge/diff-playback.py                     ← Diff-Script
```

Alles andere (Sandbox-DB-Kopien) bleibt außerhalb von Git.

---

## Wenn was schiefgeht

- **Engine-DB nicht auffindbar:** Robert fragen, wo die Denon Prime 4+ seine Daten ablegt (externe Platte?)
- **DB beim Kopieren gelockt:** Engine DJ ist offen — schließen, neu versuchen
- **Schema sieht komplett anders aus als erwartet:** Stopp, Analyse-Markdown schreiben, Session beenden, in claude.ai besprechen
- **Engine DJ startet nach Test nicht mehr:** Original-DB ist intakt (wurde nie angefasst), also kein Schaden — aber unbedingt dokumentieren was passiert ist

---

**Ende Handoff. Am Anfang der neuen Session diese Datei zuerst lesen, dann linear abarbeiten.**
