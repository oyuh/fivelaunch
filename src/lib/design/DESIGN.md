# FiveLaunch Design System

The living version renders in the browser: `bun run ui` → open `?screen=styleguide`
(source: [`StyleGuide.svelte`](./StyleGuide.svelte)). This file is the written reference.

## Fonts (roles)

| Role | Family | Token / class |
| --- | --- | --- |
| Body & UI | **Raleway** (400–700) | `--font-sans` / `font-sans` (default) |
| Super headers, dialog titles | **Archivo** (600–800) | `--font-display` / `font-display` |
| Technical: IDs, paths, logs, stat numbers | **Geist Pixel** (Square) | `--font-mono` / `font-mono` |

Geist Pixel is a decorative pixel face; `--font-mono` falls back to `Geist Mono` → `ui-monospace`
so any glyph it lacks still renders. Five pixel grid variants are vendored
(`src/assets/fonts/geist-pixel/`) and exposed as families `Geist Pixel {Square|Grid|Circle|Triangle|Line}`;
change the default by re-aliasing `Geist Pixel` in `src/assets/fonts/geist-pixel.css`.

## Color tokens (`src/app.css`)

All colors are HSL CSS variables so the runtime theme picker can rewrite `--primary` / `--ring` live.

- **Surfaces (elevation):** `background` → `surface-1` → `surface-2` → `surface-3`. Lean on these steps
  and `border-divider` hairlines instead of bordered cards ("decardify"). Utilities: `bg-surface-2`, etc.
- **Accent:** `--primary` (amber `#f59e0b` default), `--primary-foreground`, `--ring`.
- **Danger:** `--destructive` (bright red) + `--destructive-foreground`.
- **Text:** `foreground`, `muted-foreground`. **Lines:** `border`, `divider`, `input`.
- **Effects:** `shadow-btn` / `shadow-btn-hover` (flat buttons with a shadow that reads like a
  border, plus a small hover lift; no glow), `bg-accent-wash` (faint accent fill for selected/active
  surfaces). `bg-gradient-accent` still exists as a token, but buttons are flat.

Radius: `--radius` = 0.375rem (`rounded-md` = radius-md). Kept tight per prior preference.

## Components (`src/lib/components/ui/`)

| Component | Use |
| --- | --- |
| `Button` | Flat fills + `shadow-btn` + subtle hover lift (no glow). `variant`: `hero` (big launch/CTA), `primary`, `destructive`, `outline`, `subtle`, `ghost`. `size`: `sm\|md\|lg`. Props: `icon`/`iconSvg`, `loading`, `disabled`, `full`, `title` (custom tooltip). |
| `IconButton` | Square icon-only button; `label` (required, a11y), `active`, `size`. |
| `Icon` | Renders `name` (from `UI_ICONS`) or raw `svg` (from `clientIconSvg()`), Lucide stroke style. |
| `Input` | Themed text input; `mono` for pixel font, `size`. `bind:value`. |
| `Modal` | Canonical dialog: `title`, `description`, `icon`, `size` (`sm\|md\|lg\|xl`), optional `footer` snippet, `bind:open`. Backdrop blur + scale/fade motion. |
| `ConfirmDialog` | Destructive/confirm prompt on `Modal`; `title`, `message`, `confirmLabel`, `danger`, `onConfirm`. |
| `Menu` + `MenuItem` | Anchored dropdown. `Menu` provides `{ toggle, open }` to the `trigger` snippet and `{ close }` to `children`. `MenuItem` has `icon`, `label`, `description`, `active`, `trailing`. |
| `SegmentedControl` | Pill toggle group; `options`, `bind:value`. |
| `StatItem` | Decardified stat: uppercase label + prominent (pixel) value. |

## Icons (`src/lib/components/ui/icons.ts`)

- `CLIENT_ICONS` — 20 pickable client glyphs (`key` is persisted on the client). `DEFAULT_CLIENT_ICON`,
  `clientIconSvg(key)` for lookup with fallback.
- `UI_ICONS` — app chrome glyphs by name (search, plus, chevronDown, folder, trash, …).
- Inline Lucide (ISC) path data — no runtime icon dependency ships.

## Tooltips

Use the `use:tooltip={text}` action (`src/lib/actions/tooltip.ts`) for hover hints — never the
native `title` attribute (it's removed everywhere). It renders a themed `.app-tooltip` bubble. `Button`
and `IconButton` accept a `title` prop that drives it (IconButton falls back to its `label`).

## Conventions

- Prefer surface steps + dividers over `border … bg-card` cards.
- Every dialog uses `Modal`; every destructive confirm uses `ConfirmDialog`.
- Icon-only buttons always pass a `label`; hover hints use `use:tooltip`, not native `title`.
- Technical/monospace text uses `font-mono` (Geist Pixel); big titles use `font-display` (Archivo).
- Buttons are flat with `shadow-btn`; no glow. Separators in copy use `·`, not em-dashes.
