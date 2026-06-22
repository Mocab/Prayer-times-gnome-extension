import Geoclue from "gi://Geoclue";
import GObject from "gi://GObject";

export class GeoclueService {
    constructor(extensionId, reloadMain) {
        this._extensionId = extensionId;
        this._reloadExtensionMain = reloadMain;

        this._geoclueProxy = null;
        this._signalId = null;

        this.currentLocation = null;
        this._startPromise = null;
    }

    start() {
        if (this._startPromise) {
            return this._startPromise;
        }

        this._startPromise = new Promise((resolve, reject) => {
            Geoclue.Simple.new_with_thresholds(this._extensionId, Geoclue.AccuracyLevel.NEIGHBORHOOD, 600, 5000, null, (source, result) => {
                try {
                    this._geoclueProxy = Geoclue.Simple.new_with_thresholds_finish(result);

                    const location = this._geoclueProxy.get_location();
                    this.currentLocation = {
                        latitude: location.latitude,
                        longitude: location.longitude,
                    };

                    this._signalId = this._geoclueProxy.connect("notify::location", (service) => {
                        const newLoc = service.get_location();

                        this.currentLocation = {
                            latitude: newLoc.latitude,
                            longitude: newLoc.longitude,
                        };

                        this._reloadExtensionMain();
                    });

                    resolve(this.currentLocation);
                } catch (e) {
                    this._startPromise = null;
                    reject(e);
                }
            });
        });
        return this._startPromise;
    }

    destroy() {
        if (this._geoclueProxy) {
            if (this._signalId) {
                this._geoclueProxy.disconnect(this._signalId);
                this._signalId = null;
            }
            this._geoclueProxy = null;
        }
        this.currentLocation = null;
        this._startPromise = null;
    }
}
