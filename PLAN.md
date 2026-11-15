# Book Compare — the plan

Last revised: 14 November 2026 (second revision, same day).

This file is the plan for Book Compare, written in plain language. It exists so that the
plan lives next to the code instead of only in someone's memory: the owner of the project
can read it, and every future working session can read it. When a decision changes, change
it here.

---

## 1. What Book Compare is for

Book Compare superimposes scans of **different copies of the same early printed edition**
so that a human can see where they differ. The material it is built for is printed around
1500: the *Liber selectarum cantionum* (544 printed pages, 20 surviving copies) and the
*Melopoiae sive harmoniae*, with pages of music, of text and of woodcuts.

It replaces the superimposition mode of Aruspix, which is no longer maintained and which
fails on some of the pages that matter here.

The purpose is **research output**: finding out what was changed in the press and in what
order — stop-press corrections as against later alterations by owners. The findings go into
scholarly work, so the tool must help a person see and record differences, not decide for
them.

Two consequences follow from that, and they govern everything else:

- **A human does the judging.** The aligned pair in Difference view is the centre of the
  tool. Any automatic flagging of differences is an optional aid, never an answer, because
  it will never be reliable enough to cite.
- **Nothing may hide a real difference.** Differences in ink and stroke thickness are
  information, so evening them out is acceptable only inside a separate flagging layer and
  never in the Difference view. Cracks and breaks in woodcut lines are the expected form of
  change in woodblocks, so the alignment must not close them.

## 2. Who it is for

The owner uses it on an ordinary Windows PC — deliberately, because the people expected to
use Book Compare are humanities scholars who will not own powerful machines either. Speed
must therefore be **measured on ordinary computers, not assumed**.

Ease of access and use is crucial to Book Compare's success. Most users will not be very
technical, so starting it, saving work and reopening it must work the way it does in any
ordinary program: install it, double-click, and it is ready.

---

## 3. Version 1 — the finish line

Version 1 is the point at which Book Compare is finished enough to be used for real
research, published, and cited by other people. It contains:

1. **The whole-book workspace** — the grid of copies and pages, which largely exists.
2. **Automatic detection of the printed area** of each scan, with manual correction.
3. **Tile-based alignment** — the fine, piecewise registration, usable throughout.
4. **Difference view**, as it already works.
5. **A proper desktop program** — an installer, a project saved in one file, double-click to
   open (§4.8).
6. **The website**, kept up to date automatically, as the place to try Book Compare without
   installing anything and to download the program.

**Not in version 1:** automatic page matching (§5.4). Copies usually lack only a few pages
or none, so matching pages by hand is not much to ask of the user.

Everything else waits. The reason for drawing the line here is that this list is already a
complete, useful tool; without a line, the project has no point at which it can be released,
cited, or handed to anyone else.

## 4. The order of work, and why

### 4.1 Unblock the website — done (14 November 2026)

Live at **https://peerpioneer.github.io/Book-Compare/**. The repository left the fork network
of VGG's Image Compare (permanent; history kept), Pages was switched on, and the site is
renewed automatically after every change, but only once all automatic tests pass.

### 4.2 Small jobs, now

- Remove the "Slide" mode.
- Add the "how to cite" file (`CITATION.cff`, which gives the repository a "Cite this
  repository" button on GitHub), naming VGG's Image Compare as the basis.
- Update the four outdated building blocks of the automatic tests (GitHub's Node.js 20
  warning).

### 4.3 The alignment experiment — the most important open question

*In plain words:* the alignment method was worked out as a trial version (a "prototype")
written in Python, a programming language that runs on Claude's computer in the cloud but
not inside a web browser. The browser only understands another language, JavaScript. The
experiment rewrites the trial version in the browser's language (programmers call this
"porting") and measures whether it is fast enough and still as good.

Why it comes first: everything in version 1 rests on the alignment, and nobody yet knows
how fast it is outside Python.

