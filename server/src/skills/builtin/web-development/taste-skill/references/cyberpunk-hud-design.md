# Cyberpunk / Sci-Fi HUD Design Reference

Applied to YOUR_SITE (May 2026). Pure CSS, no JavaScript required.

## Key Visual Elements

| Element | CSS Technique | Example |
|---------|--------------|---------|
| Dark space background | `background-color: #0a0a1a` | Deep navy-black |
| Grid overlay | `background-image: linear-gradient(...)` with `background-size: 50px 50px` + `animation: grid-move` | Animated expanding grid |
| Particle dots | `body::before` with `radial-gradient(circle at X% Y%, color 1px, transparent 1px)` multiple layers | Floating 3D starfield |
| Glassmorphism | `background: rgba(16,20,48,0.75)` + `backdrop-filter: blur(12px)` | Translucent HUD panels |
| Corner brackets | `card::before` + `card::after` with `border-top/border-left` and `filter: drop-shadow(0 0 5px neon-cyan)` | Sci-fi targeting reticles |
| Neon borders | `border: 1px solid rgba(0,240,255,0.5)` + `box-shadow: 0 0 30px rgba(...)` | Glowing edges |
| Gradient text | `background: linear-gradient(90deg, cyan, purple)` + `-webkit-background-clip: text` | Holographic titles |
| Scan line | `footer::after` with `animation: footer-scan 4s linear infinite` moving top→bottom | HUD scanning effect |
| Neon buttons | Orbitron font + cyan border + hover fills with cyan + text reverses to dark | Interactive glow |

## Color Palette

```css
--bg-deep-space: #0a0a1a;
--bg-glass: rgba(16, 20, 48, 0.75);
--neon-cyan: #00f0ff;
--neon-purple: #b026ff;
--neon-blue: #4d7cff;
--text-primary: #e0e0ff;
--text-dim: rgba(224, 224, 255, 0.6);
--border-glow: rgba(0, 240, 255, 0.5);
```

## Font Pairing
- **Titles/Buttons:** `Orbitron` — tech/cyber feel
- **Body:** `Rajdhani` — clean, readable, geometric
- Google Fonts: `Orbitron:wght@400;700;900` + `Rajdhani:wght@300;400;600;700`

## Pitfalls (from this session)

1. **Don't use Three.js for background** — user rejected it. Pure CSS `radial-gradient` particles + `linear-gradient` grid is faster, more reliable, zero JS.
2. **Read the reference HTML first** — user had a specific HTML example. All visual decisions should match its CSS variables, color hexes, and structural patterns (corner brackets, glassmorphism, scan lines).
3. **Don't just change colors** — user called the first attempt "just changed colors, no creativity." The cyberpunk aesthetic requires: grid background, particles, corner brackets, glow effects, gradient text, and consistent glassmorphism across ALL components.
4. **Keep all Bootstrap class names** — the global CSS file overrides `.card-modern`, `.btn-modern`, `.table-modern`, `.navbar-modern` etc. No PHP changes needed.
5. **Card corners need BOTH top-left AND bottom-right brackets** (matching the reference design). `::before` for top-left, `::after` for bottom-right.
