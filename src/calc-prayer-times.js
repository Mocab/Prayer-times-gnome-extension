// Core calculations from:
//   - Prayer Times Calculator (v3.2) (MIT license) by Hamid Zarrabi-Zadeh
//   - https://praytimes.org

import GLib from "gi://GLib";

export class CalcPrayerTimes {
    #location;
    #jdOffset;
    #sinLat;
    #cosLat;

    constructor(date, timezone, location, calcMethod, asrMethod, highLatAdjustment) {
        this.#location = location;
        // precompute the Julian Day offset for the target date: Glib Julian baseline offset (+1721425) + J2000 epoch baseline (-2451545.0) + noon adjustment factor (-0.5).
        this.#jdOffset = GLib.Date.new_dmy(date.day, date.month, date.year).get_julian() - 730120.5 - location.longitude / 360;
        this.#sinLat = this.#sin(location.latitude);
        this.#cosLat = this.#cos(location.latitude);
        const noonSunPos = this.#getSunPos();

        const astronomicalHours = {};
        const calcMethodAngles = this.#getAngles(calcMethod);

        const sunHorizonAngle = 0.833; // angle where the middle of the sun is below the horizon
        const sunriseTime = this.#time(noonSunPos, sunHorizonAngle, -1);
        const sunsetTime = this.#time(noonSunPos, sunHorizonAngle, 1);

        astronomicalHours.fajr = this.#time(noonSunPos, calcMethodAngles.fajr, -1);
        astronomicalHours.duha = sunriseTime + 0.25; // 15 minutes after sunrise
        astronomicalHours.dhuhr = this.#mod(12 - noonSunPos.timeEq, 24);
        astronomicalHours.asr = this.#asrTime(asrMethod, noonSunPos);
        astronomicalHours.maghrib = sunsetTime + 0.017; // ~1 minute after sunset
        astronomicalHours.isha = calcMethod.id === "makkah" ? astronomicalHours.maghrib + 1.5 : this.#time(noonSunPos, calcMethodAngles.isha, 1);

        // high latitude adjustments
        const nightLen = sunriseTime + 24 - sunsetTime;
        astronomicalHours.fajr = this.#adjustHighLat(highLatAdjustment, astronomicalHours.fajr, calcMethodAngles.fajr, sunriseTime, nightLen, -1);
        astronomicalHours.isha = this.#adjustHighLat(highLatAdjustment, astronomicalHours.isha, calcMethodAngles.isha, sunsetTime, nightLen, 1);

        // Convert astronomical time to local time zone
        const utcMidnight = GLib.DateTime.new_utc(date.year, date.month, date.day, 0, 0, 0.0);
        for (const key in astronomicalHours) {
            this[key] = utcMidnight.add_minutes(Math.round((astronomicalHours[key] - this.#location.longitude / 15) * 60)).to_timezone(timezone);
        }
    }

    #getSunPos(approxHour = 12) {
        const d = this.#jdOffset + approxHour / 24;
        const g = this.#mod(357.529 + 0.98560028 * d, 360);
        const q = this.#mod(280.459 + 0.98564736 * d, 360);
        const l = this.#mod(q + 1.915 * this.#sin(g) + 0.02 * this.#sin(2 * g), 360);
        const e = 23.439 - 0.00000036 * d;
        const sinL = this.#sin(l);
        return {
            sunDecl: this.#arcsin(this.#sin(e) * sinL),
            timeEq: q / 15 - this.#mod(this.#arctan2(this.#cos(e) * sinL, this.#cos(l)) / 15, 24),
        };
    }

    #time(noonSunPos, angle, direction = 1) {
        const approxTime = this.#calculateHourAngle(noonSunPos, angle, direction);
        return this.#calculateHourAngle(this.#getSunPos(approxTime), angle, direction);
    }

    #asrTime(asrMethod, noonSunPos) {
        const shadowFactor = asrMethod === "hanafi" ? 2 : 1;
        const getAngle = (sunDecl) => -this.#arccot(shadowFactor + this.#tan(Math.abs(this.#location.latitude - sunDecl)));

        const approxTime = this.#calculateHourAngle(noonSunPos, getAngle(noonSunPos.sunDecl));

        const refinedSunPos = this.#getSunPos(approxTime);
        return this.#calculateHourAngle(refinedSunPos, getAngle(refinedSunPos.sunDecl));
    }

    #calculateHourAngle(sunPos, angle, direction = 1) {
        const midDay = this.#mod(12 - sunPos.timeEq, 24);
        const numerator = -this.#sin(angle) - this.#sinLat * this.#sin(sunPos.sunDecl);
        const denominator = this.#cosLat * this.#cos(sunPos.sunDecl);
        const diff = this.#arccos(numerator / denominator) / 15;
        return midDay + diff * direction;
    }

    #getAngles(calcMethod) {
        const presetAngles = Object.freeze({
            mwl: { fajr: 18, isha: 17 },
            egypt: { fajr: 19.5, isha: 17.5 },
            france: { fajr: 12, isha: 12 },
            isna: { fajr: 15, isha: 15 },
            karachi: { fajr: 18, isha: 18 },
            turkey: { fajr: 18, isha: 17 },
            makkah: { fajr: 18.5, isha: null },
            malaysia: { fajr: 18, isha: 18 },
            russia: { fajr: 16, isha: 15 },
        });
        return presetAngles[calcMethod.id] ?? { fajr: calcMethod.fajr, isha: calcMethod.isha };
    }

    #adjustHighLat(highLatAdjustment, time, angle, base, nightLen, direction = 1) {
        let factor = 0;
        switch (highLatAdjustment) {
            case "night-middle":
                factor = 0.5;
                break;
            case "night-seventh":
                factor = 1 / 7;
                break;
            case "angle":
                factor = angle / 60;
                break;
        }
        const maxTimeLen = nightLen * factor;
        if (Number.isNaN(time) || (time - base) * direction > maxTimeLen) {
            return base + maxTimeLen * direction;
        }
        return time;
    }

    #mod(a, b) {
        return ((a % b) + b) % b;
    }
    #dtr(d) {
        return (d * Math.PI) / 180;
    }
    #rtd(r) {
        return (r * 180) / Math.PI;
    }
    #sin(d) {
        return Math.sin(this.#dtr(d));
    }
    #cos(d) {
        return Math.cos(this.#dtr(d));
    }
    #tan(d) {
        return Math.tan(this.#dtr(d));
    }
    #arcsin(d) {
        return this.#rtd(Math.asin(d));
    }
    #arccos(d) {
        return this.#rtd(Math.acos(d));
    }
    #arccot(x) {
        return this.#rtd(Math.atan(1 / x));
    }
    #arctan2(y, x) {
        return this.#rtd(Math.atan2(y, x));
    }
}
