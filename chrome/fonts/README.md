# Bundled fonts

Self-hosted so the panel never makes a network request to a third party from the
pages it is injected into. See `LICENSE-OFL.txt`.

| File | Family | Source |
| ---- | ------ | ------ |
| `manrope-variable.woff2` | Manrope (variable, 200–800) | [google/fonts/ofl/manrope](https://github.com/google/fonts/tree/main/ofl/manrope) |
| `dm-mono-400.woff2` | DM Mono Regular | [google/fonts/ofl/dmmono](https://github.com/google/fonts/tree/main/ofl/dmmono) |
| `dm-mono-500.woff2` | DM Mono Medium | [google/fonts/ofl/dmmono](https://github.com/google/fonts/tree/main/ofl/dmmono) |

All three are the **latin subset only** (`U+0000-00FF` plus common punctuation),
which is what the Google Fonts CSS API serves to modern Chrome. Total ~55 KB.

Both families are licensed under the SIL Open Font License 1.1. `LICENSE-OFL.txt`
is the Manrope copy; DM Mono carries the same licence with
`Copyright 2014 The DM Mono Project Authors`.

## Why they are loaded via the `FontFace` API

`@font-face` declared inside a shadow root is not reliably honoured across Chrome
versions, so `src/content/panel.js` registers the faces against the *document's*
font set with `document.fonts.add(new FontFace(...))` instead. That requires the
files to be listed in `web_accessible_resources`; they use `use_dynamic_url` so
the URLs rotate per session and cannot be used to fingerprint the extension.

## Updating

```bash
curl -H 'User-Agent: Mozilla/5.0 ... Chrome/120.0.0.0 ...' \
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=DM+Mono:wght@400;500&display=swap'
```

Pull the `unicode-range: U+0000-00FF` (latin) blocks and download those `.woff2`
URLs. If the file names change, update `FONT_FACES` in `src/content/panel.js`.
