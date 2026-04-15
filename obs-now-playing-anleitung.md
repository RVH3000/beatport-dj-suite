# OBS Now Playing — Installation & Einrichtung

## Was das macht

Zeigt den Namen der aktuell gespielten Datei aus OBS als Text-Overlay im Bild.
Funktioniert mit **Media Playlist Source** (empfohlen) und mit **VLC Video Source**.

## Voraussetzungen

- **OBS Studio 28 oder neuer** (aktuelle Version 31.x ist perfekt)
- **macOS** (Intel oder Apple Silicon — der Lua-Skript-Teil läuft überall)

## Schritt 1 — Media Playlist Source Plugin installieren

Nur nötig, wenn du das Plugin noch nicht hast. Wenn du nur VLC nutzt, kannst du den Schritt überspringen.

1. Auf GitHub die neueste Release öffnen: https://github.com/CodeYan01/media-playlist-source/releases
2. Die Datei **`media-playlist-source-0.1.3-macos-universal.pkg`** (oder neuere Version) herunterladen.
3. **OBS komplett beenden** (Cmd+Q, nicht nur Fenster schließen).
4. Den `.pkg`-Installer doppelklicken und durch den Wizard klicken.
5. Falls macOS "unbekannter Entwickler" meckert: `Systemeinstellungen → Datenschutz & Sicherheit → "Dennoch öffnen"` klicken.
6. OBS wieder starten. Du solltest in `Quelle hinzufügen` nun `Media Playlist Source` sehen.

## Schritt 2 — Lua-Skript ablegen

1. Die Datei **`obs-now-playing.lua`** an einen festen Ort legen. Empfehlung:
   ```
   ~/Library/Application Support/obs-studio/scripts/obs-now-playing.lua
   ```
   *(Im Finder erreichst du den Ordner mit `Cmd+Shift+G` und dem Pfad einfügen.)*

2. Der Ordner `scripts` existiert vielleicht noch nicht — dann einfach anlegen.

## Schritt 3 — Textquelle in OBS erstellen

1. In der Szene, in der der Track-Name angezeigt werden soll:
   `+` unter Quellen → **`Text (FreeType 2)`**
2. Der Quelle einen Namen geben, z.B. `NowPlaying Text`.
3. Text-Feld kannst du leer lassen — das Skript füllt das.
4. Schriftart, Größe, Farbe, Outline etc. nach Geschmack einstellen.
5. **Wichtig: "Text aus Datei lesen" nicht ankreuzen** — wir schreiben direkt rein.
6. Textquelle in der Szene positionieren.

## Schritt 4 — Media-Quelle einrichten

**Variante A: Media Playlist Source**
1. `+` unter Quellen → **`Media Playlist Source`**
2. Name vergeben, z.B. `Musik Playlist`
3. In den Properties deine Musikordner oder einzelne Dateien hinzufügen
4. Loop, Shuffle etc. nach Geschmack

**Variante B: VLC Video Source** (falls du VLC-Playlist bevorzugst)
1. VLC muss auf deinem Mac installiert sein
2. `+` unter Quellen → **`VLC Video Source`**
3. Name vergeben, z.B. `Musik VLC`
4. Playlist-Dateien hinzufügen

## Schritt 5 — Skript in OBS laden

1. OBS-Menü: **`Werkzeuge → Scripts`**
2. Im Dialog unten links auf **`+`** klicken
3. Die `obs-now-playing.lua` auswählen
4. Auf der rechten Seite des Dialogs erscheinen zwei Dropdowns:
   - **Media-Quelle**: hier deine `Musik Playlist` oder `Musik VLC` auswählen
   - **Textquelle (Ziel)**: hier `NowPlaying Text` auswählen
5. Optional ins **Präfix**-Feld `Now Playing: ` eintragen (mit Doppelpunkt und Leerzeichen)
6. Scripts-Dialog schließen.

## Schritt 6 — Testen

1. Musik in deiner Media Playlist Source oder VLC starten.
2. Nach max. einer Sekunde erscheint der Track-Name in deiner Textquelle.
3. Beim Wechsel zum nächsten Track aktualisiert sich der Text automatisch.

## Dateinamen-Konvention

Damit die Anzeige schön aussieht, benenne deine Dateien idealerweise so:

```
Artist - Title.mp3
```

Das Skript macht dann daraus: `Artist - Title`

Alternative Muster, die das Skript aufräumt:
- `Artist_-_Title.mp3` → `Artist - Title` (Unterstriche werden zu Leerzeichen)
- `Some Track Name.wav` → `Some Track Name` (Endung entfernt)

## Fehlerbehebung

**Text ändert sich nicht:**
- Scripts-Dialog öffnen, unten sollte das Skript ohne Fehlermeldung geladen sein
- Prüfen ob im Dropdown tatsächlich die richtige Media-Quelle steht
- Logs anschauen: `Hilfe → Logdateien → Aktuelle Logdatei anzeigen`

**Nur der Pfad erscheint, nicht der Dateiname:**
- Deine Dateinamen enthalten vielleicht seltsame Zeichen. Einfach umbenennen und testen.

**Skript wird nicht geladen ("syntax error"):**
- Sehr unwahrscheinlich bei dieser Version, aber: Scripts-Dialog zeigt den Fehler unten an.
- Falls Zeilenumbrüche komisch sind (Windows vs. macOS), Datei einmal in einem Texteditor wie BBEdit öffnen und als UTF-8 speichern.

**VLC-Quelle zeigt immer nur den ersten Track:**
- Das ist eine bekannte Einschränkung der OBS-VLC-Source-API. Für zuverlässiges Track-Tracking mit Playlist ist die Media Playlist Source die bessere Wahl.

## Erweiterungen (wenn dir danach ist)

Das Skript ist ~150 Zeilen Lua und bewusst einfach gehalten. Was man später einbauen kann:

- **ID3-Tag-Lesen** für saubere Artist/Title-Anzeige auch bei schlecht benannten Dateien → eine zweite Version mit Python und `mutagen` wäre dafür der gängige Weg
- **Cover-Art anzeigen** als zweites Overlay
- **Geschichte der letzten Tracks** in eine Datei schreiben
- **BPM oder Key anzeigen** aus ID3v2-Tags (wichtig für DJ-Sets — passt zu deinem Beatport-Kontext)

Sag Bescheid wenn du eine davon willst.
