--[[
================================================================================
  obs-now-playing.lua
  Zeigt den aktuell spielenden Track aus Media Playlist Source oder VLC
  als Text-Overlay in OBS an.

  Funktionsweise:
  - Du wählst in den Script-Settings eine Media-Quelle (Media Playlist Source
    oder VLC Video Source) und eine Textquelle als Ziel.
  - Das Skript pollt alle 500 ms den aktuell spielenden Dateipfad.
  - Daraus wird ein lesbarer Titel gemacht (Dateiendung weg, Unterstriche
    zu Leerzeichen, "Artist - Title" wird erkannt).
  - Bei Änderung wird die Textquelle live aktualisiert.

  Voraussetzungen:
  - OBS 28 oder neuer
  - Optional: Media Playlist Source Plugin von CodeYan01
    (https://github.com/CodeYan01/media-playlist-source)
  - Optional: VLC Video Source (benötigt installiertes VLC)

  Installation:
  - OBS → Werkzeuge → Scripts → "+" → diese Datei auswählen
  - Dropdowns rechts ausfüllen

  Autor: gemeinsam mit Claude gebaut, MIT-Lizenz
================================================================================
]]--

obs = obslua

-- ============================================================================
-- Konfiguration (wird über die Script-Properties vom User gesetzt)
-- ============================================================================

-- Name der zu überwachenden Media-Quelle (Media Playlist Source oder VLC)
local media_source_name = ""

-- Name der Textquelle, in die der Track-Name geschrieben wird
local text_source_name = ""

-- Präfix für den Output (z.B. "Now Playing: ")
local output_prefix = ""

-- Merkt sich den zuletzt angezeigten Text, damit wir nur bei Änderung schreiben
local last_displayed = ""

-- ============================================================================
-- Helper: Dateiname säubern und aufbereiten
-- ============================================================================

-- Nimmt einen vollen Pfad und baut daraus einen sauberen Display-Text.
-- Beispiel:
--   "/Volumes/Musik/Deadmau5_-_Strobe.mp3" → "Deadmau5 - Strobe"
--   "/Volumes/Musik/random track.wav"     → "random track"
local function format_filename(full_path)
    if not full_path or full_path == "" then
        return ""
    end

    -- 1. Nur den Dateinamen nehmen, nicht den ganzen Pfad
    --    (funktioniert auf macOS mit "/" und auf Windows mit "\")
    local filename = full_path:match("([^/\\]+)$") or full_path

    -- 2. Dateiendung entfernen (letzter Punkt bis zum Ende)
    filename = filename:gsub("%.[^%.]+$", "")

    -- 3. Unterstriche zu Leerzeichen (viele DJ-Dateinamen nutzen "_")
    filename = filename:gsub("_", " ")

    -- 4. Mehrfache Leerzeichen zu einem einzelnen
    filename = filename:gsub("%s+", " ")

    -- 5. Leerzeichen vorne/hinten weg
    filename = filename:match("^%s*(.-)%s*$")

    return filename
end

-- ============================================================================
-- Aktuelle Datei aus der Media-Quelle lesen
-- ============================================================================

-- Liest aus den Source-Settings den aktuell spielenden Dateipfad.
-- Unterstützt:
--   - Media Playlist Source (CodeYan01)  → Key: current_folder_item_filename
--   - VLC Video Source                   → Key: playlist[current_index]
--   - Media Source (eingebaut)           → Key: local_file
local function get_current_file(source)
    if source == nil then
        return nil
    end

    -- Settings des Source-Objekts holen (liefert ein obs_data Objekt)
    local settings = obs.obs_source_get_settings(source)
    if settings == nil then
        return nil
    end

    local current_file = nil

    -- Variante 1: Media Playlist Source speichert den Dateinamen direkt
    current_file = obs.obs_data_get_string(settings, "current_folder_item_filename")

    -- Variante 2: Media Source (eingebaut) nutzt "local_file"
    if current_file == nil or current_file == "" then
        current_file = obs.obs_data_get_string(settings, "local_file")
    end

    -- Variante 3: VLC Video Source. Hier ist "playlist" ein Array von Objekten,
    -- jedes mit einem "value" Feld (Pfad zur Datei). Leider gibt es keinen
    -- direkten "current index"-Key — wir nehmen einen Workaround über die
    -- Media-API (siehe unten).
    if current_file == nil or current_file == "" then
        -- Fallback: obs_source_media_get_duration etc. funktionieren nur, wenn
        -- es sich um einen Media-Control-fähigen Source handelt.
        -- Für VLC reicht es meist, den Titel über die Media-API zu bekommen:
        -- Das ist leider nicht direkt über Settings möglich. Als
        -- Pragmatik: wir nehmen den ersten Eintrag der Playlist, wenn kein
        -- besserer Hinweis da ist. Für echten VLC-Support empfiehlt sich
        -- die Media Playlist Source stattdessen.
        local playlist = obs.obs_data_get_array(settings, "playlist")
        if playlist ~= nil then
            local count = obs.obs_data_array_count(playlist)
            if count > 0 then
                local first = obs.obs_data_array_item(playlist, 0)
                if first ~= nil then
                    current_file = obs.obs_data_get_string(first, "value")
                    obs.obs_data_release(first)
                end
            end
            obs.obs_data_array_release(playlist)
        end
    end

    obs.obs_data_release(settings)
    return current_file
end

-- ============================================================================
-- Text in die Textquelle schreiben
-- ============================================================================

local function update_text_source(new_text)
    -- Textquelle per Name suchen
    local text_source = obs.obs_get_source_by_name(text_source_name)
    if text_source == nil then
        return
    end

    -- Settings holen, Text ändern, zurückschreiben
    local settings = obs.obs_source_get_settings(text_source)
    obs.obs_data_set_string(settings, "text", new_text)
    obs.obs_source_update(text_source, settings)

    -- Wichtig: Objekte freigeben, sonst Memory Leak
    obs.obs_data_release(settings)
    obs.obs_source_release(text_source)
end

-- ============================================================================
-- Haupt-Tick: läuft alle 500 ms (wird unten in script_load registriert)
-- ============================================================================

local function tick()
    if media_source_name == "" or text_source_name == "" then
        return
    end

    -- Media-Quelle holen
    local media_source = obs.obs_get_source_by_name(media_source_name)
    if media_source == nil then
        return
    end

    -- Aktuellen Dateipfad lesen
    local current_file = get_current_file(media_source)
    obs.obs_source_release(media_source)

    if current_file == nil then
        return
    end

    -- Aufbereiten
    local display = output_prefix .. format_filename(current_file)

    -- Nur wenn sich was geändert hat, Text aktualisieren (spart Arbeit)
    if display ~= last_displayed then
        update_text_source(display)
        last_displayed = display
    end
end

-- ============================================================================
-- UI: Script-Properties (die Felder, die der User in OBS sieht)
-- ============================================================================

-- Beschreibung oben im Script-Dialog
function script_description()
    return [[<b>Now Playing Anzeige</b><br/>
Zeigt den aktuell spielenden Track aus einer Media Playlist Source
oder VLC Video Source als Text in OBS an.<br/><br/>
1. Media-Quelle auswählen (die Quelle mit der Musik)<br/>
2. Textquelle auswählen (wo der Name hin soll)<br/>
3. Optional einen Präfix eintragen<br/><br/>
Dateinamen werden automatisch aufgeräumt:
Unterstriche zu Leerzeichen, Dateiendung weg.
Benenne deine Dateien idealerweise als <code>Artist - Title.mp3</code>.
]]
end

-- Definiert die Eingabefelder
function script_properties()
    local props = obs.obs_properties_create()

    -- Dropdown für Media-Quelle
    local media_prop = obs.obs_properties_add_list(
        props,
        "media_source",
        "Media-Quelle",
        obs.OBS_COMBO_TYPE_EDITABLE,
        obs.OBS_COMBO_FORMAT_STRING
    )

    -- Dropdown für Text-Quelle
    local text_prop = obs.obs_properties_add_list(
        props,
        "text_source",
        "Textquelle (Ziel)",
        obs.OBS_COMBO_TYPE_EDITABLE,
        obs.OBS_COMBO_FORMAT_STRING
    )

    -- Alle Quellen aus OBS durchgehen und in die Dropdowns eintragen.
    -- Wir filtern locker — lieber mehr zeigen als zu streng und dann
    -- Quellen verpassen. Das Skript erkennt zur Laufzeit automatisch, aus
    -- welchem Setting-Key der Dateiname zu lesen ist.
    local sources = obs.obs_enum_sources()
    if sources ~= nil then
        for _, source in ipairs(sources) do
            local source_id = obs.obs_source_get_unversioned_id(source) or ""
            local name = obs.obs_source_get_name(source)

            -- Media-Quellen: alles was nach Audio/Video-Input aussieht
            -- (ffmpeg_source = "Media Source", vlc_source = VLC,
            --  und Plugins die "media_playlist" oder "media" im Namen haben)
            if source_id == "ffmpeg_source"
                or source_id == "vlc_source"
                or source_id:find("media_playlist") ~= nil
                or source_id:find("playlist") ~= nil then
                obs.obs_property_list_add_string(media_prop, name, name)
            end

            -- Text-Quellen: FreeType2 (macOS/Linux) oder GDI+ (Windows),
            -- egal welche API-Version
            if source_id:find("text_ft2") ~= nil
                or source_id:find("text_gdiplus") ~= nil then
                obs.obs_property_list_add_string(text_prop, name, name)
            end
        end
        obs.source_list_release(sources)
    end

    -- Textfeld für Präfix
    obs.obs_properties_add_text(
        props,
        "output_prefix",
        "Präfix (optional, z.B. \"Now Playing: \")",
        obs.OBS_TEXT_DEFAULT
    )

    return props
end

-- Default-Werte
function script_defaults(settings)
    obs.obs_data_set_default_string(settings, "output_prefix", "")
end

-- Wird aufgerufen wenn der User Settings ändert
function script_update(settings)
    media_source_name = obs.obs_data_get_string(settings, "media_source")
    text_source_name = obs.obs_data_get_string(settings, "text_source")
    output_prefix = obs.obs_data_get_string(settings, "output_prefix")
    -- Reset, damit nach Änderung sofort neu geschrieben wird
    last_displayed = ""
end

-- Wird einmal beim Laden des Skripts aufgerufen
function script_load(settings)
    -- Timer starten: alle 500 ms die tick()-Funktion aufrufen
    obs.timer_add(tick, 500)
end

-- Aufräumen beim Entladen
function script_unload()
    obs.timer_remove(tick)
end
