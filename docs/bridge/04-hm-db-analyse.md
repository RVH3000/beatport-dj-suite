# Bridge — Schritt 4: History-DB Analyse (hm.db)

**Datum:** 20. April 2026
**Kontext:** Beatport LINK → Engine Library Bridge
**Vorgänger:** `docs/bridge/03-track-analyse.md`
**Status:** ✅ hm.db-Analyse abgeschlossen — alle offenen Fragen per SQL geklärt, Bridge-Architektur vollständig verstanden

---

## Zusammenfassung

Die History-Datenbank `hm.db` hält die DJ-Session-Historie — welcher Track wurde wann in welcher Session abgespielt. Mit der Analyse dieser DB ist das **vollständige Write-Modell** für die Bridge bekannt. Kernergebnisse:

1. `hm.db` enthält **zwei relevante Tabellen**: `Historylist` (Sessions) und `HistorylistEntity` (Track-Einträge pro Session). Verknüpfung per Foreign Key.
2. `hm.db.Historylist.sessionId` und `m.db.Track.playedIndicator` sind **unabhängige Systeme** mit unterschiedlichen Wertebereichen.
3. Die Bridge-Operation besteht aus **drei SQL-Statements** pro Bridge-Lauf: ein INSERT in `Historylist`, n INSERTs in `HistorylistEntity`, n UPDATEs in `m.db.Track`.

Damit ist Schritt 4 abgeschlossen. Der nächste Schritt wäre die Umsetzung des Proof-of-Concept in funktionierenden Code.

---

## Tabellen in hm.db

`.tables` auf der History-DB liefert acht Tabellen:

```
AlbumArt              PerformanceData       PlaylistEntity
Historylist           Playlist              PlaylistPath
HistorylistEntity     PlaylistAllChildren
```

**Relevant für die Bridge:**
- `Historylist` — die Sessions selbst
- `HistorylistEntity` — Tracks in Sessions

**Nicht direkt relevant** (aber vorhanden):
- `AlbumArt`, `PerformanceData` — analoge Strukturen zu m.db, werden von Engine DJ selbst gepflegt
- `Playlist`, `PlaylistEntity`, `PlaylistAllChildren`, `PlaylistPath` — vermutlich Spiegel-Tabellen aus der m.db-Architektur, werden für die Bridge nicht benötigt

---

## Schema: Historylist

Eine Session in der Engine-DJ-Historie:

```sql
CREATE TABLE Historylist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT,
    title TEXT,
    startTime DATETIME,
    timezone TEXT,
    originDriveName TEXT,
    originDatabaseUuid TEXT,
    originListId INTEGER,
    isDeleted BOOLEAN,
    editTime DATETIME,
    CONSTRAINT C_UNIQUE_ORIGIN_UUID_AND_LIST_ID
        UNIQUE (originDatabaseUuid, originListId)
);
```

| Feld | Bedeutung | Für Bridge |
|---|---|---|
| `id` | Auto-vergebene interne ID | von Engine gesetzt, nicht selbst setzen |
| `sessionId` | 9-stellige Session-Kennung (siehe Analyse unten) | **setzen** |
| `title` | Session-Titel (meist leer bei Engine-internen Sessions) | leer lassen |
| `startTime` | Unix-Timestamp des Session-Starts | **setzen** |
| `timezone` | Zeitzone der Session (z.B. `"Europe/Vienna"`) | **setzen** |
| `originDriveName` | USB-Drive-Name, falls Session von externer Quelle | leer lassen (Bridge erzeugt Sessions lokal) |
| `originDatabaseUuid` | UUID der erzeugenden DB | **setzen** (frische UUID generieren) |
| `originListId` | Listen-Zähler pro UUID | **setzen** (nächste freie Nummer ermitteln) |
| `isDeleted` | Soft-Delete-Marker | **auf `0` setzen** |
| `editTime` | Wird per Trigger automatisch gesetzt | von Engine gesetzt |

