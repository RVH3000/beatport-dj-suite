# HANDOFF — Bridge Schritt 5: Proof-of-Concept Implementierung

**Erstellt:** 20. April 2026
**Von:** claude.ai Web-Chat (nach Abschluss der Analyse-Phase Schritte 1-4)
**Für:** eine beliebige Coding-Umgebung — Claude Code CLI, Gemini/Antigravity, ChatGPT Codex, Cursor, Cline, Aider oder andere
**Repo:** `~/Projects/_github/engine-dj-manager/`
**Zielzustand:** ein funktionierender, gegen die Sandbox-DB getesteter Python-Code, der synthetische History-Einträge erzeugt

---

## Wer diesen Handoff liest

Du bist eine KI-gestützte Coding-Umgebung. Robert hat in den Schritten 1-4 eines Proof-of-Concept (PoC) die technische Basis für eine "Beatport LINK → Engine Library Bridge" analysiert. Die Analyse ist abgeschlossen. Dein Auftrag ist die Implementierung.

Dieser Handoff ist bewusst **umgebungs-neutral** geschrieben. Es gibt keinen vorgeschriebenen Weg, keinen fertigen Code zum Kopieren, keine implizite Präferenz für eine bestimmte KI-Architektur. Du triffst eigene Implementierungs-Entscheidungen.

Robert wird diesen Handoff möglicherweise in mehrere Umgebungen geben, um die Ergebnisse zu vergleichen. Dein Ziel ist daher nicht "möglichst viel machen", sondern "sauber und nachvollziehbar das Minimum umsetzen, das den PoC beweist".

---

## Pflicht-Lektüre vor dem ersten Code

Diese drei Dateien auf dem Mac enthalten den kompletten analytischen Vorbau. Lies sie in dieser Reihenfolge:

1. **`~/Projects/_local/beatport-dj-suite/docs/bridge/04-hm-db-analyse.md`**
   Das Kerndokument. Enthält das Schema beider relevanten Datenbanken, den Pseudo-Code, die geklärten technischen Fragen und die offenen Punkte.

2. **`~/Projects/_local/beatport-dj-suite/docs/bridge/03-track-analyse.md`**
   Die Analyse der `m.db.Track`-Tabelle. Erklärt die drei Felder, die beim "Abspielen" eines Tracks geändert werden müssen.

3. **`~/Projects/_local/beatport-dj-suite/docs/bridge/02-sandbox-einbindung.md`**
   Wie die Sandbox-Umgebung aufgebaut ist. Wichtig für das Verständnis, warum `engine-dj-manager` auf eine Kopie der Library zeigt und nicht aufs Original.

**Kein Kontext aus Chat-Historien.** Weder von Claude noch von anderen KIs. Nur die drei Markdown-Dateien oben und der Code im Repo `~/Projects/_github/engine-dj-manager/`.

---

## Der Auftrag in einem Satz

**Erzeuge ein eigenständiges Python-Skript, das N Track-IDs als Eingabe nimmt und einen synthetischen "abgespielt"-Zustand in der Sandbox-Engine-DJ-Datenbank erzeugt — so dass Engine DJ diese Tracks danach als mindestens einmal abgespielt behandelt.**

---

## Absolute Sicherheits-Regeln

Diese Regeln stehen über jeder anderen Anforderung in diesem Dokument. Sie dürfen nie verletzt werden, auch nicht "nur kurz zum Testen".

### 1. Niemals auf die Original-DB schreiben

Der Code schreibt **ausschließlich** in die Sandbox-Datenbanken:
- `/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db`
- `/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db`

**Niemals** auf:
- `/Users/roberth./Music/Engine Library/Database2/m.db`
- `/Users/roberth./Music/Engine Library/Database2/hm.db`

Der Unterschied ist ein einziges Wort im Pfad ("SANDBOX"). Verwende eine Konfiguration, die versehentliches Schreiben aufs Original technisch unmöglich macht — zum Beispiel eine Environment-Variable mit explizitem Sandbox-Pfad und einer Assertion, die abbricht, wenn "SANDBOX" nicht im Pfad vorkommt.

### 2. Engine DJ muss vor dem Schreiben beendet sein

