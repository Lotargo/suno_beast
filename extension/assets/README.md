# Suno logo

`suno-logo.svg` is a static vector extracted from the inline SVG labelled «Логотип Suno» at [suno.com](https://suno.com) on 2026-10-18. Site CSS classes were removed and the fill was fixed to a light color. The README banner uses the same wordmark.

The Suno name and logo belong to their respective owner. The extension retains its separate Beast label. No font files or remote scripts were copied.

## Suno Beast icon

`suno-beast-icon.svg` is the editable source for the toolbar icon: the first S path from the wordmark, a dark rounded tile and a static orange accent. The accent is part of the icon, not a live recording indicator. The panel header uses the original Suno wordmark and Beast tag.

`icon-16.png`, `icon-24.png`, `icon-32.png`, `icon-48.png`, `icon-64.png` and `icon-128.png` are generated from that SVG for browser toolbar and extension management. Chrome does not accept SVG in manifest icons: https://developer.chrome.com/docs/extensions/reference/manifest/icons . The SVG is retained as the editable source; the panel header uses `suno-logo.svg`. Run `node tools/render-icons.js` with `sharp` available (or set `SUNO_BEAST_SHARP` to its module path) to regenerate the checked-in PNGs. No image library is shipped in the extension.

## Documentation graphics

`docs/images/banner.svg` is the editable README banner. The screenshots use the extension's actual interface with demonstration data and an original vector cover from `tools/fixtures/cover.svg`.
