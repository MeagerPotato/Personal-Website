---
title: FishAI
summary: Bots for Canadian Fish, a six-player card game of hidden information, and the simulation lab that measures whether they are any good.
system: code
date: "2026-08"
status: in-progress
role: "Solo: rules engine, bots, lab, papers, site"
stack: [TypeScript, React, Vite, Vitest, Supabase, Rust, Python, LaTeX]
links:
  repo: https://github.com/MeagerPotato/FishAI
  demo: https://fishai.allenkh.com
cover:
  src: ./cover.png
  alt: The FishAI lab's style report, headed "9 styles, one engine", with links to the payoff matrix, replays and papers.
planet:
  size: l
  biome: tide
  rings: true
flagship: true
---

Canadian Fish (also called Literature) is a six-player team card game in which you only ever see
your own hand. You win sets by asking opponents for exact cards, and by declaring a set once your
team, between you, knows where all six of its cards are. It is a game of inference: every question
leaks information, including the ones that miss.

FishAI is my attempt to play it well with software. It is three things in one repository: a rules
engine, a family of bots, and a lab that measures them.

## The bots

| Line | Status | The idea |
| --- | --- | --- |
| **Bass** | frozen at v2.0 | Nine play styles over one shared inference engine, then an adaptive layer that classifies each seat and best-responds |
| **Monet** | current, v1.0 (September 2026) | Asks with a small network that imitates a stronger bot's choice, which a second network, trained on what actually wins, can overrule |
| **ATHENA** | next | Learns its own play from game outcomes, from scratch |

Underneath every bot is the same job: track, for every card, which seats could still be holding it,
and tighten those constraints with every public ask and answer. Bots only ever see the public view
from their own seat, and a test enforces it, so none of them can cheat by accident.

## What the lab found

- **Monet v1.0 beats the reference bot.** Against SESTINA v1.0, a third-party bot running in
  someone else's engine, it won 58.38% of 14,400 games across twelve fresh seeds. Its worst seed
  was 56.58%. The acceptance test was registered before the games were played.
- **Where it started.** The previous line, Bass v2.0, won 27.08% of 7,200 games against the same
  opponent.
- **Why Bass lost.** Not accuracy: it declared sets correctly 98.42% of the time, against
  SESTINA's 98.46%. It was slow. Bass needed 9.30 events to prove a set that SESTINA proved in 2.92.
- **Is there a best play style?** On Bass's nine-style roster, yes. One style dominates, so the
  clever adaptive layer converges to it and only pays for its warm-up.

## How it is built

The rules engine is pure, deterministic TypeScript with no runtime dependencies, and it plays two
rule sets: the 54-card US student dialect and the 48-card baseline. The lab replays duplicate deals,
so the luck of the deal cancels out, then analyses the results (Nash, α-Rank, exploitability).

On the site you can take a seat against five bots, watch replays, run simulations in your browser,
and read the twelve papers, each with its PDF and its LaTeX source.
