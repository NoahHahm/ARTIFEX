# ARTIFEX app — DESIGN.md

<!-- design-system:web/src -->

Design system for the ARTIFEX application UI (`web/src`). Plain markdown tokens
so any AI assistant (Claude Code, Copilot, Cursor…) generates UI that matches
the existing app. Read this file **before** writing or modifying any component.

Stack facts that shape every decision: **Next.js 16 + React 19, Tailwind CSS v4
(CSS-first tokens), shadcn/ui components in `src/components/ui/`, lucide-react
icons, `next-themes` (light/dark via `.dark`), sonner toasts.** Never introduce
another UI kit, icon set, or CSS-in-JS.

## 1. Visual Theme & Atmosphere

"Operator console": calm, dense, data-first. Neutral surfaces carry the page;
colour is reserved for state and action. Hairline borders over shadows; every
panel is a flat bordered card, not floating paper. The UI reads as a security
tool: monochrome ink, one restrained accent per surface, charts and status
tones doing the talking. No gradients, no glassmorphism, no decorative noise.

User-selectable **theme presets** re-point the token values at runtime
(`data-theme-preset`): `default` (this document), `brutalist` (radius 0, hard
red/blue accents), `soft-pop` (radius 1rem, violet/amber), `tangerine`
(tinted warm grey, orange primary). **Never hard-code colours** — always the
semantic tokens below — or presets silently break.

## 2. Color palette

All values are oklch CSS variables defined in `src/app/globals.css`
(`:root` light, `.dark` dark). Use them **only** through Tailwind semantic
classes (`bg-background`, `text-muted-foreground`, `border-border`, …).

Light:

| Token | Value | Use |
|---|---|---|
| `--background` | `oklch(1 0 0)` | page ground |
| `--foreground` | `oklch(0.145 0 0)` | primary ink |
| `--card` / `--card-foreground` | `oklch(1 0 0)` / `oklch(0.145 0 0)` | panels |
| `--primary` / `--primary-foreground` | `oklch(0.205 0 0)` / `oklch(0.985 0 0)` | primary buttons, key ink |
| `--secondary` / `--accent` | `oklch(0.97 0 0)` | subtle fills, hover washes |
| `--muted` / `--muted-foreground` | `oklch(0.97 0 0)` / `oklch(0.556 0 0)` | secondary text |
| `--destructive` | `oklch(0.577 0.245 27.325)` | destructive actions/errors |
| `--border` / `--input` / `--ring` | `oklch(0.922 0 0)` / `oklch(0.922 0 0)` / `oklch(0.708 0 0)` | hairlines, fields, focus rings |
| `--chart-1…5` | `oklch(0.87 0 0)` → `oklch(0.269 0 0)` | monochrome chart ramp |

Dark (`.dark`): background `oklch(0.145 0 0)`, card `oklch(0.205 0 0)`,
primary `oklch(0.922 0 0)`, borders `oklch(1 0 0 / 10%)` — same tokens, no
component changes.

Status tones (badges, `src/lib/status.ts`): `slate` (neutral/created),
`blue` (running/in progress), `amber` (waiting/queued/pending/timeout),
`green` (done/pass), `red` (failed/fail), `rose` (critical severity).

## 3. Typography

- Default sans: **Geist** (`--font-geist`), mono: **Geist Mono**
  (`--font-geist-mono`). Users can switch sans at runtime (`data-font`):
  Inter, Noto Sans, Nunito Sans, Figtree, Roboto, Raleway, DM Sans — so never
  hard-code a font-family; sizes/weights must survive a swap.
- Scale: Tailwind defaults only — `text-xs` secondary/metadata,
  `text-sm` body & controls, `text-base` emphasis, `text-lg`–`text-2xl`
  page titles. Line-height: `leading-none` for display, default elsewhere.
- Weight: `font-medium` for labels/buttons, `font-semibold` for headings,
  never heavier than `font-bold`.
- Numeric data (counts, tokens, timestamps) uses `tabular-nums`.
- Copy is English source with i18n keys (`swt("interface.mXXXX")`); user-facing
  strings never hard-coded. Chinese (zh-Hant) must not clip in fixed widths.

## 4. Spacing and layout

- 4px base grid; Tailwind spacing steps only (`gap-2`, `gap-3`, `gap-4`,
  `p-3`, `p-4`). Page rhythm: `gap-4` between major sections, `gap-3` inside.
- Shell: `SidebarProvider` + `AppSidebar` + `SidebarInset` — collapsible
  sidebar (`variant`/`collapsible` user preferences), content inset fills.
- Panels: `grid gap-3 rounded-lg border p-3` (settings blocks) or
  `rounded-xl border bg-card` (larger surfaces). Section header pattern:
  left `Label` (`text-sm`) + `p` (`text-xs text-muted-foreground`)
  description, control right-aligned (`shrink-0`, fixed width `w-28`+).
