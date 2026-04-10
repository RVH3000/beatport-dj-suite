# Beatport DJ Suite v3.6.0 — Handbuch

## Inhaltsverzeichnis

1. [Uebersicht](#uebersicht)
2. [Library](#library)
3. [Explore](#explore)
4. [Build](#build)
5. [Pipeline](#pipeline)
6. [Settings](#settings)
7. [Datenfluss](#datenfluss)
8. [Tastenkuerzel](#tastenkuerzel)

---

## Uebersicht

Die Beatport DJ Suite ist eine Electron-Desktop-App fuer DJs, die ihre Beatport-Library systematisch verwalten, analysieren und in DJ-Software (Engine DJ, Rekordbox, Traktor) uebertragen wollen.

Die App organisiert sich in **5 Workflow-Gruppen**:

| Gruppe | Zweck |
|--------|-------|
| Library | Datenquellen: Beatport scannen, Cache verwalten, Engine-DB importieren |
| Explore | Daten verstehen: Suchen, Filtern, Dashboards, Analysen |
| Build | Playlists erstellen: aus Filtern, live von Beatport, Quick Actions |
| Pipeline | Transfer: Sync nach DJPlaylists.fm, Lexicon, Engine DJ, USB |
| Settings | Konfiguration: Pfade, Auth, Presets, dieses Handbuch |

---

## Library

### Scanner

Der Scanner holt Track-Metadaten von Beatport via Chrome DevTools Protocol (CDP).

**Delta-Sync starten** — Startet einen neuen Scan-Run. Oeffnet die interne Beatport-Session, iteriert durch alle Playlists und holt Track-Daten via XHR (bevorzugt), Route oder DOM-Fallback. Alte Runs werden nie ueberschrieben.

**Cache neu aufbauen** — Verwirft den lokalen Arbeitsbestand und baut ihn aus allen vorhandenen Runs neu auf.

**CSV exportieren** — Exportiert den kompletten lokalen Arbeitsbestand als CSV-Datei.

**Diagnose-Komplettlauf** — Schnelltest: prueft Verbindung, Session-Status und eine Test-Playlist ohne einen vollen Scan durchzufuehren.

**Auswahl analysieren** — Fuehrt eine Tiefenanalyse (Drama-Score, BPM-Cluster) auf den im Arbeitsbestand markierten Playlists durch.

**Pause / Resume** — Unterbricht einen laufenden Scan sicher (kein Datenverlust) und setzt ihn spaeter ab der letzten Position fort.

**Defaults laden** — Setzt die Scan-Konfiguration auf Werkseinstellungen zurueck. Keine Daten werden geloescht.

#### Status-Bar

Die Status-Bar am oberen Rand zeigt den aktuellen Systemstatus und bietet direkten Zugriff auf Session-Aktionen:

- **Beatport oeffnen** — Oeffnet das interne Beatport-Fenster fuer Login und manuelle Checks.
- **Test** — Prueft den aktuellen Session-Status (Cookie gueltig? Token frisch?) ohne Navigation.
- **Reconnect** — Baut die Session neu auf: verwirft den alten Token und holt via interne Beatport-Page einen frischen.
- **API-Kontext** — Exportiert Bearer-Token + Cookies als JSON fuer externe XHR-Tools.

#### Aktiver Run

Ein "Run" ist ein zeitlich markierter Snapshot deiner Beatport-Library. Delta-Sync erzeugt immer einen neuen Run. Analyse und Resume arbeiten auf dem ausgewaehlten Run. Du kannst zwischen Runs wechseln um historische Snapshots zu vergleichen.

#### Scan-Konfiguration (Accordion)

- **Host / Port** — CDP-Endpunkt des Beatport-Browsers (Standard: localhost:9222)
- **Target-Pattern** — Regex fuer die Beatport-Tab-URL
- **Timeout** — Maximale Wartezeit pro Operation in Millisekunden
- **Beatport App Pfad** — Pfad zur Beatport-Desktop-App
- **Analyse-Methode** — Bestimmt WIE Track-Daten von Beatport geholt werden:
  - **Auto** (Standard, empfohlen): Versucht zuerst XHR (schnellste Methode), fällt bei Fehlern auf Route und dann auf DOM zurueck.
  - **Nur XHR**: Nutzt ausschliesslich die Beatport REST-API (`/v4/my/playlists/`). Schnellste Methode, aber braucht gueltige Bearer-Auth.
  - **Route bevorzugen**: Navigiert den Browser zu jeder Playlist-URL und liest die Daten aus dem geladenen HTML. Langsamer als XHR, aber funktioniert auch bei API-Problemen.
  - **Nur DOM**: Liest Track-Daten direkt aus dem gerenderten DOM der Beatport-Seite. Langsamste Methode, Fallback fuer alte Seitenversionen.
- **App starten** — Startet die Beatport-Desktop-App oder Chrome automatisch vor dem Scan (oeffnet `open -na ... --remote-debugging-port`).
- **CDP-Autorecovery** — Wenn der CDP-Port nicht erreichbar ist (Browser geschlossen oder abgestuerzt), wird der Host-Browser automatisch neu gestartet.

#### Bekannte Einschraenkungen

- **Pause / Resume** — Pause sendet ein Signal an den laufenden Scan, der nach der aktuellen Playlist anhält. **Derzeit nicht zuverlaessig** — der Scan kann unter bestimmten Umstaenden nicht sauber fortgesetzt werden. Workaround: neuen Delta-Sync starten (alte Daten bleiben erhalten).

#### Sicherheit & Session (Accordion)

- **Laufzeitmodus** — Interne Beatport-Session oder externer Fallback
- **Recovery-Richtlinie** — Aggressive Recovery (automatisch) oder nur manuell
- **Externer Fallback** — Erlaubt die Nutzung eines externen Browsers wenn die interne Session nicht bereit ist
- Passwort wird nie gespeichert. Die App haelt nur Cookies und Storage im internen Beatport-Profil.

#### Diagnose & Build (Accordion)

Zeigt Build-Informationen, installierte App-Kopien und Pfade.

### Arbeitsbestand

Zeigt alle gecachten Playlists zur Auswahl fuer Tiefenanalyse. Filter nach Name, ID oder Track-Anzahl. Schnellauswahl: Alle, Keine, Nur Duplikate, Nur offene.

### Ergebnis

- **Duplikate** — Tabelle aller erkannten Track-Duplikate aus dem aktiven Run.
- **Tiefenanalyse je Playlist** — Drama-Score, BPM-Verteilung, Camelot-Kompatibilitaet pro Playlist.
- **Playlist-Inhalt** — Klicke eine Playlist in Discovery, Duplikaten oder Analyse an um ihren Track-Inhalt zu sehen.

### Engine-Import

Non-destruktiver Import von Daten aus der lokalen Engine DJ Datenbank (m.db + hm.db) in die zentrale scoring-data.json.

**Was importiert wird:**
- Ratings (0-5 Sterne, konvertiert aus Engine 0-100)
- Play-Counts (aus Historylist: wie oft in DJ-Sessions gespielt)
- Last-Played (Zeitstempel der letzten Session)
- File-Paths, Comments, Labels, Year

**Match-Strategie:**
1. Beatport-ID aus Engine Streaming-URI (primaer)
2. Titel + Artists (Fallback)

**Sicherheit:**
- Engine-DBs werden READ-ONLY geoeffnet (PRAGMA query_only)
- scoring-data.json wird VOR dem Write mit Timestamp-Backup gesichert
- Jede Aenderung wird ins Audit-Log geschrieben
- Echte Konflikte werden einzeln zur Entscheidung vorgelegt

**USB Prime 4+ Detection:** Die App scannt automatisch /Volumes/ nach externen Engine-DB-Strukturen (USB-Sticks, SSDs) zusaetzlich zur lokalen Library.

### Loeschen

Gefahrenzone: Batch-Loeschung bestaetigter Duplikate des aktiven Runs. Funktioniert nur mit exaktem Bestaetigungstext "LOESCHEN BESTAETIGT".

---

## Explore

### Suche & Filter

Die zentrale Suchfunktion arbeitet auf der scoring-data.json (99.000+ Tracks).

**Suchfeld** — Freitextsuche ueber Titel, Artists, Label und Release. Unterstuetzt Wildcards: `*` fuer beliebig viele Zeichen, `?` fuer ein Zeichen. Beispiel: `Tech*House` findet "Tech House", "Techno House", "Tech Afro House". Ohne Wildcards: normales Substring-Matching.

**Genre-Chips** — Multi-Select: Klicke auf einen Genre-Chip um ihn zu aktivieren (Teal-Highlight), nochmal klicken deaktiviert. Mehrere gleichzeitig moeglich. Track-Count pro Chip. Sub-Genre-Chips filtern automatisch nach den gewaehlten Parent-Genres (kaskadierend).

**BPM Min / Max** — Schraenkt den BPM-Bereich ein. BPM-Normalisierung (Toggle) halbiert/verdoppelt BPM-Werte fuer genreuebschreitende Vergleiche (z.B. 128 House = 64 Hip-Hop).

**Tonart** — Filter nach musikalischer Tonart. Anzeige mit Camelot-Code in Klammern.

**Jahr Min / Max** — Release-Zeitraum einschraenken.

**Label** — Filter nach Beatport-Label (Top 500, nach Haeufigkeit sortiert).

**Flags** — Nur Hype-Tracks oder nur DJ Edits anzeigen.

**Sortierung** — Primaere Sortierung. Das Lock-System erlaubt mehrstufiges Sortieren: klicke auf einen Spalten-Header in der Tabelle um ihn als Sortier-Lock hinzuzufuegen. Die Zahl in Klammern zeigt die Prioritaet.

**Drama-Score** — Berechneter Wert: 60% BPM-Abweichung + 40% Camelot-Inkompatibilitaet. Zeigt wie "dramatisch" ein Track im Kontext der aktuellen Auswahl ist.

**Camelot-Kompatibilitaet** — Harmonisches Mixen nach dem Camelot-Wheel:
- Perfect (5A→5A): identisch
- Good (5A→6A oder 5A→5B): gleicher Modus +-1 oder anderer Modus gleiche Zahl
- OK (5A→7A): gleicher Modus +-2
- Bad: alles andere

**Empfehlungen (Beatport + Groof)** — Der Kristallkugel-Button (🔮) pro Track holt Empfehlungen von der Beatport-API. Wenn Groof.app laeuft, werden zusaetzlich Empfehlungen via Groof's Recommendation-Engine geholt (api.groof.music). Ergebnisse erscheinen im Empfehlungs-Panel.

**Playlist-Builder** — Ausgewaehlte Tracks (Checkboxen) koennen als Playlist gespeichert werden: auf Beatport, als M3U, JSON oder CSV.

### Dashboard

Visuelle Zusammenfassung der geladenen Daten:
- Genre-Verteilung (Balkendiagramm, klickbar → springt in die Suche)
- BPM-Cluster
- Tonarten-Verteilung
- Timeline (Releases nach Jahr)

### Analyse

- Playlist-Overlap-Matrix: Welche Tracks sind in wie vielen Playlists?
- Canvas-basierte Visualisierungen fuer BPM, Key und Genre.

---

## Build

### Playlist WIZ

Live-Management von Beatport-Playlists via XHR-API:
- Playlists erstellen, umbenennen, loeschen
- Tracks hinzufuegen und entfernen
- Alle Operationen nutzen den Bearer-Token aus der internen Beatport-Session

### Quick Action

(Geplant) Templates fuer haeufige Playlist-Operationen.

---

## Pipeline

### Sync

Die Sync-Pipeline uebertraegt Playlists durch die gesamte DJ-Toolkette:

```
Beatport → DJPlaylists.fm → Lexicon DJ → Engine DJ → USB/Prime 4+
```

**WICHTIG:** Der Weg ueber DJPlaylists.fm → Lexicon ist der einzige funktionierende Pfad der alle Metadaten korrekt uebertraegt.

#### DJPL.fm Diff-Import

Vergleicht deine Beatport-Playlists mit den auf DJPlaylists.fm vorhandenen. Fehlende werden einzeln, sequenziell importiert (nicht alle auf einmal), mit konfigurierbarem Delay und Fortschrittsanzeige. Nach dem Import: weiter mit dem bestehenden DJPL.fm → Lexicon Batch-Workflow.

#### DJPL.fm → Lexicon Batch

Liest alle Playlists aus dem DJPlaylists.fm-Account via Supabase und speichert sie sequenziell in Lexicon DJ. Konfigurierbare Pause zwischen Saves (Standard: 800ms).

#### Engine DJ Export

Lexicon DJ → Engine DJ Export. Danach USB einstecken und in Engine DJ oder Denon Prime 4+ synchronisieren.

#### Lexicon DJ Referenzen

Lexicon DJ ist die zentrale Library-Management-Software in der Pipeline:
- **API-Dokumentation:** https://www.lexicondj.com/docs/developers/api
- **Benutzerhandbuch:** https://www.lexicondj.com/manual
- **Tutorials & Guides:** https://www.lexicondj.com/learn

Die Suite kommuniziert mit Lexicon ueber dessen lokale REST-API auf Port 48624:
- `GET /v1/playlists` — Playlists auflisten
- `POST /api/playlist/save` mit `streamingService: "beatport"` — Playlist speichern (selbe Funktion wie der "Save to Lexicon" Button auf DJPlaylists.fm)
- `POST /v1/sync/engine` oder `/v1/export/engine` — Engine DJ Export triggern

### Export

Export in verschiedene DJ-Formate:
- **Rekordbox XML** — Fuer Pioneer/Rekordbox DJ
- **Traktor NML** — Fuer Native Instruments Traktor
- **JSON / JSONL** — Maschinenlesbar
- **M3U** — Universelle Playlist-Datei
- **Engine m.db** — Direkt in die Engine DJ Datenbank (Streaming-Tracks)

### Automation

- **OSC-Bridge** — Fernsteuerung ueber Open Sound Control
- **Python-Tools** — Integration mit externen Python-Scripts

---

## Settings

### Pfade

- **Scan-Roots** — Verzeichnisse die der Scanner durchsucht
- **Engine Database Folder** — Pfad zur Engine DJ Library (Standard: ~/Music/Engine Library/Database2)
- **Python Command** — Pfad zum Python-Interpreter (Standard: python3)

### OSC

- **Host** — OSC-Ziel-IP (Standard: 127.0.0.1)
- **Port** — OSC-Port (Standard: 9000)
- **Address Prefix** — OSC-Adress-Praefix (Standard: /beatport)

### Handbuch

Dieses Dokument ist auch innerhalb der App in den Settings abrufbar.

---

## Datenfluss

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│  Beatport    │────▶│  scoring-    │────▶│  Suche   │
│  (CDP/XHR)   │     │  data.json   │     │  Filter  │
└─────────────┘     │  (99k Tracks) │     │  Analyse │
                    └──────┬───────┘     └──────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────┐     ┌──────────────┐     ┌────────────┐
│ Engine DB │────▶│ Merge/Import │     │ Beatport   │
│ (m.db,    │     │ (Ratings,    │     │ Labels DB  │
│  hm.db)   │     │  Play-Count) │     │ (suite.db) │
└──────────┘     └──────────────┘     └────────────┘

Pipeline:
Beatport ──▶ DJPlaylists.fm ──▶ Lexicon DJ ──▶ Engine DJ ──▶ USB/Prime 4+
                                    │
                                    └──▶ Rekordbox / Traktor (via Export)
```

---

## Tastenkuerzel

(In Planung — aktuell keine globalen Hotkeys in der Suite selbst)

---

*Beatport DJ Suite v3.6.0 — Erstellt 2026-04-08*