**Trigger-Logik:** Bei Änderung des `title`-Felds wird `editTime` automatisch auf den aktuellen Unix-Timestamp gesetzt. Für Bridge-INSERTs irrelevant — der Trigger feuert nur bei UPDATE.

**UNIQUE-Constraint:** Die Kombination `(originDatabaseUuid, originListId)` muss eindeutig sein. Bei Bridge-INSERTs muss sichergestellt werden dass keine Kollision entsteht.

---

## Schema: HistorylistEntity

Einzelner Track in einer Session:

```sql
CREATE TABLE HistorylistEntity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listId INTEGER,
    trackId INTEGER,
    startTime DATETIME,
    FOREIGN KEY (listId) REFERENCES Historylist (id) ON DELETE CASCADE,
    FOREIGN KEY (trackId) REFERENCES Track (id) ON DELETE CASCADE
);
```

| Feld | Bedeutung | Für Bridge |
|---|---|---|
| `id` | Auto-vergebene interne ID | von Engine gesetzt |
| `listId` | Verweist auf `Historylist.id` | **setzen** (die vorher erzeugte List-ID) |
| `trackId` | Verweist auf `m.db.Track.id` | **setzen** (der zu markierende Track) |
| `startTime` | Unix-Timestamp des Track-Starts innerhalb der Session | **setzen** |

**Cascade-Verhalten:** Wird eine `Historylist` gelöscht, verschwinden alle zugehörigen `HistorylistEntity`-Einträge automatisch. Wird ein `Track` in `m.db` gelöscht, verschwinden ebenfalls alle History-Einträge dieses Tracks. Für die Bridge bedeutet das: Cleanup wäre trivial, falls eine Bridge-Session fehlerhaft ist — eine einzige `DELETE FROM Historylist WHERE id = ...`-Zeile räumt alles auf.

**Indizes:** Sowohl `listId` als auch `trackId` sind indexiert. Queries über „alle Tracks einer Session" und „alle Sessions eines Tracks" sind performant.

---

## Echt-Daten-Analyse: eine typische Session

JOIN-Query über beide Tabellen zeigt eine echte Session mit fünf Tracks:

```
listId | sessionId  | title | startTime  | originDatabaseUuid                   | originListId | trackId | trackStartTime
3325   | 162580628  |       | 1775929987 | 70c584be-f4dc-4301-b7c3-26cd4c92e938 | 34           | 12114   | 1775929987
3325   | 162580628  |       | 1775929987 | 70c584be-f4dc-4301-b7c3-26cd4c92e938 | 34           | 12115   | 1775931144
3325   | 162580628  |       | 1775929987 | 70c584be-f4dc-4301-b7c3-26cd4c92e938 | 34           | 12116   | 1775931485
3325   | 162580628  |       | 1775929987 | 70c584be-f4dc-4301-b7c3-26cd4c92e938 | 34           | 217     | 1775931829
3325   | 162580628  |       | 1775929987 | 70c584be-f4dc-4301-b7c3-26cd4c92e938 | 34           | 12117   | 1775932256
```

Session-Metadaten identisch für alle fünf Zeilen (natürlich — eine Session). Unterschiedlich: `trackId` und `trackStartTime`.

**Track-Abstände:**
- Track 1 → 2: +19 Min 17 Sek
- Track 2 → 3: +5 Min 41 Sek
- Track 3 → 4: +5 Min 44 Sek
- Track 4 → 5: +7 Min 07 Sek

Realistische Mix-Intervalle für eine DJ-Session.

---

## Entscheidende Erkenntnis: zwei Session-Systeme, unabhängig

In Schritt 3 wurde `m.db.Track.playedIndicator` als Session-ID identifiziert — ein Signed 64-Bit Integer (19-stellig, kann negativ sein). Die Analyse von `hm.db.Historylist.sessionId` zeigt **ein komplett anderes Wertesystem**:

| System | Feld | Wertebereich | Beispiel |
|---|---|---|---|
| m.db | `Track.playedIndicator` | Signed Int64 (~10¹⁹, kann negativ) | `-5671310813259144062` |
| hm.db | `Historylist.sessionId` | **Signed Int32** (~2³¹, meistens positiv) | `162580628` |

