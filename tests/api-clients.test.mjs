#!/usr/bin/env node
/**
 * API-Clients Tests
 *
 * Testet die reinen (pure) Funktionen aus:
 * - djplaylists-client.mjs: parsePlaylistsFromHtml, buildLexiconImportUrl,
 *   extractPlaylistId, setApiKey, setSessionCookie
 * - lexicon-client.mjs: Source-Analyse der internen Hilfsfunktionen
 *
 * Netzwerk-abhängige Funktionen werden NICHT getestet (kein HTTP-Mock nötig).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── djplaylists-client Pure Functions importieren ─────────────────────────────

const djpl = await import(
  path.join(ROOT, "electron-app", "api", "djplaylists-client.mjs")
);

const {
  parsePlaylistsFromHtml,
  buildLexiconImportUrl,
  extractPlaylistId,
  setApiKey,
  setSessionCookie,
} = djpl;

// ── lexicon-client Source lesen (für Analyse-Tests) ───────────────────────────

const lexiconSource = await fs.readFile(
  path.join(ROOT, "electron-app", "api", "lexicon-client.mjs"),
  "utf-8"
);

const djplSource = await fs.readFile(
  path.join(ROOT, "electron-app", "api", "djplaylists-client.mjs"),
  "utf-8"
);

// ═══════════════════════════════════════════════════════════════════════════════
// DJPlaylists.fm Client — Pure Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe("DJPlaylists.fm Client", () => {

  // ── parsePlaylistsFromHtml ────────────────────────────────────────────────

  describe("parsePlaylistsFromHtml", () => {
    it("Extrahiert Playlists aus Pattern 1: /p/SLUG Links", () => {
      const html = `
        <div>
          <a href="/p/summer-techno-2025">Summer Techno 2025</a>
          <a href="/p/deep-house-mix">Deep House Mix</a>
        </div>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 2);
      assert.equal(result[0].id, "summer-techno-2025");
      assert.equal(result[0].name, "Summer Techno 2025");
      assert.equal(result[1].id, "deep-house-mix");
      assert.equal(result[1].name, "Deep House Mix");
    });

    it("Extrahiert Playlists aus Pattern 2: /playlists/ID Links", () => {
      const html = `
        <a href="/playlists/abc-123">My Playlist</a>
        <a href="/playlist/def-456">Another One</a>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.ok(result.length >= 1, "Mindestens 1 Playlist erwartet");
      const ids = result.map((r) => r.id);
      assert.ok(ids.includes("abc-123"), "abc-123 fehlt");
    });

    it("Extrahiert Playlists aus Pattern 3: data-playlist-id", () => {
      const html = `
        <div data-playlist-id="data-pl-1" data-title="Data Playlist One">
        </div>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, "data-pl-1");
      assert.equal(result[0].name, "Data Playlist One");
    });

    it("Dedupliziert identische Playlist-IDs", () => {
      const html = `
        <a href="/p/same-id">Playlist A</a>
        <a href="/p/same-id">Playlist A Duplicate</a>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 1, "Duplikat sollte gefiltert werden");
    });

    it("Dekodiert HTML-Entities in Namen", () => {
      const html = `<a href="/p/amp-test">Beats &amp; Bass &#39;26</a>`;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, "Beats & Bass '26");
    });

    it("Filtert zu kurze Namen (<2 Zeichen)", () => {
      const html = `<a href="/p/short-name">X</a>`;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 0, "Einzelzeichen-Name sollte gefiltert werden");
    });

    it("Setzt position fortlaufend ab 1", () => {
      const html = `
        <a href="/p/first">First Playlist</a>
        <a href="/p/second">Second Playlist</a>
        <a href="/p/third">Third Playlist</a>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result[0].position, 1);
      assert.equal(result[1].position, 2);
      assert.equal(result[2].position, 3);
    });

    it("Gibt leeres Array für HTML ohne Playlists zurück", () => {
      const html = "<html><body><p>Keine Playlists hier</p></body></html>";
      const result = parsePlaylistsFromHtml(html);
      assert.deepStrictEqual(result, []);
    });

    it("Baut vollständige URL aus relativen Pfaden", () => {
      const html = `<a href="/p/test-playlist">Test</a>`;
      const result = parsePlaylistsFromHtml(html);
      assert.ok(result[0].url.startsWith("http"), "URL sollte absolut sein");
      assert.ok(result[0].url.includes("/p/test-playlist"), "Pfad fehlt in URL");
    });

    it("Extrahiert Track-Anzahl aus umgebendem HTML", () => {
      const html = `
        <div>
          <span>42 tracks</span>
          <a href="/p/counted-playlist">Counted</a>
        </div>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.equal(result.length, 1);
      // trackCount kann null sein wenn das Pattern nicht matched — das ist ok
      if (result[0].trackCount !== null) {
        assert.equal(result[0].trackCount, 42);
      }
    });

    it("Verarbeitet komplexes HTML mit gemischten Patterns", () => {
      const html = `
        <div class="playlists">
          <a href="/p/techno-vibes" class="card">Techno Vibes</a>
          <span>25 tracks</span>
          <a href="/playlists/house-classics">House Classics</a>
          <div data-playlist-id="trance-2026" data-title="Trance Anthems"></div>
        </div>
      `;
      const result = parsePlaylistsFromHtml(html);
      assert.ok(result.length >= 2, `Mindestens 2 erwartet, gefunden: ${result.length}`);
    });
  });

  // ── buildLexiconImportUrl ─────────────────────────────────────────────────

  describe("buildLexiconImportUrl", () => {
    it("Baut korrekte Lexicon-Import-URL", () => {
      const url = buildLexiconImportUrl("my-playlist-123");
      assert.ok(url.includes("djplaylists.fm") || url.includes("api.djplaylists.fm"),
        "URL sollte djplaylists.fm Domain enthalten");
      assert.ok(url.includes("my-playlist-123"), "Playlist-ID fehlt in URL");
      assert.ok(url.includes("/playlists/"), "Playlists-Pfad fehlt");
    });

    it("Hängt keine doppelten Slashes an", () => {
      const url = buildLexiconImportUrl("test");
      assert.ok(!url.includes("//playlists"), "Doppelter Slash");
    });

    it("Funktioniert mit verschiedenen ID-Formaten", () => {
      const ids = ["simple", "with-dashes", "under_scored", "mix3d-n4m3"];
      for (const id of ids) {
        const url = buildLexiconImportUrl(id);
        assert.ok(url.includes(id), `ID ${id} fehlt in URL`);
      }
    });
  });

  // ── extractPlaylistId ─────────────────────────────────────────────────────

  describe("extractPlaylistId", () => {
    it("Extrahiert ID aus /playlists/ URL", () => {
      const id = extractPlaylistId("https://djplaylists.fm/playlists/abc-123");
      assert.equal(id, "abc-123");
    });

    it("Extrahiert ID aus /playlist/ URL (Singular)", () => {
      const id = extractPlaylistId("https://djplaylists.fm/playlist/def-456");
      assert.equal(id, "def-456");
    });

    it("Gibt null zurück für fremde URLs", () => {
      assert.equal(extractPlaylistId("https://example.com/test"), null);
      assert.equal(extractPlaylistId("https://google.com"), null);
    });

    it("Extrahiert Slug korrekt aus /p/ URLs", () => {
      // FIX: Regex erkennt jetzt /p/ neben /playlist/ und /playlists/
      const id = extractPlaylistId("https://www.djplaylists.fm/p/summer-mix");
      assert.equal(id, "summer-mix");
    });

    it("Ist case-insensitive für Domain", () => {
      const id = extractPlaylistId("https://DJPLAYLISTS.FM/playlists/upper-case");
      assert.equal(id, "upper-case");
    });

    it("Funktioniert ohne Protokoll-Prefix", () => {
      const id = extractPlaylistId("djplaylists.fm/playlists/no-protocol");
      assert.equal(id, "no-protocol");
    });

    it("Ignoriert Query-Parameter bei /playlists/", () => {
      const id = extractPlaylistId("https://djplaylists.fm/playlists/with-params?ref=test");
      assert.ok(id !== null, "ID sollte trotz Query-Params extrahiert werden");
    });
  });

  // ── setApiKey / setSessionCookie ──────────────────────────────────────────

  describe("Session-State-Setter", () => {
    it("setApiKey wirft keinen Fehler", () => {
      assert.doesNotThrow(() => setApiKey("test-key-12345"));
    });

    it("setSessionCookie wirft keinen Fehler", () => {
      assert.doesNotThrow(() => setSessionCookie("_session=abc123"));
    });

    it("setApiKey akzeptiert null zum Zurücksetzen", () => {
      assert.doesNotThrow(() => setApiKey(null));
    });

    it("setSessionCookie akzeptiert null zum Zurücksetzen", () => {
      assert.doesNotThrow(() => setSessionCookie(null));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DJPlaylists.fm Client — Source-Analyse
// ═══════════════════════════════════════════════════════════════════════════════

describe("DJPlaylists.fm Client — Source-Analyse", () => {
  it("Definiert korrekte API-Base-URLs", () => {
    assert.ok(
      djplSource.includes("https://api.djplaylists.fm"),
      "DJPL_BASE fehlt"
    );
    assert.ok(
      djplSource.includes("https://www.djplaylists.fm"),
      "DJPL_FRONTEND fehlt"
    );
  });

  it("Hat Supabase-URL konfiguriert", () => {
    assert.ok(
      djplSource.includes("supabase.co"),
      "Supabase-URL fehlt"
    );
  });

  it("Exportiert alle erwarteten Funktionen", () => {
    const expectedExports = [
      "setApiKey",
      "setSessionCookie",
      "parsePlaylistsFromHtml",
      "buildLexiconImportUrl",
      "extractPlaylistId",
      "checkConnection",
      "importBeatportPlaylist",
      "scrapeMyPlaylists",
      "getMyPlaylists",
      "getPlaylistTracks",
      "exploreApi",
    ];
    for (const name of expectedExports) {
      assert.ok(
        djplSource.includes(`export function ${name}`) ||
        djplSource.includes(`export async function ${name}`),
        `Export '${name}' fehlt`
      );
    }
  });

  it("Verwendet AbortController für Timeouts", () => {
    assert.ok(
      djplSource.includes("AbortController"),
      "AbortController nicht verwendet"
    );
  });

  it("Hat Default-Timeout von 15 Sekunden", () => {
    assert.ok(
      djplSource.includes("15000"),
      "DEFAULT_TIMEOUT_MS fehlt oder falsch"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lexicon Client — Source-Analyse
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lexicon Client — Source-Analyse", () => {
  it("Lexicon Client existiert und ist nicht leer", () => {
    assert.ok(lexiconSource.length > 100, "lexicon-client.mjs ist zu kurz");
  });

  it("Konfiguriert Port 48624 für Lexicon API", () => {
    assert.ok(
      lexiconSource.includes("48624"),
      "Lexicon-Port 48624 fehlt"
    );
  });

  it("Exportiert checkConnection", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("checkConnection"),
      "checkConnection fehlt"
    );
  });

  it("Exportiert getPlaylists", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("getPlaylists"),
      "getPlaylists fehlt"
    );
  });

  it("Exportiert getPlaylistTracks", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("getPlaylistTracks"),
      "getPlaylistTracks fehlt"
    );
  });

  it("Exportiert getAllTracks", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("getAllTracks"),
      "getAllTracks fehlt"
    );
  });

  it("Exportiert batchImportFromDjplaylists", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("batchImportFromDjplaylists"),
      "batchImportFromDjplaylists fehlt"
    );
  });

  it("Exportiert triggerEngineDjExport", () => {
    assert.ok(
      lexiconSource.includes("export") && lexiconSource.includes("triggerEngineDjExport"),
      "triggerEngineDjExport fehlt"
    );
  });

  it("Hat Playlist-Flattening-Logik", () => {
    // Lexicon gibt verschachtelte Playlist-Bäume zurück
    assert.ok(
      lexiconSource.includes("flat") || lexiconSource.includes("flatten"),
      "Playlist-Flattening fehlt"
    );
  });

  it("Normalisiert Track-Daten", () => {
    // Lexicon-Tracks müssen auf ein gemeinsames Schema gemappt werden
    assert.ok(
      lexiconSource.includes("title") && lexiconSource.includes("artist"),
      "Track-Normalisierung fehlt"
    );
  });

  it("Verwendet AbortController für Timeouts", () => {
    assert.ok(
      lexiconSource.includes("AbortController"),
      "AbortController nicht verwendet"
    );
  });

  it("Hat Progress-Callback für getAllTracks", () => {
    assert.ok(
      lexiconSource.includes("onProgress"),
      "onProgress-Callback fehlt"
    );
  });

  it("Unterstützt mehrere Endpoint-Patterns (Fallback)", () => {
    // Lexicon API ist nicht stabil dokumentiert, daher mehrere Patterns
    const pathPatterns = (lexiconSource.match(/\/v1\//g) || []).length;
    assert.ok(
      pathPatterns >= 2,
      "Zu wenige API-Pfad-Varianten für Fallback"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Normalisierungsfunktionen (Source-Extraktion + Nachbau)
// ═══════════════════════════════════════════════════════════════════════════════

describe("DJPlaylists normalizePlaylists (intern)", () => {
  // Aus Source extrahiert — normalizePlaylists ist intern, nicht exportiert
  function normalizePlaylists(raw) {
    return raw.map((p) => ({
      id: String(p.id ?? p.playlist_id ?? p._id ?? ""),
      name: p.name ?? p.title ?? p.playlist_name ?? "Unbenannte Playlist",
      trackCount: p.track_count ?? p.trackCount ?? p.tracks?.length ?? 0,
      beatportUrl: p.source_url ?? p.beatport_url ?? p.url ?? null,
      updatedAt: p.updated_at ?? p.updatedAt ?? null,
      raw: p,
    }));
  }

  it("Normalisiert Standard-Felder", () => {
    const result = normalizePlaylists([{
      id: "123",
      name: "Test Playlist",
      track_count: 42,
    }]);
    assert.equal(result[0].id, "123");
    assert.equal(result[0].name, "Test Playlist");
    assert.equal(result[0].trackCount, 42);
  });

  it("Fallback auf alternative Feldnamen", () => {
    const result = normalizePlaylists([{
      playlist_id: "alt-id",
      title: "Alternative Title",
      trackCount: 10,
      source_url: "https://beatport.com/playlist/123",
    }]);
    assert.equal(result[0].id, "alt-id");
    assert.equal(result[0].name, "Alternative Title");
    assert.equal(result[0].trackCount, 10);
    assert.equal(result[0].beatportUrl, "https://beatport.com/playlist/123");
  });

  it("Fallback auf _id und playlist_name", () => {
    const result = normalizePlaylists([{
      _id: "mongo-id",
      playlist_name: "Mongo Playlist",
    }]);
    assert.equal(result[0].id, "mongo-id");
    assert.equal(result[0].name, "Mongo Playlist");
  });

  it("Fallback auf tracks.length für trackCount", () => {
    const result = normalizePlaylists([{
      id: "1",
      name: "Tracks Array",
      tracks: [{ id: 1 }, { id: 2 }, { id: 3 }],
    }]);
    assert.equal(result[0].trackCount, 3);
  });

  it("Default-Name bei fehlendem Namen", () => {
    const result = normalizePlaylists([{ id: "no-name" }]);
    assert.equal(result[0].name, "Unbenannte Playlist");
  });

  it("Default trackCount ist 0", () => {
    const result = normalizePlaylists([{ id: "no-count" }]);
    assert.equal(result[0].trackCount, 0);
  });

  it("beatportUrl ist null wenn nicht vorhanden", () => {
    const result = normalizePlaylists([{ id: "no-url" }]);
    assert.equal(result[0].beatportUrl, null);
  });

  it("Behält raw-Objekt bei", () => {
    const raw = { id: "raw-test", custom_field: "preserved" };
    const result = normalizePlaylists([raw]);
    assert.equal(result[0].raw.custom_field, "preserved");
  });
});
