# Brand assets

**Build-time source only — this directory is excluded from the published zip.**
Nothing in the extension loads these at runtime: the wordmark is inlined into
both `panel.js` and `options.html`, and `icon-symbol.svg` exists purely to
regenerate `icons/*.png`. That's also why the manifest declares no
`web_accessible_resources`.

Both files come from the PriceBuddy app repo — keep them in sync with it rather
than editing here.

| File | Source | Used by |
| ---- | ------ | ------- |
| `logo-full.svg` | `../price-buddy/public/images/logo-full.svg` | The options page (inlined into `options.html`) and the panel header (inlined into `panel.js` as `LOGO_SVG`) |
| `icon-symbol.svg` | the symbol group of the same file | Source for `chrome/icons/*.png` |

Editor cruft (Inkscape/sodipodi namespaces, `id` attributes) is stripped, and the
fills are driven by `--logo-symbol` / `--logo-text`, matching the app's
`_logo.scss`, so the wordmark themes with the panel.

**`logo-full.svg` is inlined in two places** — `options.html` and `panel.js`. It
has to be: CSS custom properties don't cascade into an SVG loaded via `<img src>`
(it's a separate document), so the wordmark would stay black in dark mode. Inlining
also means the extension needs no `web_accessible_resources`. If you update the
logo, update all three copies.

## Regenerating the toolbar icons

`icon-symbol.svg` is the symbol only, with the `var()` fill resolved to a literal
so ImageMagick can render it. The icons are transparent-background and sized so
the symbol fills the canvas edge to edge on its long axis — there is no plate and
no padding beyond what squaring the non-square symbol requires.

```bash
cd chrome
convert -background none -density 400 images/icon-symbol.svg /tmp/raw.png
convert /tmp/raw.png -trim +repage /tmp/trim.png
convert /tmp/trim.png -background none -gravity center \
  -extent "$(identify -format '%[fx:max(w,h)]x%[fx:max(w,h)]' /tmp/trim.png)" /tmp/sq.png
for S in 16 48 128; do
  convert /tmp/sq.png -filter Lanczos -resize ${S}x${S} \
    -background none -gravity center -extent ${S}x${S} PNG32:icons/icon${S}.png
done
```

The `-trim` is what makes this reproducible without hand-computing the symbol's
bounding box out of the path data — it crops to the non-transparent pixels.

Note the `$` and the hook gap are genuine cutouts, not white fill, so the icon
sits correctly on both light and dark browser chrome. Check any change against
both before committing:

```bash
convert icons/icon16.png -filter Point -resize 800% -background '#3b3b3b' \
  -alpha remove -alpha off /tmp/dark.png
convert icons/icon16.png -filter Point -resize 800% -background white \
  -alpha remove -alpha off /tmp/light.png
```
