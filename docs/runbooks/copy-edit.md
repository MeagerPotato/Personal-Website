# Runbook: the copy edit (Allen's voice pass)

**Who:** Allen. **When:** whenever there is an hour or two; the only thing waiting on it is going
public ([launch-checklist.md](launch-checklist.md) §0). **Time:** about an hour for the "must"
list, another hour for the rest. **Plan reference:** docs/PLAN.md §4.4 (copy rules) and §6, W6.

Claude drafted every word from your resume, LinkedIn and the project repos; this pass is where
they start to sound like you, and where you catch anything that is not quite true. Facts were
last checked on 2026-09-28, against your resume of 2026-09-23 and your answers that day.

## 1. How to do it: pick one

- **A. Tell Claude in chat** (least effort): "on the About page, change … to …", or paste a
  rewritten paragraph. Claude makes the change, checks it and merges it.
- **B. Edit on github.com** (no setup): open a file below on
  https://github.com/MeagerPotato/Personal-Website, press the pencil, edit, then **Commit
  changes…** → **Create a new branch** (name it `allen/copy-edit`) → **Propose changes** →
  **Create pull request**. Edit more files on the same branch the same way. Tell Claude when the
  pull request is up: Claude checks it, fixes anything mechanical, and merges it.
- **C. Edit on your laptop** in VS Code, and watch it live: `npm run dev`, then
  http://localhost:4321/about/ (add `?plain` to the address for the plain page). Every save
  shows at once. Tell Claude when you are done; Claude commits, checks and merges.

Whichever you choose, you only change words. Claude does everything else: `npm run verify`, the
browser tests, a new resume PDF when the resume changed, and any test that quotes a label you
reworded.

## 2. The few rules that can break the build

- Between the two `---` lines at the top of a file, change only what comes **after** a colon,
  and leave these alone entirely: `system`, `parent`, `date`, `status`, `planet`, `flagship`,
  `theme`, `order`, `dock`, and folder names. They move planets or change addresses.
- Lengths: `summary` at most 160 characters, `title` 60, `tagline` 120, `role` 80.
- A value that contains a colon followed by a space needs quotes: `role: "Solo: the whole thing"`.
- Headings in a page's text start at `##`: the page's one big heading comes from its `title`.
- Links to the site's own pages end with a slash: `/projects/fishai/`.
- **No phone number and no personal email, anywhere.** The only address the site may show is
  `allen@allenkh.com`; a test scans the whole repository for anything else.
- Not sure yet? Write `TODO(copy)` where the words are missing. Nothing breaks while you work,
  and the build refuses to publish a page that still has one, so a half-finished sentence can
  never go live.
- In an `.astro` file, change only the text between tags. Leave anything in `{ }` alone.

## 3. The list

Tick the boxes here as you go (on github.com: edit this file, or keep the list in a note).

### Must: what a recruiter reads first

- [ ] **About** · `src/content/pages/about.md` · shows at `/about/`, and as the home planet's
      page. The `summary:` line is what Google and link previews show; the rest is the page.
      New since your last look: the **Berkeley** section (Cal Aero SAE, Hackathons @ Berkeley),
      and **Rockets** and **Robots** now match your 2026-09-23 resume (3,200 ft; 7 teams, about
      60 students, 9 national appearances).
