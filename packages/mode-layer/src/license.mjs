/**
 * Lizenz-Stub. In v4.2 noch keine echte Lizenzprüfung — die kommt
 * eventuell später. Hier nur eine Schnittstelle, damit andere Pakete
 * (z. B. mode-layer/feature-flags) bereits darauf bauen können.
 *
 * Die Stub-Implementierung gibt für JEDEN Lizenz-Check `valid: true`
 * zurück. So funktioniert die App identisch zu v4.1, das auch keine
 * Lizenzprüfung hat.
 */

export const LICENSE_TYPE_FREE = "free";
export const LICENSE_TYPE_PRO = "pro";

export class LicenseStub {
  constructor({ type = LICENSE_TYPE_FREE } = {}) {
    this._type = type;
  }

  get type() { return this._type; }

  isPro() { return this._type === LICENSE_TYPE_PRO; }
  isFree() { return this._type === LICENSE_TYPE_FREE; }

  /**
   * Prüft, ob ein Feature für die aktuelle Lizenz freigeschaltet ist.
   * Stub-Verhalten: alle Features verfügbar.
   */
  hasFeature(_featureKey) {
    return true;
  }

  toJSON() {
    return { type: this._type, valid: true, mode: "stub" };
  }
}

export function createLicense(opts) {
  return new LicenseStub(opts);
}
