# Bridge — Schritt 3: Track-Schema und Abspiel-Analyse (m.db)

**Datum:** 20. April 2026
**Kontext:** Beatport LINK → Engine Library Bridge
**Vorgänger:** `docs/bridge/02-sandbox-einbindung.md`
**Status:** ✅ m.db-Analyse abgeschlossen — bereit für hm.db-Analyse in Schritt 4

---

## Zusammenfassung

Analyse der `Track`-Tabelle in der Engine-DJ-Datenbank `m.db` (Sandbox-Kopie) hat drei Kern-Erkenntnisse geliefert:

1. Engine DJ unterstützt Streaming-Tracks **nativ** mit dedizierten Feldern — kein Workaround nötig
2. Beim Abspielen eines Tracks werden **exakt drei Felder** in `Track` geändert
3. `playedIndicator` ist eine **zufällige Session-ID** (Signed 64-Bit Integer), keine track-spezifische Kennung

Die Sandbox enthält eine vollständige 1:1-Kopie der Produktiv-Library. Damit steht ausreichend realistisches Testmaterial für alle weiteren Bridge-Experimente zur Verfügung.

---

## Library-Statistik

| Kategorie | Anzahl | Anteil |
|---|---|---|
| **Gesamt** | 13.176 | 100 % |
| Lokale Tracks | 462 | 3,5 % |
| Streaming-Tracks (gesamt) | 12.714 | 96,5 % |
| ├─ Beatport LINK | 5.535 | 42,0 % |
| └─ SoundCloud | 7.179 | 54,5 % |

**Folgerung:** Die Bridge ist für Roberts Workflow essenziell, nicht optional. 96,5 % seiner Library sind Streaming-Tracks — jeder davon braucht aktuell eine manuelle Einmal-Wiedergabe, damit er in Engine-Playlists korrekt angezeigt wird.

Verifikation:
```sql
SELECT COUNT(*) AS gesamt,
       COUNT(CASE WHEN streamingSource IS NOT NULL
                   AND streamingSource != '' THEN 1 END) AS streaming
FROM Track
```
Ergebnis Sandbox: `13176|12714`
Ergebnis Original: `13176|12714` → Sandbox ist 1:1-Kopie.

---

## Track-Tabelle — Streaming-relevante Felder

Vollständiges Schema der `Track`-Tabelle wurde analysiert. Für die Bridge relevante Felder:

| Feld | Typ | Zweck |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Engine-interne Track-ID |
| `path` | TEXT | Lokaler Dateipfad — bei Streaming **leer** |
| `filename` | TEXT | Dateiname — bei Streaming **leer** |
| `uri` | TEXT | Universal Resource Identifier — bei Streaming gefüllt |
| `streamingSource` | TEXT | Dienst-Name (z.B. `"Beatport LINK"`, `"SoundCloud"`) |
| `streamingFlags` | INTEGER | Status-Flag (Bedeutung noch zu klären, bei allen getesteten Tracks: `1`) |
| `isAvailable` | BOOLEAN | Track ist verfügbar (`1`) |
| `isPlayed` | BOOLEAN | Wurde abgespielt (`NULL` = nein, `1` = ja) |
| `playedIndicator` | INTEGER | Session-ID (siehe Analyse unten) |
| `timeLastPlayed` | DATETIME (Unix-Timestamp) | Zeitpunkt der letzten Wiedergabe |
| `originDatabaseUuid` | TEXT | UUID für Multi-Device-Sync |
| `originTrackId` | INTEGER | Track-ID im Ursprungs-System |

### UUID-System

Die Kombination `originDatabaseUuid` + `originTrackId` bildet eine eindeutige track-übergreifende Kennung:

```sql
CONSTRAINT C_originDatabaseUuid_originTrackId UNIQUE (originDatabaseUuid, originTrackId)
```

Trigger setzen diese Werte automatisch bei leerem Zustand. Für die Bridge bedeutet das: **wir müssen diese Felder nicht selbst setzen**, Engine DJ macht das beim INSERT/UPDATE automatisch.

---

