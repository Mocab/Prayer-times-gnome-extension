// Core calculations from:
//   - Prayer Times Calculator (v3.2) (MIT license) by Hamid Zarrabi-Zadeh
//   - https://praytimes.org

import GLib from "gi://GLib";

export class CalcPrayerTimes {
    #location;
    #sunDecl;
    #timeEq;
    #midDayTime;

    constructor(today, timezone, location, calcMethod, asrMethod, highLatAdjustment) {
        // Global values
        this.#location = location;
        this.#sunPos(GLib.Date.new_dmy(today.day, today.month, today.year).get_julian() + 1721425); // Add offset between Jan 1, 0001 AD (Glib julians) and Jan 1, 4713 BC (actual julian beginning)
        this.#midDayTime = this.#mod(12 - this.#timeEq, 24);

        const astronomicalHours = {};

        const { fajr: fajrAngle, isha: ishaAngle } = this.#calcMethod(calcMethod);

        const sunHorizonAngle = 0.833; // The specific angle the middle of the sun is below the horizon
        astronomicalHours.fajr = this.#angleBelowHorizonTime(fajrAngle, -1);
        const sunriseTime = this.#angleBelowHorizonTime(sunHorizonAngle, -1);
        astronomicalHours.duha = sunriseTime + 0.25; // 15 min after sunrise
        astronomicalHours.thuhr = this.#midDayTime;
        astronomicalHours.asr = this.#angleBelowHorizonTime(this.#asrAngle(asrMethod));
        const sunsetTime = this.#angleBelowHorizonTime(sunHorizonAngle);
        astronomicalHours.maghrib = sunsetTime + 0.017; // ~1 minute after sunset
        if (calcMethod.id === "makkah") {
            // Umm al-Qura
            astronomicalHours.isha = astronomicalHours.maghrib + 1.5;
        } else {
            astronomicalHours.isha = this.#angleBelowHorizonTime(ishaAngle);
        }

        const nightLen = sunriseTime + 24 - sunsetTime;
        astronomicalHours.fajr = this.#adjustHighLat(highLatAdjustment, astronomicalHours.fajr, fajrAngle, sunriseTime, nightLen, -1);
        astronomicalHours.isha = this.#adjustHighLat(highLatAdjustment, astronomicalHours.isha, ishaAngle, sunsetTime, nightLen);

        // Store final values in this instance
        const utcMidnight = GLib.DateTime.new_utc(today.year, today.month, today.day, 0, 0, 0.0);
        Object.entries(astronomicalHours).forEach(([key, value]) => {
            this[key] = this.#astronomicalToTime(value, utcMidnight, timezone);
        });
    }

    #sunPos(jDays) {
        const d = jDays - 2451545.0 - this.#location.latitude / 360;
        const g = this.#mod(357.529 + 0.98560028 * d, 360);
        const q = this.#mod(280.459 + 0.98564736 * d, 360);
        const l = this.#mod(q + 1.915 * this.#sin(g) + 0.02 * this.#sin(2 * g), 360);
        const e = 23.439 - 0.00000036 * d;
        const ra = this.#mod(this.#arctan2(this.#cos(e) * this.#sin(l), this.#cos(l)) / 15, 24);

        this.#sunDecl = this.#arcsin(this.#sin(e) * this.#sin(l));
        this.#timeEq = q / 15 - ra;
    }

    #calcMethod(calcMethod) {
        const presetAngles = {
            mwl: { fajr: 18, isha: 17 },
            egypt: { fajr: 19.5, isha: 17.5 },
            france: { fajr: 12, isha: 12 },
            isna: { fajr: 15, isha: 15 },
            karachi: { fajr: 18, isha: 18 },
            turkey: { fajr: 18, isha: 17 },
            makkah: { fajr: 18.5, isha: null },
            malaysia: { fajr: 18, isha: 18 },
            russia: { fajr: 16, isha: 15 },
        };
        return presetAngles[calcMethod.id] ?? { fajr: calcMethod.fajr, isha: calcMethod.isha };
    }

    // Time when sun reaches a specific angle below horizon
    #angleBelowHorizonTime(angle, direction = 1) {
        const numerator = -this.#sin(angle) - this.#sin(this.#location.latitude) * this.#sin(this.#sunDecl);
        const diff = this.#arccos(numerator / (this.#cos(this.#location.latitude) * this.#cos(this.#sunDecl))) / 15;
        return this.#midDayTime + diff * direction;
    }

    #asrAngle(asrMethod) {
        const shadowFactor = asrMethod === "hanafi" ? 2 : 1;
        return -this.#arccot(shadowFactor + this.#tan(Math.abs(this.#location.latitude - this.#sunDecl)));
    }

    #adjustHighLat(highLatAdjustment, time, angle, base, nightLen, direction = 1) {
        let factor;
        switch (highLatAdjustment) {
            case "night-middle":
                factor = 0.5;
            case "night-seventh":
                factor = 1 / 7;
            case "angle":
                factor = (1 / 60) * angle;
        }
        const maxTimeLen = nightLen * factor;
        const timeDiff = (time - base) * direction;
        if (timeDiff > maxTimeLen) {
            return base + maxTimeLen * direction;
        }
        return time;
    }

    #astronomicalToTime(astronomicalHours, utcMidnight, timezone) {
        const hours = astronomicalHours - this.#location.longitude / 15;
        return utcMidnight.add_minutes(Math.round(hours * 60)).to_timezone(timezone);
    }

    // Math helpers
    #mod = (a, b) => ((a % b) + b) % b;

    #dtr = (d) => (d * Math.PI) / 180;
    #rtd = (r) => (r * 180) / Math.PI;

    #sin = (d) => Math.sin(this.#dtr(d));
    #cos = (d) => Math.cos(this.#dtr(d));
    #tan = (d) => Math.tan(this.#dtr(d));

    #arcsin = (d) => this.#rtd(Math.asin(d));
    #arccos = (d) => this.#rtd(Math.acos(d));
    #arccot = (x) => this.#rtd(Math.atan(1 / x));
    #arctan2 = (y, x) => this.#rtd(Math.atan2(y, x));
}
