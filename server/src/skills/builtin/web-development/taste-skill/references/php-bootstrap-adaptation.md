# taste-skill for PHP/Bootstrap Sites

taste-skill is written for React/Next.js + Tailwind v4 stacks. But its **design principles** apply to any tech stack. Here's how to adapt each section for PHP + Bootstrap 5.3 sites.

## Stack Translation Table

| taste-skill Default | PHP/Bootstrap equivalent |
|---|---|
| React/Next.js RSC | PHP includes + `require()` |
| Tailwind v4 utilities | Bootstrap 5 utility classes + custom CSS |
| Motion (fka Framer Motion) | CSS transitions + vanilla JS animations |
| `next/font` | Google Fonts `<link>` (ok for PHP sites), or `@font-face` |
| `package.json` deps | None — Bootstrap loaded via CDN or local file |

## Which taste-skill Sections Fully Apply

| Section | Applies? | Notes |
|---|---|---|
| 0. Brief Inference | ✅ Fully | Same regardless of stack |
| 1. Three Dials | ✅ Fully | DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY |
| 2. Design System Map | ⚠️ Partial | Ignore React-specific systems (Fluent, Carbon, etc.). Reach for Bootstrap 5.3 for fast builds. |
| 3. Default Architecture | ❌ Skip | React/Tailwind-specific |
| 4. Design Engineering | ✅ Fully | Typography, Color, Layout rules all apply |
| 5. Context-Aware Proactivity | ⚠️ Partial | CSS-animations instead of Motion/GSAP |
| 6. Performance | ✅ Fully | Same Web Vitals targets |
| 9. AI Tells (banned patterns) | ✅ Fully | Same purple gradients, same clichés |
| 11. Redesign Audit | ✅ Fully | Same process |
| 12. Pre-Flight Check | ✅ Fully | Same checklist |

## Key Adaptations

### Color (Section 4.2)
- Use CSS `:root` variables for the palette (max 1 accent, sat < 80%)
- Replace `class="text-6xl"` with Bootstrap's `fs-1` + custom CSS
- **THE LILA RULE still applies** — no purple gradients, no AI-glow

### Typography (Section 4.1)
- Bootstrap uses system font stack by default (fine)
- Override via CSS if a premium feel is wanted: Geist, Outfit, Satoshi via `@font-face` or Google Fonts
- Default `line-height: 1.7` for body, `tracking-tighter` for headings

### Cards (Section 4.4)
- `.card-modern` → `.card` with `.border-0` + custom CSS
- `box-shadow: var(--shadow-sm)` for subtle depth
- Hover: `translateY(-2px)` effect via CSS

### Buttons (Section 4.5)
- `.btn-modern` → `.btn` with custom CSS overrides
- `border-radius: var(--radius-sm)` (8px) not pill (25px)
- Add `:active: scale(0.98)` for tactile feedback
- CTA button contrast check (WCAG AA) still mandatory

### Navigation (Section 4.7)
- Bootstrap navbar → customize via CSS variables
- **Single-line nav at desktop** rule still applies
- **Max 80px height** rule still applies
- White background + accent color highlights (not the old purple gradient)

### Motion (Section 5)
- Bootstrap has no built-in animation framework. Use:
  - CSS `@keyframes` + `animation` properties for scroll-reveals
  - `IntersectionObserver` for trigger-based animations
  - CSS `transition` for hovers
- No GSAP, no Motion library needed
- `prefers-reduced-motion` still mandatory

## Worked Example: YOUR_SITE Redesign (This Project)

**Design Read:** Personal portal/blog for a Chinese sea captain. Audience: self and friends. Vibe: warm, refined, personal, not corporate.

**Dials:** VARIANCE=5, MOTION=3, DENSITY=4

**Approach:**
1. Replaced purple-blue gradient (`#667eea → #764ba2`) with warm olive green (`#689f38 → #558b2f`)
2. Navigation: white background (was purple gradient), green accent for active/hover
3. Footer: dark green gradient (was dark blue/purple)
4. Cards: subtle border + shadow, no glassmorphism, no backdrop-filter
5. Page structure kept unchanged — only CSS colors, shadows, typography, spacing

**Color Palette:**
- Primary: `#689f38` (olive green)
- Primary dark: `#558b2f`
- Surface: `#ffffff`
- Surface alt: `#f5fbf0` (light green tint)
- Text: `#2e3d2e` (dark green-black)
- Border: `#dde8d5` (subtle green-gray)
- Background: `#f0f8e8` (light green page bg)

**Files Changed (pure CSS, no logic touched):**
- `css/style.css` (complete rewrite, 15KB)
- `includes/navbar.php` (button classes only)
- `includes/footer.php` (inline CSS colors)
- Individual pages with inline purple styles: index, blog, chat, search, work, movie, admin/login, admin/index, admin/ai_manage