## Streaming-Track URI-Struktur

Beispiel-URI eines Beatport-LINK-Tracks:

```
streaming://Beatport%20LINK/Track/4461407
```

Drei Informationen in einem String:

| Teil | Wert | Bedeutung |
|---|---|---|
| Schema | `streaming://` | Engine-Marker für Streaming-Tracks |
| Source | `Beatport%20LINK` | URL-kodierter Dienst-Name |
| Track-ID | `4461407` | Externe Beatport-Track-ID |

**Folgerung:** Die externe Beatport-ID kann direkt aus der URI extrahiert werden. Das wird relevant, wenn die Bridge eine Beatport-Playlist mit der Engine-Library abgleichen muss.

---

## Abspiel-Mechanik — drei Felder

Der Zustandsübergang „noch nie gespielt" → „einmal gespielt" ändert **exakt drei Felder**:

### Beispiel-Vergleich

**Track 9837 (nie gespielt):**
```
isPlayed:         NULL (leer)
playedIndicator:  0
timeLastPlayed:   NULL (leer)
```

**Track 9874 (einmal gespielt):**
```
isPlayed:         1
playedIndicator:  5632672783220610645
timeLastPlayed:   1770951387  (Unix-Timestamp)
```

### Bridge-Schreib-Operation

Für jeden Track, den die Bridge als „abgespielt" markieren will:

```sql
UPDATE Track
SET isPlayed = 1,
    playedIndicator = <session_id>,
    timeLastPlayed = <unix_timestamp>
WHERE id = <track_id>
```

Alle drei Felder müssen gleichzeitig gesetzt werden.

---

## `playedIndicator` — Analyse der Session-ID

Die wichtigste Erkenntnis dieser Phase: `playedIndicator` ist **keine track-spezifische Kennung**, sondern eine **Session-ID**. Alle Tracks derselben DJ-Session teilen denselben Wert.

### Beweis — Gruppierung nach playedIndicator

Query:
```sql
SELECT DISTINCT playedIndicator,
       MIN(timeLastPlayed) AS session_start,
       MAX(timeLastPlayed) AS session_end,
       COUNT(*) AS tracks
FROM Track
WHERE streamingSource = 'Beatport LINK'
  AND isPlayed = 1
GROUP BY playedIndicator
ORDER BY session_start DESC
LIMIT 10
```

Ergebnis (letzte 10 Sessions):

| playedIndicator | Start (UTC) | Ende (UTC) | Dauer | Tracks |
|---|---|---|---|---|
| 1606362195922836826 | 4. März 03:30 | 4. März 05:38 | ~2h | 11 |
| 7033934558660744736 | 27. Feb 04:45 | 27. Feb 06:23 | ~1,5h | 5 |
| -6878171416827531803 | 24. Feb 05:39 | 24. Feb 05:39 | 0s | 2 |
| -5671310813259144062 | 24. Feb 05:16 | 4. März 07:06 | ~8 Tage | 3 |
| 6624675929119451580 | 24. Feb 04:33 | 24. Feb 07:00 | ~2,5h | 4 |
| 3236642952155463938 | 24. Feb 04:27 | 24. Feb 04:27 | 0s | 8 |
| 8679482324707926546 | 17. Feb 07:41 | 17. Feb 07:52 | ~11min | 2 |
| -5107788328420572664 | 16. Feb 08:34 | 16. Feb 08:34 | 0s | 1 |
| 1593744536258557773 | 16. Feb 07:56 | 16. Feb 07:56 | 0s | 6 |
| 7154973019995231643 | 16. Feb 07:36 | 16. Feb 07:58 | ~22min | 2 |

### Erkenntnisse aus der Analyse

**1. Session-Hypothese bestätigt.** Mehrere Tracks teilen denselben `playedIndicator`, die Zeitspanne dazwischen entspricht typischen DJ-Session-Dauern (Minuten bis wenige Stunden). Session-Größen zwischen 1 und 11 Tracks sind realistisch.

