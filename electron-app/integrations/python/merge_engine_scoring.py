#!/usr/bin/env python3
"""
Merge-Preview: Engine DJ Datenbank → scoring-data.json

Liest scoring-data.json + Engine-Track-Dump und schreibt eine Preview-Datei
mit allen geplanten Änderungen. Berührt scoring-data.json NICHT.

Match-Strategie:
  1. beatport_id (aus Engine streaming-URI) == scoring track_id  (primär)
  2. normalized title+artists+mix_name                           (fallback)

Konflikt-Begriff (nur ECHTE Konflikte werden gesammelt):
  - Beide Seiten haben einen Wert
  - Werte sind unterschiedlich
  - Feldregel ist "ask"
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def normalize(s: str | None) -> str:
    if not s:
        return ""
    s = str(s).lower().strip()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def match_key(title: str | None, artists: str | None, mix: str | None) -> str:
    return f"{normalize(title)}|{normalize(artists)}|{normalize(mix)}"


def is_empty(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and not v.strip():
        return True
    return False


def values_equal(a, b, field: str | None = None) -> bool:
    if is_empty(a) and is_empty(b):
        return True
    if is_empty(a) or is_empty(b):
        return False
    # BPM: ±1 Toleranz (Beatport rundet auf Integer, Engine analysiert float)
    if field == "bpm":
        try:
            return abs(float(a) - float(b)) < 1.0
        except (TypeError, ValueError):
            pass
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 0.01
    return normalize(str(a)) == normalize(str(b))


def apply_rule(field: str, source_val, target_val, rule: str) -> tuple[str, dict | None]:
    """
    Returns (action, conflict_dict_or_none).
    action in: "noop" | "enrich" | "overwrite" | "conflict"
    """
    src_empty = is_empty(source_val)
    tgt_empty = is_empty(target_val)

    if src_empty and tgt_empty:
        return "noop", None
    if src_empty and not tgt_empty:
        return "enrich", None  # immer auffüllen, egal welche Regel
    if not src_empty and tgt_empty:
        return "noop", None  # neue Seite hat nichts → alter Wert bleibt
    if values_equal(source_val, target_val, field=field):
        return "noop", None

    # Beide nicht leer und unterschiedlich
    if rule == "keep_old":
        return "noop", None
    if rule == "fill_missing":
        return "noop", None
    if rule in ("overwrite_newer", "overwrite_always"):
        return "overwrite", None
    # "ask" oder unbekannt
    return "conflict", {
        "field": field,
        "old": source_val,
        "new": target_val,
        "rule": rule,
    }


def run_engine_dump(engine_tools_path: Path) -> dict:
    """Ruft engine_tools.py dump-tracks-with-history und parst Output."""
    proc = subprocess.run(
        [sys.executable, str(engine_tools_path), "dump-tracks-with-history"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return {"ok": False, "error": f"engine_tools failed: {proc.stderr}"}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Invalid JSON from engine_tools: {e}"}


# scoring-data.json verwendet abgekürzte Feldnamen.
# search.js mappt das erst zur Laufzeit:  i→track_id, t→title, m→mix_name,
# a→artists, g→genre, b→bpm, k→key, c→camelot, y→year, l→label, ms→length_ms
SHORT_TO_LONG = {
    "i":  "track_id",
    "t":  "title",
    "m":  "mix_name",
    "a":  "artists",
    "g":  "genre",
    "b":  "bpm",
    "k":  "key",
    "c":  "camelot",
    "y":  "year",
    "l":  "label",
    "ms": "length_ms",
    "r":  "release",
}
LONG_TO_SHORT = {v: k for k, v in SHORT_TO_LONG.items()}


def sget(track: dict, long_field: str):
    """Liest ein Feld aus einem scoring-data Track (abgekürzte Keys)."""
    short = LONG_TO_SHORT.get(long_field)
    if short and short in track:
        return track[short]
    return track.get(long_field)


# Felder die wir aus Engine nach scoring-data übernehmen wollen (Langnamen).
# 'key' wird bewusst NICHT gemergt — Engine speichert als Integer-Code,
# scoring-data als Text ("F Major"), direkter Vergleich macht nur Müll.
ENRICHMENT_FIELDS = [
    "bpm", "year", "label", "length_ms",
    "rating", "play_count", "last_played", "plays_total",
    "file_path", "comment",
]


def preview_merge(config: dict, repo_root: Path) -> dict:
    # Pfade aus Config expandieren
    scoring_path = Path(config["sources"]["scoring_data"]).expanduser()
    if not scoring_path.exists():
        return {"ok": False, "error": f"scoring-data.json nicht gefunden: {scoring_path}"}

    # Scoring-Daten laden
    scoring = json.loads(scoring_path.read_text("utf8"))
    all_tracks = scoring.get("all_tracks", []) if isinstance(scoring, dict) else []

    # Engine-Dump holen
    engine_tools = repo_root / "electron-app" / "integrations" / "python" / "engine_tools.py"
    engine = run_engine_dump(engine_tools)
    if not engine.get("ok"):
        return {"ok": False, "error": engine.get("error", "Engine-Dump fehlgeschlagen")}
    engine_tracks = engine.get("tracks", [])

    # Index scoring tracks (Kurz-Keys berücksichtigen)
    by_track_id: dict[int, dict] = {}
    by_fallback: dict[str, dict] = {}
    for t in all_tracks:
        tid = sget(t, "track_id")
        if isinstance(tid, int):
            by_track_id[tid] = t
        fk = match_key(sget(t, "title"), sget(t, "artists"), sget(t, "mix_name"))
        if fk.strip("|"):
            by_fallback.setdefault(fk, t)

    field_rules: dict[str, str] = config.get("field_rules", {})
    default_strategy: str = config.get("default_strategy", "fill_missing")

    stats = {
        "engine_track_count":   len(engine_tracks),
        "scoring_track_count":  len(all_tracks),
        "matched":              0,
        "matched_by_id":        0,
        "matched_by_fallback":  0,
        "unmatched_engine":     0,
        "unmatched_with_bp_id": 0,
        "enrich_actions":       0,
        "overwrite_actions":    0,
        "conflicts":            0,
        "local_only":           0,
    }
    enrichments: list[dict] = []
    overwrites: list[dict] = []
    conflicts: list[dict] = []
    new_track_candidates: list[dict] = []
    local_only: list[dict] = []

    for e in engine_tracks:
        bp_id = e.get("beatport_id")
        match = None
        match_mode = None
        if bp_id and bp_id in by_track_id:
            match = by_track_id[bp_id]
            match_mode = "beatport_id"
        else:
            fk = match_key(e.get("title"), e.get("artists"), None)
            if fk.strip("|") and fk in by_fallback:
                match = by_fallback[fk]
                match_mode = "title_artists"

        if match is None:
            stats["unmatched_engine"] += 1
            if bp_id:
                stats["unmatched_with_bp_id"] += 1
                new_track_candidates.append({
                    "beatport_id": bp_id,
                    "title": e.get("title"),
                    "artists": e.get("artists"),
                })
            else:
                stats["local_only"] += 1
                local_only.append({
                    "engine_track_id": e.get("engine_track_id"),
                    "title": e.get("title"),
                    "artists": e.get("artists"),
                    "file_path": e.get("file_path"),
                    "plays_total": e.get("plays_total"),
                })
            continue

        stats["matched"] += 1
        if match_mode == "beatport_id":
            stats["matched_by_id"] += 1
        else:
            stats["matched_by_fallback"] += 1

        scoring_track_id = sget(match, "track_id")
        scoring_title = sget(match, "title")

        for field in ENRICHMENT_FIELDS:
            rule = field_rules.get(field, default_strategy)
            src_val = sget(match, field)
            tgt_val = e.get(field)
            action, conflict = apply_rule(field, src_val, tgt_val, rule)

            if action == "enrich":
                stats["enrich_actions"] += 1
                enrichments.append({
                    "track_id": scoring_track_id,
                    "title": scoring_title,
                    "field": field,
                    "value": tgt_val,
                    "via": match_mode,
                })
            elif action == "overwrite":
                stats["overwrite_actions"] += 1
                overwrites.append({
                    "track_id": scoring_track_id,
                    "title": scoring_title,
                    "field": field,
                    "old": src_val,
                    "new": tgt_val,
                    "rule": rule,
                    "via": match_mode,
                })
            elif action == "conflict":
                stats["conflicts"] += 1
                conflict.update({
                    "track_id": scoring_track_id,
                    "title": scoring_title,
                    "via": match_mode,
                })
                conflicts.append(conflict)

    preview = {
        "ok": True,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "scoring_path": str(scoring_path),
        "engine_database_folder": engine.get("database_folder"),
        "history_available": engine.get("history_available"),
        "stats": stats,
        "enrichments": enrichments,
        "overwrites": overwrites,
        "conflicts": conflicts,
        "new_track_candidates": new_track_candidates[:200],
        "local_only": local_only[:200],
        "rules_snapshot": {
            "default_strategy": default_strategy,
            "field_rules": field_rules,
        },
    }
    return preview


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Pfad zu scoring-merge-rules.json")
    parser.add_argument("--out", required=True, help="Wohin die Preview geschrieben wird")
    parser.add_argument("--repo-root", required=True, help="Worktree-Root (für engine_tools.py)")
    args = parser.parse_args()

    config_path = Path(args.config).expanduser()
    if not config_path.exists():
        print(json.dumps({"ok": False, "error": f"Config nicht gefunden: {config_path}"}))
        return 1

    config = json.loads(config_path.read_text("utf8"))
    repo_root = Path(args.repo_root).expanduser()

    preview = preview_merge(config, repo_root)
    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), "utf8")

    # Nur die Stats auf stdout emittieren — die volle Preview steht in der Datei
    summary = {
        "ok": preview.get("ok"),
        "out": str(out_path),
        "stats": preview.get("stats"),
        "error": preview.get("error"),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if preview.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
