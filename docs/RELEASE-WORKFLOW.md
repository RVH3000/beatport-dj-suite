# Release-Workflow

Dieses Dokument erklärt, wie neue Versionen der Beatport DJ Suite **veröffentlicht** werden: Versions-Hochzählen, CHANGELOG automatisch pflegen, Git-Tag setzen, alles auf GitHub pushen — in einem Rutsch.

> **Abgrenzung:** Der *inhaltliche* QA-Teil (Smoke-Test, DMG-Build, etc.) steht separat in [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md). Diese Datei hier kümmert sich **nur** um das Versions-Tooling.

---

## 1. Was macht `commit-and-tag-version`?

`commit-and-tag-version` ist ein kleines Tool (eine npm-Dependency), das bei einem Release **vier Dinge auf einmal** erledigt:

1. Schaut sich alle Commits seit dem letzten Tag an.
2. Erhöht die Versionsnummer in `package.json` und `package-lock.json` — je nach gefundenen Commit-Typen (siehe unten).
3. Ergänzt `CHANGELOG.md` oben um einen neuen Eintrag mit allen relevanten Commits.
4. Erstellt einen Git-Commit mit diesen Änderungen und setzt einen Tag wie `v4.1.0`.

Danach pushen unsere Scripts (`npm run release`) automatisch Commit und Tag zu GitHub.

**Wichtig:** Das Tool liest **nur die Commit-Nachrichten**. Was du im Code änderst, ist ihm egal. Deshalb müssen Commits korrekt benannt sein — siehe Abschnitt 2.

---

## 2. Conventional Commits — die Regel

Jeder Commit, der etwas Nennenswertes ändert, bekommt einen **Präfix** vor dem Doppelpunkt. Der Präfix bestimmt den Versions-Sprung und den Changelog-Abschnitt.

| Präfix | Versions-Sprung | Erscheint im CHANGELOG? | Beispiel |
|---|---|---|---|
| `feat:` | Minor (4.0.0 → **4.1.0**) | Ja, unter „✨ Features" | `feat: Playlist-Builder mit Drag & Drop` |
| `fix:` | Patch (4.0.0 → **4.0.1**) | Ja, unter „🐛 Bugfixes" | `fix: Scanner friert bei 0 Playlists ein` |
| `perf:` | Patch | Ja, unter „⚡ Performance" | `perf: XHR-Batching beim Delta-Sync` |
| `refactor:` | Patch | Ja, unter „♻️ Refactoring" | `refactor: Scanner in Module aufteilen` |
| `chore:` | kein Bump | **Nein** (versteckt) | `chore: dependencies aktualisiert` |
| `docs:` | kein Bump | **Nein** | `docs: README erweitert` |
| `style:` | kein Bump | **Nein** | `style: CSS-Einrückung` |
| `test:` | kein Bump | **Nein** | `test: Scanner-Edge-Cases abgedeckt` |
| `ci:` | kein Bump | **Nein** | `ci: GitHub Actions aktualisiert` |

### Major-Bump (Breaking Change)

Wenn eine Änderung **nicht abwärtskompatibel** ist (z.B. API-Änderung, entferntes Feature), gibt es zwei Wege:

**Weg A** — Ausrufezeichen hinter dem Präfix:
```
feat!: Scanner-Konfigurationsformat auf YAML umgestellt
```

**Weg B** — `BREAKING CHANGE:` im Commit-Body:
```
feat: neuer Sync-Pipeline-Flow

BREAKING CHANGE: Die alte Pipeline-Config aus 3.x wird nicht mehr gelesen.
Nutzer müssen auf die neue Syntax migrieren — siehe docs/MIGRATION.md.
```

Beides führt zu Major-Bump: 4.0.0 → **5.0.0**.

### Scope optional

Du kannst nach dem Präfix einen Scope in Klammern setzen, z.B. `feat(scanner): ...` oder `fix(engine-analyze): ...`. Das landet dann fett im CHANGELOG, aber ist **nicht pflicht**.

---

## 3. Alltags-Workflow

Am Ende einer Coding-Session:

```bash
# 1. Alle Änderungen als Conventional Commits committen
#    (einen pro logischer Einheit — z.B. ein feat und ein fix getrennt)
git add <deine-dateien>
git commit -m "feat: neue Dramaturgie-Score-Badges im Builder"

# 2. Release starten
npm run release
```

Das war's. `npm run release` läuft jetzt durch und:

- Findet den richtigen Versions-Bump (Major/Minor/Patch je nach Commits)
- Schreibt CHANGELOG.md
- Macht einen Commit `chore(release): 4.1.0`
- Setzt Tag `v4.1.0`
- Pusht Commit + Tag auf GitHub (`origin v4`)

