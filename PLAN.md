# Book Compare — the plan

Last revised: 20 November 2026.

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
4. **Difference view**, as it already works, **and the movement map** ("how far was every part of this copy moved to fit the reference?") with an automatic "possible shift here" hint and a "rough alignment only" view. Reason: tile alignment bends a copy so much that a line of notation that was only shifted becomes invisible (§4.4, tests of 15 Nov 2026; register V16).
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

**Music tests (15 November 2026)** — scripts `research/js/music_pair.js`, `shift_test.js`, `dump_field.js`
(scans never in the repository). Reference copy CH-E (group A); every number is "share of ink without a
partner within 1 px" after tile alignment.

- *Test A, re-set folios 7r, 7v, 9r, 9v (apparatus pp. 199–201).* Same group: 0.3–2 % (7r: D-ARk, D-FUl, US-CA;
  7v: 1.6–8 %, the high values come from a dark scan edge at the top; 9r/9v: D-Rs, F-Pm 0.4–3 %). Other group: 44–50 % on 7r and 7v
  (D-Rs, F-Pm: the page is "almost completely set differently"). The re-set voices show as red/blue ghosts, nothing was bent into a false
  match, the unchanged voices match, the single lower Sextus system on 7v (it stands lower in group A) shows as two displaced copies.
  On 9r/9v the unchanged top voice matches in all copies and only the re-set voices and the stems pointing the other way differ.
  Two B copies against each other: 1.3–1.7 %.
- *Same-group control, f.8r and 8v (all copies group A):* 0.2–2.4 % everywhere, i.e. no invented differences.
- *f.19v (A1 against A2):* CH-E against F-Pm and D-Rs, 0.6 %.
- *Possible error in the printed lists:* on 9r and 9v D-ARk matches D-FUl and US-CA (0.3–2.2 %) and differs from CH-E, D-Rs
  and F-Pm (14–28 %). The printed lists put D-ARk in group A, those of 10r and 10v put it in B, and the list for 9r has only 19 copies
  (CH-FF missing). **Confirmed by the owner (15 Nov 2026): an error in the critical apparatus.** D-ARk belongs in group B on 9r and 9v;
  the appendix (p. 368) has it correctly. (CH-FF lacks f.8 and f.9, so it is in neither group there.)
  **Rule for the future:** when a grouping looks wrong, (1) check the appendix (pp. 365–386), which groups pages by printing sheet,
  (2) check the suspect copy on the other pages of the same sheet, which normally carry the same grouping (f.9 and f.16 are on one
  sheet, 2nd quaternion, first sheet).
- *Test B, artificial shift (8r, one system moved, CH-E against F-Pm):* a shift of 4–32 px (3000 px working height; the distance between two staff lines is 39 px, so 32 px is 0.8 of a line space) is
  fully absorbed: 0.6–2.4 % unmatched after tile alignment (28–63 % without). 48 px (1.2 line spaces): 7–11 %, 64 px (1.6 line spaces): 72 % (visible). So even a line moved by about one whole line space, which would change the pitch of every note, is nearly invisible. Even with only
  the coarsest tile level (384 px tiles) a shift of 16 px is absorbed. So **the owner's fear is justified**. The movement the alignment applied in the band equals the
  shift that was built in (within 1 px), so the information is not lost, only not shown.
- *Can the shift be detected automatically?* Comparison of the movement in a band of 350 px with the movement in the 150 px above and below: it equals the shift
  (4.3 px for 4, 7.8 for 8, 14.7 for 16, 30 for 32), but on real, correctly matching pairs the same measure reaches 2–10 px (up to 14–19 px on some pages with strong paper warping, e.g. 9v). So: usable for shifts of about 15 px and more
  (0.4 of a line space), unreliable below about 10 px, where it would raise false alarms.
- *Melopoiae pairs 05 and 09:* the clef and flat differences of pair 05 (C against A and B) and the two single notes (6:7 and 7:8) show in the overlay.
  The "notes slightly too low" differences of pair 09 (A-Wn1 against B-Br) are NOT visible (1.7 % unmatched, same as the control B-Br against DK-Kk, 1.5 %) and not in the movement map either (patchy 0–12 px
  everywhere from paper warping): small shifts of notes against their staff are lost in the alignment.

Consequence for the design: the movement map is not a luxury. It is part of version 1, with the display of the rough alignment (unbent) next to it; the
automatic hint must be cautious (only clear, sharp-edged movements of about 15 px or more, shown as "worth a look", never as "no shift"). For small
shifts (a few pixels) the overlay and the map cannot be trusted; a more specific measurement (notes against their own staff) would be needed, which is research beyond version 1.

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

- It measures the alignment Book Compare has today and, with a tick box that is on by default,
  the new tile method too (in the background, the page does not freeze). So it can be measured
  again at any time and on other people's computers.
- The "opening the scan" figures do **not** change when the alignment method changes. That
  half of the numbers is permanent knowledge. An external drive affects only this column.

**Result on the owner's PC (20 November 2026)** — Edge, Windows, 8 processor threads, 8 GB or more;
f.4r, CH-E as copy 1 against 9 copies from 1.5 to 37 megapixels (D-FUl, D-Sl, D-ARk, GB-Lbl2, F-Pm,
A-Wn, D-Mbs, SK-Mmf split page `00006_R.jpg`, D-Tu `10014.jpg`); scans on his internal D: drive.

- **Tile method: median 6.1 s per additional copy (5.7–7.1 s), 8 of 9 under the 10 s target.** Of that,
  the tile step about 3.1 s whatever the size, the rough step 2.1–3.1 s, opening and ink map 0.3–1 s.
  Copy 1 is prepared once per page: 2.6 s (printed area 2.1 s).
- **The one copy over target, F-Pm (13.0 s), is a re-set page:** on f.4r F-Pm is in group B and CH-E in A1
  (`Dissertation_Verlag.pdf`, p. 197). The rough step needed 9.5 s instead of 2–3 s, most likely because its
  refinement (ECC, up to 300 rounds per stage) does not settle when the pages disagree. The result is right:
  15.9 % unmatched ink after the tiles, against 0.2–2.0 % for the others, i.e. the differences stay visible.
  → engine fix A7 (done 20 Nov, next bullet).
- **A7 done (20 Nov, `research/js/rough_align.js`, worker rebuilt):** the refinement of the rough step now stops a round
  when it improves the match by less than 0.0001 (it was 0.000001). Before, it ran about 60 rounds of 55 ms in each of the
  three whole-page stages when the pages disagree. On Claude's computer (not his PC): F-Pm rough step 11.1 s → 4.4 s,
  D-Rs 7.6 s → 4.4 s, A-Wn 3.5 s → 2.2 s; unmatched ink after the tiles the same or slightly better (F-Pm 16.0 → 14.9 %,
  D-Rs 21.5 → 21.5 %, others unchanged). The stop is a count of rounds, not a clock, so the result is the same on every
  computer. All earlier checks give the same result (`check_known_differences.js`, 8 cases; the values moved by at most
  0.2 percentage points). To be confirmed on his PC in the next speed test (expected: F-Pm about 7–8 s in total).
- **A1–A5 done (20 Nov 2026, `research/js`, worker rebuilt, service worker v22).** Each was tested against every earlier check (11 cases and 95 assertions now, 77 earlier assertions
  unchanged; the values moved by at most 0.2 points) and against its own new check.
  - **A5 memory:** every step that makes Mats now frees them also when it fails (a list of Mats, `scope`, in `printed_area.js`; `test_memory.js`). Six failing
    pages ("box too small") grew the WebAssembly memory by 405 MB before, 0 MB now; normal pages 0 MB as before. **Limit found: OpenCV.js itself loses about
    17 MB inside every FAILED call of its ECC step** (C++ exceptions do not clean up there), which our code cannot free. So V8 must restart a helper that has grown
    too large (for example above 1.5 GB) and not rely on freeing alone.
  - **A4 border-safe box:** second candidate box = same procedure with the outer 5 % of the picture ignored; taken when the standard box touches two or more scan
    edges or holds 8 % less ink than the second one (the standard box cuts through print). Where the standard box is right nothing changes (every other scan measured: boxes
    equal or a few pixels apart; Antiphonarium, Opusculum p.20, Liber f.4r/f.8 stay). Opusculum B-Br: the standard box was a fragment on 30 of 79 pages and the whole scan on
    28; now 13 of 13 test pages get a sensible box (36–66 % of the page), and the seven pages tried against D-Mbs (p.9, 11, 14, 19, 22, 29, 56) give 0.8–1.5 % unmatched ink
    (before: "box too small" or 30–90 %). A lowest-threshold lesson: 25 % more ink was too strict (p.16 lost its heading and first system at 14 %), 8 % works.
    The Munich counterpart of the Antiphonarium page is not staged, so that pair was not rerun; its box is identical with and without the new rule (so 0.6 % stays).
  - **A1 sparse staves:** the box is stretched over staff systems that hang on it. The first version (every row of the page with a long line) reached the dark page edge and
    made Liber f.8 D-ARk against US-CA worse (1.1 % → 9.8 %); the version adopted counts only thin rows (a run thicker than 12 px is a dark band, not a staff line) and follows
    them only while the next one is within 3 % of the height. It leaves the Antiphonarium box as it is (the old `STAFFBOX=1` made it worse, 0.6 → 12.4 %). On Canti C / Odhecaton
    pages it changes little (one of nine pages tried), which is cautious on purpose; **Canti C B4r (half-page box) is solved by A4**, not by this.
  - **A3 near-empty page:** if the ink is below 2 % of the whole picture, in the reference or in the other copy, only the rough alignment is used and the result says
    so (`sparse`, `ink_density`). Real pages: 4–15 % (the emptiest, Canti C p.7, 1 %); a test page with one strip left: 0.5 %. The share is taken over the picture, not the box,
    because the box shrinks around whatever is left. **Odhecaton F8r (Paris 097 against New York 095; two pages off, as noted) is NOT near-empty by ink (it has full staves, 9.6 % of
    the picture) and is not caught:** the box is right now (no more "box too small"), rough alignment leaves 30.7 % unmatched, tiles 5.8 %, movement median 7.7 px, 48 % over 8 px
    (a normal pair: 0.9–2.4 %, 1.6–3.9 px, 1–14 %). The number of matched tiles (98 %) does not tell it apart either. So F8r stays a case for the shifted-page / movement-map
    items (B2, B4), not for A3.
  - **A2 items in the margin:** a step after the tiles finds every ink blob outside the box (not within 60 px of the scan edge, not a speck, never touching the box) in the other copy
    within ±60 px by template matching (correlation at least 0.5) and moves that patch onto its place; an item that is not found stays (a real difference). A wider tile ring alone did not help
    (the signature is too small for the tiles: 98 % unmatched at ring 2, 6, 12 and 25 %). Odhecaton H1r signature (lower right of the page, outside the box), Paris against New York / Washington:
    100 % / 98 % unmatched before, 26 % / 28 % now (the letter differs a little between copies). Seven margin items were looked at on that page, one moved (34, −50 px).
  - **New checks in `check_known_differences.js`:** case 9 (13 assertions: the box of 11 Opusculum B-Br pages, Antiphonarium, Liber f.4r D-FUl), case 10 (near-empty page, 2), case 11 (H1r
    signature, 2). `align_chain.alignPair` now also returns `sparse`, `density`, `margin`; the worker returns `box_which`, `box_why`, `sparse`, `ink_density`.
  - **Found on the way, not fixed:** (1) a mismatched pair (Paris 097 against New York 097, a different page) needed 97 s for the rough step, because ECC runs to its limit when the
    pages share nothing; a cap on rounds when the first stage correlates badly is the next speed item (call it **A8**; matters for V8, where wrong page numbers will happen). (2) `new cv.Mat(h, w, type)`
    is not zeroed in OpenCV.js: a mask must be created with `cv.Mat.zeros`. (3) A view on a Mat's data (`.data`, `.data32F`) taken before another Mat is created can become empty when the WebAssembly memory
    grows; take it after the last allocation. (4) `copyTo` into a region of a Mat wrote nothing in OpenCV.js; plain array copies are used.
