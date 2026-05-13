# GOAL — Multi-Agent-Workflow fuer Backlog-Punkte 30-32

**Datum:** 2026-05-13
**Verfasst von:** Werkbank (Claude Code CLI, Opus 4.7, 1M Context) auf User-Auftrag
**Adressat:** Naechste Werkbank-Session(s) + Kontrollraum (ChatGPT)
**Branch:** feat/v4.2 (oder Folge-Branch nach M5)
**Trigger:** User-Anweisung "Agentensystem verwenden. Mindestens zwei die sich
gegenseitig kontrollieren, dass wir nicht wieder rein rennen und mit
Vorderberechtigung bis zum Ende durchprogrammieren."

---

## 1. Goal in einem Satz

Die Backlog-Punkte 30 (Label-Cover), 31 (Meine Artists Tab) und
32 (Meine Tracks Tab) werden durch ein Zwei-Agenten-Pingpong umgesetzt:
**Implementer-Agent** entwirft + setzt um, **Reviewer-Agent** prueft
adversarial. Kein destruktiver Schritt (DB-Write, Force-Push, Datei-Replace,
Schema-Change, externe Datei-Operation) ohne explizites Reviewer-OK in
derselben Session.

## 2. Warum

Diese Session (2026-05-13) hatte einen Beinahe-Unfall: `asar extract-file
<archive> <file> /tmp/...` hat das 4. Argument ignoriert und stattdessen
die `package.json` im Worktree-CWD mit der reduzierten asar-Version
ueberschrieben. Erkannt nur durch `git diff --stat` vor Commit (72 deletions
disproportional). Wenn ich vorher gecommitet haette, waere v4.3.0 mit
einer kaputten `package.json` rausgegangen.

Die strukturelle Ursache: **autonomer Single-Agent-Durchlauf**. Mehrere
Tool-Calls hintereinander ohne externen Cross-Check, weil "fragt nicht
mehr pro Tool-Call" eingestellt war. Vorberechtigung + Speed = Risiko.

Loesung: Cross-Check durch zweiten Agent vor destruktiven Schritten.

## 3. Rollen (analog MODEL-ROLES.md)

### 3.1 Implementer-Agent

- **Default-Wahl:** `feature-dev:code-architect` fuer Entwurf,
  Standard-Werkbank (Claude Code Opus 4.7) fuer Ausfuehrung.
- **Mandat:** Code schreiben, Dateien anlegen/editieren, Tests laufen
  lassen, Builds anstossen, Backups erstellen.
- **Verbot:** Keine destruktive Operation (siehe §4) ohne dokumentiertes
  Reviewer-OK.

### 3.2 Reviewer-Agent

- **Default-Wahl:** `code-reviewer` (bzw. `pr-review-toolkit:code-reviewer`)
  fuer Code-Review, `ultra-think` fuer adversarial Analyse bei
  Architektur-Fragen, `pr-review-toolkit:silent-failure-hunter` fuer
  Error-Handling-Pruefung.
- **Mandat:** Plan des Implementers stress-testen, Edge-Cases finden,
  konkrete Bedenken aufschreiben. Pflicht: nicht nur "looks good" sagen,
  sondern Risiken benennen oder explizit "keine Bedenken weil X" begruenden.
- **Empfohlene Kombination:** Mindestens ein adversarial Tool (ultra-think
  oder silent-failure-hunter), nicht nur ein generischer Code-Reviewer.

### 3.3 Kontrollraum

- Bleibt ChatGPT/Robert. Priorisiert Reihenfolge und entscheidet bei
  Reviewer-Veto oder Patt-Situationen zwischen den Agenten.

## 4. Destruktive Operationen — Cross-Check-Pflicht

Vor folgenden Aktionen MUSS der Implementer ein Plan-Block schreiben,
dem Reviewer-Agent vorlegen, und sein explizites OK abwarten:

1. **Datei-Replace ueber Write** auf existierende, nicht-leere Datei
   (Edit ist ok, weil Diff-basiert; Write ueberschreibt komplett)
2. **DB-Write** auf produktive Datenbanken (`suite.db`, `m.db`, `hm.db`).
   Sandbox-Writes sind freigegeben (siehe `engine-dj-db-safety`-Skill).
3. **`git push --force` / `git reset --hard` / `git tag -d` / `git branch -D`**
4. **`rm -rf` ausserhalb von `node_modules/`, `dist*/`, `/tmp/`**
5. **`asar extract-*`, `asar pack`, `npm install --force`, externe
   Build-Tools mit Argumenten, deren Default-Verhalten unklar ist**
6. **Schema-Aenderungen** (neue/geloeschte Tabellen in suite.db oder m.db,
   AUTOINCREMENT-Operationen)
7. **`gh pr merge`, `gh pr close`, `gh release create`**
8. **App-Installation nach `/Applications/`** mit Loeschung der
   Vorversion

