const STORAGE_KEY = "beatport-suite-unified-settings-v1";

export const DEFAULT_UNIFIED_SETTINGS = {
  scanRoots: ["/Users/roberth.", "/Users/roberth./Projects"].join("\n"),
  engineDatabaseFolder: "",
  pythonCommand: "python3",
  oscHost: "127.0.0.1",
  oscPort: 9000,
  oscAddressPrefix: "/beatport-suite",
};

export function loadUnifiedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_UNIFIED_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_UNIFIED_SETTINGS,
      ...(parsed || {}),
    };
  } catch {
    return { ...DEFAULT_UNIFIED_SETTINGS };
  }
}

export function saveUnifiedSettings(nextSettings = {}) {
  const merged = {
    ...loadUnifiedSettings(),
    ...(nextSettings || {}),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}
