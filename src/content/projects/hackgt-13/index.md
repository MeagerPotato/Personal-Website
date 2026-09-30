---
title: HackGT 13
summary: HEARSAY, team dh squad's entry to the NSA challenge at HackGT 13, which scores how likely a voice clip is synthetic and shows the evidence.
system: hackathons
date: "2026-09"
status: shipped
role: Team member, dh squad
stack: [Python, Hugging Face Transformers, ONNX, LightGBM, ffmpeg, Docker]
links:
  repo: https://github.com/MeagerPotato/hearsay-dh-squad
planet:
  size: m
  biome: frost
---

At HackGT 13 my team, dh squad, took on the NSA's HEARSAY challenge: 1,671 audio clips, and for
each one a single number, the probability that the voice in it is synthetic. Most of the judging
was a cost metric that makes a false alarm four times as expensive as a miss, so the job is less
"catch the fakes" than "never accuse a real voice".

## Read the data before training anything

The organizers supplied a large synthetic-speech dataset, so the obvious move was to train on it.
We looked at the test clips first. Their sentences were VCTK prompts, the source of the ASVspoof
2019 benchmark, not the supplied data. Almost all of their lengths were exact multiples of one
audio library's hop size, which let us rebuild the organizers' preprocessing step by step. And
they were about 17 dB noisier than that benchmark. Noise, not unfamiliar attacks, turned out to be
what broke the published detectors, and that one measurement shaped everything after it. (We also
found that the scorer we were given read the scores the wrong way round, and told the organizers.)

## Four detectors and sixteen experts

The score fuses four deep anti-spoofing detectors: two published XLS-R models, a copy of one of
them with its back end re-trained by us on noise-matched audio, and a small classifier we trained
on WavLM-Large features. Alongside the number, every clip gets a forensic report drawn from 16
experts (pitch, pauses and breaths, spectral dynamics, reverberation, compression traces, splices,
speaker identity, the spoken text), and a rule-based router decides which of them a clip needs
and logs why.

On benchmark audio matched to the test set's noise, the fusion reached a cross-validated minDCF (a
cost: lower is better) of 0.076 on attack types it had seen and 0.153 on synthesis families none
of its parts was trained on, against 0.140 and 0.179 for the best-known published detector under
the same noise.
