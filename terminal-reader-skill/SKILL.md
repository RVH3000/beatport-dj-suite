---
name: terminal-reader
description: >
  Liest Terminal-Ausgaben direkt als Text über Desktop Commander MCP — ohne Screenshots.
  Verwende diesen Skill IMMER wenn du Terminal-Output, Testergebnisse, Build-Logs,
  Compiler-Fehler oder CLI-Ausgaben auf dem Mac des Users lesen musst. Auch triggern bei:
  "zeig mir die Ausgabe", "was steht im Terminal", "lies die Logs", "Testergebnisse lesen",
  "guck ins Terminal", "check the output", "read terminal", "show test results".
  Dieser Skill ersetzt den Screenshot-Umweg über computer-use für Terminal-Inhalte komplett.
  Nutze ihn auch proaktiv wenn der User einen Befehl auf seinem Mac ausführt und du
  das Ergebnis brauchst — statt zu fragen "zeig mir die Ausgabe", lies sie einfach selbst.
---

# Terminal Reader — Direkter Textzugriff auf macOS Terminal

## Warum dieser Skill existiert

Computer-use-Tools können das Terminal nur als Screenshot lesen (Tier "click" — kein Tippen erlaubt). Das bedeutet: Pixel parsen, scrollen, zoomen, mehrere Roundtrips. Desktop Commander dagegen läuft direkt auf dem Mac des Users und liefert Terminal-Output als reinen Text — sofort, vollständig, durchsuchbar.

## Werkzeug-Hierarchie

```
1. Desktop Commander (Text)     ← IMMER BEVORZUGEN
   start_process / read_process_output / interact_with_process

2. Bash-Tool (Sandbox)          ← Für eigene Berechnungen in der Sandbox
   Läuft NICHT auf dem Mac des Users!

3. computer-use (Screenshots)   ← NUR für GUI-Apps (Finder, Ableton, etc.)
   Terminal-Screenshots sind der LETZTE Ausweg
```

## Strategie 1: Befehl selbst ausführen (bevorzugt)

Wenn du einen Befehl auf dem Mac des Users ausführen und das Ergebnis lesen willst:

```
1. mcp__Desktop_Commander__start_process
   command: "cd ~/Projects/mein-projekt && npm test"
   timeout_ms: 60000

2. mcp__Desktop_Commander__read_process_output
   pid: <vom start_process zurückgegeben>
   offset: 0
```

Das gibt dir die komplette Ausgabe als Text. Kein Screenshot nötig.

**Beispiel: Tests ausführen und Ergebnis lesen**
```
start_process("cd ~/Projects/_local/beatport-dj-suite && node --test tests/**/*.test.mjs", timeout_ms: 120000)
→ pid: 12345

read_process_output(pid: 12345, offset: -50)
→ Letzte 50 Zeilen der Testausgabe als Text
```

**Beispiel: Git-Status auf dem Mac prüfen**
```
start_process("cd ~/Projects/_local/beatport-dj-suite && git status", timeout_ms: 10000)
→ pid: 12346

read_process_output(pid: 12346)
→ "On branch main\nYour branch is up to date..."
```

## Strategie 2: Laufenden Prozess lesen

Wenn der User bereits einen Befehl im Terminal ausgeführt hat und du das Ergebnis lesen willst:

```
1. mcp__Desktop_Commander__list_sessions
   → Zeigt alle aktiven Terminal-Sessions mit PID

2. mcp__Desktop_Commander__read_process_output
   pid: <passende PID>
   offset: -100    ← Letzte 100 Zeilen lesen
```

**Pagination für lange Ausgaben:**
- `offset: 0` → Neue Zeilen seit letztem Lesen
- `offset: -50` → Letzte 50 Zeilen (tail)
- `offset: 500, length: 100` → Zeilen 500-599 (absolute Position)

## Strategie 3: Interaktive Sessions

Für REPLs (Python, Node.js) oder interaktive Tools:

```
1. start_process("python3 -i", timeout_ms: 30000)
2. interact_with_process(pid, "import json; print(json.dumps({'test': True}))")
3. read_process_output(pid) → Ergebnis als Text
```

## Wann NICHT Desktop Commander nutzen

- **GUI-Apps inspizieren** (Finder, Ableton, Browser) → computer-use Screenshots
- **Sandbox-Berechnungen** (Dateien schreiben, Code testen in der VM) → Bash-Tool
- **Web-Inhalte lesen** → WebFetch / Claude in Chrome

## Fehlerfälle

**Prozess nicht gefunden:** `list_sessions` zeigt keine passende Session
→ Neuen Prozess mit `start_process` starten

**Timeout:** Befehl braucht länger als erwartet
→ `timeout_ms` erhöhen (max 300000 = 5 Minuten)
→ Oder `read_process_output` mit Offset wiederholt aufrufen

**Leere Ausgabe:** Prozess hat noch nichts geschrieben
→ `read_process_output` mit `timeout_ms: 5000` nochmal versuchen

## Konfigurationsoption: Keine Screenshots

Wenn der User sagt "keine Screenshots" oder "direkt lesen", bedeutet das:
- NIEMALS `mcp__computer-use__screenshot` für Terminal-Inhalte verwenden
- IMMER über Desktop Commander als Text lesen
- Auch bei Fehlern NICHT auf Screenshots zurückfallen
- Stattdessen den Befehl über `start_process` selbst ausführen

## Zusammenfassung

Der kürzeste Weg zur Terminal-Ausgabe:
1. `start_process(command, timeout_ms)` → PID
2. `read_process_output(pid, offset: -100)` → Text

Kein Screenshot. Kein Scrollen. Kein Zoomen. Reiner Text.