- Forms: two-column `grid gap-3` rows, label+hint left, control right.
- Content width: fluid with sidebar; never fix page width.

## 5. Component styles

- **Radius** — one knob: `--radius: 0.625rem` (+`-4px/-2px/+4px…` scale via
  `radius-sm…4xl`). Cards/panels `rounded-lg`–`rounded-xl`; badges
  `rounded-md`; never mix arbitrary radii (`rounded-[7px]` forbidden).
- **Buttons** — shadcn `Button` only, variants: `default` (bg-primary),
  `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `sm/default/
  icon`. One `default` button per view region; everything else `ghost`/
  `outline`. Destructive actions also need an `AlertDialog` confirm.
- **Cards/panels** — `Card` or the `rounded-lg border p-3 grid gap-3` pattern;
  flat (no shadow) unless a popover/dropdown (`shadow-md`).
- **Form controls** — shadcn `Input`/`Select`/`Checkbox`/`Switch`/`Label`;
  hint text `text-xs text-muted-foreground` under the label; numeric inputs
  get `min` + `placeholder`.
- **Badges** — `StatusBadge` (`src/components/status-badge.tsx`) with tones
  from §2; never invent new tone colours.
- **Toasts** — `sonner` (`toast.success/error`); no alert()/confirm().
- **Icons** — lucide-react, 4 (`h-4 w-4`) or 3.5 (`size-3.5`) inside text;
  no emoji in chrome, no filled icons.
- **Dialogs** — `Dialog` for creation/editing, `AlertDialog` for confirms;
  sheet/side only for wide editors.
- Copy button on anything user-shared (see `copy-button.tsx`).

## 6. Interaction & Motion

- `tw-animate-css` utilities only (`animate-in fade-in slide-in-from-*`);
  durations 150–200ms; no spring/physics, no parallax.
- Hover: background wash (`hover:bg-accent`, `hover:bg-primary/80` for
  primary); never scale/translate whole panels.
- Focus: the global `outline-ring/50` ring — keep it, never `outline-none`
  without a replacement.
- Destructive/irreversible actions always confirm (AlertDialog), never undo.
- Long operations stream progress into the page; disabled buttons show why
  (title/adjacent text), not just greying.

## 7. Responsive Behavior

- Sidebar collapses (`collapsible` preference); content reflows to one column
  below `md` (`grid gap-3 md:grid-cols-2` pattern for settings rows).
- Tables → horizontal scroll containers, never squish columns below ~120px.
- Fixed-width controls (`w-28 shrink-0`) keep right-aligned on wrap.
- Touch targets ≥ 32px; `text-xs` is the minimum size anywhere.

## 8. Do's and Don'ts

Do:
- Use semantic tokens (`text-muted-foreground`) — they are what makes the
  theme presets, dark mode and font switcher work.
- Reuse `src/components/ui/*` and existing page patterns before writing new.
- Keep settings blocks in the Label+hint / control-right pattern.
- i18n every string (`swt`/`locale`), including toast copy.
- Prefer data density with hairline separation over whitespace-heavy layouts.

Don't:
- Don't hard-code hex/oklch values, `font-family`, or `shadow-*` classes that
  presets override.
- Don't add new dependencies for UI primitives (no MUI/AntD/radix-vanilla
  outside `components/ui`), no CSS-in-JS, no styled-components.
- Don't use pure black `#000` or pure white `#fff` — the token ramp handles
  ink/surface.
- Don't put colour on chrome (chrome is monochrome; colour = state only).
- Don't invent animation beyond the tw-animate-css vocabulary.
- Don't break the `text-xs` floor or the 4px grid.

## 9. Agent Prompt Guide

When asked for a new settings block:

> Add a `grid gap-3 rounded-lg border p-3` section; left side a `Label`
> (`text-sm`, i18n key) with a `text-xs text-muted-foreground` hint under it,
> right side the control in a fixed `w-28 shrink-0` `Input`/`Select`. Wire the
> value through the existing preferences/settings store; toast on save via
> sonner. Tokens: semantic only.

When asked for a status display:

> Use `StatusBadge` with the domain's status map in `src/lib/status.ts`;
> pick the tone from the §2 status-tone table (blue = active, amber =
> waiting, green = success, red = failure, slate = neutral).

When asked for a destructive action:

> `Button variant="destructive"` wrapped in an `AlertDialog` confirm whose
> action is also `destructive`; toast the outcome with sonner; never window
>.confirm.

---

Maintenance: this file tracks the real code — when tokens change in
`src/app/globals.css` or a preset is added, update the matching section here
in the same PR. The landing-page design schema lives in the root `DESIGN.md`.
