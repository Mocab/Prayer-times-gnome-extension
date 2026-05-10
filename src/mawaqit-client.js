import GLib from "gi://GLib";
import Soup from "gi://Soup";

const MAWAQIT_API_BASE = "https://mawaqit.net/api/2.0";
const MAWAQIT_WEB_BASE = "https://mawaqit.net/fr";

export class MawaqitClient {
    constructor() {
        this._session = new Soup.Session();
    }

    _sendRequest(uri) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new("GET", uri);
            if (!message) {
                reject(new Error(`Invalid URI: ${uri}`));
                return;
            }
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code !== Soup.Status.OK) {
                        reject(new Error(`HTTP ${message.status_code} for ${uri}`));
                        return;
                    }
                    resolve(new TextDecoder().decode(bytes.get_data()));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async searchMosques(query) {
        const encodedQuery = encodeURIComponent(query);
        const uri = `${MAWAQIT_API_BASE}/mosque/search?word=${encodedQuery}&fields=slug,label,uuid,name,localisation,times,latitude,longitude`;
        const text = await this._sendRequest(uri);
        return JSON.parse(text) || [];
    }

    async fetchPrayerTimes(slug) {
        const html = await this._sendRequest(`${MAWAQIT_WEB_BASE}/${slug}`);
        return this._parseConfData(html);
    }

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

            if (escapeNext) { escapeNext = false; continue; }
            if (char === "\\") { escapeNext = true; continue; }
            if (!inString && (char === '"' || char === "'")) { inString = true; stringChar = char; continue; }
            if (inString && char === stringChar) { inString = false; stringChar = null; continue; }

            if (!inString) {
                if (char === "{") braceCount++;
                else if (char === "}") braceCount--;

                if (braceCount === 0 && i > jsonStart) {
                    const jsonStr = html.substring(jsonStart, i + 1);
                    try {
                        return this._extractPrayerTimes(JSON.parse(jsonStr));
                    } catch (error) {
                        throw new Error(`Failed to parse confData JSON: ${error.message}`);
                    }
                }
            }
        }

        throw new Error("Could not parse confData: unbalanced braces");
    }

    extractTimesForDate(calendar, year, month, day) {
        const monthData = calendar[month - 1];
        if (!monthData) return null;
        const dayTimes = monthData[String(day)];
        if (!dayTimes) return null;

        const parseForDate = (timeStr) => {
            const [hours, minutes] = timeStr.split(":").map(Number);
            return GLib.DateTime.new_local(year, month, day, hours, minutes, 0.0);
        };

        let fajr, duha, dhuhr, asr, maghrib, isha;
        const n = dayTimes.length;

        if (n >= 6) {
            // Format: [Fajr, ...extras..., Shuruq, Dhuhr, Asr, Maghrib, Isha]
            // Last 5 entries are always Shuruq, Dhuhr, Asr, Maghrib, Isha
            fajr = parseForDate(dayTimes[0]);
            const shuruq = parseForDate(dayTimes[n - 5]);
            duha = this._addMinutes(shuruq, 15);
            dhuhr = parseForDate(dayTimes[n - 4]);
            asr = parseForDate(dayTimes[n - 3]);
            maghrib = parseForDate(dayTimes[n - 2]);
            isha = parseForDate(dayTimes[n - 1]);
        } else if (n === 5) {
            fajr = parseForDate(dayTimes[0]);
            dhuhr = parseForDate(dayTimes[1]);
            asr = parseForDate(dayTimes[2]);
            maghrib = parseForDate(dayTimes[3]);
            isha = parseForDate(dayTimes[4]);
            duha = null;
        } else {
            return null;
        }

        return { fajr, duha, dhuhr, asr, maghrib, isha, source: "mawaqit" };
    }

    _extractPrayerTimes(confData) {
        const times = confData.times || [];
        const calendar = confData.calendar || [];

        let fajr, duha, dhuhr, asr, maghrib, isha;
        const n = times.length;

        if (n >= 6) {
            fajr = this._parseTimeString(times[0]);
            const shuruq = this._parseTimeString(times[n - 5]);
            duha = this._addMinutes(shuruq, 15);
            dhuhr = this._parseTimeString(times[n - 4]);
            asr = this._parseTimeString(times[n - 3]);
            maghrib = this._parseTimeString(times[n - 2]);
            isha = this._parseTimeString(times[n - 1]);
        } else if (n === 5) {
            fajr = this._parseTimeString(times[0]);
            dhuhr = this._parseTimeString(times[1]);
            asr = this._parseTimeString(times[2]);
            maghrib = this._parseTimeString(times[3]);
            isha = this._parseTimeString(times[4]);
            duha = null;
        } else {
            throw new Error(`Unexpected times array length: ${times.length}`);
        }

        return { fajr, duha, dhuhr, asr, maghrib, isha, source: "mawaqit", rawTimes: times, calendar };
    }

    _parseTimeString(timeStr) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const now = GLib.DateTime.new_now_local();
        return GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), hours, minutes, 0.0);
    }

    _addMinutes(dateTime, minutes) {
        return dateTime.add_minutes(minutes);
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
}
