# Skills for Claude Code

Claude Code loads each folder here as a skill. They are copied unchanged from their sources, with
their licences, so they can be compared with upstream later.

| Skill | What it is for | Source (commit) | Licence |
| --- | --- | --- | --- |
| `frontend-design` | a design lens: one bold choice, no templated defaults, critique from screenshots | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` (dbd4588) | Apache 2.0 |
| `review-animations` | a strict review of motion code; run it by name (`/review-animations`) | [emilkowalski/skill](https://github.com/emilkowalski/skill) `skills/review-animations` (2d22863) | MIT |
| `animation-performance` | why an animation drops frames, which properties are cheap | [emilkowalski/skill](https://github.com/emilkowalski/skill) `skills/animation-performance` (2d22863) | MIT |

They were picked from fourteen skill repositories after a read-through of every file (none of
these three has scripts, hooks or network calls) and trials on this site. Where a skill's advice
conflicts with AGENTS.md or docs/DESIGN.md, the repo wins: CLAUDE.md lists the known clashes.
