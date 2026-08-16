---
name: taste-skill
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
---

# tasteskill: Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, **infer what the user actually wants**. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### 0.A Read these signals first
1. **Page kind** - landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. **Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste.
5. **Brand assets that already exist** - logo, color, type, photography. For redesigns, these are starting material, not optional input (see Section 11).
6. **Quiet constraints** - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints OVERRIDE aesthetic preference.

### 0.B Output a one-line "Design Read" before generating
Before any code, state in one line: **"Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>."**

Example reads:
- *"Reading this as: B2B SaaS landing for technical buyers, with a Linear-style minimalist language, leaning toward Tailwind utilities + Geist + restrained motion."*
- *"Reading this as: solo designer portfolio for hiring managers, with an editorial / kinetic-type language, leaning toward native CSS + scroll-driven animation + custom typography."*
- *"Reading this as: redesign of a public-sector service site, with a trust-first language, leaning toward GOV.UK Frontend or USWDS."*

### 0.C If the brief is ambiguous, ask one question, do not guess
Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges. Example: *"Should this feel closer to Linear-clean or Awwwards-experimental?"*

If you can confidently infer from context, **do not ask**. Just declare the design read and proceed.

### 0.D Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.

---

## 1. THE THREE DIALS (Core Configuration)

After the design read, set three dials. Every layout, motion, and density decision below is gated by these.

* **`DESIGN_VARIANCE: 8`** - 1 = Perfect Symmetry, 10 = Artsy Chaos
* **`MOTION_INTENSITY: 6`** - 1 = Static, 10 = Cinematic / Physics
* **`VISUAL_DENSITY: 4`** - 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data

**Baseline:** `8 / 6 / 4`. Use these unless the design read overrides them. Do not ask the user to edit this file - overrides happen conversationally.

### 1.A Dial Inference (design read → dial values)
| Signal | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| "minimalist / clean / calm / editorial / Linear-style" | 5-6 | 3-4 | 2-3 |
| "premium consumer / Apple-y / luxury / brand" | 7-8 | 5-7 | 3-4 |
| "playful / wild / Dribbble / Awwwards / experimental / agency" | 9-10 | 8-10 | 3-4 |
| "landing page / portfolio / marketing site (default)" | 7-9 | 6-8 | 3-5 |
| "trust-first / public-sector / regulated / accessibility-critical" | 3-4 | 2-3 | 4-5 |
| "redesign - preserve" | match existing | +1 | match existing |
| "redesign - overhaul" | +2 | +2 | match existing |

### 1.B Use-Case Presets
| Use case | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| Landing (SaaS, mainstream) | 7 | 6 | 4 |
| Landing (Agency / creative) | 9 | 8 | 3 |
| Landing (Premium consumer) | 7 | 6 | 3 |
| Portfolio (Designer / studio) | 8 | 7 | 3 |
| Portfolio (Developer) | 6 | 5 | 4 |
| Editorial / Blog | 6 | 4 | 3 |
| Public-sector service | 3 | 2 | 5 |
| Redesign - preserve | match | match+1 | match |
| Redesign - overhaul | +2 | +2 | match |

---

## 2. BRIEF → DESIGN SYSTEM MAP

Once you have the design read and dials, pick the right foundation. Do not invent CSS for things that have an official package.

### 2.A When to reach for a real design system
| Brief reads as… | Reach for | Why |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | `@fluentui/react-components` or `@fluentui/web-components` | Official Fluent UI |
| Google-ish UI, Material-flavored product | `@material/web` + Material 3 tokens | Official, theme-able |
| IBM-style B2B / enterprise analytics | `@carbon/react` + `@carbon/styles` | Official Carbon |
| Shopify app surfaces | `polaris.js` / Polaris React | Required for Shopify admin |
| Atlassian / Jira-style product | `@atlaskit/*` + `@atlaskit/tokens` | Official Atlassian DS |
| GitHub-style devtool / community page | `@primer/css` or `@primer/react-brand` | Official Primer |
| Public-sector UK service | `govuk-frontend` | Legally expected |
| US public-sector / trust-first | `uswds` | Same |
| Fast local-business / agency MVP | Bootstrap 5.3 | Fast, works |
| Modern accessible React foundation | `@radix-ui/themes` | Primitives + polished theme |
| Modern SaaS where you own components | shadcn/ui | You own the code |
| Tailwind-based modern SaaS / AI marketing | Tailwind v4 utilities + `dark:` variant | Default for indie builds |

### 2.B Aesthetic directions (no official package)
| Aesthetic | Honest implementation |
|---|---|
| Glassmorphism / "frosted glass" | `backdrop-filter`, layered borders, highlight overlays. Solid-fill fallback for `prefers-reduced-transparency` |
| Bento (Apple-style tile grids) | CSS Grid with mixed cell sizes |
| Brutalism | Native CSS, monospace, raw borders |
| Editorial / magazine | Serif type, asymmetric grid, generous whitespace |
| Dark tech / hacker | Mono + accent neon, terminal motifs |
| Aurora / mesh gradients | SVG or layered radial gradients |
| Kinetic typography | Native CSS animations, scroll-driven animations, GSAP |

---

## 3. DEFAULT ARCHITECTURE & CONVENTIONS

