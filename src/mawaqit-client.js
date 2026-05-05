import GLib from "gi://GLib";
import Gio from "gi://Gio";

const MAWAQIT_API_BASE = "https://mawaqit.net/api/2.0";
const MAWAQIT_WEB_BASE = "https://mawaqit.net/fr";

export class MawaqitClient {
    constructor() {
    }

    // Search for mosques by query string
    async searchMosques(query) {
        const encodedQuery = encodeURIComponent(query);
        const uri = `${MAWAQIT_API_BASE}/mosque/search?word=${encodedQuery}&fields=slug,label,uuid,name,localisation,times,latitude,longitude`;
        
        return new Promise((resolve, reject) => {
            const file = Gio.File.new_for_uri(uri);
            file.load_contents_async(null, (source, result) => {
                try {
                    const [success, contents] = source.load_contents_finish(result);
                    if (!success) {
                        reject(new Error("Failed to load search results"));
                        return;
                    }
                    const data = JSON.parse(new TextDecoder().decode(contents));
                    resolve(data || []);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Fetch prayer times by scraping the mosque page
    async fetchPrayerTimes(slug) {
        const uri = `${MAWAQIT_WEB_BASE}/${slug}`;
        
        return new Promise((resolve, reject) => {
            const file = Gio.File.new_for_uri(uri);
            file.load_contents_async(null, (source, result) => {
                try {
                    const [success, contents] = source.load_contents_finish(result);
                    if (!success) {
                        reject(new Error(`Failed to fetch mosque page for ${slug}`));
                        return;
                    }
                    const html = new TextDecoder().decode(contents);
                    const times = this._parseConfData(html);
                    resolve(times);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Parse confData from HTML using brace counting (handles nested objects)
    _parseConfData(html) {
        let startMarker = "var confData = ";
        let startIndex = html.indexOf(startMarker);
        if (startIndex === -1) {
            startMarker = "let confData = ";
            startIndex = html.indexOf(startMarker);
        }
        if (startIndex === -1) {
            throw new Error("confData not found in page");
        }

        let braceCount = 0;
        let inString = false;
        let stringChar = null;
        let escapeNext = false;
        const jsonStart = startIndex + startMarker.length;

        for (let i = jsonStart; i < html.length; i++) {
            const char = html[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (!inString && (char === '"' || char === "'")) {
                inString = true;
                stringChar = char;
                continue;
            }

            if (inString && char === stringChar) {
                inString = false;
                stringChar = null;
                continue;
            }

            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') braceCount--;

                if (braceCount === 0 && i > jsonStart) {
                    const jsonStr = html.substring(jsonStart, i + 1);
                    try {
                        const confData = JSON.parse(jsonStr);
                        return this._extractPrayerTimes(confData);
                    } catch (error) {
                        throw new Error(`Failed to parse confData JSON: ${error.message}`);
                    }
                }
            }
        }

        throw new Error("Could not parse confData: unbalanced braces");
    }

    // Extract prayer times from confData
    _extractPrayerTimes(confData) {
        const times = confData.times || [];
        const calendar = confData.calendar || [];
        
        // Mawaqit times array: [fajr, shuruq, duhr, asr, maghrib, isha] (6 elements)
        // OR [fajr, duhr, asr, maghrib, isha] (5 elements) without shuruq
        
        let fajr, duha, dhuhr, asr, maghrib, isha;
        
        if (times.length === 6) {
            // With shuruq: [fajr, shuruq, duhr, asr, maghrib, isha]
            fajr = this._parseTimeString(times[0]);
            const shuruq = this._parseTimeString(times[1]);
            duha = this._addMinutes(shuruq, 15);
            dhuhr = this._parseTimeString(times[2]);
            asr = this._parseTimeString(times[3]);
            maghrib = this._parseTimeString(times[4]);
            isha = this._parseTimeString(times[5]);
        } else if (times.length === 5) {
            // Without shuruq: [fajr, duhr, asr, maghrib, isha]
            fajr = this._parseTimeString(times[0]);
            dhuhr = this._parseTimeString(times[1]);
            asr = this._parseTimeString(times[2]);
            maghrib = this._parseTimeString(times[3]);
            isha = this._parseTimeString(times[4]);
            duha = null; // Can't calculate without shuruq
        } else {
            throw new Error(`Unexpected times array length: ${times.length}`);
        }

        return {
            fajr,
            duha,
            dhuhr,
            asr,
            maghrib,
            isha,
            source: "mawaqit",
            rawTimes: times,
            calendar,
        };
    }

    // Parse "HH:MM" string into GLib.DateTime for today
    _parseTimeString(timeStr) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const now = GLib.DateTime.new_now_local();
        return GLib.DateTime.new_local(
            now.get_year(),
            now.get_month(),
            now.get_day_of_month(),
            hours,
            minutes,
            0.0
        );
    }

    // Add minutes to a DateTime
    _addMinutes(dateTime, minutes) {
        return dateTime.add_minutes(minutes);
    }

    destroy() {
        // Cleanup if needed
    }
}
