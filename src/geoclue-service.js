import Geoclue from "gi://Geoclue";
import GObject from "gi://GObject";
import GLib from "gi://GLib";

// seconds between location updates
export const LOCATION_REFRESH_SECONDS = { hourly: 3600, "6h": 6 * 3600, daily: 24 * 3600 };

export class GeoclueService {
    constructor(extensionId, refreshSchedule, refreshSeconds) {
        this._extensionId = extensionId;
        this._refreshScheduleMain = refreshSchedule;
        this._refreshSeconds = refreshSeconds;

        this._fetchedAt = 0;
        this._timerId = null;
        this._destroyed = false;
        this.currentLocation = null;
        this._startPromise = null;
    }

    _isStale() {
        return GLib.get_real_time() - this._fetchedAt >= this._refreshSeconds * 1e6;
    }

    // timers don't count time spent suspended, so a stale location is also refreshed lazily by start() when the schedule is recomputed after wake
    _scheduleRefresh() {
        if (this._destroyed) return;
        if (this._timerId) GLib.Source.remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._refreshSeconds, () => {
            this._timerId = null;
            const old = this.currentLocation;
            this.start()
                .then((location) => {
                    // IP based fixes jitter slightly, ignore moves too small to change prayer times
                    if (old && (Math.abs(location.latitude - old.latitude) > 0.05 || Math.abs(location.longitude - old.longitude) > 0.05)) this._refreshScheduleMain();
                })
                .catch((e) => console.warn(`[${this._extensionId}]: Location refresh failed:`, e));
            return GLib.SOURCE_REMOVE;
        });
    }

    // resolves with the cached location, fetching a new one first if there is none or it is older than the refresh interval
    start() {
        if (this._startPromise) return this._startPromise;
        if (this.currentLocation && !this._isStale()) return Promise.resolve(this.currentLocation);

        this._startPromise = new Promise((resolve, reject) => {
            Geoclue.Simple.new_with_thresholds(this._extensionId, Geoclue.AccuracyLevel.NEIGHBORHOOD, 0, 0, null, (source, result) => {
                this._startPromise = null;
                try {
                    const proxy = Geoclue.Simple.new_with_thresholds_finish(result);

                    const location = proxy.get_location();
                    this.currentLocation = { latitude: location.latitude, longitude: location.longitude };
                    this._fetchedAt = GLib.get_real_time();

                    this._scheduleRefresh();
                    // stop the client so the system location indicator turns off between updates
                    proxy.get_client().call_stop(null, (client, stopResult) => {
                        try {
                            client.call_stop_finish(stopResult);
                        } catch (e) {
                            console.warn(`[${this._extensionId}]: Failed to stop GeoClue client:`, e);
                        }
                    });

                    resolve(this.currentLocation);
                } catch (e) {
                    // a failed refresh keeps the last known location and tries again later
                    if (this.currentLocation) {
                        this._scheduleRefresh();
                        resolve(this.currentLocation);
                    } else reject(e);
                }
            });
        });
        return this._startPromise;
    }

    destroy() {
        this._destroyed = true;
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
        this.currentLocation = null;
        this._fetchedAt = 0;
        this._startPromise = null;
    }
}
