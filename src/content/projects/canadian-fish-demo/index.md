---
title: Canadian Fish
summary: Play the six-player card game Literature in the browser, with live rooms, bots that deduce instead of guess, and practice drills.
parent: fishai
date: "2026-08"
status: shipped
role: "Solo: game engine, server, client"
stack: [TypeScript, React, Vite, Supabase Realtime, Vercel Functions, Playwright, Vitest]
links:
  repo: https://github.com/MeagerPotato/Canadian-Fish-Demo
  demo: https://canadian-fish.vercel.app
cover:
  src: ./cover.webp
  alt: The Canadian Fish lobby, with one card to open a table, one to join with a six-letter room code, and the rules in four lines.
planet:
  size: s
  biome: terra
---

The place to actually play. Someone opens a table, hands out a six-letter room code, and six people
are playing Literature in their browsers. No accounts, and nothing persists past the room.

- **The server is the referee.** The game logic that counts runs in serverless functions, and
  state reaches the six seats over Supabase Realtime.
- **Bots that deduce.** Empty seats go to deterministic inference bots, which work out what every
  public ask and answer proves rather than guessing.
- **Practice drills.** A drill suite for the skills the game rewards, for when five friends are
  not available.
- **Phone first.** It is built for a table of people holding phones, because that is who plays.

This is the 48-card game: the four 8s are removed, leaving eight half-suits of six. The engine is
covered by unit tests and fuzz tests, with Playwright for the browser.
