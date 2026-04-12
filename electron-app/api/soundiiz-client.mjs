/**
 * Soundiiz API Client (read + trigger only)
 *
 * Dieser Client erweitert die bestehende Sync-Pipeline optional um Monitoring
 * und Trigger-Funktionen fuer Soundiiz-Syncs.
 */

const SOUNDIIZ_BASE = "https://api.soundiiz.com";
const DEFAULT_TIMEOUT_MS = 12000;

let _apiKey = "";

export function setApiKey(key) {
  _apiKey = typeof key === "string" ? key.trim() : "";
}

function toErrorResult(error, status) {
  const result = {
    ok: false,
    error: String(error?.message ?? error ?? "Unbekannter Fehler"),
  };
  if (Number.isFinite(status)) result.status = status;
  return result;
}

function endpointLabel(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    return String(
      value.name
      ?? value.title
      ?? value.service
      ?? value.platform
      ?? value.type
      ?? value.id
      ?? ""
    );
  }
  return "";
}

function normalizeSync(raw = {}) {
  return {
    id: String(raw.id ?? raw.syncId ?? raw._id ?? ""),
    title: String(raw.title ?? raw.name ?? raw.playlistTitle ?? raw.playlist ?? "Unbenannter Sync"),
    source: endpointLabel(raw.source ?? raw.from ?? raw.sourceService ?? raw.source_service),
    destination: endpointLabel(raw.destination ?? raw.to ?? raw.destinationService ?? raw.destination_service),
    status: String(raw.status ?? raw.state ?? raw.syncStatus ?? "unknown"),
    nextExecutionDate: raw.nextExecutionDate
      ?? raw.next_execution_date
      ?? raw.nextRunAt
      ?? raw.next_run_at
      ?? null,
    raw,
  };
}

async function readResponseBody(resp) {
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await resp.json().catch(() => null);
  }
  const text = await resp.text().catch(() => "");
  return text ? { message: text } : null;
}

async function soundiizFetch(path, options = {}) {
  const timeoutMs = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Beatport-DJ-Suite/3.5.0",
    ...options.headers,
  };

  if (_apiKey) headers.Authorization = `Bearer ${_apiKey}`;

  try {
    const url = path.startsWith("http") ? path : `${SOUNDIIZ_BASE}${path}`;
    const resp = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body ?? undefined,
      signal: controller.signal,
    });

    const data = await readResponseBody(resp);

    if (!resp.ok) {
      const message = data?.error
        ?? data?.message
        ?? data?.detail
        ?? `HTTP ${resp.status} ${resp.statusText}`;
      return toErrorResult(message, resp.status);
    }

    return {
      ok: true,
      status: resp.status,
      data,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return toErrorResult(`Timeout nach ${timeoutMs}ms`);
    }
    return toErrorResult(error);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkConnection() {
  const response = await soundiizFetch("/v1/me", { timeout: 10000 });
  if (!response.ok) return response;
  return {
    ok: true,
    status: response.status,
    account: response.data,
  };
}

export async function listSyncs({ offset = 0, limit = 50 } = {}) {
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Math.trunc(Number(offset))) : 0;
  const safeLimitInput = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 50;
  const safeLimit = Math.max(1, Math.min(200, safeLimitInput));
  const query = new URLSearchParams({
    offset: String(safeOffset),
    limit: String(safeLimit),
  });

  const response = await soundiizFetch(`/v1/me/syncs?${query.toString()}`);
  if (!response.ok) return response;

  const payload = response.data;
  const items = Array.isArray(payload) ? payload
    : Array.isArray(payload?.syncs) ? payload.syncs
    : Array.isArray(payload?.items) ? payload.items
    : Array.isArray(payload?.data) ? payload.data
    : [];

  return {
    ok: true,
    status: response.status,
    offset: safeOffset,
    limit: safeLimit,
    count: items.length,
    syncs: items.map((item) => normalizeSync(item)),
  };
}

export async function getSync(id) {
  const syncId = String(id ?? "").trim();
  if (!syncId) {
    return toErrorResult("Soundiiz Sync-ID fehlt.");
  }

  const response = await soundiizFetch(`/v1/me/syncs/${encodeURIComponent(syncId)}`);
  if (!response.ok) return response;

  const payload = response.data?.sync ?? response.data ?? {};
  return {
    ok: true,
    status: response.status,
    sync: normalizeSync(payload),
  };
}

export async function triggerSync(id) {
  const syncId = String(id ?? "").trim();
  if (!syncId) {
    return toErrorResult("Soundiiz Sync-ID fehlt.");
  }

  const response = await soundiizFetch(`/v1/me/syncs/${encodeURIComponent(syncId)}/trigger`, {
    method: "POST",
  });
  if (!response.ok) return response;

  return {
    ok: true,
    status: response.status,
    accepted: response.status === 202,
    result: response.data ?? null,
  };
}