- Opening a scan is fast on this PC: under 1.3 s even for the 37-megapixel split SK-Mmf page (the
  unsplit 70-megapixel double page could not be opened in the earlier test on Claude's computer).
- Today's alignment: 2.1–3.5 s per pair, but the page freezes for up to 3 s each time.
- What it means for a whole book, one worker: one copy of the Liber (544 pages) about 55 minutes;
  all 19 against copy 1 about 17 hours. The PC has 8 threads and one copy uses one, so several copies at
  once (V8) could cut this several times; **measured 20 Nov (T2b): about 3.5 times with 4 helpers, 4.2 times with 8** (below).
- **Several at once, measured on the owner's PC (20 Nov 2026, T2b; Edge 157, 8 threads, 10 copies of f.4r, 16 jobs per run, each job =
  prepare the page of one copy + align the same page of another copy onto it, helpers take the next job from a waiting line):**

  | Helpers | all 16 jobs | per pair | faster than 1 | median job | longest delay of the page |
  |---|---|---|---|---|---|
  | 1 | 134.8 s | 8.4 s | 1.0 × | 8.5 s | 18 ms |
  | 2 | 69.5 s | 4.3 s | 1.94 × | 8.7 s | 14 ms |
  | 4 | 38.1 s | 2.4 s | 3.54 × | 9.3 s | 24 ms |
  | 8 | 32.0 s | 2.0 s | 4.21 × | 15.6 s | 15 ms |

  Nothing failed (no memory problem up to 8 helpers with scans up to 37 MP); the page never stood still (longest delay 24 ms); loading
  8 helpers took 0.8 s. 1 → 2 → 4 helpers scales almost perfectly (1.94 ×, 3.54 ×); from 4 to 8 only 19 % more, and each single job
  takes 1.8 times as long (8.5 → 15.6 s): the 8 threads are most likely 4 real cores with 2 threads each, so the last 4 helpers
  mostly wait for each other. **Decision for V8: default number of helpers = half the processor threads (4 here), at least 1, at most
  the number of threads minus 2; an "all threads" choice may be offered for an overnight run (4.2 × instead of 3.5 ×); the rest of the
  PC stays free for other work.** Not measured: scans over 37 MP (the unsplit 70 MP double pages), memory use in the browser, the
  gain when one reference page is reused for several copies (should be better than here, where every job prepares its own reference).
  Rough estimates for the Liber (544 pages): one copy against one other copy (every job prepares its own reference) 76 minutes with
  one helper, about 21 minutes with 4; all 19 copies against copy 1 (the reference page is prepared once and reused for the copies of
  that page, so about 6.1 s per pair): 17 hours with one helper, about 5 hours with 4 (4.2 hours with 8).

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

### 4.7 The reference copy — confirmed by the owner (20 November 2026, D1)

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

### 4.8 The desktop program — Electron (decided 20 November 2026, D3)

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

*Decided by the owner, 17 Nov 2026:* the grouping tool **suggests nothing**; the user groups the copies himself.
Recorded facts (16 Nov): every page of the Liber was printed twice (two formes); his groups cover both formes of a page together;
copies are grouped only by changes made to the formes, not by registration (misregistration is shown in the movement map, V16,
but creates no groups); groups are most often equal across a whole sheet, second most often across one side of a sheet.

*Ideas for after version 1, to be discussed then (the owner thinks they may be too complex for Book Compare):*
1. Record the structure of the book (gatherings, sheets, sides of sheets, pages).
2. Show that structure in the navigation.
3. A view of the groups across gatherings, sheets, sides of sheets and pages.
4. Only then: point out a grouping that looks suspicious (e.g. one copy in a different group on one page while it agrees
   with the rest of its sheet, as with D-ARk on 9r/9v), so the user can check for a mistake. Never change anything itself.

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
script of his own, which is a stopgap for his own work and **not part of Book Compare** (it was
removed from the project on 19 Nov 2026; it stays in the git history, commit before 19 Nov). Later Book Compare should do this itself. The grid was already
designed for it: a cell can be a region of a file rather than a whole file.

### 5.6 Further out

- Other visualization modes, where they prove useful. The candidate is a mode with offset
  arrows, and it only makes sense once alignment is settled.
- Quality dots per row, and the rough wrong-page check before full alignment.
- Making the app look more pleasing. Surface only, and last.

### 5.7 Finding the subtle differences — owner's idea, 21 November 2026

**The problem (owner).** The obvious changes (a re-set line, a replaced woodcut) are visible
without Book Compare. Its real value lies in the small ones, and those are still easy to miss:
"Conradus" against "Couradus" changes the meaning, but on the page it is the difference between
a u and an n, a few dozen pixels. In the Difference view it shows as two thin slivers of colour,
and the page is full of similar slivers caused by inking, worn type and paper. The eye slides
over them. The aim: methods that point the user to such spots, and a way to measure how many
of them each method finds.