The prototype has three steps that run one after the other. They are built **in this order**,
and each is checked before the next is started:

1. **Find the printed area** on each scan. This cuts the work roughly in half for the steps
   after it, and is useful on its own (it is in version 1 anyway).
2. **Rough alignment** — put the two pages roughly on top of each other. In the prototype this
   is the slowest step.
3. **Fine (tile) alignment** — correct the remaining small distortions piece by piece.

The rewrite uses the browser version of OpenCV, the image-processing library the Python
prototype borrows about a dozen operations from. That keeps the rewrite close to the tested
prototype and nearly as fast. It costs a download of roughly 10 MB, made once. Before relying
on it: check that the browser version contains every operation the prototype uses.

**The target:** a page pair that has not been aligned yet is ready in **under 10 seconds** on
the owner's ordinary PC.

**Status (14 November 2026):** all three steps are rewritten and checked on Claude's computer
(two processor cores, Node.js; code in `research/js/`, details in its README). Step 1: the
printed-area boxes agree with the prototype to within a pixel on 21 of 24 test scans (at most
14 pixels on the others), about 3 s per scan. Step 2: the same result as the prototype; the slow
refinement runs on a picture a quarter of the size and takes about 3 s instead of 48 s with
practically the same result. Step 3: the same result as the prototype (0.4 % of the ink left
unmatched on the test pair, 22 % after the rough step), about 4–5 s. Together about 7–9 s per
additional copy of a page on Claude's computer, i.e. close to the target before any further
speed-up and before the measurement on the owner's PC.

**Where it is measured:** first on Claude's computer, then in the browser on the owner's
tablet (the worst case: an old machine, with scans on an external drive), then on the owner's
usual PC (the real benchmark, because it stands in for the average user).

**Test pages:** in the owner's Dropbox folder "Example pages" — f.158v (19 copies), f.4r
(20 copies), the dedication page, the woodcuts — which Claude can reach from the owner's
tablet.

### 4.4 A check against known differences — alongside the experiment

*In plain words:* the speed test answers "how fast is it?". This answers "is it still right?".

The owner's list of differences (`Differences.odt` in "Example pages", and
`Dissertation_Verlag.pdf`) says, for named pages and copies, exactly what differs and where.
A handful of these become automatic checks: after alignment, the known difference must still
be visible, and the alignment must stay within a few pixels where nothing differs.

**Status (14 November 2026):** the first check exists (`research/js/check_known_differences.js`,
Melopoiae table of contents, copies of both variant groups): 16 of 16 pass. The displaced poem lines
of group B stay visible after alignment, the rest of the page matches. The woodcut fracture lines
and the music table (Folio 19v) are still to do.

This was planned for after version 1; it moves here because it is how the experiment is
judged. Speed alone means nothing if the faster version no longer shows the variants. Later,
the same checks protect against something quietly breaking whenever the code changes. The
code is written by an assistant across many sessions and the owner cannot read it, which
makes this the strongest protection available.

### 4.5 The speed test

Already built (Compare tab → Pages view, menu More). It measures, per copy: opening the scan
(reading, decoding, getting at the pixels), finding the alignment, drawing the result; and
extrapolates to a whole book. To be run by the owner on his usual PC.

When reading its numbers:

- It measures the alignment Book Compare has **today**, not the tile method. The app says so
  itself. Once the experiment (§4.3) works, its timing is added to the speed test so that it
  can be measured again at any time and on other people's computers.
- The "opening the scan" figures do **not** change when the alignment method changes. That
  half of the numbers is permanent knowledge. An external drive affects only this column.

### 4.6 How the computing is organised — decided

The prototype needs about 13 seconds per copy and page — a figure that **already includes**
the saving from cutting each scan to its printed area (without it: about 29 seconds). For
the *Liber selectarum cantionum* that means roughly **2 hours per copy**, and about 37 hours
for all 19 copies against one reference. So the work is split up:

