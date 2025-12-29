PACK_NAME=prayertimes@mocab.shell-extension

.PHONY: all pack install run clean dev

all: pack

$(PACK_NAME).zip:
	@echo "Creating & packing $(PACK_NAME).zip"
	@gnome-extensions pack src \
	    --force \
	    --podir="../po" \
		--extra-source="setting-manager.js" \
		--extra-source="calc-prayer-times.js" \
		--extra-source="../assets" \
	    --extra-source="../CHANGELOG.md"

pack: clean $(PACK_NAME).zip

install: clean $(PACK_NAME).zip
	@echo "Installing $(PACK_NAME)"
	@gnome-extensions install --force $(PACK_NAME).zip

clean:
	@echo "Deleting $(PACK_NAME).zip"
	@rm -rf $(PACK_NAME).zip

dev: clean install
	dbus-run-session -- gnome-shell --nested --wayland