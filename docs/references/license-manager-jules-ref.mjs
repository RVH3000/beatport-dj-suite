import fs from "node:fs";
import path from "node:fs";
import { app } from "electron";
import crypto from "node:crypto";

const LICENSE_FILE = "suite-license.json";

const DEFAULT_STATE = {
  edition: "dj",
  developerUnlocked: false,
  licenseKey: null,
  pinHash: null
};

let currentState = { ...DEFAULT_STATE };

function getLicensePath() {
  const userData = app.getPath("userData");
  return require("node:path").join(userData, LICENSE_FILE);
}

export function loadLicenseState() {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      currentState = { ...DEFAULT_STATE, ...parsed };

      if (currentState.developerUnlocked) {
          if (!currentState.licenseKey || !currentState.pinHash) {
              currentState.developerUnlocked = false;
          }
      }
    }
  } catch (err) {
    console.error("[LicenseManager] Fehler beim Laden:", err);
  }
  return currentState;
}

export function saveLicenseState() {
  try {
    fs.writeFileSync(getLicensePath(), JSON.stringify(currentState, null, 2));
  } catch (err) {
    console.error("[LicenseManager] Fehler beim Speichern:", err);
  }
}

export function getCapabilities() {
  return {
    edition: currentState.edition,
    developerUnlocked: currentState.developerUnlocked,
    features: {
      engineAnalysis: currentState.developerUnlocked,
      multiDbDiff: currentState.developerUnlocked,
      historyMerge: currentState.developerUnlocked,
      projectDiscovery: currentState.developerUnlocked,
      pythonLab: currentState.developerUnlocked,
      advancedDiagnostics: currentState.developerUnlocked
    }
  };
}

export function verifyLicense(key) {
  if (typeof key === "string" && key.startsWith("DEV-") && key.length > 8) {
      return { ok: true };
  }
  return { ok: false, error: "Ungültiger Lizenzschlüssel." };
}

export function hashPin(pin) {
    return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

export function unlockDeveloperMode(key, pin) {
    const validation = verifyLicense(key);
    if (!validation.ok) return validation;

    if (!pin || pin.length < 4) {
        return { ok: false, error: "PIN muss mindestens 4 Zeichen lang sein." };
    }

    currentState.licenseKey = key;
    currentState.pinHash = hashPin(pin);
    currentState.developerUnlocked = true;
    currentState.edition = "developer";

    saveLicenseState();
    return { ok: true, capabilities: getCapabilities() };
}

export function lockDeveloperMode() {
    currentState.developerUnlocked = false;
    currentState.edition = "dj";
    saveLicenseState();
    return { ok: true, capabilities: getCapabilities() };
}

export function authDeveloperMode(pin) {
    if (!currentState.licenseKey || !currentState.pinHash) {
        return { ok: false, error: "Keine gültige Lizenz hinterlegt." };
    }
    if (hashPin(pin) === currentState.pinHash) {
        currentState.developerUnlocked = true;
        currentState.edition = "developer";
        saveLicenseState();
        return { ok: true, capabilities: getCapabilities() };
    }
    return { ok: false, error: "PIN inkorrekt." };
}