Du siehst hinterher auf GitHub einen neuen Tag und ein aktualisiertes CHANGELOG.

### Bump manuell erzwingen

Falls die automatische Logik nicht passt (z.B. du willst aus einem Patch einen Minor machen):

```bash
npm run release:patch   # Erzwinge Patch (4.0.0 → 4.0.1)
npm run release:minor   # Erzwinge Minor (4.0.0 → 4.1.0)
npm run release:major   # Erzwinge Major (4.0.0 → 5.0.0)
```

### Trockenlauf (ohne etwas zu ändern)

```bash
npx commit-and-tag-version --dry-run
```

Zeigt dir genau, was passieren würde. Macht keine Commits, keine Tags, keinen Push. Wenn du unsicher bist, **immer vorher** `--dry-run`.

---

## 4. Notfall-Rollback

Falls ein Release schiefgegangen ist — z.B. falscher Bump, kaputte Changelog-Formatierung, irrtümlich gepusht:

### 4a. Rollback vor dem Push

Wenn `npm run release` zwar gelaufen ist, aber **noch nicht** gepusht hat (oder das Pushen fehlschlug):

```bash
# 1. Den Release-Commit ungeschehen machen
git reset --hard HEAD~1

# 2. Den Tag lokal löschen
git tag -d v4.1.0

# 3. package.json prüfen — sollte wieder die alte Version zeigen
cat package.json | grep version
```

### 4b. Rollback nach dem Push (heikel!)

Wenn der Tag **schon auf GitHub** ist, werden andere den vielleicht schon gesehen haben. Idealer Weg: **NICHT löschen**, sondern einen neuen korrigierenden Release drauflegen. Z.B. wenn v4.1.0 kaputt war: sofort einen Fix committen und v4.1.1 releasen.

Falls du trotzdem zwingend löschen musst (nur wenn niemand sonst den Tag benutzt hat):

```bash
# 1. Tag lokal löschen
git tag -d v4.1.0

# 2. Tag remote löschen
git push origin :refs/tags/v4.1.0

# 3. Release-Commit auf dem Branch rückgängig
git reset --hard <commit-hash-vor-release>
git push origin v4 --force-with-lease   # --force-with-lease ist sicherer als --force
```

> **Warnung:** `--force-with-lease` ist weniger gefährlich als `--force`, aber beides überschreibt Remote-History. Nur nutzen, wenn du dir 100% sicher bist und sonst niemand auf dem Branch arbeitet.

### 4c. Backup-Tag als Rettungsanker

Vor jedem größeren Umbau werden in diesem Repo Backup-Tags gesetzt, z.B. `backup-vor-version-workflow-20260419-0420`. Falls alles schiefgeht:

```bash
git reset --hard backup-vor-version-workflow-20260419-0420
```

bringt dich zum exakten Zustand vor dem Eingriff zurück.

---

## 5. Wichtige Dateien im Versions-System

| Datei | Wozu |
|---|---|
| `package.json` | Hält die aktuelle Version (wird automatisch hochgezogen) |
| `package-lock.json` | Spiegel der Version für npm (ebenfalls automatisch) |
| `.versionrc.json` | Config für `commit-and-tag-version` (Sections, GitHub-URLs, versteckte Typen) |
| `CHANGELOG.md` | Auto-generiert, niemals von Hand editieren (nur bei Korrekturen) |
| `CHANGELOG-HISTORY.md` | Pre-v4.1.0-Historie, friert ein, wird nicht mehr verändert |

---

## 6. FAQ

**Ich habe einen Commit ohne Conventional-Prefix gemacht. Was nun?**
Das Tool ignoriert ihn einfach (kein Bump, nichts im Changelog). Bei der nächsten Release-Session füge einen Commit mit Prefix hinzu, z.B. einen harmlosen `chore: bump deps` — oder committe den nächsten Change einfach mit Prefix und es wird trotzdem korrekt gebumpt.

**Kann ich Commits nachträglich umbenennen?**
Nur solange nichts gepusht ist: `git commit --amend` (für letzten) oder `git rebase -i` (für ältere). Wenn gepusht: lass es und achte beim nächsten Commit auf den Prefix.

**Ich will mehrere feats in einer Version bündeln, nicht jeden einzeln releasen.**
Genau so funktioniert es: Committe beliebig viele feats/fixes, und einmal am Ende `npm run release`. Das Tool sammelt alle seit dem letzten Tag.

**Wer sieht den Co-Authored-By-Hinweis in den Commits?**
Nur wer sich die Commits in der Git-Historie anschaut (GitHub, `git log`). Endnutzer der App sehen davon nichts.
