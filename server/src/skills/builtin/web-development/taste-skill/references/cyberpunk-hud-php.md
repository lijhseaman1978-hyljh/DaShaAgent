# Cyberpunk HUD Design Pattern (Pure CSS)

## When to use
User asks for "sci-fi", "cyberpunk", "HUD", "neon", "future tech", "Blade Runner" aesthetic on a PHP/Bootstrap site. Not a React/Next.js project.

## Design Read
Personal website/portal for a single user — needs high visual impact without changing any HTML/PHP logic. The audience is the user and their friends. Style: Cutting-edge sci-fi/HUD.

## Dials
- VARIANCE: 8 (asymmetric, artsy — fits cyberpunk)
- MOTION: 7 (cinematic — particles, glow animations, scan lines)
- DENSITY: 4 (standard content density)

## Reference File
When the user provides a reference.html file (e.g. `C:\Users\...\Desktop\新建 文本文档.html`), load it with `read_file()` and match ALL visual elements exactly:
- Background color: `#0a0a1a`
- Grid lines: CSS `background-image: linear-gradient(...)` with `background-size: 50px 50px` and `grid-move` animation
- Particle dots: CSS `background-image: radial-gradient(...)` with `float-particles` animation
- Glassmorphism: `rgba(16, 20, 48, 0.75)` + `backdrop-filter: blur(10px)`
- Neon cyan: `#00f0ff`, Neon purple: `#b026ff`, Electric blue: `#4d7cff`
- Corner brackets on cards: `::before` top-left + `::after` bottom-right, 2px solid neon-cyan
- Navigation: transparent glass background, neon bottom border glow
- Buttons: Orbitron font, transparent with neon border, hover fills with neon
- Headings: Orbitron font, gradient text (cyan → purple) via `background-clip: text`
- Footer scan line: `::after` pseudo-element with `top: 0 → 100%` animation
- All corners: `border-radius: 0` (hard edges for HUD look)
- Fonts: Orbitron for headings/title-case, Rajdhani for body text

## Pure CSS over Three.js
- Do NOT use Three.js for particle backgrounds on a PHP/Bootstrap site
- Pure CSS `radial-gradient()` on `body::before` creates a lighter, faster, more reliable particle effect
- Grid lines: `linear-gradient()` on `body`
- No JavaScript dependencies needed for the background

## Card Corner Bracket Pattern
```css
.card::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 40px; height: 40px;
  border-top: 2px solid var(--neon-cyan);
  border-left: 2px solid var(--neon-cyan);
  filter: drop-shadow(0 0 5px var(--neon-cyan));
  z-index: 1;
}
.card::after {
  content: '';
  position: absolute;
  bottom: 0; right: 0;
  width: 40px; height: 40px;
  border-bottom: 2px solid var(--neon-cyan);
  border-right: 2px solid var(--neon-cyan);
  filter: drop-shadow(0 0 5px var(--neon-cyan));
  z-index: 1;
}
```

## Common Pitfalls
1. **Three.js on PHP sites**: Avoid. Three.js requires npm install and a build step. Pure CSS backgrounds work better and load faster.
2. **Inline style HTML typos**: When patching inline HTML in PHP files, a single `</i>` → `</div>` typo breaks the entire page layout below the edit point. Always re-read the patched section to verify tag matching.
3. **Glassmorphism overflow**: `overflow: hidden` on cards clips the corner bracket `::before`/`::after` if they extend outside. Set `position: relative` on the card.

## Files to modify for a PHP/Bootstrap site
- `css/style.css` — complete rewrite with cyberpunk variables and class overrides
- `includes/navbar.php` — Google Fonts link (Orbitron, Rajdhani) + nav CSS classes
- `includes/footer.php` — scanning line animation
- Individual PHP pages with inline styles (index.php hero, admin/login.php, etc.)
