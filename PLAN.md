# Book Compare — the plan

Last revised: 14 November 2026.

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

Getting started has to be easy enough for someone with no technical background. That is why
Book Compare stays a web page started by a small local helper (`Start Book Compare.bat`),
rather than an installed program, and why it must work in Firefox as well as Edge.

---

## 3. Version 1 — the finish line

Version 1 is the point at which Book Compare is finished enough to be used for real
research, published, and cited by other people. It contains:

1. **The whole-book workspace** — the grid of copies and pages, with its project folder and
   automatic saving.
2. **Automatic detection of the printed area** of each scan, with manual correction.
3. **Tile-based alignment** — the fine, piecewise registration, usable throughout.
4. **Difference view**, as it already works.
5. **The website**, kept up to date automatically.

Everything else waits. The reason for drawing the line here is that this list is already a
complete, useful tool; without a line, the project has no point at which it can be released,
cited, or handed to anyone else.

## 4. The order of work, and why

### 4.1 Unblock the website (small, and already overdue)

The repository is still marked on GitHub as a copy of the original Image Compare project,
and GitHub refuses to publish Pages from such a repository. The automatic tests already
pass; only the publishing step fails. The fix is to leave the fork network in the
repository's settings, then switch Pages on and re-run the failed job.

Leaving the fork network is permanent. It keeps the whole history. It costs the ability to
send changes back to VGG — which will never happen, since the projects have diverged
completely — and any issues and stars, of which there are none.

### 4.2 Try tile-based alignment in the browser, before building anything on top of it

**This is the largest risk in the project and therefore comes first after the website.**

Everything in version 1 rests on the tile-based alignment, and it does not exist in Book
Compare yet. It exists only as a prototype in Python on the owner's PC, where it took about
8 seconds per copy. The browser is a slower place for that kind of arithmetic, and it
freezes the window while it works. Nobody yet knows whether it is fast enough, and the
whole-book workflow is being designed on the assumption that it is.

So: port **only** the tile alignment into the browser, for a single page pair, with no
interface at all, and measure it on f.158v and f.4r.

- If it is fast enough, build the workspace on top of it with confidence.
- If it is too slow, there is a fallback that costs the user nothing: the local helper that
  already starts the app could do the computation itself, outside the browser, at
  Python-like speed. That is a real change to the shape of the program, and far cheaper to
  decide now than after the workspace is built on the other assumption.

Afterwards, fold the tile timing into the built-in speed test, so that it can be measured
again at any time and on other people's computers.

### 4.3 The speed test

Already built (Compare tab). It measures, per copy: opening the scan (reading, decoding,
getting at the pixels), finding the alignment, drawing the result; and extrapolates to a
whole book.

Two things to keep in mind when reading its numbers:

- It measures the alignment Book Compare has **today**, not the tile method. The app says so
  itself. Until 4.2 is done, its alignment figures are the optimistic case.
- The "opening the scan" figures do **not** change when the alignment method changes. A
  40-megapixel scan takes as long to open either way. That half of the numbers is permanent
  knowledge.

The reference measurement is the owner's usual PC, because it stands in for the average
user. A run on a weaker machine, or with the scans on an external drive, is still useful as
a lower bound — and the external drive shows up only in the "opening the scan" column.

### 4.4 The whole-book workspace, with project files

Design already decided (see §6). Project saving to a single file (`.bookcompare`) is folded
in here rather than built separately, while old folder projects keep opening.

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

### 5.2 A test set built from differences already known

The dissertation lists differences for named pages and copies. Turning half a dozen of them
into automatic checks — on f.158v, copies X and Y, this known difference must still be
visible; the alignment error must stay below N pixels — means every future change is verified
without re-checking by eye.

This matters more than it sounds. The code is written by an assistant across many sessions
and the owner cannot read it. A test set built from known answers is the strongest
protection against something quietly breaking. The automatic tests on GitHub already provide
the place to put it.

### 5.3 Citation infrastructure

The owner wants to take the citation duty towards VGG seriously, and the same machinery
serves his own work:

- a `CITATION.cff` file, so GitHub shows a "Cite this repository" button;
- a short "How to cite Book Compare" section naming VGG's Image Compare as the basis;
- on release, a DOI through Zenodo. In the humanities a DOI is what makes software citable
  at all — without one, other scholars have nothing to put in a footnote.

### 5.4 One other person installing it, once

Book Compare is designed for a humanities user with no technical background, and so far only
its owner has ever installed it. One afternoon with someone else — ideally a colleague
without a coding background — catches what cannot be seen from the inside.

### 5.5 Further out

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
cover and flyleaf scans. A project folder with automatic saving. Any copy may serve as copy
1 or copy 2.

**The copy-name field is left empty.** No pre-filling, ever.

**No placing files by numbers in their file names.** File names are inconsistent across
copies and scans often begin with a cover or flyleaf.

**Contrast and black-and-white are gone entirely** — both before alignment and as display
settings. The alignment tests showed no benefit, and the results were considered clear.

**Removing a copy never deletes scans.**

**Annotations live only in the whole-book workspace**, not in the two-image app. The six
annotation and flag colours are the palette listed in §5.1.

**Alignment is computed once per pair and reused** for every display variant.

**One reference copy, not every pair.** Each copy is aligned with one reference and the
other pairs are derived; comparing every copy with every other would be an order of
magnitude more work, as the speed test shows.

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

**Slide mode.** A presentation gimmick for this purpose; remove it with that clean-up.
**Toggle stays** — the blink between two states is how Aruspix's superimposition worked, and
some differences show up that way which do not in a colour difference.

**Hover and Overlay** are already out of the interface, with the code left dormant.

**PDF import**, and **a true installed desktop program**. Deferred; Book Compare stays a
browser-based tool.

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
formality. Leaving the fork network on GitHub (§4.1) is a separate, purely practical matter
and changes nothing about the licence or the credit.

The credit line stays:
*Book Compare is based on Image Compare, developed by VGG, Oxford | Modifications by Torge
Schiefelbein.*

---

## 9. How the work is organised

- The plan is decided with Claude Opus; the code is written by Claude Sonnet, following
  Anthropic's "plan with Opus, execute with Sonnet" advice.
- Changes are pushed straight to `main`.
- Tests run automatically on GitHub for Windows and Linux; the website publishes only after
  they pass.
- One working session per piece of work, rather than one long session, since a session that
  runs out of room loses its context.

## 10. Test material

- *Liber selectarum cantionum* f.158v — 19 copies; the first music test page, three versions
  in the superius (system 2, notes 13–14).
- *Liber selectarum cantionum* f.4r — 20 copies, many differences of several kinds.
- The dedication page, f.1r — 9 copies; group A with the "Helvetio" addition, group B
  without. Aruspix could not superimpose it.
- The coat-of-arms woodcut — 5 copies in black and white (unframed; the D-Mbs copy is
  incomplete), and 8 copies in colour. Outline alignment is enough; colour comparison is not
  wanted.
- *Melopoiae* p. 4 ("Prima facies"), and the *Melopoiae* title page, which is the first
  printed page in every copy.
- Copies that are difficult to align: F-Pm, A-Wn, D-ARk, D-SHk.

Music pages matter most and should be tested hardest, starting with a page that has few
differences and working towards pages with more and with different kinds of alteration.