- **On demand:** a page pair that has not been aligned yet is aligned the moment the user
  opens it (target: under 10 seconds), and the next pages are prepared in the background
  while the user is still looking at the current one.
- **Background alignment, one copy at a time:** the user may switch it on and choose which
  copy to align. It runs while the user carries on working.
- **A progress bar with the estimated time left** for every longer computation.
- **Results are saved**, so nothing is ever computed twice.

Ideas to make it faster on top of that, each to be tested, none promised:

- *Do the rough alignment on a much smaller version of the page.* It only has to get within
  a few pixels — the fine step corrects the rest at full detail. This is the slowest step, so
  it is probably where the largest saving lies.
- *Use several processor cores at once.* Most PCs have four to eight. Aligning several pages
  at the same time multiplies the background speed accordingly (it does not shorten the wait
  for a single pair).
- *Prepare each scan only once* (printed area, ink preparation) and reuse it for every pair
  it belongs to.
- *Perhaps later, the graphics card.* Powerful but complicated; only if the above is not
  enough.

### 4.7 The reference copy — proposal, to be confirmed by the owner

Every copy is aligned to one reference copy; any two copies can then be shown against each
other by going via the reference. The reference is like a central station: every copy has a
line to it, and every trip between two copies passes through it. It need not be the most
important copy in a scholarly sense, only a reliable one.

- **Choosing it.** Book Compare proposes a reference from what it can measure — fewest
  missing pages, highest resolution, least skew, printed area found on most pages — and the
  user confirms or picks another. The owner's own criteria for a good reference copy were:
  complete, high resolution and little skew, freely accessible online, good condition, few
  manual alterations, good print quality.
- **Per page where needed.** Where the reference copy lacks a page, another copy stands in as
  the reference for that page.
- **A better copy added later.** Book Compare never switches the reference by itself. It may
  point out that a newly added copy looks like a better reference, saying what switching would
  cost ("about N hours of computing"). If the user switches, the old results stay in use until
  the new ones are ready.
- **Open:** pairs worked out via the reference may be slightly less exact than a pair aligned
  directly. If the check against known differences (§4.4) shows that this matters, the pair on
  screen can be aligned directly on demand.

### 4.8 The desktop program — after the experiment

Book Compare becomes an ordinary Windows program, built from the same web pages it consists
of now. It brings its own browser engine — the same one Edge uses — so everything that exists
keeps working. VS Code and Obsidian are built the same way.

What the user gets:

- an installer, a Start-menu entry, its own window;
- **a project saved in one file**, with Save and Save As, like LibreOffice. Double-clicking
  the file opens Book Compare with the project loaded. The file remembers where the scans are,
  and Book Compare reads them from there itself — no permission clicks. If a scan folder has
  moved, it asks once and relinks;
- no `.bat` file, no black window, no helper running in the background;
- the same behaviour on every computer, whatever browser the user has, so the question of
  Firefox disappears;
- heavy computing in the background without freezing the window, and access to faster
  image-processing tools than a web page may use.

This does **not** depend on the result of the experiment — it suits every outcome. It comes
second only because the experiment is the smaller job and answers the most important
question first. It replaces the helper and `Start Book Compare.bat`, and the single project
file is built as part of it, while old folder projects keep opening.

All file access in the app already sits in one place (`workspace.js`), behind one interface.
The desktop program plugs in a third way of reading files behind that same interface: it is
not a rewrite.

Costs, honestly: the download is about 80–100 MB. Without a paid code-signing certificate,
Windows shows "unknown publisher" on first install, and the user clicks "More info" →
"Run anyway"; whether to buy a certificate (low hundreds of euros a year) is decided at
release. A Mac version is possible from the same code later, if colleagues ask. The installer
is built automatically on GitHub, so the owner never has to build anything himself.

### 4.9 Finishing the whole-book workspace

What is left of version 1 once alignment and the desktop program are in place. The design is
already decided (see §6).

---

## 5. After version 1

### 5.1 Recording findings, and grouping copies — open design question

