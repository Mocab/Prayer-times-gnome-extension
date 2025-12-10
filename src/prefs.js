import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import GLib from "gi://GLib";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class PrayerTimePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const gSettings = this.getSettings();
        window.add(page);

        this.#locationGroup(page, gSettings);
        this.#calcGroup(page, gSettings);
        this.#notificationGroup(page, gSettings);
    }

    #locationGroup(page, gSettings) {
        const locationGroup = new Adw.PreferencesGroup({
            title: _("Location"),
        });
        page.add(locationGroup);

        const autoLocation = new Adw.SwitchRow({
            title: _("Automatic"),
        });
        const customLocation = new Adw.ExpanderRow({
            title: _("Custom"),
        });
        const latitude = new Adw.SpinRow({
            title: _("Latitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -90.0,
                upper: 90.0,
                step_increment: 0.0001,
            }),
        });
        const longitude = new Adw.SpinRow({
            title: _("Longitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -180.0,
                upper: 180.0,
                step_increment: 0.0001,
            }),
        });

        locationGroup.add(autoLocation);
        locationGroup.add(customLocation);
        customLocation.add_row(latitude);
        customLocation.add_row(longitude);
        gSettings.bind("auto-location", autoLocation, "active", 0);
        gSettings.bind("latitude", latitude, "value", 0);
        gSettings.bind("longitude", longitude, "value", 0);
        function updateLocationSensitivity() {
            customLocation.sensitive = !autoLocation.active;
        }
        updateLocationSensitivity();
        autoLocation.connect("notify::active", updateLocationSensitivity);
    }

    #calcGroup(page, gSettings) {
        const calcGroup = new Adw.PreferencesGroup({
            title: _("Calculations"),
        });
        page.add(calcGroup);

        const presetMethods = [
            { id: "mwl", name: _("Muslim World League (London)") },
            { id: "egypt", name: _("Egyptian General Authority of Survey") },
            { id: "france", name: _("Musulmans de France") },
            { id: "isna", name: _("Islamic Society of North America") },
            { id: "karachi", name: _("Uni of Islamic Sciences (Karachi)") },
            { id: "turkey", name: _("Diyanet İşleri Başkanlığı (Turkey)") },
            { id: "makkah", name: _("Umm al-Qura Uni (Makkah)") },
            { id: "malaysia", name: _("Jabatan Kemajuan Islam Malaysia") },
            { id: "russia", name: _("Spiritual Administration of Muslims of Russia") },
            { id: "custom", name: _("Custom") },
        ];
        const presetMethod = new Adw.ComboRow({
            title: _("Preset methods"),
            model: new Gtk.StringList({ strings: presetMethods.map((a) => a.name) }),
        });
        const customMethod = new Adw.ExpanderRow({
            title: _("Custom methods"),
        });
        const fajrAngle = new Adw.SpinRow({
            title: _("Fajr method"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const ishaAngle = new Adw.SpinRow({
            title: _("Isha method"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        const asrMethods = [
            { id: "standard", name: _("Hanbali, Maliki, Shafi") },
            { id: "hanafi", name: _("Hanafi") },
        ];
        const asrMethod = new Adw.ComboRow({
            title: _("Asr shadow method"),
            model: new Gtk.StringList({ strings: asrMethods.map((a) => a.name) }),
        });
        const highLatAdjustments = [
            { id: "night-middle", name: _("Middle of night") },
            { id: "night-seventh", name: _("One seventh of night") },
            { id: "angle", name: _("Angle based") },
        ];
        const highLatAdjustment = new Adw.ComboRow({
            title: _("High latitude adjustment"),
            model: new Gtk.StringList({ strings: highLatAdjustments.map((h) => h.name) }),
        });
        const includeSunnah = new Adw.SwitchRow({
            title: _("Include sunnah prayers"),
        });

        calcGroup.add(presetMethod);
        calcGroup.add(customMethod);
        customMethod.add_row(fajrAngle);
        customMethod.add_row(ishaAngle);
        calcGroup.add(asrMethod);
        calcGroup.add(highLatAdjustment);
        calcGroup.add(includeSunnah);
        // Use .connect for all combo rows instead of bind_with_mapping, see: https://gitlab.gnome.org/GNOME/gjs/-/issues/397
        function presetMethodGSettingToUi() {
            presetMethod.selected = presetMethods.findIndex((object) => object.id === gSettings.get_string("preset-methods"));
        }
        presetMethodGSettingToUi();
        gSettings.connect("changed::preset-methods", presetMethodGSettingToUi);
        presetMethod.connect("notify::selected", () => gSettings.set_string("preset-methods", presetMethods[presetMethod.selected].id));
        /* gSettings.bind_with_mapping(
            "preset-methods",
            presetMethod,
            "selected",
            0,
            (gObject, gSetting) => {
                const foundI = presetMethods.findIndex((object) => object.id === gSetting.unpack());
                if (foundI !== -1) {
                    gObject = foundI;
                    return true;
                }
                return false;
            },
            (gObject) => {
                return GLib.Variant.new_string(presetMethods[gObject].id);
            }
        ); */
        gSettings.bind("fajr-method", fajrAngle, "value", 0);
        gSettings.bind("isha-method", ishaAngle, "value", 0);
        function asrMethodGSettingToUi() {
            asrMethod.selected = asrMethods.findIndex((object) => object.id === gSettings.get_string("asr-method"));
        }
        asrMethodGSettingToUi();
        gSettings.connect("changed::asr-method", asrMethodGSettingToUi);
        asrMethod.connect("notify::selected", () => gSettings.set_string("asr-method", asrMethods[asrMethod.selected].id));
        function highLatAdjustmentGSettingToUi() {
            highLatAdjustment.selected = highLatAdjustments.findIndex((object) => object.id === gSettings.get_string("high-latitude-adjustment"));
        }
        highLatAdjustmentGSettingToUi();
        gSettings.connect("changed::high-latitude-adjustment", highLatAdjustmentGSettingToUi);
        highLatAdjustment.connect("notify::selected", () => gSettings.set_string("high-latitude-adjustment", highLatAdjustments[highLatAdjustment.selected].id));
        function updateAngleSensitivity() {
            customMethod.sensitive = presetMethods[presetMethod.selected].id === "custom";
        }
        updateAngleSensitivity();
        presetMethod.connect("notify::selected", updateAngleSensitivity);
        gSettings.bind("include-sunnah", includeSunnah, "active", 0);
    }

    #notificationGroup(page, gSettings) {
        const notificationGroup = new Adw.PreferencesGroup({
            title: _("Notifications"),
        });
        page.add(notificationGroup);

        const notifyPrayer = new Adw.SwitchRow({
            title: _("Send notifications"),
        });
        const soundPlayer = new Adw.SwitchRow({
            title: _("Play a sound for prayers"),
        });
        const reminderTimes = [
            { value: 0, name: _("Off") },
            { value: 5, name: _("5 minutes") },
            { value: 10, name: _("10 minutes") },
            { value: 15, name: _("15 minutes") },
        ];
        const reminderTime = new Adw.ComboRow({
            title: _("Notify before prayer"),
            model: new Gtk.StringList({ strings: reminderTimes.map((r) => r.name) }),
        });

        notificationGroup.add(notifyPrayer);
        notificationGroup.add(soundPlayer);
        notificationGroup.add(reminderTime);
        gSettings.bind("notify-prayer", notifyPrayer, "active", 0);
        gSettings.bind("sound-player", soundPlayer, "active", 0);
        function reminderGSettingToUi() {
            reminderTime.selected = reminderTimes.findIndex((object) => object.value === gSettings.get_int("reminder"));
        }
        reminderGSettingToUi();
        gSettings.connect("changed::reminder", reminderGSettingToUi);
        reminderTime.connect("notify::selected", () => gSettings.set_int("reminder", reminderTimes[reminderTime.selected].value));
    }
}
