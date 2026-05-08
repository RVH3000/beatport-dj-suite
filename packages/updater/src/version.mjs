/**
 * Leichter Semver-Parser für die Suite — wir brauchen nur Parse und Compare,
 * keine Range-Operatoren. Akzeptiert "MAJOR.MINOR.PATCH" mit optionalem
 * Pre-Release-Suffix ("4.2.7-beta.1") und optionalem führenden "v".
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseVersion(input) {
  if (typeof input !== "string") {
    throw new Error(`parseVersion: erwartet String, erhielt ${typeof input}`);
  }
  const m = input.trim().match(VERSION_RE);
  if (!m) throw new Error(`parseVersion: ungültiges Format: "${input}"`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
    raw: input
  };
}

function comparePrerelease(a, b) {
  // Beide null → gleich. Eine null → die ohne Pre-Release ist neuer (semver §11).
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aParts = a.split(".");
  const bParts = b.split(".");
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;
    const aNum = /^\d+$/.test(ap);
    const bNum = /^\d+$/.test(bp);
    if (aNum && bNum) {
      const diff = Number(ap) - Number(bp);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numerisch < alphanumerisch
    } else if (ap !== bp) {
      return ap < bp ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Vergleicht zwei Versionen. Akzeptiert Strings oder bereits geparste Objekte.
 * Gibt -1 / 0 / 1 zurück (a<b, a==b, a>b).
 */
export function compareVersions(a, b) {
  const va = typeof a === "string" ? parseVersion(a) : a;
  const vb = typeof b === "string" ? parseVersion(b) : b;
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return comparePrerelease(va.prerelease, vb.prerelease);
}

export function isNewer(candidate, base) {
  return compareVersions(candidate, base) > 0;
}

export function formatVersion(v) {
  const parsed = typeof v === "string" ? parseVersion(v) : v;
  let out = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.prerelease) out += `-${parsed.prerelease}`;
  if (parsed.build) out += `+${parsed.build}`;
  return out;
}
