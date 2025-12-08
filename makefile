UUID=prayertimes@mocab

.PHONY: all pack install clean

all: pack

$(UUID).zip:
	@gnome-extensions pack src \
	    --force \
	    --podir="../po" \
		--extra-source="setting-manager.js" \
		--extra-source="calc-prayer-times.js" \
		--extra-source="../assets" \
	    --extra-source="../CHANGELOG.md"

pack: $(UUID).zip

install: $(UUID).zip
	gnome-extensions install --force $(UUID).shell-extension.zip

clean:
	@rm -rf $(UUID).zip