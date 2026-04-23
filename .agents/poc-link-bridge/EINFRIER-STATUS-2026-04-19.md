# PoC Link-Bridge — Einfrier-Status

**Erstellt:** 19. April 2026
**Chat-Kontext:** claude.ai Projekt `beatport-dj-suite`, langer Planungs-Chat
**Status:** Eingefroren — wird fortgesetzt, sobald `vibe-code-fragmente` Scan-Output liefert

---

## Warum eingefroren

Im Chat-Verlauf hat sich gezeigt, dass an verschiedenen Orten auf dem Mac bereits umfangreiches Vorarbeits-Material zu Engine-DB, Track-IDs und Engine DJ Manager existiert. Fünf relevante Dateien sind während der Session aufgetaucht und haben den PoC-Plan spürbar verändert.

Statt blind weiter zu planen, wird jetzt ein systematischer Material-Scan durchgeführt (neues Projekt `vibe-code-fragmente`). Das Ergebnis fließt in Version 2 des PoC-Briefings ein.

---

## Was im Chat geklärt wurde (Zusammenfassung)

### Terminologie — endgültig festgelegt

- **Engine DJ Desktop** — Mac-App zur Library-Verwaltung (kein Mixing)
- **Engine DJ OS** — Betriebssystem der Standalone-Geräte (Prime 4+, SC6000 etc.)
- **Stick-DB** — Engine-Library auf externem Datenträger (Stick, SSD, SD), von beiden Programmen lesbar
- **Computer Mode** — Zustand, in dem der Prime 4+ per USB am Mac die SSD als externes Laufwerk mounted
- **Engine DJ** — Oberbegriff für das ganze Ökosystem

### Architektur-Erkenntnisse

- Engine-DB besteht aus **mehreren zueinander referenzierenden Dateien** — der ganze `Database2/`-Ordner muss kopiert werden, nicht nur `m.db`
- History entsteht primär am Gerät, wandert beim Sync in den Desktop — **die saubere History liegt im Desktop**
- Engine Desktop und Engine OS nutzen **dieselbe DB-Schema-Struktur**, nur an unterschiedlichen Speicherorten
- Vier DB-Dateien auf dem Stick: `m.db` (Main), `hm.db` (History), `stm.db` (Statistics), `sm.db` (Settings)
- Plus auf Desktop zusätzlich: `p.db` (Performance), `rbm.db` (Rekordbox-Import)

### Drei Ansätze für die Bridge — priorisiert

1. **Ansatz A — Direktes Schreiben in DB** (liefert präzisestes Schema-Wissen, schlechtester Fallback)
2. **Ansatz C — Prepare-Ordner** (eleganter Zwischenweg, baut auf A-Wissen auf)
3. **Ansatz B — Kurzes LINK-Playback** (geparkt, unattraktiv, nur wenn A und C beide scheitern)

### Entscheidung zum Hauptweg

- **Stick-DB als Hauptziel**, nicht Desktop-DB
- Grund: Reversibler (Stick neu formatieren = Reset), realitätsnäher (Gig-Betrieb), keine Gefahr für die saubere Desktop-History
- Desktop-DB-Manipulation nur als optionaler Vergleichsweg

### Bereits vorhandenes Material

Fünf Dateien wurden gefunden und erwähnt:

1. **`ANALYSE_REPORT.md`** (4. Februar 2026) — Engine DJ Manager ist eine Next.js/React-App, die in `m.db` schreibt (`PATCH /api/tracks/{id}`), Backup-System für `m.db` mit ISO-8601-Zeitstempeln bereits implementiert. Server läuft laut Report auf localhost:3000.

2. **`engine_analyze.txt`** — CustomTkinter-App mit Multi-DB-Analyse (m, hm, stm, sm). Enthält funktionierenden Playlist-Entity-Query (`Playlist → PlaylistEntity → trackId/nextEntityId/databaseUuid`).

