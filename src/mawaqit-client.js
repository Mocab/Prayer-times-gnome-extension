import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class MawaqitClient {
    constructor(extensionName, slug) {
        this._extensionName = extensionName;
        this._slug = slug;
        this._cache = null;
    }

    // date = { day, month, year}
    async fetchPrayerTimes(date) {
        if (!this._cache) {
            const cacheDir = Gio.File.new_for_path(`${GLib.get_user_cache_dir()}/${this._extensionName}`);
            const file = cacheDir.get_child("mawaqit-cache.json");

            try {
                const [contents] = await file.load_contents_async(null);
                const parsedData = JSON.parse(new TextDecoder().decode(contents));

                // 30 days cache invalidation // TODO: group new_now_local
                if (this._slug === parsedData.slug && GLib.DateTime.new_now_local().to_unix() - parsedData.last_updated_unix <= 2592000) {
                    this._cache = parsedData;
                }
            } catch (e) {
                // file doesn't exist or json is corrupted, just ignore and fetch online
            }

            if (!this._cache) {
                const freshCache = await this._fetchOnline();
                this._cache = freshCache;
                try {
                    if (!cacheDir.query_exists(null)) cacheDir.make_directory_with_parents(null);
                    file.replace_contents_bytes_async(new GLib.Bytes(JSON.stringify(freshCache)), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
                        try {
                            source.replace_contents_finish(result);
                        } catch (e) {
                            console.error(_("MawaqitClient: Failed to write cache file: %s").format(e));
                        }
                    });
                } catch (e) {
                    console.error(_("MawaqitClient: Failed to create cache directory: %s").format(e));
                }
            }
        }

        // calendar: months are 0 indexed, key string for days and prayer day format: fajr, ...extra?, shuruq?, dhuhr, asr, maghrib, isha.
        const prayers = this._cache.calendar[date.month - 1][date.day.toString()];
        if (prayers.length < 5) throw new Error(_("Unexpected prayer data structure or array length"));

        const tz = GLib.TimeZone.new_identifier(this._cache.timezone);
        const convertToGDateTime = (prayerTimeStr) => GLib.DateTime.new(tz, date.year, date.month, date.day, +prayerTimeStr.slice(0, 2), +prayerTimeStr.slice(3, 5), 0);

        return {
            fajr: convertToGDateTime(prayers[0]),
            duha: prayers.length >= 6 ? convertToGDateTime(prayers[prayers.length - 5]).add_minutes(15) : null,
            dhuhr: convertToGDateTime(prayers[prayers.length - 4]),
            asr: convertToGDateTime(prayers[prayers.length - 3]),
            maghrib: convertToGDateTime(prayers[prayers.length - 2]),
            isha: convertToGDateTime(prayers[prayers.length - 1]),
        };
    }

    async _fetchOnline() {
        const session = new Soup.Session();
        const message = Soup.Message.new("GET", `https://mawaqit.net/en/${this._slug}`);
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
            slug: this._slug,
            last_updated_unix: GLib.DateTime.new_now_local().to_unix(),
            timezone: timezoneMatch[1].replace(/\\\//g, "/"),
            calendar: calendar,
        };
    }
}