**The gap this closes.** Book Compare helps the owner *see* a difference and then gives him
nothing to take away. His lists of differences, which are the substance of chapter 4.7 of
his dissertation, are kept by hand, while the tool that found them knows nothing about what
he concluded. Closing that gap turns Book Compare from a viewer into something that produces
research data. The export of findings and the grouping of copies are two halves of one piece
of work and should be built together.

**What grouping means here.** Not the software guessing which copies belong together — that
idea is dropped for good (§7). This is the software *recording* the grouping the scholar
arrives at himself: these copies carry this version of this spot, those copies carry that
one. It is bookkeeping, which is the kind of feature that always works.

**The design is not settled.** The thinking so far, to be discussed before anything is
built:

- *Where the marking happens.* The moment one knows that copy 7 matches copy 1 is the moment
  one is looking at them in Difference view. If recording it means going back to the grid
  afterwards, it will not get done. So the marking probably belongs in the Compare tab, as
  one click or keystroke while the pair is on screen, with the grid showing the result.
- *What a group belongs to: a page, or a spot on a page.* This is the hard part. f.4r has
  many differences, and copies may group one way for a spot in one system and differently
  for a spot further down. One mark per page would force several findings to be flattened
  into one. The proposal is therefore that a grouping belongs to a **variant** — a page plus
  a spot, where "the whole page" is the simple case — and that the grid colours the cells for
  whichever variant is currently selected, with a small selector on rows that have more than
  one.
- *How it looks.* Letters (A, B, C) carry the meaning, because colour blindness is common;
  the six palette colours (`ef476f`, `f78c6b`, `ffd166`, `06d6a0`, `118ab2`, `073b4c`) may
  tint them.
- *Two states besides the groups: "not checked yet" and "can't tell".* Without them one is
  pushed into assigning a group one does not believe — for an incomplete copy such as
  D-Mbs, or a scan too poor to judge. A useful consequence: "which copies still need
  checking on this page" then falls out of the data, which is the "next to check" idea, so
  that need not be built separately.
- *A guardrail from the owner's own reading.* Copies cannot be ordered as whole books: the
  work on Vesalius found hybrid copies, with only 2 of 28 having all the checked woodcuts in
  one state. Groups must therefore stay strictly per page and per spot, and the tool must
  never roll them up into a verdict about a copy. Software quietly encourages that kind of
  summary and it would be wrong for this material.
- *One honest aid, which is not guessing.* Once copy 7 is in the same group as copy 1, the
  copies not yet judged can be shown against the group's representative instead of against
  copy 1 every time. That is workflow, not inference.

**The export.** For a marked spot: a cropped picture of the two copies side by side, plus a
line of text identifying page, copies, group and note. Over a whole project: a table of
page / spot / group / copies — which is the raw material of the difference lists.

### 5.2 Citation: a DOI on release

The "how to cite" file comes now (§4.2). On release, a DOI through Zenodo. In the humanities
a DOI is what makes software citable at all — without one, other scholars have nothing to put
in a footnote.

### 5.3 One other person installing it, once

Book Compare is designed for a humanities user with no technical background, and so far only
its owner has ever installed it. One afternoon with someone else — ideally a colleague
without a coding background — catches what cannot be seen from the inside.

### 5.4 Automatic page matching — optional, and only if cheap

Not in version 1 (§3). A tested prototype exists (`research/page_matching.py`: 193 of 216
page correspondences found across four *Melopoiae* copies without using file names). The
computing itself is cheap, since it compares small thumbnails, but building it into the app
with a good way to check and correct its suggestions is a medium-sized job. If it is built,
the user decides whether to use it.

### 5.5 Splitting double-page scans inside Book Compare

Many libraries scan two pages in one picture. For now the owner splits them with a Photoshop
script (`tools/photoshop/Split-double-pages.jsx`), which is a stopgap for his own work and
**not part of Book Compare**. Later Book Compare should do this itself. The grid was already
designed for it: a cell can be a region of a file rather than a whole file.