Wenn Engine DJ läuft, hält es Locks auf die DB-Dateien. Ein paralleler Schreibzugriff kann die DB korrumpieren. Der Code sollte vor jedem Schreibzugriff prüfen:

```bash
pgrep -f "Engine DJ"
```

Falls ein Treffer kommt: abbrechen mit einer klaren Fehlermeldung. Nicht stillschweigend weitermachen. Nicht Engine DJ selbst killen — Robert entscheidet das.

### 3. Transaktionen sind Pflicht

Der PoC schreibt in zwei Datenbanken (m.db und hm.db). Wenn einer der beiden Schritte fehlschlägt, muss der andere zurückgerollt werden. Das ist zwei-DB-Transaktion-Handling — kein SQLite `BEGIN TRANSACTION` reicht dafür. Nutze für jede DB einen eigenen `try/except`-Block mit `rollback()` im Fehlerfall.

### 4. Keine destruktiven Operationen

Der PoC macht nur `INSERT` und `UPDATE`. Kein `DELETE`, kein `DROP`, kein `TRUNCATE`. Auch nicht "zum Aufräumen". Wenn Testläufe die Sandbox verschmutzen, wird sie **außerhalb des Codes** manuell zurückgesetzt (siehe unten).

### 5. Keine Installation neuer Systempakete ohne Nachfrage

Der Code darf `pip install <paket>` oder `npm install <paket>` vorschlagen, aber nicht autonom ausführen. Roberts Entwicklungs-Umgebung ist stabil konfiguriert — unerwartete Paket-Installationen können andere Projekte stören.

### 6. Keine Git-Operationen ohne explizite Zustimmung

Der Code darf keine Commits, Pushes, Branches oder Tag-Operationen ausführen. Robert macht diesen Teil manuell, weil er seine Git-Historie sauber halten will.

---

## Technische Details die du vor dem Coden kennen musst

Diese kommen aus den Analyse-Dokumenten und sind **bereits validiert**. Keine Vermutungen mehr nötig.

### Die drei SQL-Operationen pro Bridge-Lauf

Für N Tracks, die als "abgespielt" markiert werden sollen:

1. **Einmal INSERT in `hm.db.Historylist`** (erzeugt die Session)
   ```sql
   INSERT INTO Historylist
       (sessionId, title, startTime, timezone,
        originDriveName, originDatabaseUuid, originListId, isDeleted)
   VALUES (?, NULL, ?, ?, NULL, ?, ?, 0)
   ```

2. **N-mal INSERT in `hm.db.HistorylistEntity`** (ordnet Tracks der Session zu)
   ```sql
   INSERT INTO HistorylistEntity (listId, trackId, startTime)
   VALUES (?, ?, ?)
   ```

3. **N-mal UPDATE in `m.db.Track`** (markiert Track als abgespielt)
   ```sql
   UPDATE Track
   SET isPlayed = 1,
       playedIndicator = ?,
       timeLastPlayed = ?
   WHERE id = ?
   ```

### Die Werte, die zu setzen sind

**Für Historylist:**
- `sessionId` — zufälliger Signed Int32, positiv (`secrets.randbits(31)` in Python)
- `startTime` — aktueller Unix-Timestamp in Sekunden
- `timezone` — `"Europe/Vienna"` (Roberts Wert in 2466/2466 realen Sessions)
- `originDatabaseUuid` — frische UUID4 (`uuid.uuid4()`)
- `originListId` — pro UUID von 1 aufwärts: `SELECT MAX(originListId) FROM Historylist WHERE originDatabaseUuid = ?` plus 1. Bei frischer UUID (NULL-Ergebnis): `1`

**Für HistorylistEntity:**
- `listId` — die `id`, die der Historylist-INSERT zurückgegeben hat (SQLite: `cursor.lastrowid`)
- `trackId` — aus der Input-Liste
- `startTime` — aktueller Timestamp plus ein Offset (z.B. 7 Minuten pro Track, um realistische Abstände zu simulieren)