- [ ] **Home page** · `src/pages/index.astro` · shows at `/`. The browser-tab title and the
      `description` (Google's snippet: at 173 characters it is cut off after about 160), the line
      above the heading, the heading ("A small universe of things I've built."), the sentence
      under it, the paragraph on how to fly (keep it in step with the hint card, below), the two
      buttons, and the "Elsewhere" list at the bottom.
- [ ] **Resume** · `src/content/resume.yaml` · shows at `/resume/`, on paper, and in the PDF.
      One block per section, entries in the order they appear. Check especially what your
      2026-09-23 resume does not say, which the site keeps from the earlier resume and LinkedIn:
      the YC line "Selected to attend YC's in-person conference…", the whole **Awards** section,
      and TypeScript in the skills (added because both shipped projects are written in it).
- [ ] **FishAI** · `src/content/projects/fishai/index.md` · `/projects/fishai/`, the flagship.
      The `summary`, the `role`, and the text. The bot table and the lab's numbers describe a
      project that keeps moving: they match FishAI's README as of 2026-09-28.
- [ ] **Days2Meet** · `src/content/projects/days2meet/index.md` · `/projects/days2meet/`. Its
      README confirms the modes, no accounts and no polling, but not press-and-hold painting,
      moving answers when the dates change, or the security list: make sure they are true as
      written.
- [ ] **Canadian Fish** (a moon of FishAI) · `src/content/projects/canadian-fish-demo/index.md`.
- [ ] **Fish Onboarding** (a moon of FishAI) · `src/content/projects/fish-onboarding/index.md`.
- [ ] **The one-line bio**, which lives in three places that should agree: `description` in
      `src/config/site.ts`, `summary` in `about.md`, and the home page's `description`.

### Should

- [ ] **Contact** · `src/content/pages/contact.md` · the sentence above the links.
- [ ] **Resume intro** · `src/content/pages/resume.md` · the sentence under the contact links
      (screen only; paper and the PDF leave it out).
- [ ] **Projects index** · `src/pages/projects/index.astro` · its title, description, the small
      label "Star chart" and the paragraph under the heading.
- [ ] **Picture descriptions** · `cover:` → `alt:` in each project's `index.md` (four of them).
      What a screen reader says for the picture, and for its link preview.
- [ ] **The 404 page** · `src/pages/404.astro` · "Lost in space".
- [ ] **The colophon** · `src/layouts/Base.astro`, at the bottom · "Made by Allen with Claude.
      Built with Astro and three.js, served by Cloudflare, set in Outfit." (plain mode only).
- [ ] **The hint card** (how to fly, first visit) · `src/layouts/Base.astro`, near the top ·
      the key list and the touch list. Keep it in step with the home page's paragraph.
- [ ] **The footer notices** · `src/layouts/Base.astro`, at the bottom · what a visitor reads
      when the 3D view cannot start or their device asks for reduced motion, and the two chips
      "Plain version" and "Launch the starfield".
- [ ] **Place labels** · `src/site/view-models.ts` · "Home planet", "Resume station", "Comms
      satellite" (the small label over each page's heading), the statuses (Shipped, In progress,
      Archived) and the link labels (Live site, Source, Video).

### Skip until your solar-system tree arrives

- The **Code** system (`src/content/systems/code.md`: its name, tagline and blurb) and the home
  page's "Every solar system here is something I care about": the systems are being reorganized
  (About Me, Personal Projects, Hackathons…), and they will be written again with the tree.

### Tiny labels: tell Claude rather than editing them

Tests quote these word for word, so a change to one also means changing its tests: "Orbit
FishAI", "Leave orbit", "Flying to … Stop", "Map" / "Close map", "Boost", "Expand" / "Shrink" /
"Close", "About this site", "Got it", and what a screen reader hears ("Flying to FishAI.",
"Docked at FishAI.", "Stopped.", "Star map open.").

## 4. Small decisions the words raise

Answer these in chat, or decide them as you edit. None is urgent.

- **One name for each mode.** The 3D site is "the universe version" (home page), "the starfield"
  (the chip) and "the 3D view" (the failure notice); the plain site is "Plain version", "the
  plain version" and "the calm version" (the reduced-motion notice). Pick one pair.
- **Orbit or dock?** What a visitor sees says orbit ("Orbit FishAI"); what a screen reader hears
  says dock ("Docked at FishAI.").
- **Map words.** "Star chart" (the projects page) against "star map" and "Map" (the universe).
- **The game's name.** FishAI says "Canadian Fish"; both moons say "Literature"; one moon is
  itself called "Canadian Fish".
- **"The formal version"** means LinkedIn on the home page, but the resume on About and Resume.
- **Page titles are place names.** The home planet is called "About", so the world says "Orbit
  About" and "Docked at About." Your tree may settle this.
- **The promise.** The home page says rockets, robots and software, but only software has
  planets until the tree lands.
- **More from LinkedIn, if you want it:** VEX's 4 Worlds qualifications and 3 California state
  qualifications, JROTC nationals, the National Build, Create and Inspire awards. The site
  follows your resume, which leaves them out.

## 5. When you are done

Tell Claude "copy done" (with the pull request, if you made one). Claude then:

1. runs `npm run verify` and the browser tests, and fixes anything mechanical;
2. prints the resume PDF again if the resume changed (`npm run resume-pdf`: the build refuses a
   PDF that no longer matches the page);
3. updates any test that quoted a label you changed;
4. looks at every changed page at phone width and on paper, merges, and checks the live site.

Then tick the copy box in [launch-checklist.md](launch-checklist.md).
