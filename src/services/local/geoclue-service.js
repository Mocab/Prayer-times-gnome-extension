import Gio from "gi://Gio";
import Geoclue from "gi://Geoclue";

export class GeoclueService {
    #proxy = null;
    #signalId = null;
    #cancellable = new Gio.Cancellable();

    static async create(extensionId, onLocationChanged) {
        return new Promise((resolve, reject) => {
            const service = new GeoclueService();
            Geoclue.Simple.new_with_thresholds(extensionId, Geoclue.AccuracyLevel.NEIGHBORHOOD, 600, 5000, service.#cancellable, (source, result) => {
                try {
                    service.#proxy = Geoclue.Simple.new_with_thresholds_finish(result);
                    service.#signalId = service.#proxy.connect("notify::location", onLocationChanged);
                    resolve(service);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    get location() {
        const location = this.#proxy?.get_location();
        return { latitude: location.latitude, longitude: location.longitude };
    }

    destroy() {
        if (!this.#cancellable.is_cancelled()) this.#cancellable.cancel();
        if (this.#proxy) {
            if (this.#signalId) {
                this.#proxy.disconnect(this.#signalId);
                this.#signalId = null;
            }
            this.#proxy = null;
        }
    }
}