## Worked Example: Cyberpunk HUD Overhaul (Session 2026-05-30)

After the warm green theme, redesigned the SAME PHP/Bootstrap site into a cyberpunk sci-fi HUD. Demonstrates how to go from "refined warm" to "gritty futuristic" without touching any PHP logic.

**Design Read:** Sci-fi command terminal / HUD interface. Audience: self. Vibe: dark tech, neon glow, glassmorphism, retro-futuristic.

**Dials:** VARIANCE=8, MOTION=6, DENSITY=5

**Pure CSS approach (no Three.js, no canvas):**
- Background: `#0a0a1a` (deep navy) + animated grid via `background-image` + `linear-gradient` repeating lines
- Particles: `body::before` with multiple `radial-gradient` dots at random positions, animated with CSS `@keyframes`
- Glassmorphism: `backdrop-filter: blur(12px)` on nav, cards, footer
- Corner brackets: `::before` / `::after` on cards (top-left + bottom-right angle brackets, 20px border, transparent center)
- Neon borders: `box-shadow: 0 0 15px rgba(0,240,255,0.3)` with color-matched glow
- Gradient text: `background: linear-gradient(135deg, #00f0ff, #b026ff)` + `-webkit-background-clip: text` + `-webkit-text-fill-color: transparent`
- Buttons: neon border + Orbitron font + hover fills with accent + text color flips to white
- Tables: HUD-style header (dark background + neon border-bottom) + fixed-width monospace cells
- Footer scan line: vertical sweep animation (top-to-bottom linear gradient moving down)

**Fonts:** Orbitron (Google Fonts) for titles/buttons, Rajdhani for body text

**Key insight:** Every visual effect was achieved with pure CSS. No JavaScript, no image assets, no framework overhead. The Three.js particle background (first attempt) was replaced with CSS-only particles — instant load, zero dependencies, works offline.

**Verification checklist for cyberpunk/HUD themes:**
- [ ] Deep navy background (`#0a0a1a` or `#0d1117`)
- [ ] Animated grid lines (CSS repeating gradients with animation)
- [ ] Particle dots (body::before with radial-gradients)
- [ ] Glassmorphism on containers (backdrop-filter: blur)
- [ ] Corner brackets (::before/::after, 2px solid accent)
- [ ] Neon glow on borders (box-shadow with color)
- [ ] Gradient text on headings (cyan→purple or similar)
- [ ] Orbitron or similar sci-fi font for headings
- [ ] Buttons with neon border + hover fill effect
- [ ] Tables with HUD-style borders
- [ ] Scan line or similar animation on footer

## PHP/Bootstrap Layout Pitfalls (field-tested)

### 1. Flex layout: `min-height: 0` on scrollable children
When building a `display: flex; flex-direction: column` layout where one child has `flex: 1; overflow-y: auto`:
- The child **must** have `min-height: 0` to shrink below its content.
- Without it, the flex item's minimum size is `auto` (content height), so it won't compress, causing sibling items to overflow the viewport.

```css
.messages-container {
  flex: 1;
  overflow-y: auto;
  min-height: 0;  /* ← CRITICAL */
}
```

### 2. `100dvh` vs `100vh` for viewport-height containers
- Use `100dvh` (dynamic viewport height) instead of `100vh` for full-viewport containers.
- Add a JS fallback for browsers that don't support `dvh`:
```javascript
function fixViewportHeight() {
  document.querySelector('.app-container').style.height = window.innerHeight + 'px';
}
```
- Do NOT set `min-height: 100vh` alongside `height: 100dvh` — it will override the `dvh` value.

### 3. Inline HTML patch verification
When patching inline HTML inside PHP files (`echo` statements, inline `<style>` blocks):
- **Read the patched file** after every write to verify tag matching.
- A single `</i>` → `</div>` typo will cascade through ALL subsequent HTML on that page (cards, grid items, footer).
- Re-read the full page output to catch dangling tags.

### 4. Close `mysqli_stmt` gracefully
When calling `mysqli_stmt_close($stmt)` at the bottom of a PHP page, the statement may already have been implicitly closed by `mysqli_stmt_get_result()`. This causes a Fatal Error. Solution: remove the `mysqli_stmt_close()` call entirely — PHP frees resources automatically at script end.

taste-skill's **design reasoning** (sections 0, 1, 4, 9, 11, 12) is fully stack-agnostic. Only the implementation details (sections 2B, 3, 5, 6) need translation. For Bootstrap/PHP sites, focus on: clean color palette, generous spacing, typographic hierarchy, card/shadow restraint.
