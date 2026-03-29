import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SCAN_ROOTS = [
  os.homedir(),
  path.join(os.homedir(), "Projects"),
];

const DIR_PATTERNS = [
  /^beatport/i,
  /^dj-suite/i,
  /^engine/i,
  /^denon/i,
  /^m3u/i,
  /^playlist/i,
  /^bpm/i,
  /^osc/i,
  /^vj/i,
  /^ableton/i,
  /^maxpat/i,
  /^als-file/i,
  /^\.(beatport|dj)/i,
];

const CONTENT_KEYWORDS = ["beatport", "denon", "engine"];
const SCANNED_FILENAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Dockerfile",
]);

const DIRECT_FILE_PATTERNS = [/\.maxpat$/i, /\.als$/i, /\.m3u8?$/i];

const EXCLUDED_BASENAMES = new Set([
  ".git",
  ".next",
  ".venv",
  ".venv-app-build",
  "__pycache__",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "Library",
  "Downloads",
  ".codex",
  ".claude",
  ".Trash",
  ".cache",
  ".npm",
  ".oh-my-zsh",
  ".zsh_sessions",
  ".openclaw",
  "Dropbox",
  "Dropbox-CloudOptionDJteam",
]);

function matchesDirectoryName(name) {
  return DIR_PATTERNS.some((pattern) => pattern.test(name));
}

function matchesDirectFile(fileName) {
  return DIRECT_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function createRelativeLabel(root, absolutePath) {
  return path.relative(root, absolutePath) || ".";
}

async function readKeywordHits(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > 512_000) {
    return [];
  }
  const raw = await fs.readFile(filePath, "utf8");
  return CONTENT_KEYWORDS.filter((keyword) =>
    raw.toLowerCase().includes(keyword)
  );
}

async function walkDirectory(root, currentDir, results) {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = createRelativeLabel(root, absolutePath);

    if (entry.isDirectory()) {
      if (matchesDirectoryName(entry.name)) {
        results.directoryMatches.push({
          path: absolutePath,
          relativePath,
          matchedBy: entry.name.startsWith(".") ? "hidden-dir" : "dir-name",
        });
      }

      if (EXCLUDED_BASENAMES.has(entry.name)) {
        continue;
      }
      await walkDirectory(root, absolutePath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (matchesDirectFile(entry.name)) {
      results.fileMatches.push({
        path: absolutePath,
        relativePath,
        fileName: entry.name,
        matchedBy: "file-pattern",
      });
    }

    if (!SCANNED_FILENAMES.has(entry.name)) {
      continue;
    }

    try {
      const keywordHits = await readKeywordHits(absolutePath);
      if (keywordHits.length > 0) {
        results.fileMatches.push({
          path: absolutePath,
          relativePath,
          fileName: entry.name,
          matchedBy: "config-keyword",
          keywordHits,
        });
      }
    } catch {
      continue;
    }
  }
}

function collectPathsByNeedle(paths, needle) {
  return paths.filter((entry) => entry.path.toLowerCase().includes(needle));
}

function toUniquePaths(entries) {
  return [...new Set(entries.map((entry) => entry.path))];
}

export function buildUnifiedComponentMap(discovery, repoRoot = "") {
  const allMatches = [
    ...(discovery.directoryMatches || []),
    ...(discovery.fileMatches || []),
  ];

  const beatportSources = [
    ...collectPathsByNeedle(allMatches, "beatport-dj-suite"),
    ...collectPathsByNeedle(allMatches, "beatport-scanner"),
    ...collectPathsByNeedle(allMatches, "beatport-playlist-creator"),
  ];
  const engineSources = [
    ...collectPathsByNeedle(allMatches, "engine-dj-manager"),
    ...collectPathsByNeedle(allMatches, "engine-analyzer"),
  ];
  const abletonSources = [
    ...collectPathsByNeedle(allMatches, "ableton-sketch-tool"),
    ...collectPathsByNeedle(allMatches, "ableton-sketch-bridge"),
    ...collectPathsByNeedle(allMatches, "maxpat"),
    ...collectPathsByNeedle(allMatches, ".als"),
  ];
  const gastroSources = collectPathsByNeedle(allMatches, "gastro-erp");

  const bundled = [
    {
      id: "electron-app",
      label: "Electron App (beatport-dj-suite)",
      status: "bundled",
      path: repoRoot,
      sourcePaths: toUniquePaths(beatportSources),
    },
    {
      id: "m3u-export",
      label: "M3U8 Export Script",
      status: "bundled",
      path: path.join(repoRoot, "electron-app", "integrations", "m3u-exporter.mjs"),
      sourcePaths: toUniquePaths([
        ...beatportSources,
        ...engineSources,
        ...collectPathsByNeedle(allMatches, ".m3u"),
      ]),
    },
    {
      id: "engine-tools",
      label: "Engine DB / Denon History Tools (Python)",
      status: "bundled",
      path: path.join(repoRoot, "electron-app", "integrations", "python", "engine_tools.py"),
      sourcePaths: toUniquePaths(engineSources),
    },
    {
      id: "performance-classifier",
      label: "Performance Classifier (BPM/Energy/Danceability)",
      status: "bundled",
      path: path.join(repoRoot, "electron-app", "integrations", "performance-classifier.mjs"),
      sourcePaths: toUniquePaths([
        ...collectPathsByNeedle(allMatches, "beatport-playlist-creator"),
        ...collectPathsByNeedle(allMatches, "stem_analyzer.py"),
        ...collectPathsByNeedle(allMatches, "suno_prompt_generator.py"),
      ]),
    },
    {
      id: "osc-vj",
      label: "OSC → Max/MSP VJ Integration",
      status: "bundled",
      path: path.join(repoRoot, "electron-app", "integrations", "osc-bridge.mjs"),
      sourcePaths: toUniquePaths(abletonSources),
    },
    {
      id: "gastro-erp",
      label: "Gastro ERP (FastAPI, Docker)",
      status: gastroSources.length > 0 ? "linked" : "not-linked",
      path: gastroSources[0]?.path || "",
      sourcePaths: toUniquePaths(gastroSources),
    },
  ];

  return bundled;
}

export async function discoverProjectParts(options = {}) {
  const roots = Array.isArray(options.roots) && options.roots.length > 0
    ? options.roots
    : DEFAULT_SCAN_ROOTS;

  const results = {
    scannedAt: new Date().toISOString(),
    roots,
    directoryMatches: [],
    fileMatches: [],
  };

  for (const root of roots) {
    await walkDirectory(root, root, results);
  }

  return {
    ...results,
    summary: {
      directoryMatches: results.directoryMatches.length,
      fileMatches: results.fileMatches.length,
      uniquePaths: new Set(
        [...results.directoryMatches, ...results.fileMatches].map((entry) => entry.path)
      ).size,
    },
  };
}
