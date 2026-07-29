EXT_NAME     := prayertimes@mocab
PACK_NAME    := $(EXT_NAME).shell-extension.zip
EXT_DIR      := $(HOME)/.local/share/gnome-shell/extensions/$(EXT_NAME)
SRC          := src

.PHONY: all pack install clean dev

all: pack

$(PACK_NAME):
	@echo "Creating & packing $(PACK_NAME)..."
	@gnome-extensions pack $(SRC) \
		--force \
		--podir="../po" \
		$(foreach item,$(shell ls $(SRC)),--extra-source="$(item)")

pack: $(PACK_NAME)

install: $(PACK_NAME)
	@echo "Installing $(PACK_NAME)..."
	@gnome-extensions install --force $(PACK_NAME)
	@echo "Done. Restart GNOME Shell (log out and back in) to apply."

clean:
	@echo "Deleting $(PACK_NAME)..."
	@rm -f $(PACK_NAME)

dev: install
	dbus-run-session gnome-shell --devkit --wayland --wayland-display=wayland-nested-0