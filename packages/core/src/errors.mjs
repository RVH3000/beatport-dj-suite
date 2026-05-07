export function toErrorMessage(error) {
  if (!error) return "Unbekannter Fehler";
  return String(error.message || error);
}

export class AppError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = "AppError";
    if (cause) this.cause = cause;
    if (code) this.code = code;
  }
}