**Schlussfolgerung:** Engine DJ nutzt **zwei getrennte Session-Systeme**. Sie sind nicht synchronisiert, die Bridge muss sie auch nicht verknüpfen. Jede DB bekommt ihre eigene, voneinander unabhängige Session-Identifikation.

**Empirische Prüfung `sessionId`:** Eine Analyse der letzten 10 Sessions zeigt `sessionId`-Werte zwischen 107 Millionen und 2,07 Milliarden — genau im Bereich eines Signed Int32. Die Differenz `startTime - sessionId` variiert zwischen −304 Millionen und +1,67 Milliarden. Kein mathematischer Zusammenhang mit dem Timestamp.

**Folgerung:** `sessionId` ist eine zufällige Signed-Int32-Zahl. Die Bridge kann einen ähnlichen Wert per `secrets.randbits(31)` in Python erzeugen (31 Bit liefert nur positive Werte, was den Normalfall in den echten Daten widerspiegelt).

---

## Die vollständige Bridge-Operation

Mit allen Erkenntnissen aus Schritt 2-4 kann die Bridge-Operation jetzt vollständig skizziert werden.

### Datenfluss

```
1. Vor der Bridge: Track in m.db existiert, aber isPlayed=NULL
                   Kein Eintrag in hm.db für diesen Track

2. Bridge-Lauf für N Tracks einer Playlist:
   ├─ Neue UUID erzeugen
   ├─ Nächste freie originListId ermitteln
   ├─ INSERT in hm.db.Historylist (1x — die Session)
   ├─ Liste der INSERTs in hm.db.HistorylistEntity (Nx — die Tracks)
   └─ UPDATEs in m.db.Track (Nx — Track-Status)

3. Nach der Bridge: Track in m.db hat isPlayed=1, playedIndicator gesetzt
                    Track erscheint in hm.db-History
                    Engine DJ zeigt Track korrekt in Playlists
```

### Pseudo-Code (Python)

