---
title: alai
summary: A voice-first iPad tutor that watches STEM homework and speaks up the moment a step goes wrong. Keewano track winner at a16z SpeedHacks.
system: hackathons
date: "2026-10"
status: shipped
role: Product and engineering lead
stack: [Next.js, React, TypeScript, Vercel, tldraw, Claude, Deepgram, KaTeX, pdf-lib, Keewano]
links:
  repo: https://github.com/MeagerPotato/alai
  demo: https://alai-ruddy.vercel.app
planet:
  size: s
  biome: frost
flagship: true
---

alai is a voice-first iPad tutor that watches students write STEM homework with an Apple Pencil and
speaks up the moment a step goes wrong, without giving away the answer. Students working alone often
make an early mistake, keep going, and find out a day later. alai catches it within seconds.

## How it works

A student snaps or uploads a worksheet. Claude reads every problem, builds its own answer key, and
checks the handwriting after each pause of about two seconds. On a wrong step, Ally, the on-screen
companion, highlights it and speaks a nudge of twenty words or fewer. The student can hold a button
and ask "why?" out loud.

Every mistake, hint and fix is logged to Keewano, which builds a profile of each student (the
teaching style that works, familiar topics, past fixes) and a hint policy across the whole cohort
that changes how alai tutors. It covers math, physics and chemistry, and exports the finished
worksheet as a PDF.

Under the hood: Next.js 16 and React 19 on Vercel, tldraw for the page, Claude for vision, tutoring
and reading the worksheet, Deepgram Aura-2 for its voice and Nova-3 to hear the student, KaTeX,
pdf-lib and pdf.js, and sixteen custom Keewano event types. A 22-case automated eval checks the
tutor's verdict, the type of mistake, the length of a nudge, latency, and whether it gives the
answer away.

## Built in a day

Aiden Guan and I built it in one day at a16z SpeedHacks during SF Tech Week, on October 11, 2026:
first commit at 11:58 AM, submission at 5:00 PM, 54 merged pull requests and 155 commits. I led
product and engineering; Aiden handled the visual design and testing on the iPad. It won the
Keewano track (Best Use of Keewano) and its $1,000 prize.

## What's next

Better recognition of handwriting and of more languages, a teaching mode, and a version for school
districts and tutoring companies.