**2. Werte sind pseudo-zufällig.** Volle Signed-64-Bit-Integer-Range wird genutzt, sowohl positive als auch negative Werte kommen vor. Kein mathematischer Zusammenhang zwischen Session-ID und Start-Timestamp erkennbar.

**Folgerung:** Engine DJ erzeugt beim Session-Start eine zufällige Signed-Int64-Zahl. Die Bridge kann denselben Mechanismus nutzen — z.B. per `secrets.randbits(64)` in Python und optionaler Vorzeichen-Anpassung, oder `crypto.randomInt()` in Node.js.

**3. Session-ID bleibt bei Wiederabspielung persistent.** Ein Sonderfall in den Daten zeigt drei Tracks mit derselben Session-ID, die aber 8 Tage zwischen erstem und letztem Abspielen liegen. Das bedeutet: Engine DJ überschreibt bei erneutem Abspielen eines bereits markierten Tracks den `playedIndicator` **nicht**. Der bestehende Session-Wert bleibt erhalten.

**Folgerung für die Bridge:** Die UPDATE-Operation ist **idempotent** — sie kann mehrfach auf denselben Track angewendet werden, ohne unerwartete Seiteneffekte. Das ist sauberes Engine-DJ-Design.

---

## Was als Schreib-Operation noch offen ist

Die Bridge braucht **vermutlich** zusätzlich einen Eintrag in der History-Datenbank `hm.db`, damit abgespielte Tracks in der Engine-DJ-History-Anzeige und in Playlist-Vorschauen erscheinen.

Offene Fragen für Schritt 4:

- **Reicht das UPDATE auf `Track` alleine?** Oder braucht es zusätzlich `hm.db`-Einträge?
- **Welche Tabellen in `hm.db` sind relevant?** Erwartet: `Historylist`, `HistorylistEntity`
- **Wie referenziert `hm.db` die Tracks aus `m.db`?** Über `id` oder über die `originDatabaseUuid` + `originTrackId` Kombination?
- **Gibt es weitere Felder, die beim Abspielen über `Track` hinaus gesetzt werden?**

---

## Pseudo-Code — Bridge-Operation (Entwurf)

Basierend auf dem aktuellen Stand (ohne `hm.db`-Integration):

```python
import secrets
import time

def mark_track_as_played(db_connection, track_id, session_id=None):
    """
    Markiert einen Track in Engine-DJ's m.db als abgespielt.

    - session_id: Wenn None, wird eine neue Session-ID erzeugt.
                  Für Batch-Operationen: außerhalb generieren und
                  pro Track wiederverwenden.
    """
    if session_id is None:
        # Signed 64-Bit Integer (kann positiv oder negativ sein)
        session_id = secrets.randbits(64)
        if session_id >= 2**63:
            session_id -= 2**64

    timestamp = int(time.time())

    db_connection.execute("""
        UPDATE Track
        SET isPlayed = 1,
            playedIndicator = ?,
            timeLastPlayed = ?
        WHERE id = ?
    """, (session_id, timestamp, track_id))


def mark_playlist_as_played(db_connection, track_ids):
    """
    Batch-Variante: alle Tracks einer Playlist mit derselben
    Session-ID markieren (entspricht Engine-DJ-Verhalten).
    """
    session_id = secrets.randbits(64)
    if session_id >= 2**63:
        session_id -= 2**64

    for track_id in track_ids:
        mark_track_as_played(db_connection, track_id, session_id)
```

**Warnung:** Dieser Code ist noch nicht getestet. Vor Ausführung:
1. Nur gegen die **Sandbox**-DB laufen lassen
2. Anschließend prüfen ob Engine DJ die gesetzten Werte akzeptiert
3. `hm.db`-Integration (Schritt 4) ggf. ergänzen

---

## Nächste Schritte

**Schritt 4 — Schema-Dump der `hm.db`**. Ziel: verstehen ob und wie ein History-Eintrag in `hm.db` gesetzt werden muss, damit der Track in Engine-DJ-Playlists korrekt als „abgespielt" erscheint.

Siehe `docs/bridge/HANDOFF_03_POC_V2.md` für den Gesamtplan (Schritte 3-5).
