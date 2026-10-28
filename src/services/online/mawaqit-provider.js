import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");
Gio._promisify(Gio.File.prototype, "make_directory_async", "make_directory_finish");
Gio._promisify(Gio.File.prototype, "replace_contents_bytes_async", "replace_contents_bytes_finish");
Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish");

export class MawaqitClient {
    #settings;
    #slugChangedId = null;
    #cache;
    #timezone;
    #ready;

    constructor(settings, extensionName, refreshSchedule) {
        this.#settings = settings;
        this.#slugChangedId = settings.connect("changed::mawaqit-slug", refreshSchedule);
        this.#ready = this.#init(extensionName, settings.mawaqitSlug);
    }
    async #init(extensionName, slug) {
        this.#cache = await this.#generateCache(extensionName, slug);
        this.#timezone = GLib.TimeZone.new_identifier(this.#cache.timezone);
    }

    async fetchPrayerTimes([year, month, day]) {
        await this.#ready;

        // calendar months are 0 indexed, day are 1 indexed strings.
        // format: [fajr, ...extra?, shuruq?, dhuhr, asr, maghrib, isha]
        const prayers = this.#cache.calendar[month - 1]?.[String(day)];
        if (!prayers || prayers.length < 5) throw new Error(_("Unexpected prayer data structure or array length"));

        const toGDateTime = (timeStr) => GLib.DateTime.new(this.#timezone, year, month, day, +timeStr.slice(0, 2), +timeStr.slice(3), 0);

        return {
            fajr: toGDateTime(prayers[0]),
            duha: prayers.length >= 6 ? toGDateTime(prayers.at(-5)).add_minutes(15) : null,
            dhuhr: toGDateTime(prayers.at(-4)),
            asr: toGDateTime(prayers.at(-3)),
            maghrib: toGDateTime(prayers.at(-2)),
            isha: toGDateTime(prayers.at(-1)),
        };
    }

    async #generateCache(extensionName, slug) {
        const cacheDir = Gio.File.new_for_path(GLib.get_user_cache_dir() + "/" + extensionName);
        const cacheFile = cacheDir.get_child("mawaqit-cache.json");
        const nowUnix = GLib.DateTime.new_now_local().to_unix();

        const diskCache = await this.#readDiskCache(cacheFile, slug, nowUnix);
        if (diskCache) return diskCache;

        const freshCache = {
            slug,
            last_updated_unix: nowUnix,
            ...(await this.#fetchCalendarOnline(slug)),
        };
        this.#writeDiskCache(cacheDir, cacheFile, freshCache);
        return freshCache;
    }
    async #readDiskCache(cacheFile, slug, nowUnix) {
        try {
            const [success, contents] = await cacheFile.load_contents_async(null);
            if (!success) return null;

            const parsedData = JSON.parse(new TextDecoder().decode(contents));

            // 30 days cache invalidation
            if (slug === parsedData.slug && nowUnix - parsedData.last_updated_unix <= 2592000) return parsedData;
        } catch {
            // file missing or corrupted, return null for now
        }
        return null;
    }
    async #writeDiskCache(cacheDir, cacheFile, cache) {
        try {
            await cacheDir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                console.error(_("MawaqitClient: Failed to create cache directory: %s").format(e.message));
                return;
            }
        }
        try {
            await cacheFile.replace_contents_bytes_async(new GLib.Bytes(JSON.stringify(cache)), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.warn(_("MawaqitClient: Failed to update the Mawaqit prayers cache: %s").format(e.message));
        }
    }
    async #fetchCalendarOnline(slug) {
        const session = new Soup.Session();
        const message = Soup.Message.new("GET", "https://mawaqit.net/en/" + slug);
        if (!message) throw new Error(_("Invalid Mawaqit mosque URL slug."));

        const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.get_status() !== Soup.Status.OK) throw new Error(_("Network error: HTTP %s").format(message.get_status()));

        const htmlString = new TextDecoder().decode(bytes.get_data());
        const timezoneMatch = htmlString.match(/"timezone"\s*:\s*"([^"]+)"/);
        const calendarMatch = htmlString.match(/"calendar"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
        if (!timezoneMatch || !calendarMatch) throw new Error(_("Failed to parse prayer schedule from Mawaqit."));

        const calendar = JSON.parse(calendarMatch[1]);
        if (calendar.length !== 12) throw new Error(_("Expected calendar to be 12 months long."));

        return {
            timezone: timezoneMatch[1].replaceAll("\\/", "/"),
            calendar: calendar,
        };
    }

    destroy() {
        if (this.#slugChangedId) {
            this.#settings.disconnect(this.#slugChangedId);
            this.#slugChangedId = null;
        }
    }
}