```python
import secrets
import sqlite3
import time
import uuid

def sync_tracks_to_engine_history(
    m_db_path: str,
    hm_db_path: str,
    track_ids: list[int],
    timezone: str = "Europe/Vienna"
) -> int:
    """
    Erzeugt einen synthetischen History-Eintrag für eine Liste von Tracks.

    Engine DJ sieht die Tracks danach als "abgespielt" — sie erscheinen
    korrekt in gemischten Playlisten, der UI-Bug mit nicht angezeigten
    Streaming-Tracks verschwindet.

    Returns: list_id der neu erzeugten Historylist
    """
    now = int(time.time())
    fresh_uuid = str(uuid.uuid4())

    # Zufälliger Signed 64-Bit Integer für m.db.Track.playedIndicator
    # (siehe Schritt 3 — pseudo-zufällig, kann negativ sein)
    random_indicator = secrets.randbits(64)
    if random_indicator >= 2**63:
        random_indicator -= 2**64

    # Zufälliger Signed 32-Bit Integer für hm.db.Historylist.sessionId
    # (siehe Abschnitt "zwei Session-Systeme" weiter oben)
    # 31 Bit = nur positive Werte, entspricht Normalfall in echten Daten
    random_session_id = secrets.randbits(31)

    # Zwei parallele DB-Connections öffnen
    m_db = sqlite3.connect(m_db_path)
    hm_db = sqlite3.connect(hm_db_path)

    try:
        # 1. Neue Session in hm.db anlegen
        # originListId: für frische UUID immer 1, bei wiederverwendeter UUID MAX+1
        list_id = _insert_historylist(
            hm_db,
            session_id=random_session_id,
            start_time=now,
            timezone=timezone,
            origin_database_uuid=fresh_uuid,
            origin_list_id=_get_next_origin_list_id(hm_db, fresh_uuid)
        )

        # 2. Pro Track: HistorylistEntity + Track-Update
        track_offset_seconds = 0
        for track_id in track_ids:
            track_time = now + track_offset_seconds

            # HistorylistEntity in hm.db
            hm_db.execute("""
                INSERT INTO HistorylistEntity (listId, trackId, startTime)
                VALUES (?, ?, ?)
            """, (list_id, track_id, track_time))

            # Track-Status in m.db.Track aktualisieren
            m_db.execute("""
                UPDATE Track
                SET isPlayed = 1,
                    playedIndicator = ?,
                    timeLastPlayed = ?
                WHERE id = ?
            """, (random_indicator, track_time, track_id))

            # Realistischer Abstand: 7 Minuten pro Track
            track_offset_seconds += 420

        # 3. Beide Transaktionen committen (atomar pro DB)
        m_db.commit()
        hm_db.commit()

        return list_id

    except Exception as e:
        # Bei jedem Fehler: beide DBs zurückrollen
        m_db.rollback()
        hm_db.rollback()
        raise


def _get_next_origin_list_id(hm_db, origin_database_uuid: str) -> int:
    """
    Nächste freie originListId für eine UUID.

    Engine DJ zählt originListId pro UUID bei 1 beginnend hoch.
    Gelöschte Sessions werden nicht recycelt (Lücken möglich).
    Daher: höchsten vorhandenen Wert für diese UUID ermitteln, +1.
    """
    result = hm_db.execute(
        "SELECT MAX(originListId) FROM Historylist "
        "WHERE originDatabaseUuid = ?",
        (origin_database_uuid,)
    ).fetchone()
    max_id = result[0]
    return 1 if max_id is None else max_id + 1


def _insert_historylist(hm_db, session_id, start_time, timezone,
                         origin_database_uuid, origin_list_id):
    """Erzeugt eine neue Historylist, gibt die neue id zurück."""
    cursor = hm_db.execute("""
        INSERT INTO Historylist
            (sessionId, title, startTime, timezone,
             originDriveName, originDatabaseUuid, originListId, isDeleted)
        VALUES (?, NULL, ?, ?, NULL, ?, ?, 0)
    """, (session_id, start_time, timezone,
          origin_database_uuid, origin_list_id))
    return cursor.lastrowid
```

### Verifikation nach einem Testlauf

Nach einem Bridge-Lauf in der Sandbox sollten drei Checks grün sein:

```bash
# Check 1: Der Track in m.db hat jetzt isPlayed=1
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db" \
  "SELECT id, title, isPlayed, playedIndicator, timeLastPlayed
   FROM Track WHERE id = <test_track_id>"

# Check 2: Die neue Historylist existiert
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  "SELECT id, sessionId, startTime, originDatabaseUuid, originListId
   FROM Historylist ORDER BY id DESC LIMIT 1"

# Check 3: Der HistorylistEntity-Eintrag verweist korrekt auf beide
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  "SELECT listId, trackId, startTime FROM HistorylistEntity
   WHERE trackId = <test_track_id> ORDER BY id DESC LIMIT 1"
```

### Final Check — Engine DJ selbst

Der letzte Test ist Engine DJ starten (nicht die Sandbox — dafür müsste die Sandbox-DB temporär an die Original-Position gemountet werden) und schauen, ob die synthetisch markierten Tracks in Playlists korrekt angezeigt werden. Das ist **nicht mehr Teil des PoC** — es ist der Produktions-Test.

---

## Was in diesem Schritt NICHT passiert ist

- Keine Implementierung des Pseudocodes — nur Design
- Keine Testläufe gegen die Sandbox
- Kein Live-Test mit Engine DJ selbst (Produktions-Test kommt in Schritt 5)
- Keine Überlegungen zu Fehlerfällen (DB gelockt, Transaktions-Abbrüche)

---

## Geklärte Fragen (per SQL-Analyse in dieser Session)

Drei zuvor offene Fragen wurden mit gezielten Queries auf die Sandbox-DB geklärt:

### ✅ Frage 1 — `originListId`-Logik

**Query:** Verteilung von `originListId` pro `originDatabaseUuid`.

