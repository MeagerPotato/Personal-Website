---
title: Fish Onboarding
summary: Learn the card game Literature in about four minutes, in a scripted teaching game where you have to make the key moves yourself.
parent: fishai
date: "2026-08"
status: shipped
role: "Solo: rules engine, teaching script, components, design"
stack: [TypeScript, React, Vite, Vitest, CSS]
links:
  repo: https://github.com/MeagerPotato/Fish-Onboarding
  demo: https://fish-onboarding.vercel.app
cover:
  src: ./cover.png
  alt: The first step of the guide, a six-seat table split into Blue and Red teams, your nine cards below it, and the heading "Six players, two teams".
planet:
  size: s
  biome: dune
---

The fastest way to learn Literature is to have someone explain it across a table. This guide
competes with that person. It is a scripted teaching game: eight steps, two checkpoints where you
have to make the move yourself, and 448 words in total. A longer version lost its testers, so this
one is short on purpose, and everything else a table asks about lives on a printable cheat sheet at
the end.

Most people reach it by scanning a QR code at the table, so it is phone-first and completely
self-contained: no accounts, no backend, no network requests once it has loaded. The whole thing is
82 KB gzipped against a 98 KB budget, with no webfont and no images. (Three.js was measured for
this one, and rejected. This website is where it got its revenge.)

## Nothing is hand-waved

Every step replays a real game action through the same pure rules engine, starting from a fixed
54-card deal. If the text says "this hits and you keep the turn", the engine produced that hit, and
the tests fail the build if it ever stops doing so. Both checkpoints can be solved by deduction from
the public log alone, which is why the deal is hand-authored: a checkpoint you can only guess at
teaches guessing.

## Colour never carries meaning alone

Team is carried by corner radius, suit by glyph, state by border style. The interface survives
greyscale, and that is checked by measurement rather than by eye.