3. **`engine-dj-protocol.md`** — Ausführlicher Guide zu StagelinQ, Netzwerk-Ports (51337, 50000-50100, SSH auf 2222), USB-Modi (Massenspeicher, MIDI, Audio). Für späteren Network Traffic Visualizer relevant, für PoC geparkt.

4. **`SKILL.md` (engine-db-monitor)** — Fertige Skill-Definition, die Multi-DB-Scan inklusive USB-Laufwerke macht. Genau das Werkzeug, das ursprünglich als „wäre schön zu bauen" angedacht war.

5. **`Engine_DJ_Playlist_Creator.txt`** — Name deutet auf weiteres Werkzeug hin, Inhalt wurde nicht geprüft.

### Vorhandenes Projekt auf dem Mac

- `engine-analyzer` unter `~/Projects/_local/engine-analyzer/` — Python + CustomTkinter, read-only, kann Tabellen auflisten, Playlists analysieren, Reports exportieren. Hat `.git`, aber vermutlich kein Remote. **Nicht** das, was für schreibende Operationen gebraucht wird, aber brauchbar als Verifikations-Tool.

---

## Was fehlt — Kern-Fragen des PoC (Version 2)

Diese Fragen sind der eigentliche Arbeitsgegenstand des PoC:

1. **Track-ID-Mapping zwischen Stick und Desktop** — wie identifiziert Engine „denselben Track" über verschiedene DBs? Hash? Beatport-ID? Metadaten-Tupel?
2. **Wie entsteht ein History-Eintrag wirklich?** Welche Felder in `hm.db` werden gesetzt, welche in `m.db`, in welcher Reihenfolge? Auf welche Trigger reagiert Engine OS?
3. **Reicht ein synthetischer History-Eintrag**, um den Playlist-Anzeige-Bug bei LINK-Tracks zu lösen?
4. **Reicht der Prepare-Ordner alternativ** — oder braucht es beides?
5. **Wohin muss die Bridge schreiben**, damit der Prime 4+ die Tracks sofort korrekt anzeigt? Stick-DB allein, oder Desktop-DB auch?

---

## Was Version 2 des Briefings mitnehmen muss

Sobald der Material-Scan läuft und weitere Fundstücke vorliegen:

- Fokussiertes Briefing, das auf vorhandenem Werkzeug aufsetzt statt parallel neues zu bauen
- `engine-db-monitor` Skill als Standard-Diagnose-Werkzeug vor und nach jedem Experiment
- Engine DJ Manager (Next.js-App) als möglicher Schreib-Kanal prüfen — falls der PATCH-Endpoint stabil ist, muss nicht alles neu gebaut werden
- Track-ID-Kapitel als eigenes Unterkapitel
- Stick-DB-only-Hauptweg
- Computer-Mode-Live-Beobachtung als ergänzender Erkenntnis-Weg
- Saubere Schatten-DB-Strategie auf Ordner-Ebene (nicht nur Datei-Ebene)
- Verifikations-Kette dreistufig (SQLite / Engine-UI / Persistenz nach Neustart)

---

## Wie hier weiter gemacht wird

Dieser Chat bleibt eingefroren. Der nächste Schritt findet in zwei Schritten statt:

1. **Im Projekt `vibe-code-fragmente`:** Scan-Skript bauen, laufen lassen, Fragmente durchgehen.
2. **Zurück in diesem Projekt `beatport-dj-suite`:** Neuer Chat, basierend auf dem Scan-Output wird Version 2 des PoC-Briefings geschrieben.

Danach geht es in die Claude Code CLI — dort wird das eigentliche PoC-Experiment ausgeführt.

---

## Ablage dieses Dokuments

`~/Projects/_local/beatport-dj-suite/.agents/poc-link-bridge/EINFRIER-STATUS-2026-04-19.md`

Sollte der Ordner noch nicht existieren:
```bash
mkdir -p ~/Projects/_local/beatport-dj-suite/.agents/poc-link-bridge
```
