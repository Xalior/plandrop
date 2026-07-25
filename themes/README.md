# Onboard themes

Hand-authored plandrop themes live here — one folder per theme. This tree is
**source**; `templates/` is **output**. The generator (`scripts/gen-templates.mjs`)
turns each folder here into a full `templates/<name>/` template folder, exactly
like it does for each theme of the pinned Bootswatch package, and the ingress
image bundles the result.

Keeping the source out of `templates/` is what makes a hand-made theme safe:
`node scripts/gen-templates.mjs` rebuilds `templates/` from scratch on every
run and in every image build, so anything hand-edited *there* would be
overwritten. Author here, and regeneration reproduces your theme instead of
erasing it.

## What a theme folder contains

```
themes/<name>/
  theme.json   the manifest: label, appearances, credit
  theme.css    the theme itself — CSS layered on top of stock Bootstrap
```

That is all. The generator supplies everything else:

| Generated into `templates/<name>/` | From |
| --- | --- |
| `header.html`, `plan.html`, `footer.html` | the `bootstrap5` skeleton, retargeted at your theme |
| `css/bootstrap.min.css` | stock Bootstrap (the skeleton's copy) with your `theme.css` appended |
| `NOTICE` | the skeleton's Bootstrap attribution, since your theme vendors it |

Because the chrome comes from the skeleton, a change to the shared header or
footer reaches your theme automatically — a hand-made theme never drifts behind
the shipped ones.

The served stylesheet is one file (Bootstrap, then your layer) for the same
reason a Bootswatch `dist` file is: one request, and source order alone decides
the cascade. Your CSS always wins over the Bootstrap rule it overrides, with no
`!important` and no specificity games.

## theme.json

```json
{
  "label": "Fanny's First Terminal",
  "appearance": ["dark", "light"],
  "credit": {
    "name": "plandrop",
    "url": "https://plandrop.dev/",
    "license": "LGPL-3.0-only"
  }
}
```

- **`label`** — the human name, for catalogues and galleries.
- **`appearance`** — the Bootstrap schemes the theme supports, best first. The
  first entry is what `<html data-bs-theme>` is pinned to. List both to declare
  a dual-appearance theme: it keeps the navbar light/dark toggle and its script,
  and its navbar inherits `data-bs-theme` so the toggle flips the chrome too. A
  single-entry theme gets no toggle, and its navbar is pinned to that scheme.
- **`credit`** — who made the theme, under which license. It replaces the
  Bootswatch attribution in the document footer, so every published document
  credits the theme it actually uses.

## Writing theme.css

- **Drive it from Bootstrap's CSS custom properties.** Set the `--bs-*` variables
  and the components a plan document uses — navbar, cards, tables, badges,
  alerts, buttons, code — follow along without per-document tweaks. Reach for a
  component selector only where Bootstrap compiled a literal colour into it
  (`.btn-*` and `.text-bg-*` are the usual culprits; they do not read
  `--bs-primary`).
- **Declare both appearances in full, or neither.** `:root` matches whatever the
  scheme, so a variable set only in the light block leaks into dark. A
  dual-appearance theme therefore sets the *same* variable list in
  `:root, [data-bs-theme="light"]` and in `[data-bs-theme="dark"]`; only
  scheme-independent values (fonts, radii, spacing) belong in a bare `:root`.
  `test/gen-templates.test.ts` asserts that parity.
- **Leave `--bs-code-color` alone.** The shared override sheet
  (`templates/shared/css/plandrop.css`) loads after every theme and retunes
  inline code to a calm green — dark green on light, light green on dark. Check
  both of your backgrounds clear 4.5:1 against those two greens. If a palette
  genuinely collides, the sanctioned escape hatch is a
  `[data-plandrop-theme="<name>"]` rule in that shared sheet, the way `quartz`
  takes the dark-scheme green on its saturated light surface.
- **Meet WCAG AA** (4.5:1 for body text, 3:1 for large text and UI edges) in
  *both* appearances, and check the pairs rather than trusting your eye.
- **Respect `prefers-reduced-motion`.** Any animated flourish must have a still
  fallback that still looks deliberate.

## Adding a theme

1. Create `themes/<name>/` with the two files.
2. Run `node scripts/gen-templates.mjs` (or `pnpm run gen:templates`) and open
   `templates/<name>/template.html` in a browser.
3. Add its name to the `CUSTOM` list in `test/gen-templates.test.ts`. The
   stack test's built-in count derives itself from this directory.
4. The catalogue needs nothing: `/api/templates` enumerates the theme volume at
   request time, so a seeded folder is an offered theme.
5. To demo it on plandrop.dev, add a row to the site's `data/themes.json`
   datasheet (slug, label, modes, source) — the gallery and its example docs
   both read from there.