### 3.A Stack
* **Framework:** React or Next.js. Default to Server Components (RSC).
* **Styling:** **Tailwind v4** (default). v3 only if existing project demands it.
* **Animation:** **Motion** (fka Framer Motion). Import from `motion/react`.
* **Fonts:** Always `next/font` (Next.js) or self-host `@font-face` + `font-display: swap`. Never link Google Fonts via `<link>` in production.

### 3.B State
* Local: `useState` / `useReducer`.
* Global: Zustand, Jotai, or React context (for deep prop-drilling only).
* **NEVER** `useState` for continuous mouse/scroll/pointer values. Use Motion's `useMotionValue` / `useTransform`.

### 3.C Icons
* **Allowed:** `@phosphor-icons/react`, `hugeicons-react`, `@radix-ui/react-icons`, `@tabler/icons-react`.
* **Discouraged:** `lucide-react` (only if user asks or project depends).
* **Never hand-roll SVG icons.** One family per project.
* Standardize `strokeWidth` globally (e.g. 1.5 or 2.0).

### 3.D Emoji Policy
Discouraged by default. Replace with icon-library glyphs. Override: only when user explicitly asks for playful / chat-style / social-native vibe.

### 3.E Responsiveness & Layout Mechanics
* Standard breakpoints (`sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`).
* Contain pages with `max-w-[1400px] mx-auto` or `max-w-7xl`.
* **NEVER `h-screen`** on Hero. Always `min-h-[100dvh]` (iOS Safari address bar fix).
* **Grid over Flex-Math:** Never `w-[calc(33%-1rem)]`. Use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-6`).

### 3.F Dependency Verification
Before importing ANY 3rd-party library, check `package.json`. If missing, output the install command first.

---

## 4. DESIGN ENGINEERING DIRECTIVES (Bias Correction)

### 4.1 Typography
* **Display / Headlines:** Default `text-4xl md:text-6xl tracking-tighter leading-none`.
* **Body:** Default `text-base text-gray-600 leading-relaxed max-w-[65ch]`.
* **Sans font:** Discouraged: `Inter` as default. Pick `Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi` first.
* **Pairings:** `Geist` + `Geist Mono`, `Satoshi` + `JetBrains Mono`, `Cabinet Grotesk` + `Inter Tight`.

### 4.2 Color Calibration
* Max 1 accent color. Saturation < 80% by default.
* **THE LILA RULE:** No automatic purple/blue AI glow aesthetic. Use neutral bases with high-contrast singular accents.
* **One palette per project.** Lock the accent color. Audit every component before shipping.

### 4.7 Layout Discipline (Hard Rules)
* **Hero MUST fit in initial viewport.** Headline max 2 lines, subtext max 20 words, CTAs visible without scroll.
* **Navigation MUST render on single line at desktop.**
* **Zigzag alternation cap:** Max 2 split sections in a row. 3rd is a Pre-Flight Fail.
* **Eyebrow restraint:** Max 1 eyebrow per 3 sections. Count instances of `uppercase tracking` - if count > ceil(sectionCount/3), fail.
* **Section-layout-repetition ban:** Once a layout family is used, it can appear at most ONCE.

### 4.9 Content Density
* Short headline (≤ 8 words) + short sub-paragraph (≤ 25 words) + one visual asset OR one CTA.
* No data-dump sections. Long lists need a different UI component.
* **Hero stack discipline:** Max 4 text elements (eyebrow, headline, subtext, CTAs). Banned in hero: trust micro-strip, feature bullets, avatar row, pricing teaser.

---

This is an abbreviated version. For the full 87KB skill with all sections (5. Context-Aware Proactivity, 6. Technology Patterns, 7. Component Library, 8. Motion Architecture, 9. Dark Pattern Bans, 10. Quality Gate, 11. Redesign Audit, 12. Pre-Flight Check):
- Full original: https://github.com/Leonxlnx/taste-skill
- Full local copy: `references/full-skill.md`
- PHP/Bootstrap adaptation: `references/php-bootstrap-adaptation.md`
- Cyberpunk/Sci-Fi HUD design (pure CSS): `references/cyberpunk-hud-design.md`

## Pitfalls (from real sessions)

### 1. Read the Reference File FIRST
When the user provides a reference HTML/CSS file, read it before writing any code. Match its CSS variables, color hexes, font choices, and structural patterns (corner brackets, glassmorphism, scan lines) exactly. Don't guess the aesthetic — copy the reference.

### 2. Pure CSS over JS/Three.js
For visual effects (particles, grids, backgrounds), prefer pure CSS (`radial-gradient` + `linear-gradient` + CSS `animation`) over Three.js or canvas-based solutions. Pure CSS loads instantly, has no dependency issues, and works offline.

### 3. Cyberpunk HUD Checklist
When the brief reads as "cyberpunk / sci-fi / HUD", apply ALL of these:
- [ ] Deep navy background (`#0a0a1a`) + animated grid lines
- [ ] Particle dots via `body::before` with radial gradients
- [ ] Glassmorphism on nav, cards, footer (`backdrop-filter: blur()`)
- [ ] Corner brackets on cards (top-left AND bottom-right via ::before/::after)
- [ ] Neon borders with glow `box-shadow`
- [ ] Gradient text on headings (cyan → purple)
- [ ] Orbitron fonts for titles/buttons, Rajdhani for body
- [ ] Buttons: neon border, Orbitron, hover fills with neon, text reverses
- [ ] Footer scan line animation (vertical sweep)