### 5.6 Further out

- Other visualization modes, where they prove useful. The candidate is a mode with offset
  arrows, and it only makes sense once alignment is settled.
- Quality dots per row, and the rough wrong-page check before full alignment.
- Making the app look more pleasing. Surface only, and last.

---

## 6. Decisions already made

**The grid (whole-book workspace).** Columns are copies, rows are positions in the book.
Empty cells for missing pages; a row preview across all copies; insertion and removal of gap
ranges; undo; renamable rows (e.g. "Index", "Mons Parnassus Woodcut"); "Start numbering at
this row", so that rows above become front matter; "Don't compare this row". Rows are
positions, not tied to any copy, because the first copy may be incomplete or begin with
cover and flyleaf scans. Any copy may serve as copy 1 or copy 2.

**The copy-name field is left empty.** No pre-filling, ever.

**No placing files by numbers in their file names.** File names are inconsistent across
copies and scans often begin with a cover or flyleaf.

**Pages are matched by hand in version 1** (§5.4).

**Contrast and black-and-white are gone entirely** — both before alignment and as display
settings. The alignment tests showed no benefit, and the results were considered clear.

**Removing a copy never deletes scans.**

**Annotations live only in the whole-book workspace**, not in the two-image app. The six
annotation and flag colours are the palette listed in §5.1.

**Alignment is computed once per pair and reused** for every display variant.

**One reference copy, not every pair** (§4.7). Comparing every copy with every other would
be an order of magnitude more work, as the speed test shows.

**Speed target:** a page pair not yet aligned is ready in under 10 seconds on an ordinary PC.

**Computing:** on demand for the pair on screen, plus optional background alignment of one
chosen copy at a time, with a progress bar showing the time left, and saved results (§4.6).

**The printed area.** An automatic proposal per scan, drawn as an outline that stays
visible; manual correction by dragging edges and corners on either scan; a "back to
automatic" button; one rectangle used by every alignment mode; remembered per scan with the
pair and reusable in batch work. It is used only for the alignment calculation — the engine
receives the cut-out areas, the result is carried back to the full scans, and the panels
still show whole pages. It must be optional. Rectangles first; tilted or irregular areas
perhaps later. The detector may not depend on a frame, since many woodcuts have none.
Failures caused by stamps or handwritten entries are not worth fixing: a manual box on those
few pages is acceptable. Open: what to fall back to when no area is found — the whole page,
or a manual rectangle.

**Standing rule, never to be broken.** The scan and PDF folders are read-only: never change
anything in `Diss_Pdfs`, `Liber selectarum cantionum. Digitalisate` or
`Melopoiae. Digitalisate. Originale`. Work on copies elsewhere.

**Scan images are never committed to this public repository.**

**For anything about the dissertation, consult only `Dissertation_Verlag.pdf`** — not the
other PDFs. Registration is not discussed in the thesis; the findings on differences are in
chapter 4.7 "Druckreihenfolge", and possibly chapter 6 "Resümee".

**The website publishes only after all automatic tests pass**, not on every push.

---

## 7. Dropped, and why

**Automatic grouping of copies.** Dropped for good. It is the one clever feature that could
absorb months and end in something not trustworthy enough to cite. Replaced by the manual,
recorded grouping in §5.1.

**OCR.** Dropped from the plan. Reading type of around 1500 is a research field of its own,
dedicated tools exist for it, and it is not what Book Compare does.

**Comparing individual types** (after Agata & Agata 2022, on the Gutenberg Bible). Moved out
of the software plan and into research reading. It is a question about method — does
comparing single letters reveal something the eye does not? — and becomes a feature only if
the answer turns out to be yes.

**Thin plate spline.** No further work. It has never produced usable results on this
material. Keep it until the tile method works, because it is the honest comparison point,
then take it out of the interface.

