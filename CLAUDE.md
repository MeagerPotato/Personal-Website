@AGENTS.md

## Skills

`.claude/skills/` holds third-party skills (frontend-design, review-animations,
animation-performance; sources in its README). They are general advice written for other sites.
Where one conflicts with AGENTS.md or docs/DESIGN.md, this repo wins. The clashes found so far:

- `transform`: the engine owns it. Movement uses the `translate` and `scale` properties.
- Reduced motion turns transitions off here (0 s), not "shorter" or "a gentler fade": a lagging
  `visibility` breaks focus after a soft navigation.
- "UI under 300 ms": `motion.slow` (480 ms) is deliberate for drawers and the leaders.
- New typefaces or palettes: Outfit and `tokens.ts` are decided. Caps labels, the route sign
  and status chips are part of the system, not template chrome.
- Animating `left` or a size is accepted where AGENTS.md or the code says why (the Map button and
  the prompt slide by `left`; the minimap redraws at its size).
