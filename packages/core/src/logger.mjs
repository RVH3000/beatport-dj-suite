import fs from "node:fs";
import path from "node:path";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const DEFAULT_LEVEL = process.env.BPDJS_LOG_LEVEL || "info";

function fmt(tag, level, args) {
  const ts = new Date().toISOString();
  const tagPart = tag ? ` [${tag}]` : "";
  return `${ts} ${level.toUpperCase()}${tagPart} ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}`;
}

class FileSink {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
    this.stream.on("error", () => { /* swallow EPIPE-style errors */ });
  }
  write(line) { try { this.stream.write(line + "\n"); } catch { /* ignore */ } }
  close() { try { this.stream.end(); } catch { /* ignore */ } }
}

export class Logger {
  constructor({ tag = null, level = DEFAULT_LEVEL, sinks = [] } = {}) {
    this._tag = tag;
    this._level = LEVELS[level] ?? LEVELS.info;
    this._sinks = sinks;
  }

  setLevel(level) {
    const num = LEVELS[level];
    if (num === undefined) throw new Error(`Unknown log level: ${level}`);
    this._level = num;
  }

  addFileSink(filePath) {
    this._sinks.push(new FileSink(filePath));
    return this;
  }

  tag(name) {
    const child = new Logger({ tag: name, sinks: this._sinks });
    child._level = this._level;
    return child;
  }

  _emit(levelName, args) {
    if (LEVELS[levelName] < this._level) return;
    const line = fmt(this._tag, levelName, args);
    const fn = console[levelName] || console.log;
    fn(line);
    for (const sink of this._sinks) sink.write(line);
  }

  debug(...args) { this._emit("debug", args); }
  info(...args) { this._emit("info", args); }
  warn(...args) { this._emit("warn", args); }
  error(...args) { this._emit("error", args); }
}

export const logger = new Logger();

export function createLogger(opts = {}) {
  return new Logger(opts);
}