**Slide mode.** A presentation gimmick for this purpose; removed now (§4.2).
**Toggle stays** — the blink between two states is how Aruspix's superimposition worked, and
some differences show up that way which do not in a colour difference.

**Hover and Overlay** are already out of the interface, with the code left dormant.

**PDF import.** Deferred.

**Noise reduction beyond thickness-equalising**, and **comparing by segmented letters or
words** instead of fixed windows. Both too complicated for now; not on the list.

---

## 8. The relationship to VGG's Image Compare

Book Compare began as a fork of [ox-vgg/image-compare](https://github.com/ox-vgg/image-compare),
released under the BSD-2-Clause licence. That licence permits commercial use, modification
and redistribution, and does not require changes to be published. What it requires is that
the copyright notice and the licence text be kept. (Not legal advice; for anything with
money attached, ask a lawyer.)

Measured on 14 November 2026, the application contained roughly 1,300 lines still
substantially VGG's (`action.js`, `viz.js`, `compare.js`, `transform.js`) against roughly
3,250 lines written for Book Compare (`workspace.js`, `panes.js`, `compare-tab.js`,
annotations, the speed test), with the launcher, the tests, the Photoshop tool, the
prototypes and the research code all new.

The VGG code that remains is precisely the code this plan replaces: `viz.js` holds the
alignment that the tile method supersedes, and `action.js` is the two-image result view that
the Compare tab takes over. **The separation from the original therefore happens by itself
as the work proceeds**, and there is no reason to spend time on a rewrite. The question of
decoupling can be revisited when that share is near nothing, at which point it will be a
formality. Leaving the fork network on GitHub (§4.1) was a separate, purely practical matter
and changed nothing about the licence or the credit.

The credit line stays:
*Book Compare is based on Image Compare, developed by VGG, Oxford | Modifications by Torge
Schiefelbein.*

---

## 9. How the work is organised

- The plan is decided with Claude Opus; the code is written by Claude Sonnet, following
  Anthropic's "plan with Opus, execute with Sonnet" advice. **Before any coding starts,
  Claude asks the owner, in one short question, whether he has switched to Sonnet, and waits
  for the answer.**
- Changes are pushed straight to `main`.
- Tests run automatically on GitHub for Windows and Linux; the website publishes only after
  they pass.
- One working session per piece of work, rather than one long session, since a session that
  runs out of room loses its context.

## 10. Test material

All in the owner's Dropbox folder "Example pages", reachable from his tablet and his PC:

- *Liber selectarum cantionum* f.158v — 19 copies; the first music test page, three versions
  in the superius (system 2, notes 13–14).
- *Liber selectarum cantionum* f.4r — 20 copies, many differences of several kinds.
- The dedication page — 9 copies; group A with the "Helvetio" addition, group B without.
  Aruspix could not superimpose it.
- The coat-of-arms woodcut — 5 copies in black and white (unframed; the D-Mbs copy is
  incomplete), and 8 copies in colour. Outline alignment is enough; colour comparison is not
  wanted.
- *Melopoiae* p. 4 ("Prima facies"), and the *Melopoiae* title page, which is the first
  printed page in every copy.
- `Mein Artikel\List of Differences.odt` (in Dropbox\Melopoiae) — the owner's current list of known differences; this is the reference. The older `Differences.odt` / `Differences.pdf` in Example pages is outdated (it wrongly listed a woodcut line for D-Mu).
- Copies that are difficult to align: F-Pm, A-Wn, D-ARk, D-SHk.

Music pages matter most and should be tested hardest, starting with a page that has few
differences and working towards pages with more and with different kinds of alteration.

---

## 11. Register of open items and decisions

Added 15 November 2026, because the plan lived partly in prose and in conversation, and items
(the desktop program, the reference copy) were dropped from to-do lists. **Rule from now on:**
every item below has an ID; the status line of this register is updated whenever something is
done, decided or added, and any "what can we do next" list is taken from this register, never
from memory. Status: **done** / **next** / **waiting** (needs something first) / **open**
(design question) / **later** (after version 1).

### 11.1 Version 1 — building

| ID | Item | Status | Depends on / note |
|----|------|--------|-------------------|
| V1 | Whole-book workspace (grid of copies × pages, importing, copy names stay empty) | mostly done | §4.9 lists what is left |
| V2 | Printed-area detection, automatic + manual correction | detection done in experiment (§4.3); **not yet in the Compare tab**; manual correction not built | V2a make Compare tab use it; V2b correction by hand |
| V3 | Tile-based alignment in the Compare tab | experiment done, runs in the speed test (worker); **not yet in the Compare tab** | needs V2a; Thursday speed test decides nothing about *whether*, only about expectations |
| V4 | Difference view | done | — |
| V5 | **Desktop program** (§4.8): installer, project in one file, double-click opens, own browser engine, replaces helper/.bat, built on GitHub | **next** (does not depend on the speed test) | V5a decide framework (Electron vs Tauri) — see D3; V5b file access behind `workspace.js`; V5c installer built by GitHub Actions; V5d code-signing certificate decision at release |
| V6 | Website, kept current automatically | done (live) | — |
| V7 | **Reference copy** (§4.7): proposal from measurable criteria, user confirms, stand-in per page, never switches by itself, old results kept until new ones are ready | **open** — design confirmed in prose only; not built; needs owner confirmation of the last point | V7a scoring of copies; V7b UI to confirm/choose; V7c per-page stand-in; V7d "better copy found" hint with cost |
| V8 | **Background alignment** of one chosen copy at a time + computing on demand for the pair on screen | decided (§4.6), not built | needs V3 |
| V9 | **Progress bar with time estimate** for V8 | decided, not built | needs V8 |
| V10 | Storage of aligned results (what is kept, where, invalidation when the reference changes) | **open** — not designed in detail | V7, V8; decide with the desktop program's project file |
| V11 | Speed target: not-yet-aligned page pair ready in < 10 s on an ordinary PC | to be measured Thursday 19 Nov on his PC | speed test already includes the tile method |
| V12 | Known-differences checks (§4.4), all pass (15 Nov): Melopoiae TOC (16); woodcut p.19 B-Br vs D-Mu (7 assertable lines of 8); p.8, five copies against B-Br (25); Liber f.19v, CH-E vs D-FUl and US-CA, whole page and the single notes of the apparatus (11). **Source for the Liber:** the critical apparatus in `Dissertation_Verlag.pdf`, 4.6, pp. 195–224 (PDF page = printed page), with Table 1 of the 20 extant copies on p. 15; for the Melopoiae: `Mein Artikel\\List of Differences.odt`. **Still open:** more Liber folios from the apparatus (many have groups A/B with single notes or text), Melopoiae pairs 05, 09 and others | partly done | T3, T4 |
| V13 | Tests: workspace tests on Windows CI; desktop-program smoke test | partly done | — |
| V15 | **Alignment settings for a page that aligns badly** (idea from Aruspix: number of main tiles and sub-tiles). Proposal: a button "Try again with other settings" with 2–3 plain presets (stiffer / standard / more flexible), numbers only in an advanced panel; result shown at once for the pair on screen; chosen setting saved per page in the project. Caution: a more flexible alignment can hide real differences, so "fewest unmatched" must NOT be the only criterion (needs the known-differences check, §4.4) | **open** — owner's idea 15 Nov; to be decided with the experiment on difficult copies (F-Pm, A-Wn, D-ARk, D-SHk) | needs V3; test first which settings matter |
| V16 | **Shifts of a few pixels are absorbed by the tile alignment** (found 15 Nov on Melopoiae p. 8: title and kerning "shifted slightly" in group A show only 0–3 % unmatched). Idea: show how far each part was moved (a map or arrows from the displacement field), so that such shifts stay visible. This is the "offset arrows" candidate of §5.6; decide after the first real use | **open** | needs V3 |
| V14 | Release housekeeping: README (ORCID, year, version), CITATION.cff, CHANGELOG, licences list (OpenCV.js Apache-2.0 is in) | per release | — |

### 11.2 After version 1

| ID | Item | Status |
|----|------|--------|
| P1 | Manual recorded grouping of copies and findings export (§5.1) | open design |
| P2 | DOI via Zenodo on release (§5.2) | later |
| P3 | One outside tester installs it once (§5.3) | later |
| P4 | Automatic page matching (§5.4) — only if cheap | later, optional |
| P5 | Splitting double-page scans inside Book Compare (§5.5) — Photoshop script v1.1 is the stopgap | later |
| P6 | Other visualization modes, quality dots, wrong-page check, look and feel (§5.6) | later |
| P7 | Mac version from the same code, if colleagues ask | later |

### 11.3 The owner's own tasks and material

| ID | Item | Status |
|----|------|--------|
| T1 | Split double-page copies (CZ-Pu, D-SHk, GB-Lbl1, SK-Mmf) with `Split-double-pages.jsx` v1.1 into a *different* folder (never into the protected scan folders) | his; SK-Mmf partly done with v1.0 |
| T2 | Run the speed test on his PC, Thursday 19 Nov, and paste the text | his |
| T3 | Marked woodcut files: `Example pages\Melopoiae. Concert of Gods\19. B-Br. White lines marked.jpg` and `19. D-Mu. White lines marked.jpg` (found 15 Nov) — B-Br: vertical (teal), horizontal above Phoebus' head (red), horizontal at the feet (yellow); D-Mu: vertical (yellow) and four short lines at hand height | material for V12 |
| T4 | Melopoiae scans on `D:\Melopoiae. Digitalisate vom Tablet`: one folder per copy, 20 files "NN. [copy].jpg"; not Melopoiae pages: Aktueller Vergleich, D-Mbs Harmoniae super odis Horatii Flacci, germanos, Grantley-Dateien | reference for V12 |
| T5 | CZ-Pu split run with v1.0 (15 Nov): 163 double pages split, then every file from NK4288 to NK4405 failed with "Cannot open the file because the open options are incorrect" (112 files); NK4406 (a single page) opened fine. Cause unknown: the D: drive was no longer reachable when I tried to inspect the files. To do: inspect NK4287/NK4288 (format, colour mode, profile), then make the script robust | his drive; then me |

### 11.4 Decisions still to be taken

| ID | Question | Needed by |
|----|----------|-----------|
| D1 | Reference copy: confirm the proposal in §4.7 (including "old results stay until new ones are ready") | before V7 |
| D2 | Pairs via the reference vs directly aligned on demand (§4.7 "Open") | after V12 results |
| D3 | Desktop framework (Electron vs Tauri) — to be proposed with reasons in plain language | before V5 |
| D4 | Code-signing certificate for the installer (low hundreds of euros a year) | at release |
| D5 | Grouping design (§5.1) | before P1 |
| D7 | ~~Differences.pdf listed the line above Phoebus' head for D-Mu too~~ **Resolved 15 Nov:** the owner says that was an error in the old Differences.pdf; the line is in B-Br only. His current list is `Mein Artikel\List of Differences.odt` (Dropbox\Melopoiae), which already says so. **That file, not Differences.pdf, is the reference for all checks from now on** | done |
| D6 | What exactly is stored for aligned results (V10) | before V8 |

### 11.5 Order from here (15 November 2026)

1. Photoshop script v1.1 — **done**.
2. Known-differences check: woodcut — **done**; more Melopoiae pairs and the Liber f.19v table (V12) — next, small.
3. Thursday 19 Nov: speed test on his PC (V11/T2).
4. Desktop program (V5), starting with D3.
5. Compare tab uses printed-area detection and tile alignment (V2a, V3).
6. Reference copy (V7, D1), then background alignment, progress bar and stored results (V8–V10).