**Ergebnis:** Deine Sandbox enthält Sessions aus **9 verschiedenen UUIDs** (vermutlich 9 verschiedene Engine-DJ-DBs über die Zeit). Jede UUID beginnt bei `1`. Engine recycelt keine gelöschten IDs — drei UUIDs haben Lücken zwischen `min_id` und `max_id`.

**Bridge-Implementierung:**
```python
MAX(originListId) WHERE originDatabaseUuid = ? → +1
Bei neuer UUID → NULL → 1
```

### ✅ Frage 2 — `sessionId`-Wertebereich

**Query:** Differenz `startTime - sessionId` über die letzten 10 Sessions.

**Ergebnis:** Werte zwischen 107 Millionen und 2,07 Milliarden — entspricht Signed Int32. Kein mathematischer Zusammenhang mit Timestamps (Differenz schwankt von −304 Millionen bis +1,67 Milliarden).

**Bridge-Implementierung:** `secrets.randbits(31)` (positiver Int32).

### ✅ Frage 3 — `timezone`-Werte

**Query:** `GROUP BY timezone`.

**Ergebnis:** Bei dir ausschließlich `Europe/Vienna` (2.466 Sessions). Kein NULL, keine Variation.

**Bridge-Implementierung:** Als Default-Parameter `"Europe/Vienna"`, keine Erkennungslogik nötig.

---

## Offene Fragen für Schritt 5 (Implementierung)

Nicht per SQL zu beantworten, brauchen echte Test-Durchläufe oder Produkt-Entscheidungen:

1. **Wie verhält sich Engine DJ mit dem Bridge-Ergebnis?** Akzeptiert Engine den synthetischen Eintrag oder gibt's irgendwo eine Konsistenzprüfung die anschlägt? Muss per Engine-DJ-Live-Test geklärt werden — Sandbox temporär an Original-Position mounten.
2. **Wie lange ist der optimale Abstand zwischen Tracks in `startTime`?** 7 Minuten sind plausibel. Für den ersten PoC kein Problem. Bei Produktiv-Nutzung ggf. anhand echter Session-Daten verfeinern (durchschnittliche Track-Dauer in den deutschen Beatport-Sessions berechnen).
3. **Was passiert wenn Engine DJ parallel läuft während die Bridge schreibt?** DB-Locks, Read-Konflikte. Pflicht-Pre-Check in der Bridge: Engine-DJ-Prozess killen oder User auffordern Engine zu beenden, bevor geschrieben wird.
4. **Wie wird die Bridge über die UI ausgelöst?** Produkt-Entscheidung: Button in `engine-dj-manager`? CLI-Skript? Integration in die Electron-Suite von `beatport-dj-suite`?

Punkt 1 ist die **einzige echte technische Unbekannte**. Punkt 2-3 sind Detail-Tuning. Punkt 4 ist eine UX-Entscheidung.

---

## Gesamt-Bild aller vier Schritte

| Schritt | Thema | Ergebnis |
|---|---|---|
| 1 | engine_tools.py Analyse | Read-Write-Schiene in m.db existiert teilweise (~70%) |
| 2 | Sandbox-Einbindung | App zeigt auf Sandbox-DB, Write-Isolation bewiesen |
| 3 | m.db Track-Analyse | Drei Felder pro Track-Playback (isPlayed, playedIndicator, timeLastPlayed) |
| 4 | hm.db Analyse | Zwei Tabellen, drei SQL-Statements pro Bridge-Lauf |

**Technisch ist der PoC jetzt komplett geplant.** Die nächste Session kann mit der Implementierung beginnen.

---

## Nächster logischer Schritt (Schritt 5)

**Schritt 5 — Proof-of-Concept Implementierung.** Der Python-Pseudocode oben wird zu echtem Code, getestet gegen die Sandbox, verifiziert per sqlite3-Checks. Ergebnis: ein funktionierender Beweis dass die Bridge technisch machbar ist.

Das ist **eine eigene Arbeits-Session** und gehört nicht mehr in die PoC-Analyse-Phase.
