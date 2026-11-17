# Bundled fonts

These files are committed so every render, and the golden frame in `test/golden/`, uses the
same glyphs. Setup never fetches fonts. Both are licensed under the SIL Open Font License 1.1;
see `OFL.txt`.

| File | Family | Upstream | sha256 |
|---|---|---|---|
| `Excalifont-Regular.woff2` | Excalifont 1.000 | the official download on <https://plus.excalidraw.com/excalifont> (`https://excalidraw.nyc3.cdn.digitaloceanspaces.com/fonts/Excalifont-Regular.woff2`); the OFL text is in the font's `name` table | `ee41ec4c06bfa0728665499de6f4b4019e7953119ab20b5aeb5917f1609c3b2a` |
| `Inter-Regular.ttf` | Inter 4.1 | `extras/ttf/Inter-Regular.ttf` from `Inter-4.1.zip`, <https://github.com/rsms/inter/releases/tag/v4.1> | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |

Both files are byte-for-byte the upstream release files. Replacing either one moves pixels, so
regenerate the golden frame (`UPDATE_GOLDEN=1 npm test`) in the same change and look at it.
