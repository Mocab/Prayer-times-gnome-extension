import Gio from "gi://Gio";
import Geoclue from "gi://Geoclue";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export class GeoclueService {
    #extensionName;
    #cancellable = new Gio.Cancellable();

    constructor(extensionName) {
        this.#extensionName = extensionName;
    }

    async getLocation() {
        return new Promise((resolve, reject) => {
            Geoclue.Simple.new_with_thresholds(this.#extensionName, Geoclue.AccuracyLevel.NEIGHBORHOOD, 600, 5000, this.#cancellable, (_source, result) => {
                let proxy = null;

                try {
                    proxy = Geoclue.Simple.new_with_thresholds_finish(result);

                    const location = proxy?.get_location();
                    if (!location) throw new Error(_("Location is unavailable."));

                    resolve({
                        latitude: location.latitude,
                        longitude: location.longitude,
                    });
                } catch (e) {
                    reject(e);
                } finally {
                    proxy?.get_client()?.call_stop(null, null);
                }
            });
        });
    }

    destroy() {
        if (!this.#cancellable.is_cancelled()) this.#cancellable.cancel();
    }
}