**Für Track (UPDATE):**
- `playedIndicator` — zufälliger Signed Int64 (kann negativ sein). `secrets.randbits(64)` mit Vorzeichen-Behandlung: wenn ≥ 2**63, dann −= 2**64
- `timeLastPlayed` — derselbe Timestamp wie `HistorylistEntity.startTime` für diesen Track

**Wichtig:** `playedIndicator` bleibt **für alle Tracks der Bridge-Session gleich** (Session-ID, nicht Track-ID). Aber `HistorylistEntity.startTime` ist **pro Track verschieden**.

### Vollständiger Pseudo-Code

In `04-hm-db-analyse.md` unter dem Abschnitt "Die vollständige Bridge-Operation" steht ein 80-Zeilen Python-Beispiel mit `sqlite3`-Standard-Library. Du kannst ihn als Vorlage nehmen oder davon abweichen — beides legitim, solange das Ergebnis sicher und getestet ist.

---

## Akzeptanz-Kriterien — wann ist Schritt 5 abgeschlossen

Der PoC gilt als erfolgreich, wenn alle vier Checks grün sind:

### Check 1 — Der Code läuft ohne Fehler durch

```bash
# Beispiel-Aufruf, konkrete Form hängt von deiner Implementierung ab
python3 tools/bridge/sync_history.py --track-ids 9832,9837,9839
```

Keine Exceptions, keine SQL-Errors. Exit-Code 0.

### Check 2 — Track in m.db wurde aktualisiert

Vorher war für den Test-Track `isPlayed = NULL`. Nachher:

```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/m.db" \
  "SELECT id, title, isPlayed, playedIndicator, timeLastPlayed
   FROM Track WHERE id = 9837"
```

Erwartung:
- `isPlayed = 1`
- `playedIndicator` eine Zahl (nicht 0, nicht NULL)
- `timeLastPlayed` ein plausibler Unix-Timestamp (nahe `now`)

### Check 3 — Neue Historylist in hm.db existiert

```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  "SELECT id, sessionId, startTime, timezone,
          originDatabaseUuid, originListId, isDeleted
   FROM Historylist
   ORDER BY id DESC LIMIT 1"
```

Erwartung:
- `sessionId` eine positive Zahl
- `startTime` nahe `now`
- `timezone = 'Europe/Vienna'`
- `originDatabaseUuid` im UUID-Format
- `originListId = 1` (bei frischer UUID)
- `isDeleted = 0`

### Check 4 — HistorylistEntity-Einträge verknüpfen Tracks mit Session

```bash
sqlite3 "/Users/roberth./Music/Engine Library SANDBOX/Database2/hm.db" \
  "SELECT hle.listId, hle.trackId, hle.startTime,
          hl.sessionId, hl.originDatabaseUuid
   FROM HistorylistEntity hle
   JOIN Historylist hl ON hl.id = hle.listId
   ORDER BY hle.id DESC LIMIT 5"
```

Erwartung: N Zeilen (eine pro Input-Track), alle mit derselben `listId` und `sessionId`. Die `trackId`-Werte entsprechen der Input-Liste.

### Bonus-Check — Original-DB unverändert

Die Sandbox-Write-Isolation wurde in Schritt 2 bewiesen, aber der Test sollte bei jedem PoC-Lauf wiederholt werden:

```bash
sqlite3 "/Users/roberth./Music/Engine Library/Database2/m.db" \
  "SELECT id, title, isPlayed, playedIndicator
   FROM Track WHERE id = 9837"
```

Erwartung: `isPlayed` unverändert (NULL oder alter Wert), `playedIndicator` unverändert. Falls hier etwas geändert wurde — **sofort abbrechen, Sandbox-Konfiguration defekt**.

---

## Was NICHT Teil von Schritt 5 ist

Klare Scope-Begrenzung, um Feature-Creep zu vermeiden:

- **Kein Engine-DJ-Live-Test.** Ob Engine DJ die Bridge-Einträge akzeptiert, wird in einem späteren Schritt (Schritt 6) separat getestet. Schritt 5 beweist nur, dass die DB-Schreib-Operationen technisch durchlaufen.
- **Keine UI-Integration.** Keine Buttons, keine Web-Endpoints, keine Electron-App-Erweiterung. Schritt 5 ist ein reines Kommandozeilen-Skript.
- **Keine Performance-Optimierung.** Wenn der Code für 10.000 Tracks 10 Sekunden braucht, ist das ok für den PoC.
- **Keine Tests jenseits der 4 Akzeptanz-Checks.** Unit-Tests mit Mocks und dergleichen sind nice-to-have, aber nicht Pflicht.
- **Keine Retry-Logik, keine Queue-Verwaltung.** Wenn der Bridge-Lauf fehlschlägt, Exception werfen und beenden. Robert entscheidet ob er manuell neu startet.
- **Keine Authentifizierung mit Beatport.** Der PoC bekommt Track-IDs als Input — woher Robert diese IDs hat (Beatport-API, Datei, manuell) ist außerhalb des PoC-Scopes.

---

## Workflow-Empfehlungen (nicht Pflicht)

### Wo der Code liegen sollte

Vorschlag: `~/Projects/_github/engine-dj-manager/tools/bridge/` oder `~/Projects/_github/engine-dj-manager/scripts/`. Aber das ist Geschmacksfrage — sinnvoll ist jedes Verzeichnis, das nicht im `src/`-Baum der Next.js-App liegt (der PoC ist ein CLI-Skript, nicht Teil der Web-App).

### Python-Version

Roberts System hat `python@3.12` installiert. Das Skript sollte mit 3.11+ lauffähig sein. Die `sqlite3`-Standard-Library reicht, keine externen Packages nötig.

### Wenn die Sandbox-DB durch deine Tests "verschmutzt" ist

Robert kann sie manuell zurücksetzen:

```bash
rm -rf "/Users/roberth./Music/Engine Library SANDBOX"
cp -R "/Users/roberth./Music/Engine Library" \
      "/Users/roberth./Music/Engine Library SANDBOX"
```

Dein Code muss das nicht selbst machen. Aber: wenn du beim Testen viele Durchläufe machst, informiere Robert am Ende wie die Sandbox aussieht (viele Historylist-Einträge? irrelevant? sauber?).

### Wenn du auf unerwartete DB-Eigenheiten stößt

Engine DJ ist eine proprietäre Software, die wir von außen nachbilden. Es ist möglich dass Felder existieren, die weder Schritt 3 noch Schritt 4 abgedeckt haben (z.B. Hash-Feld, Foreign Key den wir übersehen haben). Wenn dir etwas auffällt:

1. **Nicht raten.** Keine Felder "einfach auch setzen" ohne sicheres Wissen.
2. **Dokumentieren.** Schreib die Beobachtung in einen Kommentar im Code oder eine separate Notiz.
3. **Robert fragen.** Er entscheidet ob die Beobachtung wichtig ist oder ignoriert werden kann.

---

## Verfügbare Orientierungs-Dateien (Referenz, nicht Pflicht-Lektüre)

- `~/Projects/_github/engine-dj-manager/src/lib/engine-db.ts` — existierender TypeScript-Code der mit m.db arbeitet (lesend). Zeigt wie die Pfad-Auflösung in der Next.js-App funktioniert.
- `~/Projects/_github/engine-dj-manager/src/lib/engine-history-db.ts` — analog für hm.db.
- `~/Projects/_github/engine-dj-manager/src/lib/engine-paths.ts` — zeigt wie `DATABASE_PATH` als Umgebungs-Variable gelesen wird.
- `~/Projects/_github/engine-dj-manager/ANALYSE_REPORT.md` — 12 KB alte Analyse des Projekts (Stand Februar 2026), zeigt die Gesamt-Architektur.
- `~/Projects/_github/engine-dj-manager/docs/DEV-HANDBUCH.md` — Dev-Workflows und sqlite3-Rezepte für die Engine-DJ-DB.

---

## Abschluss

Wenn die 4 Akzeptanz-Checks grün sind, dokumentiere das Ergebnis in einem kurzen Kommentar-Block oder einer separaten `RESULT.md`. Dann ist Schritt 5 abgeschlossen.

Robert entscheidet danach, ob Schritt 6 (Engine-DJ-Live-Test) in derselben Umgebung oder einer anderen passiert.

**Viel Erfolg.**