Nicht-destruktive Operationen, die KEIN Cross-Check brauchen (Trend statt
Einzelfreigabe):
- `npm test`, `npm run desktop:dev` (lokal, read-only auf User-Daten)
- `git status`, `git diff`, `git log`, `git ls-remote`
- `Read`, `Glob`, `Grep`, normales `Edit` auf nicht-sensible Dateien
- `git add`, `git commit`, `git push` (zu nicht-protected Branch und ohne
  `--force`)
- Klar abgesteckte Build-Befehle wie `npm run desktop:dist:mac` (kein
  destruktiver Side-Effect ausserhalb von `dist-electron/`)

## 5. Workflow pro Feature (am Beispiel Punkt 30 — Label-Cover)

### Phase 1 — Auftragsklaerung

- Implementer liest Backlog-Eintrag (z.B. Punkt 30) und die referenzierten
  Sub-Pfade (`bp_labels`-Schema, `query_beatport_labels.py` Output).
- Implementer schreibt einen **Auftrags-Block** (max. 200 Worte) mit:
  - Goal in einem Satz
  - Welche Dateien er anfassen will (Pfade)
  - Welche destruktiven Operationen er erwartet
  - Tests-Verifikation

### Phase 2 — Adversarial Review

- Reviewer-Agent (ultra-think oder code-reviewer) liest den
  Auftrags-Block.
- Reviewer schreibt einen **Review-Block** mit:
  - Risiken pro destruktiver Operation
  - Alternativen die der Implementer nicht erwaehnt hat
  - Konkrete Test-Cases die fehlen
  - Verdict: "OK", "OK mit Bedingungen", "Nein, weil X"

### Phase 3 — Implementation

- Falls Reviewer "OK" oder "OK mit Bedingungen": Implementer setzt um.
- Implementer macht Backup vor jedem destruktiven Schritt (CLAUDE.md global).
- Bei "OK mit Bedingungen": Implementer dokumentiert wie die Bedingung
  erfuellt wurde.

### Phase 4 — Schluss-Review

- Reviewer prueft das Ergebnis (Tests gruen? Diff ohne Ueberraschungen?
  Erwartete Bundle-Groesse? `git diff --stat` proportional zu Plan?)
- Reviewer gibt schriftliches Final-OK.
- Erst dann: Commit, Tag, Push.

### Phase 5 — Bericht

- Implementer schreibt Werkbank-Bericht (MODEL-ROLES §5).
- Reviewer ergaenzt was nicht erwartet war.

## 6. Konkrete naechste Schritte (Reihenfolge)

| # | Feature | Implementer-Default | Reviewer-Default | Aufwand |
|---|---|---|---|---|
| 30 | Label-Cover anzeigen | code-architect + Standard-Werkbank | code-reviewer + ultra-think | ~1–2h |
| 31 | Meine Artists Tab | code-architect + Standard-Werkbank | pr-review-toolkit:silent-failure-hunter + code-reviewer | ~3–4h |
| 32 | Meine Tracks Tab | feature-dev:code-explorer (vorab) + code-architect | ultra-think (Konzeptphase) + code-reviewer | ~4–6h |

Punkt 30 ist der **Pilot-Lauf** fuer den Workflow. Klein, gut testbar,
keine neue Schema-Aenderung noetig (Spalten existieren in `bp_labels`).
Wenn der Workflow bei 30 sauber laeuft, koennen 31 und 32 nach gleichem
Schema folgen.

## 7. Was bei Konflikt zwischen Implementer und Reviewer passiert

- **Reviewer veto't:** Implementer haelt an, schreibt einen kurzen
  Rebut-Block ("Reviewer hat X gesagt, aber Y spricht dagegen").
- **Robert/Kontrollraum entscheidet** das Patt (nicht die Werkbank).
- **Bei DB-Schreiboperationen mit Sandbox-First-Regel im Konflikt:**
  Sandbox-First gewinnt immer (CLAUDE.md global ist Mindeststandard).

## 8. Was diese Goal-Datei nicht ist

- Sie ist **kein Implementierungsplan** fuer Punkt 30/31/32 selbst — der
  kommt pro Punkt als eigene `.agents/PLAN-punkt-XX-*.md`.
- Sie ist **kein Ersatz fuer DECISIONS §6** (Inventur → Plan → Backup →
  Freigabe → Ausfuehrung → Bericht) — sie schiebt die Reviewer-Stufe
  zwischen Plan und Ausfuehrung ein.
- Sie ist **kein YOLO-Modus-Ersatz** — Robert kann diesen Workflow jederzeit
  mit "ohne Reviewer durchziehen" pausieren, aber das ist explizit zu sagen
  (siehe MODEL-ROLES §Sicherheit "YOLO-Modus ist opt-in").

## 9. Fortschritts-Tracking

Diese Datei dokumentiert das Goal. Der Fortschritt wird in der jeweiligen
PLAN-Datei pro Punkt + im Werkbank-Bericht pro Session festgehalten.

Beim Abschluss der Punkte 30, 31, 32 wird hier ein Update-Block mit den
tatsaechlichen Erfahrungen ergaenzt, damit der Workflow weiter geschaerft
werden kann.