**Step 1: research what is already known.** The owner suspects that this exact problem has been
studied, and it very likely has. To look into: the optical collators of descriptive bibliography
(Hinman, Lindstrand, McLeod and later ones) and why they rely on flicker and superimposition; digital
collation of early prints; Aruspix (superimposition and recognition of early printed music); OCR of
early printed books followed by a text comparison; and "change detection" in other fields
(astronomy's blink comparator, document forensics). The result is a short written overview with
sources, before anything is built.

**Step 2: test pages with planted changes (owner's idea).** Take the same page in two copies that
are identical in their original state (the owner has scans of the *Ligurinus*, bound with
the *Melopoiae*: much ordinary text). In one of the two, single letters are replaced by similar
ones, the kind of change that is common in the *Melopoiae*. Then measure: how many planted changes
a method finds, and how many false alarms it raises per page.
- The replacement letters are cut from **elsewhere on the same scan** (same type, same ink,
  same paper), never typed in a computer font, so that the test is honest. A turned letter (n
  for u) is a letter of the page turned upside down.
- Two kinds of test pages: many made by a small script of mine (it records what it changed,
  where), and a few made by the owner in Photoshop **without telling me where** (a blind test,
  so that no method gets tuned to answers it already knows).
- The first measurement is the owner looking with today's Difference and Toggle views: that is
  the baseline every new method has to beat.
- The test also checks the alignment: the tile alignment may bend each part of the page by up
  to 1.5 px (§10: known differences get smaller the more it may bend). A planted change must
  survive the alignment.

**Step 3: a catalogue of subtle differences**, to decide which ones the test pages must contain.
Owner's starting list: u/n, l/I, n against a turned u. Further suggestions, to be checked by the owner:
- *Text:* c/e; long s/f (they differ by a crossbar); rn/m; turned letters in general;
  an abbreviation mark (tilde or macron over a vowel) added or missing; i with or without its dot;
  comma against full stop, punctuation added or missing; a ligature against two separate letters; a
  letter from another font of type; spacing and hyphens.
- *Music (owner: hard to think of; suggestions):* a stem added or removed (breve against long, the
  owner's example); stem direction (already in the ground truth: Liber f.19v, stems of 3:12–20); a note
  one step higher or lower (also in the ground truth: f.19v, the semibreve 6:16 on G in A1 and B but on F
  in A2); a dot added or missing (dot of addition, dot of division); a rest that hangs from a line against
  one that stands on it (semibreve against minim rest); mensuration signs (O against C, with or without
  a dot or a stroke); stems on ligatures, which change the note values; flats and other accidentals;
  the position of a custos; fermatas and signa congruentiae.

**Step 4: methods to try against the test pages** (ideas, not decisions):
- *A difference finder:* after alignment, look for small, compact spots of the size of a letter
  where ink is present in one copy and missing in the other; rank them; show them as a list of
  small pictures the user steps through (this is C4, the jump list). The hard part is separating
  real changes from print noise. With many copies there is a strong help: noise is different in
  every copy, while a real variant appears in exactly the same place in a whole group of copies.
- *Letter by letter:* cut out every letter and compare it with its partner in the other copy.
  A u against an n then gets a poor match score, even though few pixels differ.
- *Reading the text:* OCR made for early printed books on both copies, then a text comparison
  ("Conradus | Couradus" becomes a word difference). OCR makes mistakes, but it only has to
  point to the places where the two readings disagree; the user then looks at the picture.
  For music the same idea would use music recognition (Aruspix recognises early printed music).
- *Better looking:* the old collators' principle that the eye catches flicker more reliably
  than a still colour difference: a magnifier with Toggle that follows the list from spot to
  spot.

No method will find everything. The test pages say honestly how much each one finds, and
the help text says it too.

### 5.8 The launch — owner's idea, 21 November 2026

**When:** after version 1, after one outside person has installed it (§5.3) and with a DOI
(§5.2). People should find a download page (a release on GitHub with the installer) and a way
to cite it. Before the launch, decide about signing the installer (V5d): unsigned, Windows
warns "unknown publisher", which puts many people off. Signing costs money (a certificate or a
signing service, yearly or monthly), so this is the owner's decision.

**Where (owner):** academia.edu, LinkedIn, Xing, Facebook. **Suggestions to check before the
launch** (which ones still exist, and whether announcements are welcome there):
- Musicology and music libraries: AMS-L (American Musicological Society), IAML and MLA-L (music
  libraries), the Gesellschaft für Musikforschung, the Medieval and Renaissance Music Conference.
- Book history and rare books: SHARP-L (Society for the History of Authorship, Reading and
  Publishing), ExLibris-L (rare-book librarians), bibliographical societies.
- Digital humanities: the Humanist discussion group, DHd (Digital Humanities im deutschsprachigen
  Raum), H-Net networks.
- Bluesky and Mastodon, where many scholars are now.
- The libraries whose scans appear in the examples (and whose digitised copies the program is for).
- A short article later, e.g. in the Journal of Open Source Software or *Fontes Artis Musicae*.

**The demonstration, without AI (owner: many people dislike AI-made videos).** A real
screen recording of the real program, with the owner's own voice, or with captions he writes:
nobody can mistake that for an AI video.
- Tools: OBS Studio (free) or the screen recording of the Windows Snipping Tool; cutting with a
  simple editor (Shotcut is free; Clipchamp comes with Windows).
- One to two minutes: the question (two copies, where do they differ?), open a project, the page
  grid, COMPARE, a real variant in the Difference view, the same in Toggle (flicker), done. Real
  examples from the owner's research (the Liber f.19v stems, a *Melopoiae* variant).
- Three or four screenshots, and an animated picture made with Book Compare's own GIF export (Toggle).
- Captions in the video: on LinkedIn and Facebook videos often start without sound.
- Say plainly how the video was made.
- **To decide: how to speak about AI in the program itself.** Book Compare's code was written
  with an AI assistant. Some readers will ask. Openness (a line in the README and the
  acknowledgements) is the safe way. What can be said with full confidence: Book Compare's
  *results* involve no AI. The alignment is classical image processing (template matching, ECC,
  tiles): the same pictures always give the same result, and every step can be checked.
- I can help with the storyboard and script, the texts for each platform, the screenshots, and the
  release page.

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

**Further prints for testing the alignment (agreed 16 Nov 2026; the owner is looking for digitized copies):**
- *Petrucci, Odhecaton A, Venice 1504* (mensural, several impressions). Only 1504 copies against each other.
  **Ground truth: Boorman, *Ottaviano Petrucci: A Catalogue Raisonné* (Oxford UP 2006), No. 14, pp. 543–548** (owner's copy:
  `Example pages\Secondary Literature with lists of differences between copies`). Item "In-house corrections" lists stop-press
  changes and corrections made after printing, folio (by signature).stave.note, with the copies concerned: F-Pc (Rés.538, now
  BnF), I-TVcap, US-NYp, US-Wc (M1490.P4 Case). Mostly small: folio numbers, a signature, inverted letters, one word; a few
  notes stamped in or erased. **US-NYp: the outer sheet of gathering F (F1, F2, F7, F8) is from the 1503 edition** = a re-set
  sheet, like Test A. Boorman warns his lists are not complete (p. 456). Hewitt (1942) and Pugin (2018) give no list of
  differences between copies of one edition (owner, 17 Nov).
**Odhecaton A (1504) alignment tests — first results (17 Nov 2026).** Copies F-Pn (Paris, small scans, ~1000 px), US-Wc
(Washington, ~1300 px, dark binding border) and US-NYp (New York, large scans). 21 pages from gatherings A, D, F, H, K, L, N,
chosen from Boorman No. 14. Scan page = idx + 3 (Paris, New York) or idx + 7 (Washington), idx = 16·gathering + 2·(leaf−1) (+1 verso).
- Same setting, different scan quality: 1–4 % unmatched ink (e.g. Paris–Washington A1v 1.1 %, K3v 2.1 %). The small Paris scan
  aligns as well as the large ones; even upsampled about 3× nothing bent.
- **The New York scan set is shifted by one leaf (2 scan pages) from gathering F onward** (colophon at idx 204, in Paris at 206;
  one leaf missing or skipped in the scan sequence, between gatherings D and F). Compared with the unshifted pages the result was
  29–43 % unmatched ink; with the shift corrected 0.8–2.9 % (H2r 1.0, H5v 1.8, K3r 2.9, K3v 2.5, L4r 1.3), i.e. as good as Paris–Washington.
  Gatherings D (and earlier) have no shift. The re-set outer sheet of F (F1, F2, F7, F8) stays different: 4–8 % even when shifted.
- A reference scan with a dark border (Washington) breaks printed-area detection: always use a clean-border scan as reference.
- Weak spots: (1) "box too small for this level" error on pages with almost no ink (blank staves, e.g. F8r); (2) the printed-area box
  clips the margin, so page numbers and signatures at the edge are not shown and headlines on the edge are only partly shown
  (H5v headline); (3) a few red/blue specks at 1–3 % are normal scan noise, not differences.
- Not yet done: small Boorman differences (page numbers, signature, single notes) were only partly checked visually; Canti C next.
- *Petrucci, Canti C, Venice 1504* (Boorman No. 12, pp. 525–534): stop-press changes of notes and folio numbers, many
  stamped-in and erased notes; copies A-Wn, F-Pc, I-TVcap. Other Boorman entries with listed stop-press changes: No. 4
  Josquin, Misse (p. 479), No. 7 Motetti B (p. 499), No. 11 La Rue, Misse (p. 518), No. 13 Agricola, Misse (pp. 536, 541).
**Canti C (1504) alignment tests — first results (17 Nov 2026).** Copies A-Wn (Vienna) and F-Pn (Paris), both small scans
(about 1400 × 1050 px, 200–300 KB each). 21 pages chosen from Boorman No. 12 (pp. 525–527). Scan page = idx + 3 (Paris) or idx + 9 (Vienna),
idx = 16·gathering + 2·(leaf−1) (+1 verso), gatherings A B C D E F G H J K L M N O P Q R S T V X. No page shift in either copy.
- All 21 pages align (1–7.5 % unmatched ink; 1–3 % on the cleanest pages). Strip values of 8–18 % always sit where something really differs
  or at the page edge. The Vienna scans show dark binding edges, so Paris was the reference.
- Detected clearly at this resolution: **L1v.iv.9–10** (changed notes, stave 4) and **R8r** final chords (staves 5 and 6; F-Pn differs from A-Wn,
  as Boorman describes).
- **Folio numbers: visible once the margin is shown** (second run, `PAD=0.15`): B4r Paris "21" against Vienna's handwritten "12", T3r "1047"
  against "147", T5r "1049" against "149" — all exactly as Boorman says. In the first run they were cut off by the research overlay's crop
  (not by the app, which shows the whole page).
- **O4v.iv.19–22** (changed notes) is also found, at the stave and note position Boorman gives. D3v.i.1, C4r.iv: still not confirmed.
- **New weak spot found: the printed-area box can cover only part of a page.** On Canti C B4r the box began at about half the page height;
  the two top staves were outside it and stayed unaligned (red/blue doubling). Cause: staves are removed as "lines" and sparse staves
  vanish. Fix tried: stretch the box over every row that is mostly ink across the box width (`extendBoxByStaves` in printed_area.js,
  switched on with `STAFFBOX=1`). B4r then aligns over the full page (4.3 % unmatched, same as before but now for the whole page).
  Three of 21 Canti C pages (B4r, F1r, O4v) and several Odhecaton pages had suspiciously small boxes.
- Marginalia are found as differences, too: a drawn manicule in the Paris margin (Odhecaton H5v) and Vienna's handwritten folio number.
  Useful for readers, but they should be nameable as "later addition", not as a change to the printing forme (see 5.1).

**Consolidated findings and plan from ALL tests (17 Nov 2026; agreed with the owner).**
What the tests showed, across Liber, Melopoiae, printed-area set (116 scans), page matching, Odhecaton A, Canti C:
- Same setting 0.2–4 % unmatched in every print and at every scan size; re-set pages 30–50 %; nothing bent into a false match.
- Small scans (1000–1400 px wide) align as well as 3000 px; single-note changes stay visible on them. Limit: very thin lines
  (woodcut crack through Mercury's chest). **No resolution warning, and the grid does not show resolution (owner, 17 Nov).**
- Shifts up to about one staff space are absorbed (V16); shifts of a few px cannot be detected at all.
- The printed-area box is the weakest step: misses sparse staves (Canti C B4r/F1r/O4v, Odhecaton, US-CA, CH-E f.158v, D-FUl,
  CZ-Jm — probably one cause); dark binding edges/scan borders (US-Wc, A-Wn Canti C, Liber 7v); margins (folio numbers,
  signatures, headlines, marginalia) only carried along, not aligned; near-empty pages fail ("box too small", Odhecaton F8r; D-W title).
- Page order in scan sets cannot be trusted (US-NYp Odhecaton from gathering F; D-ARk versos in the Liber). High mismatch alone
  cannot tell a shifted page from a re-set page; only comparison with neighbouring pages can.
- The unmatched-ink figure is orientation, never a verdict (ranges overlap). Handwritten additions show as differences.
  Printed lists of differences contain errors and gaps. OpenCV.js runs out of memory in long runs.

Plan (IDs used in the register, §11):
- **A — alignment engine** (A1 box extended over sparse staves; A2 align a margin around the box; A3 near-empty page → rough
  alignment only, said so; A4 dark borders must not distort the box; A5 release memory per page in long runs (**A1–A5 done 20 Nov**, next to the A7 bullet in 4.5); **proposed 18 Nov:** A6 ink choice dark / red / both; **A8 proposed 20 Nov:** cap the rough step when the first stage correlates badly (97 s on a mismatched pair); **A7 done 20 Nov:** the rough step stops refining sooner when the two pages disagree — F-Pm f.4r took 9.5 s instead of 2–3 s, §4.5). Each must keep every
  check that passes today. **Done only AFTER the tests D (owner, 17 Nov: the tests may change A).**
- **B — what the user sees, version 1**: B1 box visible and correctable (see V2b); B2 **small shifted-page warning** (owner: version 1):
  when a page matches badly, compare with the copy's neighbouring pages and, if one fits clearly better, suggest moving the column
  with the existing gap tools; B3 reference proposal prefers clean borders and reliably found boxes (V7); B4 movement map (V16);
  B5 help text on what cannot be seen; B6 tile settings per page (V15). **Proposed 18 Nov (owner to decide, see the lessons in §10):** B8 show-margin control (**decided, version 1**, owner 18 Nov). B7 jump list moved to C4 (after
  version 1); B9 page-offset list dropped (the page grid does it).
- **C — after version 1**: C1 handwritten additions as "later addition" (5.1); C2 book structure (5.1 idea 1); C3 suspicious-grouping hint; C4 jump list of the strongest difference spots (B7; owner 18 Nov, after version 1, mock-up seen).
- **D — tests first (D1–D5 all done 18 Nov 2026, results and lessons in §10)**: D1 remaining Boorman items — partly done 17 Nov, see results (Canti C D3v.i.1, C4r.iv; Odhecaton A1v, A7v, D1r/D7r, D2v, F5v, H2r signature,
  H5v "e", L6r, N4r.iv.33, N8r); D2 artificial shift on a small scan (does the V16 hint hold?); D3 Liber B copies of f.8r/8v;
  D4 chant print (noise floor, artificial changes, red ink; material below); D5 add Odhecaton/Canti C pairs to
  `check_known_differences.js`. Also during D: (a) which tile settings start hiding known differences (sets the safe range for B6);
  (b) whether leaving out a dark border with a four-cornered area fixes the US-Wc/A-Wn reference problem; (c) note every page where
  box and tile settings both fail (decides on matching points, V17).

**D4 material (17 Nov 2026).** A survey of vdm16, ISTC, GW and library catalogues found no chant print with full scans from
more than two or three institutions except the one below; most German chant prints are online only at BSB.
- **D4a — Simon de Quercu, *Opusculum musices*, Nuremberg: Johann Weissenburger, 1513 (vdm 407).** Five copies, owner's folder
  `D:\Opusculum musices. Digitalisate`: B-Br (≈2400 × 3250 px, colour), D-Mbs (≈1750 × 2470, colour), A-Wn (1240 px wide), D-B
  (1000 px wide), US-Wc (greyscale, two-page openings, must be split). All five checked: same imprint ("Dns Joan. Weyssenburger
  Nurenberge impressit"), 1513 colophon page in the four copies whose scans include it. 34 leaves, 68 pages; A-Wn seems 2 pages short, US-Wc seems to end
  before the last leaf (map pages by content). Woodcut chant and mensural examples, black staves; red print on the title page
  only. Known copy marks: hand-coloured title woodcut (D-B), handwritten notes under the colophon (A-Wn), handwritten note on a
  "De Tonis" page (US-Wc), stamps, strong show-through (D-Mbs). Plan: B-Br as reference, all pages of the other four; artificial
  changes on music pages; red title text against the greyscale US-Wc scan.
- **D4b — *Antiphonarium Augustense*, Augsburg: Ratdolt, 1495 (ISTC ia00773000, GW 2062).** Hufnagel notation on **red staves**,
  red rubrics, red/black initial — the red-ink weak spot. Only one page has two copies: printed fol. I ("Antiffanarium per
  circulum anni"), Bodleian Inc. c.G5.1495.1 (single page online, labelled "a3 recto", 2073 × 2857 px, ruler and dark border
  in the scan) and D-Mbs 2 Inc.c.a. 3159 (BSB image 0013, 4340 × 6026 px, fetched from the BSB IIIF server and saved in the
  owner's folder `D:\Antiphonarium Augustense. Ratdolt 1495. Digitalisate\D-Mbs`). Tests: noise floor on red staves; an
  artificial shift of the red staves against the black notes (the ink map in the red channel should not see it — confirm and
  measure); dark border and ruler (A4, four-cornered area).
- **D4c — *Graduale Romanum*, Venice: Emerich for L. A. Giunta, 1499–1500 (GW 10982, ISTC ig00332000).** Square notation on
  red staves. Three digitized copies in the owner's folder `D:\Graduale Romanum. Giunta. Digitalisate`: Venice Marciana
  (≈1085 × 1496 px), Vatican Inc.S.244–245 (≈1650 × 2300), Vatican Stamp.Ross.1857 (vellum, ≈1625 × 2338). Four common
  pages (CCXIXr, CCXIXv, CCXXr, CCXXv) in all three; CLVr, CLVv, CLVIr in both Vatican copies.

**D tests — results so far (17 Nov 2026, Sonnet).**
- **D4c Giunta (15 pairs, Vatican Inc.S.245 as reference).** Pages that are really the same align cleanly: Vatican 1 – Marciana
  CCXIXv 0.8 %, Vatican 1 – Rossiana CCXIXv 1.2 %, the three CLVr/CLVv/CLVIr pairs (Vatican 1 – Vatican 2) 0.4–0.5 % (CLVr 6.1 %:
  the page edge), CCXIXr 9.5–10 % and CCXXr 9–11 % (the hand-painted initial in Marciana and Rossiana against the woodcut
  initial in Vatican 1 shows as a large red/blue area, as it should). **The lower part of CCXXr and CCXXv differs between ALL three copies** (strip values 12–55 %, whole page 9–20 %): on
  CCXXv Rossiana has other text ("Ostendat faciem suam…"), Vatican 1 and Marciana have the same text ("Quam dilecta
  tabernacula…") but set with different line breaks. Corrects an earlier note: Marciana and Vatican 1 do NOT agree here.
  In every copy the text block of this part sits on a visibly lighter rectangle of paper, so these may be printed slips
  pasted over the page (to be checked by the owner on the originals). Red staves are not seen by the ink map and cause no problem when the notes and text align. The
  red watermark/copyright strip of the Vatican images shows as a small difference at the page edge.
- **D4b Antiphonarium fol. I (Bodleian against D-Mbs, both directions).** 0.6 % unmatched ink with the default box (very clean,
  although the Bodleian scan has ruler and dark border and the red staves are invisible to the ink map). **`STAFFBOX=1` made it
  WORSE (12.4 %, red/blue bands at the top and bottom edge): the stretched box reaches into the headline and the margin. So A1
  must not simply switch `extendBoxByStaves` on for every page.** Artificial changes to the red layer of the Munich scan: red
  staves shifted by 14 px: 1.7 % (nothing visible); red staves removed completely: 0.0 %. So **a difference that exists only
  in red ink (staves, rubrics, red initials) cannot be seen at all by the engine** — to be said in the help text (B5).
- **D4a Opusculum musices (five copies).** Page map (B-Br page n = D-Mbs and D-B scan n − 1; A-Wn n − 1 up to Br page 13,
  then n − 3: the A-Wn scans lack two pages after Br page 13; US-Wc: two-page openings with a black background, bitonal).
  **First run with B-Br as reference: 66 of 202 pairs failed ("box too small", 22 of 68 pages, the same pages in all three
  copies) and of the 136 that ran, most showed 30–90 % unmatched ink. Cause: the dark gilt/black border of the Brussels scans
  confuses the printed-area box.** Second run with D-Mbs as reference (15 sampled pages, 45 pairs, none failed): B-Br 0.6–3.2 %
  (median 1.0 %) on all 15 pages; D-B and A-Wn 5–27 % (median 9 %). In D-B and A-Wn staves and notes align, but several captions
  ("Tenor", "Discantus", "Exemplum … notulis") stand slightly apart in the same way in both copies, so they look like a real
  variant group. **Page 30 differs in layout: D-B and A-Wn (and US-Wc) agree with each other (US-Wc left page against D-B 5.1 %)
  and differ from D-Mbs and B-Br (26–28 %).** The black-and-white US-Wc scan with its black background aligns well once the
  reference has a clean border and the opening is split into single pages. Lesson for B3 (reference proposal) and A4: the Brussels
  scans are unusable as reference; a reference should be proposed by border cleanliness and a reliably found box, not by size.
- **D2 artificial shift on small scans (Canti C Q4r, F-Pn against A-Wn, both ≈1050 px high, one system moved).** Control 1.5 %;
  shift of 8 / 16 px sideways: 1.6 / 1.7 % (invisible); 32 px: 4.8 %; 48 px: 4.5 %; 64 px: 25 %. Shift downward 16 / 32 px: 1.8 / 2.6 %.
  The movement the alignment applied in the band equals the built-in shift (7.9, 14.1, 25.7, 38.3 px for 8, 16, 32, 48 sideways;
  14.7, 32.7 for 16, 32 downward), so the movement map (V16) reveals it, as on the large Liber scans. Small scans behave like large ones.
- **D1 Boorman items, finished 18 Nov 2026 (Odhecaton A: Paris as reference against New York "PN" and Washington "PW", full working height of
  3000 px, `PAD=0.1 OVERLAY_SCALE=1`; Canti C: Paris F-Pn against Vienna A-Wn).** *Seen, with the location known:* A1v line 9 first word (Paris "temis"
  against "meas"); D1r and D7r page numbers (Paris and Washington agree, New York differs); **A7v system v, 14th symbol** (the white window of the
  note head is open in New York and Washington and filled in Paris: red inside the head in both pairs; Boorman: Paris in black ink);
  **D2v system iv, 13th–14th symbol** (Paris has a solid stamped head, the other two copies show blue ink smudges around and below the head, i.e. the
  erased and re-written note); **F5v, last symbol of the last system** (both pairs: a red band inside the sign and blue strokes beside it; the reading
  f/g itself cannot be read from the overlay); **N4r system iv around the middle** (both pairs: a stem and a head only in Paris, blue smudges and a
  blue flat-like sign in New York, i.e. the erasure and re-stamped semibreve; the 33rd note was not counted exactly). *Seen only weakly:* H5v
  headline "Alexander" (extra red over the "d" and the final "e" against New York only; a shifted letter looks the same); Canti C D3v.i.1 (the first
  note after the clef: the inner window and the corners of the head show a red and blue fringe in Vienna, not stronger than the fringe on the next
  head). *Closed (owner, 18 Nov):* N8r colophon. The owner read the words ("Ferosemp[ro] niensem", last words of the first colophon row) and says the first "e" is
  inverted in ALL THREE copies, so there is no difference at this spot and the tool was right to show none (at 5x the "e" looked the same in all three; Boorman says it
  is inverted in F-Pc only and corrected by a stop-press change in the others; **the scans we have do not show that**, so Boorman's note is not usable as a
  "must differ" check here; it stays a good negative control: nothing may be reported). The **signature is on H1r, not H2r** (Boorman's "Har" is the OCR of "H1r"):
  H2r carries "H ij" in Paris and New York alike. **H1r done 18 Nov** (owner staged all three: Paris Page_115, New York Page_113, Washington Page_119):
  Boorman's note reads "H1r signature: [nil] H [US-NYp, US-Wc]" (nil in the other copies, i.e. F-Pc), but **all three scans show the same small mark at the lower right
  (a gothic H with a hook; Paris 1373 px wide, so the form is only roughly readable) — no difference in this spot either.** *Owner, 18 Nov: the letter "H" is present on H1r and on H2r of the Paris copy; Boorman's "nil" is an error in his catalogue.* In the overlay (margin shown, PAD=0.35) the mark
  appears as a red/blue pair about 10–15 px apart, because it lies outside the printed-area box and is only carried along by the rough alignment: **a margin
  item that exists in both copies shows up as a false difference when the margin is shown (supports A2, B8).** What the pairs DO show on H1r is a real difference that Boorman describes
  elsewhere ("the sixth stave is increasingly seldom inked as the book progresses ... on the following rectos: G4, H1,2,4,7, ..."): **Paris prints six staves, New York and
  Washington five (three blank staves in Paris, two in the others);** the sixth blank stave is the only large red block in the overlays (strips 11–12 are
  100 % unmatched, whole page 8.2 % Paris–New York, 8.1 % Paris–Washington; the music itself matches). A real, expected difference, found without looking for it.
  *Not to be expected:* Canti C C4r.iv: Boorman lists
  that correction for F-Pc and I-TVcap, not for F-Pn or A-Wn, so the two copies here should agree (they do, 3.0 % whole page). L6r not staged.
  Seen by eye on the way: a hand-drawn mark (looks like a pointing hand) in the left margin of H5v and pen strokes in the left margin of H2r, both
  only in Paris. **How the notes were located:** by counting symbols by eye in the system band; an automatic count failed because the staff lines
  join all symbols into one blob, and automatic lists of the largest differing spots were swamped by the right-edge custos strokes, staff-line fringes
  and the speckle of the device woodcut (see the lessons below).
- **D3 Liber f.8r and f.8v, group B copies (18 Nov 2026; file names from the owner: CZ-Pu NK4134_R / NK4135_L, GB-Lbl1 K9a24_010_R /
  K9a24_011_L; the group A comparison copy is US-CA Harvard_0022 / 0023).** The two group B copies agree: CZ-Pu against GB-Lbl1 0.4 %
  (f.8r) and 1.3 % (f.8v), movement median 1.7–1.9 px, almost nothing bent over 8 px. Group B against group A (US-CA) is clearly different:
  13–17 % (CZ-Pu) and 16–31 % (GB-Lbl1, whose spread scan has a black background), movement median 8–29 px and 49–86 % of the page bent over
  8 px (CA as reference: 19 % and 18 %). Both measures separate "same setting" from "re-set" without a gap. In the overlay of f.8r the notes
  mostly agree but the first stave, the initial V, the custodes and the stems stand apart, and on f.8v the text doubles; the tile alignment
  bends hard to force a fit, so **the movement map (or the share of the page bent over 8 px) is needed as a second signal next to the
  unmatched-ink figure** (supports B4).
  **Control inside group A (18 Nov, after the owner confirmed that Harvard_0022/0023 are f.8r/8v):** D-ARk (Arnstadt 2105, fol 008r/008v, group A)
  against US-CA: 1.1 % and 1.2 % unmatched (same setting), D-ARk against CZ-Pu (group B): 20.4 % and 16.2 %. This also confirms the identification of
  the Harvard files. **But the movement of the matching A–A pair is large** (median 4.2 and 6.1 px, 28 % and 40 % of the page bent over 8 px,
  rough alignment 26–34 % unmatched), because the two copies were photographed differently; the B–B pair had a median of 1.7–1.9 px and
  almost nothing over 8 px, the A–B pairs a median of 13–17 px and 67–75 % over 8 px. So **the unmatched ink separates "same setting" from "re-set" cleanly
  (0.4–1.3 % against 13–31 %); the movement does not on its own, it only agrees when the scans are of similar quality.**
- **D5 done (18 Nov 2026): `research/js/check_known_differences.js` has four new cases** (5 Liber f.8r/8v, 6 Petrucci controls Odhecaton A1v
  and Canti C Q4r, 7 Giunta CCXIXv/CLVv/CCXXv, 8 Opusculum p. 30), switched on by a third argument (the folder that holds the digitised copies;
  the second argument may be `-` to skip the Melopoiae cases). 18 whole-page assertions (the four added on 18 Nov are the group A control pairs on Liber f.8r/8v), all pass on the staged scans; cases 1 and 4
  still pass (16 and 11); all 8 cases together: 77 assertions (73 before the control pairs were added). Single-note and margin differences (Boorman items, folio numbers) are NOT asserted yet: they need regions in pixels.
- **Extra (a), done 18 Nov 2026: what happens when the tile alignment is made stiffer.** `BC_LEVELS=n` uses only the first n of the four
  tile levels (384, 192, 96, 48 px tiles); all 73 known-difference assertions (cases 1–8) were run with n = 1, 2, 3 and 4 (= normal).
  Result: **no known difference disappears at any setting**; what the stiffer settings spoil is the matching side: matching regions stay matched only with all four
  levels: assertions failed 16 of 73 with one level, 7 with two, 2 with three, 0 with four. Examples (unmatched ink in %, levels 1 / 2 / 3 / 4):
  f.19v CH-E against D-FUl (A1 against A2) whole area 8.6 / 2.7 / 0.9 / 0.7, control system 1 20.2 / 4.5 / 0.8 / 0.6; Melopoiae p.8 B-Br against
  DK-Kk "meonii" (should match) 29.8 / 27.9 / 1.5 / 0.7. Known differences get SMALLER the more the alignment may bend: f.19v stems 3:12–20
  (A1 against B) 36 / 24 / 22 / 21, p.8 "amando" (A-Wn1) 37 / 30 / 25 / 21, Opusculum p.30 D-Mbs against D-B 42.5 / 35 / 31 / 27.5, Giunta
  CCXXv (V1 against Rossiana) 15.5 / 14.2 / 12.7 / 11.6. **Reading: the present setting (four levels, finest tiles 48 px, ±1.5 px) is the loosest
  one tested and every known difference still stands clear of its threshold (tightest margin: Giunta CCXXv Rossiana 11.6 % against > 8 %); the
  trend says a looser setting than level 4 (smaller tiles, a larger range) would start absorbing real differences, so B6 (tile settings in the
  app) should offer "stiffer" but not "looser" than the present setting without a warning.** A fifth, finer level was not tried, so the looser side is only
  inferred from the trend.
- **Extra (b), done 18 Nov 2026: a hand-set printed area rescues the dark-border reference.** Research switch in `music_pair.js`:
  `BOX=x0,y0,x1,y1` (rectangle in working pixels) or `BOXAUTO=<fraction>` (stand-in for a hand-drawn area: ignore that fraction of the image on all
  four sides, take the 0.5–99.5 % range of the ink). With `BOXAUTO=0.05` all 22 Opusculum pages on which B-Br as reference had failed
  ("box too small") now align: unmatched ink 1.9–6.6 % (median 3.5 %), page 73 13.3 %; with D-Mbs as reference the same pages give 0.4–4.1 %
  (median 1.1 %). The box found automatically on these pages was a fragment of the page (100–700 px wide on 21 of 22 pages, 1130 px on page 66); the stand-in box
  is about 1900 px wide. The extra ≈ 2.4 points come from edge marks inside the generous box, a tight hand-drawn box should close most of the gap (page 73:
  the box reaches down to y = 2778 while most end between 2430 and 2720; to be looked at). Movement statistics are as good as with D-Mbs as reference
  (over 8 px: median 2 %, pages 32 and 54 16–26 % against 11–17 % with the other reference, probably real re-setting). **Consequence for
  A4/B3: a scan with a dark border can stay reference if the printed area is set by hand (or proposed after ignoring a border strip);
  switching references is not needed.** Not tested: a four-cornered (slanted) area. **Correction the same day: the trimmed box is NOT a general rule.** On the
  Antiphonarium pair (Bodleian against Munich) it gives 24.0 % unmatched, against 0.6 % with the automatic box, because it is far too large (1752 x 2634 px
  instead of the correct 1383 x 1967 px found automatically: edge noise lies inside the percentile range). So neither box is right everywhere: the
  automatic one fails on dirty borders (Opusculum, 22 pages), the trimmed one on this page. What works in every case tested is a box that is set (or
  confirmed) by hand; for the proposal a rule is needed that says which candidate to trust (next research step: candidate boxes and a test "does the box cut
  through print?", i.e. ink just outside its edges, run on all pages of all checks).
- **Extra (c), done 18 Nov 2026: pages where box AND tile settings fail.** With the hand-set area none of the 22 Opusculum pages fails any more
  (see (b)). Canti C B4r (box covered half the page): `BOXAUTO=0.05` aligns the whole page, 2.1 % unmatched (earlier with `STAFFBOX=1` 4.3 %),
  strips 0.9–3.8 %. **Odhecaton F8r (blank staves, almost no ink) still fails in substance:** the box error is gone but rough alignment leaves 30 %
  and the tile alignment moves the copy by a median of 7 px (46 % of the page over 8 px) to find something to hold on to, result 5.7 % unmatched
  that cannot be trusted. Nearly empty pages need a warning ("too little ink to align") or alignment from the neighbouring page. Remaining list:
  Odhecaton F8r (blank staves), Canti C pages with sparse staves not retested after `BOXAUTO` (F1r, O4v).

- **Lessons from tests D1–D5 (18 Nov 2026): what did not work, what it taught, what changes in Book Compare.** Items marked *new* are
  proposals for the owner to decide; the others sharpen items that already exist (A1–A5, B1–B6, V2, V15, V16, V18).
  1. **A dark scan border broke the printed-area box** (Opusculum B-Br: 22 of 68 pages "box too small", the rest poor; also US-Wc, GB-Lbl1 spreads).
     *Learned:* a box that ignores a 5 % border strip and takes the 0.5–99.5 % range of the ink rescues all 22 pages (extra b), but fails on the Antiphonarium
     (24 % against 0.6 %), so it cannot simply replace the automatic box. *Change:* **A4** = two candidate boxes plus a rule which one to trust, and **B1/V2b**
     lets the user set or confirm the box (the reliable fix); **B3** still prefers clean borders when proposing a reference, but a dark-bordered
     scan is no longer unusable as reference.
  2. **Sparse staves cost half a page** (Canti C B4r, Odhecaton) and the cure `STAFFBOX=1` is not safe (Antiphonarium 0.6 % became 12.4 %).
     *Learned:* no single automatic rule fits every print (automatic box, `STAFFBOX`, trimmed box each fail somewhere). *Change:* **A1** is not "switch STAFFBOX
     on"; it is the candidate-box rule of A4 plus the user's correction, **tested on all pages of every check before it is adopted**.
  3. **Near-empty pages produce a number without meaning** (Odhecaton F8r: the copy is moved by a median of 7 px to find something to hold on to,
     5.7 % unmatched). *Change:* **A3** as planned (rough alignment only, say so); the trigger is little ink in the box plus large movement.
  4. **Small shifts are absorbed, and real warping looks like a shift.** 8–16 px invisible, 32–48 px a faint signal, 64 px visible (D2, also on
     small scans); the movement map shows the shift. But two matching copies photographed differently also move a lot (Liber A–A: median 4–6 px,
     28–40 % over 8 px). *Change:* **B2/V18** (shifted-page warning) and **B4/V16** (movement map) use unmatched ink AND movement, and compare a page
     with the other pages of the same pair (relative to the typical value of that copy), never with a fixed limit; the warning says "look here", not "wrong".
  5. **How flexible may the alignment be?** (a) All known differences survive the present setting; fewer levels only spoil the matching side; the
     more the alignment may bend, the smaller the real differences get. *Change:* **B6/V15** presets: "standard" = today; "stiffer" is safe (only more
     false differences); nothing looser than today without a warning that real differences may vanish.
  6. **Differences in red ink are invisible** (Antiphonarium: red staves shifted 14 px 1.7 %, removed 0.0 %), because the ink map uses the red channel.
     *Prototype tested 18 Nov (`INKCH=min`, ink map from the darkest of red, green and blue):* red staves shifted 14 px 5.9 % (default 1.7 %), red staves removed
     21 % (default 0.0 %), the cross-copy control Bodleian against Munich 1.3 % (default 0.6 %): red print is seen and matching copies still match.
     *Owner 18 Nov:* there can be any number of colours, so the choice is not "red" but **"dark ink" / "dark ink and lighter inks"** (A6); for now **B5**, a help text, is enough:
     it says that lighter inks (red, and others) take no part in the alignment and that their differences are not measured; integrating lighter inks comes after version 1.
     *Caution for that later step:* "lighter inks" also catches stains, show-through, paper yellowing and pencil, so the default stays "dark ink" and the other
     mode is a deliberate choice per pair, with a warning that it is more sensitive to such marks.
  7. **A single changed note hides in a whole-page overlay.** Four of seven single Boorman items on the Odhecaton pages were found at full resolution and
     only because I knew the system and the note; automatic lists of the largest spots were swamped by right-edge custos strokes, staff-line fringes
     and device-woodcut speckle. *New proposal (B7, owner 18 Nov: only after version 1, see C4; wants to see an example first, mock-up sent):* after alignment, a list ("jump list") of the strongest difference spots as small pictures that
     open in the zoom view, with those three kinds of noise filtered out; the owner decides what counts. *Acceptance test:* on the seven known
     locations, how many rank in the first 20? (research script, before anything is built.) The app also needs a fast zoom to 1:1. **Mock-up on N4r (Paris against Washington): a plain list of the six strongest spots shows only fringes at clefs and staff lines; the real
     difference (the erased and re-stamped note, 52 % from the left) is not among them. This is why B7 waits for the noise filter and the ranking test.**
  8. **Signatures, folio numbers and headlines sit outside the box** and show only when the margin is shown (Canti C folio numbers "21" against a
     handwritten "12"; the Odhecaton H2r signature was not found even with a wide margin). *Owner 18 Nov: headlines, folio numbers and signatures are printed and must be part of the alignment, not cut off.* **What the code does today:** the whole page
     is moved by the rough alignment (nothing is cut off); only the fine tile step and the unmatched-ink measure are limited to the box plus a 2 % ring.
     So margin items are carried along but not fine-aligned or measured. *Change:* **A2** widened: the fine alignment ring covers every printed item of the page
     (headline, folio number, signature, catchword) while ignoring the scan edge; **B8 (version 1)**: a "show margin" control, default wide enough to show them;
     and margin items are added to the checks (D1r/D7r page numbers, H5v headline, Canti C folio numbers). **H1r signature checked 18 Nov: present in all three scans, so it
     is a "must NOT differ" control, and in the overlay it shows as a red/blue pair 10–15 px apart (outside the box, not fine-aligned): exactly the false difference A2 has to remove.**
  8a. **The printed-area proposal is automatic for every page, the user does not confirm it page by page** (owner 18 Nov: confirming a box for every single page would be
     impractical, and that is not the plan). Design: (1) the app proposes a box for every page by itself, with candidate boxes (A4) and an internal check
     ("does the box cut through print?"), at no cost to the user; (2) the user is only asked on pages the check flags (box very small, box much larger than the
     other pages of the same copy, little ink) and sees the box drawn there; (3) systematic problems are solved once per copy, not per page: one setting such as "ignore a border
     strip of x %" for a dirty scan edge, applied to every page of that copy (the Opusculum case: one setting for 22 pages); (4) the hand-set box (V2b) is the safety
     net on single pages and is saved. *Idea not yet tested:* mask the outer border strip of the ink map (set to paper) before the standard automatic box instead of
     the percentile box; it would keep the box that works on the Antiphonarium and still clean dirty borders. To be run on the 22 Opusculum pages, the Antiphonarium pair and Canti C B4r.
  9. **Page numbers do not line up between copies** (New York is two pages off from gathering F on, Brussels is one off, Vienna three off after
     Brussels 13); I had to build the page map by hand for every print. *Owner 18 Nov: not needed, the page grid already lets the user match pages across copies (B9 dropped).*
  10. **Catalogues name copies by siglum, and a correction may belong to other copies than the two on screen** (Canti C C4r.iv: F-Pc and I-TVcap,
      not our F-Pn and A-Wn). Catalogues and the dissertation also contain errors and gaps (D-ARk f.9). *Change:* every known difference in the
      checks carries the copies it applies to; "expected" only when both copies are named. `check_known_differences.js` (now 77 assertions on six
      prints, plus the Melopoiae) must pass after every engine change, and the single-note locations should be added once the app has stable coordinates.
  11. **Scan material:** black-and-white or spread scans align well once split and with a clean border; the Photoshop split script (v1.5, works) stays
      part of the workflow. Time: 25–50 s per pair on Claude's two-core machine; the speed test on the owner's PC on 19 Nov decides whether the
      10-second target holds, and **A5** (release memory) matters because every test ran in a separate process.

- **Status of D1–D5 (18 Nov 2026): all done.** The H1r signature and the N8r colophon are closed (no difference in these scans; see D1). Open only: L6r (not staged); the extra tests: border strip masked before the standard box (see lesson 8a), red-ink mode as research, jump-list ranking (after version 1).

- *Marenzio, madrigal books, Venice 1580s–90s* (mensural, single impression: a useful contrast). Pugin (Troja 17, 2018)
  reports stop-press corrections found with Aruspix but lists none; a list may exist only in the edition's apparatus
  (marenzio.org, not yet checked).
- *A chant print, two or more copies*, even without a list of differences: pairs of identical copies show the noise
  floor (paper warping, inking, show-through); artificial changes (as in Test B: move a note, delete a note) give a
  ground truth for any print. **Weak spot to test:** chant prints often have red staves or rubrics; the ink map uses the
  red channel, in which red ink nearly disappears. (Antiphonale Pataviense: only two copies known, BSB and ÖNB; no
  copy comparison by David Merlin found.)

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
| V2 | Printed-area detection, automatic + manual correction | detection done; **V2a done 20 Nov: the Compare tab uses it (through the tile alignment, V3)**; the box is not shown yet and manual correction (V2b) is not built. **Owner, 17 Nov: the box is shown on both scans and has four FREE corners** (not only a rectangle): the automatic proposal is a rectangle, each corner can be dragged on its own, everything outside the shape is ignored by the alignment (main use: leave out a slanted dark binding edge or a sliver of the next page); the pair is aligned again at once; "back to automatic"; saved per scan. Engine fixes A1–A5 (§10) after the tests D | V2a make Compare tab use it; V2b correction by hand |
| V3 | Tile-based alignment in the Compare tab | **done 20 Nov 2026 (with V2a):** default in the Compare tab ("Tiles (recommended)"); background helper returns copy 2 bent onto copy 1 in colour at full size (movement map `composeMap`, job `alignColor`, check `research/js/test_map.js`); older types stay in the menu | needs V2a; Thursday speed test decides nothing about *whether*, only about expectations |
| V4 | Difference view | done | — |
| V5 | **Desktop program** (§4.8): installer, project in one file, double-click opens, own browser engine, replaces helper/.bat, built on GitHub | **stage 1 done 21 Nov (version 0.7.0):** Electron window (`desktop/main.js`), the helper's scan reading rewritten in Node inside the program (`desktop/server.js`, same /api; the whole `test_helper.py` passes against it), ordinary Windows folder/Open windows, installer for the user only (no administrator), Start menu + Desktop, built and tested on GitHub (`.github/workflows/desktop.yml`: silent install, test mode, uninstall). **Open:** project in one file + double-click (needs owner decisions), alignment helpers as Node programs (V8), code-signing (V5d), automatic updates | V5a framework: **Electron (D3, decided 20 Nov)**; V5b file access behind `workspace.js`; V5c installer built by GitHub Actions; V5d code-signing certificate decision at release |
| V6 | Website, kept current automatically | done (live) | — |
| V7 | **Reference copy** (§4.7): proposal from measurable criteria, user confirms, stand-in per page, never switches by itself, old results kept until new ones are ready | **decided** (D1, owner 20 Nov), not built | V7a scoring of copies; V7b UI to confirm/choose; V7c per-page stand-in; V7d "better copy found" hint with cost |
| V8 | **Background alignment** of one chosen copy at a time + computing on demand for the pair on screen | decided (§4.6), not built | needs V3; **measured 20 Nov (T2b, §4.5): a work queue with several helper workers works; 4 helpers 3.5 × faster, 8 helpers only 4.2 ×.** Design: when one pair is finished the next pair starts, so no worker waits; default helpers = half the processor threads, an "all threads" choice for overnight runs; each helper keeps its last reference page so jobs are ordered page by page; limits still to watch: memory with very large scans, the screen needs some capacity |
| V9 | **Progress bar with time estimate** for V8 | decided, not built | needs V8 |
| V10 | Storage of aligned results (what is kept, where, invalidation when the reference changes) | **open** — not designed in detail | V7, V8; decide with the desktop program's project file |
| V11 | Speed target: not-yet-aligned page pair ready in < 10 s on an ordinary PC | **measured 20 Nov on his PC: median 6.1 s, 8 of 9 copies under 10 s**; F-Pm 13 s on a re-set page (rough step) → A7 (§4.5) | — |
| V12 | Known-differences checks (§4.4), all pass (15 Nov): Melopoiae TOC (16); woodcut p.19 B-Br vs D-Mu (7 assertable lines of 8); p.8, five copies against B-Br (25); Liber f.19v, CH-E vs D-FUl and US-CA, whole page and the single notes of the apparatus (11). **Source for the Liber:** the critical apparatus in `Dissertation_Verlag.pdf`, 4.6, pp. 195–224 (PDF page = printed page), with Table 1 of the 20 extant copies on p. 15; for the Melopoiae: `Mein Artikel\\List of Differences.odt`. Music tests added 15 Nov (re-set folios 7r/7v/9r/9v, f.8r/8v control, f.19v A1 against A2, Melopoiae pairs 05 and 09, artificial shifts; see §4.4). **Still open:** the B copies of f.8r/8v (CZ-Pu, GB-Lbl1 and others, once split), other Liber folios with single notes, other Melopoiae pairs | partly done | T3, T4 |
| V13 | Tests: workspace tests on Windows CI; desktop-program smoke test | partly done | — |
| V15 | **Tile settings for a page that aligns badly** (owner's Aruspix idea). **Decided 17 Nov:** plain presets shown by default (stiffer / standard / more flexible); a button opens an advanced panel with the two numbers — *main tiles* (how many large tiles cover the page height, today about 8) and *sub-tiles* (how many times each is split again, today 3); the pair is aligned again at once, with overlay, movement map and unmatched figure; a note that more flexible settings can hide real differences; "standard" button; **applies only to this copy on this page** and is saved in the project. Safe range of the numbers comes from tests D(a) | **decided, version 1** | needs V3 |
| V17 | **Matching points by hand** (click three or four matching points on both pages as a starting point for the alignment) | **only if** tests D show pages where box correction and tile settings both fail (owner, 17 Nov) | after D |
| V18 | **Shifted-page warning, small version** (B2 in §10) | **decided, version 1** (owner, 17 Nov) | needs V3; full automatic page matching stays P4 |
| V16 | **Shifts are absorbed by the tile alignment — now measured (15 Nov, §4.4 music tests).** One whole line moved by 4–32 px is pulled back and invisible (0.6–2.4 % unmatched); only 64 px shows. Melopoiae p. 9: half-staff-space differences are not visible. The movement applied equals the shift, so it can be shown. **Decision: part of version 1** — (1) movement map next to the overlay, (2) the rough, unbent alignment as a second view, (3) a cautious automatic hint for sharp-edged movements of about 15 px or more (false alarms below about 10 px). Small shifts remain undetectable; say so in the help text | **firm, version 1** | needs V3 |
| V14 | Release housekeeping: README (ORCID, year, version), CITATION.cff, CHANGELOG, licences list (OpenCV.js Apache-2.0 is in) | per release | — |

### 11.1a Small changes for the next release (owner, 18 Nov 2026; **built 19 Nov 2026, version "Book-Compare-002"**)

| ID | Change | Note |
|----|--------|------|
| S1 | **done 19 Nov:** Grid view, "add new copy" name box: change the example text from "Austria, Austrian National Library" to "e. g. Austria, Austrian National Library" | wording only |
| S2 | **done 19 Nov:** Grid view, moving a file: instead of swapping with an existing file, the moved file is **inserted between two adjacent files** (the files after it shift by one place) | owner confirmed the meaning. As built: dropping on the **upper half** of a file puts the moved file in front of it, on the **lower half** behind it (a teal line shows the place); the files in between move by one place, the rest of the column stays. Dropping next to its own place changes nothing. Dropping on an empty cell ("no page") moves the file into that cell and leaves an empty cell behind (rows are page positions, so a gap is kept on purpose). One undo step. |
| S3 | **done 19 Nov:** Adding files: besides adding a whole folder, **select individual files** (e.g. one picture); the default stays "add a whole folder" | |
| S4 | **done 19 Nov:** "Start Book Compare.bat" should open **Microsoft Edge** instead of the default browser (Firefox on the owner's PC), because the app works best in Edge | `launcher/serve.ps1` (line 56, `Start-Process $url`) and `launcher/tray.ps1` (lines 53–54): try Edge first, fall back to the default browser if Edge is not found; the new desktop program (V5) brings its own browser engine and makes this obsolete |
| S5 | **done 19 Nov:** **Remove the Photoshop split script** from Book Compare (owner: it was only for his own work): `tools/photoshop/`, `tests/photoshop/`, the CI step that tests it, the README paragraph; plan notes P5/T1 updated | it stays in the project history and can be handed out as a single file at any time |
| S6 | **done 19 Nov:** **Fix:** the book map strip (the thin line above the page bar) lies on top of the opened view menu and cuts through it (owner's screenshot, 18 Nov) | layering: menus must always be above the map |
| S7 | **done 19 Nov:** **Arrow keys:** no longer change page or copy; they move the picture inside the superimposed panel again, as before the Compare tab; the key hints in the left panel change accordingly | **owner 19 Nov:** Page Up / Page Down turn the page; no keys for switching copies (the ▲ ▼ buttons stay); F for flag stays |
| S8 | **done 19 Nov:** **Difference view legend:** "Orange = A-Wn1 / Blue = A-Z" with the copy names from the grid instead of "image 1 / image 2" | if a copy has no name: "Copy 1" / "Copy 2" |
| S9 | **done 19 Nov (sketch 1 chosen):** **One bar at the bottom:** the light teal page bar is merged into the dark teal bar; the design is being discussed (18 Nov, on Opus); build on Sonnet once decided | **owner 19 Nov:** option B preferred (one dark teal bar: page turning and flag on the left, the six views as a row of buttons in the middle, Linked and More as icons on the right; when the window is too narrow for the buttons, e.g. half the screen, they fold into one menu automatically); the **Back** button is removed (the PAGES tab does the same); short messages move to a note at the bottom of the picture; Toggle speed appears only in Toggle view. **Decided 19 Nov (owner chose "sketch 1"):** the middle of the bar shows only the **current view name in a framed pill with six dots** (the current view is the bigger white dot); when the pointer rests on it for about 0.18 s the six names unfold (they close about 0.35 s after the pointer leaves); a click or tap opens them too (touch screens have no hovering); a click on a name switches; keys 1–6 choose the views (Difference, Toggle, Top and bottom, Left and right, copy 1, copy 2); if the window is too narrow the names stand one under the other above the pill. As built; the page-turning part, flag, Linked and More are in the same bar; Back is gone; short messages are a note at the bottom of the pictures. |

### 11.1b Small changes for the release after 002 (owner, 19 Nov 2026)

| ID | Change | Note |
|----|--------|------|
| S10 | **done 20 Nov:** **Add single pictures with the ordinary Windows "Open" window**: a button "Add single pictures…" opens the same file window as in any Windows program; one or several pictures are chosen there (Ctrl- or Shift-click) and go into the copy. The tick boxes in "Add a folder" (S3) stay | **decided 19 Nov (owner)**, to be built in the next coding round (on Sonnet). With the helper the window is opened by the helper, like its folder window today (`launcher/pickfolder.ps1`); the desktop program (V5) has such a window built in, so the button carries over. On the website without the helper the tick boxes remain the way, because a browser can reopen pictures later only from a folder it was given. **As built 20 Nov:** button "Add single pictures …" next to "Choose another folder …" in *Add a copy* and *Add files* (only with the helper); the helper's window (`pickfolder.ps1`, `BC_PICK_MODE=files`) returns the folder and the names; the folder is registered like a scan folder and the chosen pictures arrive ticked; the window opens in the folder of the last single pictures. Tested: helper API and the page (`test_helper.py`), the real Windows window on CI (`windows-checks.ps1`: cancel, and two names typed into the file-name box) |

### 11.2 After version 1

| ID | Item | Status |
|----|------|--------|
| P1 | Manual recorded grouping of copies and findings export (§5.1) | open design |
| P2 | DOI via Zenodo on release (§5.2) | later |
| P3 | One outside tester installs it once (§5.3) | later |
| P4 | Automatic page matching (§5.4) — only if cheap | later, optional |
| P5 | Splitting double-page scans inside Book Compare (§5.5) — the owner's own Photoshop script is the stopgap (not part of the project) | later |
| P6 | Other visualization modes, quality dots, wrong-page check, look and feel (§5.6) | later |
| P7 | Mac version from the same code, if colleagues ask | later |
| P8 | **Finding the subtle differences** (§5.7, owner 21 Nov): research overview first; test pages with planted letter changes (*Ligurinus*, script-made + owner's blind ones); catalogue of subtle differences (text and music); then methods (difference finder / jump list C4, letter by letter, OCR + text comparison, flicker magnifier), each measured against the test pages | later (after version 1) |
| P9 | **The launch** (§5.8, owner 21 Nov): where to announce; screen-recorded video with the owner's voice or captions (no AI video), screenshots, GIF; download page, DOI; decide about signing the installer and how to speak about AI in the code | later (after version 1) |

### 11.3 The owner's own tasks and material

| ID | Item | Status |
|----|------|--------|
| T1 | Split double-page copies (CZ-Pu, D-SHk, GB-Lbl1, SK-Mmf) with `Split-double-pages.jsx` into a *different* folder (never into the protected scan folders) | **done 16 Nov** (owner): all split; the single-page folders are now sub-folders of the original copy folders. Paths for the B copies of f.8r/8v still to be looked up |
| T2 | Run the speed test on his PC and paste the text | **done 20 Nov** (results in §4.5) |
| T2b | **Several alignments at the same time** (built 20 Nov: speed-test window, button "Several at once …"): the same 16 jobs (prepare the page of one copy, align the same page of another copy onto it) with 1, 2, 4 and 8 helpers from a waiting line; shows the time per number of helpers, the gain against one helper and the longest delay of the page. The owner runs it on his PC and pastes the text; result decides how many helpers V8 uses | **done 20 Nov** (results in §4.5): 4 helpers 3.5 ×, 8 helpers 4.2 ×; default for V8 = half the threads |
| T3 | Marked woodcut files: `Example pages\Melopoiae. Concert of Gods\19. B-Br. White lines marked.jpg` and `19. D-Mu. White lines marked.jpg` (found 15 Nov) — B-Br: vertical (teal), horizontal above Phoebus' head (red), horizontal at the feet (yellow); D-Mu: vertical (yellow) and four short lines at hand height | material for V12 |
| T4 | Melopoiae scans on `D:\Melopoiae. Digitalisate vom Tablet`: one folder per copy, 20 files "NN. [copy].jpg"; not Melopoiae pages: Aktueller Vergleich, D-Mbs Harmoniae super odis Horatii Flacci, germanos, Grantley-Dateien | reference for V12 |
| T6 | For P8: scans of the *Ligurinus* (bound with the *Melopoiae*): the same text pages in two copies that are identical in their original state; later a few test pages with letters changed by hand in Photoshop, without telling me where; check the catalogue of subtle differences in §5.7, especially the music part | after version 1 |
| T7 | For P9: record the demonstration video (screen recording, own voice or captions) | after version 1 |
| T5 | CZ-Pu split run with v1.0 (15 Nov): 163 double pages split, then every file from NK4288 to NK4405 failed with "Cannot open the file because the open options are incorrect" (112 files); NK4406 (a single page) opened fine. Cause unknown: the D: drive was no longer reachable when I tried to inspect the files. To do: inspect NK4287/NK4288 (format, colour mode, profile), then make the script robust | his drive; then me |

### 11.4 Decisions still to be taken

| ID | Question | Needed by |
|----|----------|-----------|
| D1 | ~~Reference copy: confirm the proposal in §4.7~~ **Decided 20 Nov 2026 (owner): yes**, the whole proposal in §4.7, including "old results stay in use until the new ones are ready" | done |
| D2 | Pairs via the reference vs directly aligned on demand (§4.7 "Open") | after V12 results |
| D3 | ~~Desktop framework (Electron vs Tauri)~~ **Decided 20 Nov 2026 (owner): Electron.** Reasons given: the alignment can run in separate Node helper programs that are closed and restarted (cures the OpenCV.js leak, no browser memory ceiling for 70 MP double pages); native OpenCV possible later (to be tested); the engine version is fixed per release, so CI tests what the owner runs (Playwright drives Electron); one language (JavaScript) for everything; a Mac version would use the same engine. Cost: installer about 100 MB, somewhat more memory, both negligible next to the scans. Also considered: installed web app from Edge (keeps permission clicks and memory ceiling), Tauri and Wails (system WebView, Rust/Go backend, engine changes with Edge, Safari engine on Mac), Neutralino (too thin), NW.js and Electrobun (nothing over Electron), Qt/Flutter/native (rewrite of the interface) | done |
| D4 | Code-signing certificate for the installer (low hundreds of euros a year) | at release |
| D5 | Grouping design (§5.1) | before P1 |
| D7 | ~~Differences.pdf listed the line above Phoebus' head for D-Mu too~~ **Resolved 15 Nov:** the owner says that was an error in the old Differences.pdf; the line is in B-Br only. His current list is `Mein Artikel\List of Differences.odt` (Dropbox\Melopoiae), which already says so. **That file, not Differences.pdf, is the reference for all checks from now on** | done |
| D6 | What exactly is stored for aligned results (V10) | before V8 |

### 11.5 Order from here (17 November 2026)

1. Tests D1–D5 with the extra measurements (a)–(c) (§10) — research only, on Sonnet.
2. Speed test on his PC (V11/T2) — **done 20 Nov**.
3. Engine fixes A1–A5, checked against every earlier check (**done 20 Nov**, with A7; open: A6 ink choice, A8 cap on a mismatched pair).
4. **Owner, 20 Nov: D3 = Electron, D1 = yes. Next built: S10, then the Compare tab uses the new alignment (V2a, V3)** (**both done 20 Nov**; next: V2b box correction by hand, V15 tile settings, V18/V16 shifted-page warning and movement map, then V5), because that is what his research uses at once and it does not depend on the desktop program; the desktop program (V5) follows.
5. Compare tab uses the new alignment (V2a, V3) with box correction (V2b), tile settings (V15), shifted-page warning (V18), movement map (V16).
6. Reference copy (V7, D1), then background alignment, progress bar and stored results (V8–V10).

### 11.6 Earlier order (15 November 2026), kept for the record

1. Photoshop script v1.1 — **done**.
2. Known-differences check: woodcut — **done**; more Melopoiae pairs and the Liber f.19v table (V12) — next, small.
3. Thursday 19 Nov: speed test on his PC (V11/T2).
4. Desktop program (V5), starting with D3.
5. Compare tab uses printed-area detection and tile alignment (V2a, V3).
6. Reference copy (V7, D1), then background alignment, progress bar and stored results (V8–V10).
