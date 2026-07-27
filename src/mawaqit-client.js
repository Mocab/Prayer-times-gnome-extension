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

    async fetchPrayerTimes([year, month, day]) {
        if (!this._cache) {
            const cacheDir = Gio.File.new_for_path(`${GLib.get_user_cache_dir()}/${this._extensionName}`);
            const file = cacheDir.get_child("mawaqit-cache.json");

            try {
                const [success, contents] = await file.load_contents_async(null);

                if (success) {
                    const parsedData = JSON.parse(new TextDecoder().decode(contents));

                    // 30 days cache invalidation // TODO: group new_now_local
                    if (this._slug === parsedData.slug && GLib.DateTime.new_now_local().to_unix() - parsedData.last_updated_unix <= 2592000) {
                        this._cache = parsedData;
                    }
                }
            } catch (e) {
                // file doesn't exist or json is corrupted, just ignore and fetch online
            }

            if (!this._cache) {
                const freshCache = await this._fetchOnline();

                this._cache = freshCache;

                // write to cache file for future use
                cacheDir.make_directory_async(Gio.PRIORITY_DEFAULT, null, (source, result) => {
                    try {
                        source.make_directory_finish(result);
                    } catch (e) {
                        // if error is anything other than dir already exists then abort
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                            console.error(_("MawaqitClient: Failed to write cache file: %s").format(e.message));
                            return; // FIXME
                        }
                    }
                    file.replace_contents_bytes_async(new GLib.Bytes(JSON.stringify(freshCache)), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
                        try {
                            source.replace_contents_finish(result);
                        } catch (e) {
                            console.warn(_("MawaqitClient: Failed to update the Mawaqit prayers cache: %s").format(e.message));
                        }
                    });
                });
            }
        }

        // calendar: months are 0 indexed, key string for days and prayer day format: fajr, ...extra?, shuruq?, dhuhr, asr, maghrib, isha.
        const prayers = this._cache.calendar[month - 1][day.toString()];
        if (prayers.length < 5) throw new Error(_("Unexpected prayer data structure or array length"));

        const tz = GLib.TimeZone.new_identifier(this._cache.timezone);
        const convertToGDateTime = (prayerTimeStr) => GLib.DateTime.new(tz, year, month, day, +prayerTimeStr.slice(0, 2), +prayerTimeStr.slice(3, 5), 0);

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
