import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Soup from "gi://Soup";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class PrayerTimePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const gSettings = this.getSettings();

        // tab 1: calculations
        const calcTab = new Adw.PreferencesPage({
            title: _("Calculations"),
            icon_name: "preferences-system-symbolic",
        });
        calcTab.add(this.#sourceGroup(gSettings));
        calcTab.add(this.#locationGroup(gSettings));
        const mawaqitGroup = this.#mawaqitGroup(gSettings);
        calcTab.add(mawaqitGroup);
        const syncMawaqitVisibility = () => {
            mawaqitGroup.set_visible(gSettings.get_string("source") === "mawaqit");
        };
        syncMawaqitVisibility();
        gSettings.connect("changed::source", () => syncMawaqitVisibility());
        window.add(calcTab);

        // tab 2: display & notifications
        const displayNotificationTab = new Adw.PreferencesPage({
            title: _("Display & Notifications"),
            icon_name: "system-run-symbolic", // TODO: update icon
        });
        displayNotificationTab.add(this.#displayGroup(gSettings));
        displayNotificationTab.add(this.#notificationGroup(gSettings));
        window.add(displayNotificationTab);
    }

    #bindMapping(gSettings, key, comboRow, mapArray) {
        const uiSignalId = comboRow.connect("notify::selected", () => gSettings.set_string(key, mapArray[comboRow.get_selected()].id));

        function updateUi() {
            comboRow.block_signal_handler(uiSignalId);
            const index = mapArray.findIndex((object) => object.id === gSettings.get_string(key));
            comboRow.set_selected(index !== -1 ? index : 0);
            comboRow.unblock_signal_handler(uiSignalId);
        }
        updateUi();

        gSettings.connect(`changed::${key}`, updateUi);
    }

    // calculation tab

    #sourceGroup(gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Sources"),
        });

        const sources = [
            { id: "mawaqit", name: _("Mawaqit") },
            { id: "auto", name: _("Automatic Location") },
            { id: "manual", name: _("Manual Location") },
        ];
        const sourcesRow = new Adw.ComboRow({
            title: _("Source"),
            model: new Gtk.StringList({ strings: sources.map((a) => a.name) }),
        });
        group.add(sourcesRow);
        this.#bindMapping(gSettings, "source", sourcesRow, sources);

        return group;
    }
    #locationGroup(gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Location Calculations"),
        });

        const customLocationRow = new Adw.ExpanderRow({
            title: _("Custom location"),
            subtitle: _('Used when "manual location" is selected or if Mawaqit and/or auto location fails.'),
        });

        const latitude = new Adw.SpinRow({
            title: _("Latitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -90.0,
                upper: 90.0,
                step_increment: 0.001,
                page_increment: 1,
            }),
        });
        customLocationRow.add_row(latitude);
        gSettings.bind("latitude", latitude, "value", Gio.SettingsBindFlags.DEFAULT);

        const longitude = new Adw.SpinRow({
            title: _("Longitude"),
            digits: 4,
            adjustment: new Gtk.Adjustment({
                lower: -180.0,
                upper: 180.0,
                step_increment: 0.001,
                page_increment: 1,
            }),
        });
        customLocationRow.add_row(longitude);
        gSettings.bind("longitude", longitude, "value", Gio.SettingsBindFlags.DEFAULT);

        group.add(customLocationRow);

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
        const presetMethodRow = new Adw.ComboRow({
            title: _("Preset methods"),
            model: new Gtk.StringList({ strings: presetMethods.map((a) => a.name) }),
        });
        group.add(presetMethodRow);
        this.#bindMapping(gSettings, "preset-methods", presetMethodRow, presetMethods);
        const customMethodExpander = new Adw.ExpanderRow({
            title: _("Custom methods"),
        });
        const fajrAngle = new Adw.SpinRow({
            title: _("Fajr angle"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        customMethodExpander.add_row(fajrAngle);
        gSettings.bind("fajr-angle", fajrAngle, "value", Gio.SettingsBindFlags.DEFAULT);
        const ishaAngle = new Adw.SpinRow({
            title: _("Isha angle"),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 0.5,
            }),
        });
        customMethodExpander.add_row(ishaAngle);
        gSettings.bind("isha-angle", ishaAngle, "value", Gio.SettingsBindFlags.DEFAULT);
        function updateExpanderVisibility() {
            customMethodExpander.set_visible(presetMethods[presetMethodRow.selected]?.id === "custom");
        }
        updateExpanderVisibility();
        presetMethodRow.connect("notify::selected", () => updateExpanderVisibility());

        const asrMethods = [
            { id: "standard", name: _("Hanbali, Maliki, Shafi") },
            { id: "hanafi", name: _("Hanafi") },
        ];
        const asrMethodRow = new Adw.ComboRow({
            title: _("Asr shadow method"),
            model: new Gtk.StringList({ strings: asrMethods.map((a) => a.name) }),
        });
        group.add(asrMethodRow);
        this.#bindMapping(gSettings, "asr-method", asrMethodRow, asrMethods);

        const highLatAdjustments = [
            { id: "night-middle", name: _("Middle of night") },
            { id: "night-seventh", name: _("One seventh of night") },
            { id: "angle", name: _("Angle based") },
        ];
        const highLatAdjustmentRow = new Adw.ComboRow({
            title: _("High latitude adjustment"),
            model: new Gtk.StringList({ strings: highLatAdjustments.map((h) => h.name) }),
        });
        group.add(highLatAdjustmentRow);
        this.#bindMapping(gSettings, "high-latitude-adjustment", highLatAdjustmentRow, highLatAdjustments);

        const includeSunnahRow = new Adw.SwitchRow({
            title: _("Include sunnah prayers"),
        });
        group.add(includeSunnahRow);
        gSettings.bind("include-sunnah", includeSunnahRow, "active", Gio.SettingsBindFlags.DEFAULT);

        return group;
    }
    #mawaqitGroup(gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Mawaqit"),
            description: _('Prayer data from <a href="https://mawaqit.net/">Mawaqit</a>.'),
        });

        const chosenMosqueRow = new Adw.ActionRow({
            title: _("No mosque selected"),
        });
        const mosqueIcon = new Gtk.Image({
            icon_name: "mark-location-symbolic", // TODO: use mosque icon
            pixel_size: 26,
        });
        chosenMosqueRow.add_prefix(mosqueIcon);
        group.add(chosenMosqueRow);
        gSettings.bind("mawaqit-label", chosenMosqueRow, "title", Gio.SettingsBindFlags.GET);
        gSettings.bind("mawaqit-slug", chosenMosqueRow, "subtitle", Gio.SettingsBindFlags.GET);

        function closeSearch() {
            searchMosquesInput.text = "";
            clearSearchButton.visible = false;
            searchMosquesInput.get_root().set_focus(null);
        }

        const searchMosquesInput = new Adw.EntryRow({
            title: _("Search for a mosque"),
        });
        const clearSearchButton = new Gtk.Button({
            icon_name: "edit-clear-all-symbolic",
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: _("Clear search"),
            focus_on_click: false,
        });
        clearSearchButton.visible = false;
        clearSearchButton.connect("clicked", closeSearch);
        searchMosquesInput.add_suffix(clearSearchButton);
        group.add(searchMosquesInput);

        const resultsPopover = new Gtk.Popover({
            position: Gtk.PositionType.BOTTOM,
            has_arrow: false,
            autohide: false, // prevents searchMosquesInput from losing focus
        });
        resultsPopover.set_parent(searchMosquesInput);
        resultsPopover.connect("map", (popover) => popover.set_size_request(popover.get_parent().get_width(), -1));
        const resultsList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            hexpand: true,
            css_classes: ["menu"],
        });
        resultsList.set_can_focus(false);
        resultsPopover.set_child(resultsList);

        function clearResults() {
            let child;
            while ((child = resultsList.get_first_child())) {
                resultsList.remove(child);
            }
        }

        let searchTimeoutId = null;
        let currentCancellable = null;
        const soupSession = new Soup.Session();
        const decoder = new TextDecoder("utf-8");
        searchMosquesInput.connect("notify::text", () => {
            clearSearchButton.visible = true;

            if (searchTimeoutId) {
                GLib.Source.remove(searchTimeoutId);
                searchTimeoutId = null;
            }

            if (currentCancellable) {
                currentCancellable.cancel();
            }
            currentCancellable = new Gio.Cancellable();

            const query = searchMosquesInput.text.trim();

            if (query.length <= 5) {
                resultsPopover.popdown();
                clearResults();
                return;
            }

            searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                const message = Soup.Message.new("GET", `https://mawaqit.net/api/2.0/mosque/search?word=${encodeURIComponent(query)}&fields=slug,label,localisation,name,times`);

                soupSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, currentCancellable, (session, result) => {
                    clearResults();
                    try {
                        const bytes = session.send_and_read_finish(result);

                        if (message.status_code !== Soup.Status.OK) {
                            throw new Error(_("Network transport error: %s.").replace("%s", message.status_code));
                        }
                        if (!bytes) {
                            throw new Error(_("No data received from server."));
                        }

                        const data = JSON.parse(decoder.decode(bytes.toArray()));

                        if (!Array.isArray(data)) {
                            throw new Error(_("Invalid data format received: expected an array."));
                        }

                        if (data.length === 0) {
                            const row = new Adw.ActionRow({
                                title: _("No results found."),
                                activatable: false,
                            });
                            resultsList.append(row);
                        } else {
                            const limit = Math.min(data.length, 9);
                            for (let i = 0; i < limit; i++) {
                                const mosqueTitle = data[i].label || data[i].name;
                                const mosqueLocale = data[i].localisation || data[i].slug;
                                const row = new Adw.ActionRow({
                                    title: mosqueTitle,
                                    subtitle: mosqueLocale,
                                    activatable: true,
                                });
                                row.connect("activated", () => {
                                    gSettings.set_string("mawaqit-slug", data[i].slug);
                                    gSettings.set_string("mawaqit-label", mosqueTitle);
                                    closeSearch();
                                });
                                resultsList.append(row);
                            }
                        }
                    } catch (e) {
                        const row = new Adw.ActionRow({
                            title: `${_("Error:")} ${e.message || e}`,
                            activatable: false,
                        });
                        resultsList.append(row);
                    }
                    resultsPopover.popup();
                });
                searchTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        });

        const fallbackAutoLocationRow = new Adw.SwitchRow({
            title: _("Fallback to automatic location"),
            subtitle: _("If Mawaqit fails, fall back to automatic location."),
        });
        group.add(fallbackAutoLocationRow);
        gSettings.bind("fallback-auto-location", fallbackAutoLocationRow, "active", Gio.SettingsBindFlags.DEFAULT);

        group.add(
            new Gtk.Label({
                label: _("Will always fall back to manual location if mawaqit fails and automatic location is disabled or unavailable."),
                css_classes: ["dim-label"],
                margin_top: 10,
                margin_start: 12,
                xalign: 0,
                wrap: true,
            }),
        );

        return group;
    }

    // display & notifications tab

    #displayGroup(gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Display"),
        });

        const displayModes = [
            { id: "countdown", name: _("Countdown") },
            { id: "time", name: _("Time") },
        ];
        const displayModeRow = new Adw.ComboRow({
            title: _("Display mode"),
            subtitle: _("Show next prayer countdown or time in the status area."),
            model: new Gtk.StringList({ strings: displayModes.map((m) => m.name) }),
        });
        group.add(displayModeRow);
        this.#bindMapping(gSettings, "display-mode", displayModeRow, displayModes);

        return group;
    }
    #notificationGroup(gSettings) {
        const group = new Adw.PreferencesGroup({
            title: _("Notifications"),
        });

        const notifyPrayerRow = new Adw.SwitchRow({
            title: _("Send notifications"),
        });
        group.add(notifyPrayerRow);
        gSettings.bind("notify-prayer", notifyPrayerRow, "active", Gio.SettingsBindFlags.DEFAULT);

        const soundPlayerRow = new Adw.SwitchRow({
            title: _("Play takbir for prayers"),
        });
        group.add(soundPlayerRow);
        gSettings.bind("sound-player", soundPlayerRow, "active", Gio.SettingsBindFlags.DEFAULT);

        const reminderRow = new Adw.SpinRow({
            title: _("Number of minutes to notify before prayer"),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        group.add(reminderRow);
        gSettings.bind("reminder", reminderRow, "value", Gio.SettingsBindFlags.DEFAULT);

        return group;
    }
}
