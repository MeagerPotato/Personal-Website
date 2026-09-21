---
title: Days2Meet
summary: A group availability poll in the spirit of When2meet, plus a dates-only mode for the plans where hours are meaningless.
system: code
date: "2026-08"
status: shipped
role: "Solo: product, frontend, backend, security"
stack: [Next.js, React, TypeScript, Tailwind CSS, Supabase Postgres, Vercel]
links:
  repo: https://github.com/MeagerPotato/days2meet
  demo: https://days2meet.allenkh.com
cover:
  src: ./cover.png
  alt: The Days2Meet create-event form, with the "Dates only" mode selected above a two-month calendar.
planet:
  size: m
  biome: terra
---

When2meet answers "what time on Tuesday?". It cannot answer "which weekend in October?". Days2Meet
is the same idea, a link you send to a group and a heat map that shows when everyone is free, with
one addition that matters: you choose a **mode** when you create the event.

- **Dates & times** is the classic grid: a date range, a daily time window, painted by dragging.
- **Dates only** is a month calendar where people mark whole days. No times, no time zones. It is
  the mode for winter break, a trip window, or that weekend in October.

## The details that make it usable

- **No accounts.** Respondents type a name and start marking. A password is optional for them, and
  only stops other people editing their answer.
- **Painting that works on a phone.** Press and hold to paint, so an ordinary swipe still scrolls.
- **An Event Planner who can change their mind.** The creator can move the dates, change the time
  window, close responses, and export the roster as CSV. Moving dates remaps the answers people
  already gave, with a live count of how many marks would be dropped.
- **No polling.** Answers load with the page and refresh when you ask, not every five seconds.

## Security, on purpose

A scheduling poll collects names and sometimes email addresses, so I treated it like something
worth attacking. Row-level security is enabled with zero policies, so only the server can touch the
data. Sessions are HMAC-signed cookies, passwords are hashed with scrypt, sign-in is throttled, the
CSV export guards against formula injection, and old events are deleted on a schedule. I wrote up an
audit before launch, and the app never sends email: addresses exist only so the Event Planner can
see them.
