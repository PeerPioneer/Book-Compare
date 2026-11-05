# Whole-book workspace: clickable mock-up

`workspace.html` is a **mock-up**: a picture of how the whole-book screen of Book Compare could look and behave.
Open it by double-clicking in Edge or Firefox. It is **not connected to the real app** yet.

What it shows (all with made-up pages, no real scans):

- a grid: **columns = copies, rows = pages** (positions in the book), empty cells for missing pages
- a row preview of all copies of a page
- "Start numbering at this row" (rows above become front matter) and "Don't compare this row"
- renamable rows (e.g. "Index", "Mons Parnassus Woodcut"), insert/remove gap ranges, undo
- per-row quality dots, free choice of copy 1 / copy 2
- annotations with the six flag colours `ef476f f78c6b ffd166 06d6a0 118ab2 073b4c`
  (annotations are only meant for this workspace, never for the two-image app)

What it does **not** do: read folders, match pages, align, or save anything. Everything on screen is invented.
Fonts are loaded from Google Fonts; without internet the browser uses a fallback font.

Design decisions behind it are listed in `../../research/ROADMAP.md`.
