# Solopilot brand sources — identity "Trajectoire"

Decision: [ADR 0028](../adr/0028-identite-visuelle-trajectoire.md). Usage rules: [DESIGN.md](../../DESIGN.md#identity).

| File | Use |
| --- | --- |
| `mark-light.svg` / `mark-dark.svg` | Colour symbol for a light / dark background |
| `mark-mono.svg` | One-colour symbol (black, recolour with `fill`/`stroke`) |
| `mark-small-mono.svg` | Optical symbol for 32 px and below (thicker stroke, larger dot) |
| `lockup-light.svg` / `lockup-dark.svg` | Horizontal logo, wordmark converted to outlines |
| `lockup-mono.svg`, `lockup-mono-light.svg`, `lockup-mono-dark.svg` | One-colour logo (black, muted light, muted dark) |
| `favicon.svg` | Favicon source (optical symbol on an indigo tile) |
| `app-icon.svg` | App icon source (PWA "any", apple-touch-icon) |
| `app-icon-maskable.svg` | PWA maskable icon source (symbol in the 80 % safe zone) |

The app does not load these files. `frontend/src/components/brand/logo.tsx`
inlines the same paths, and `npm run generate:pwa-icons` renders
`frontend/public/` from `favicon.svg`, `app-icon.svg` and
`app-icon-maskable.svg`. Change a source here, then rerun the script.

## Fonts and licences

- **Wordmark**: Space Grotesk 600, converted to outlines in the SVGs. No font
  is needed to display the logo.
- **UI**: Inter (`@fontsource-variable/inter`). **Titles and figures**: Space
  Grotesk (`@fontsource-variable/space-grotesk`). Both are self-hosted from
  npm packages, with no Google Fonts CDN.
- Both families are under the [SIL Open Font License 1.1](https://openfontlicense.org).
  Copyright: "Copyright 2020 The Space Grotesk Project Authors
  (https://github.com/floriankarsten/space-grotesk)" and "Copyright 2016 The
  Inter Project Authors (https://github.com/rsms/inter)". The full licence
  text ships in each package's `LICENSE` file. The OFL allows the outlined
  wordmark in a logo.
