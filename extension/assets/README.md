# Suno logo

`suno-logo.svg` was extracted from the inline SVG labelled «Логотип Suno» on https://suno.com on 2026-10-18, at the user's request. The website's animated logo was captured as a static vector. The site CSS classes were removed and `currentColor` was fixed to a light fill for use as a local image.

The Suno name and logo belong to their respective owner. The extension retains its separate Beast label. No font files or remote scripts were copied.

## Suno Beast icon

`suno-beast-icon.svg` is the editable vector source for the extension badge. Since 2.7.1 the panel header uses only the original Suno wordmark and Beast tag. It uses the first S path from `suno-logo.svg`, a dark rounded tile and a static warm orange accent for recording. The accent is part of the brand mark, not a live recording indicator; REC/AUTO action badges and panel status still show actual state. No shadows, filters, gradients, remote assets or fonts.

`icon-16.png`, `icon-24.png`, `icon-32.png`, `icon-48.png`, `icon-64.png` and `icon-128.png` are generated from that SVG for browser toolbar and extension management. Chrome does not accept SVG in manifest icons: https://developer.chrome.com/docs/extensions/reference/manifest/icons . The SVG is retained as the editable source; the panel header uses `suno-logo.svg`. Run `node tools/render-icons.js` with `sharp` available (or set `SUNO_BEAST_SHARP` to its module path) to regenerate the checked-in PNGs. No image library is shipped in the extension.
