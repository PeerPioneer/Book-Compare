# Book Compare
Do you work with books? Do you want to compare them? Boy, do I have good news for you. Use Book Compare to compare books.
Book compare is based on Image Compare but has a few added features and modifications that makes it more suitable for comparing entire books with each other.
This is still very much a work in progress.

## Download (Windows)
**https://github.com/PeerPioneer/Book-Compare/releases/latest**: download `Book-Compare-Setup-x.y.z.exe` and run it. The installer asks where to install Book Compare and whether it should appear in the Start menu and on the Desktop. Book Compare then opens in its own window. It reads your scan folders itself (only ever reads them; nothing is uploaded), remembers them across restarts and saves the project in a folder of your choice. When a newer version is on the download page, the program says so. Windows may warn about an "unknown publisher" (the installer is not signed yet): "More info", then "Run anyway".

## Try it in your browser
**https://peerpioneer.github.io/Book-Compare/**: the same Book Compare, always up to date with this repository (the website is only renewed after all automatic tests have passed). Nothing is uploaded. In Edge or Chrome you can choose your scan folders and save the project as a file; Firefox cannot hand a folder to a web page, so there you pick the files of a folder instead and keep the project as a downloaded file. For full comfort use the desktop program.

## How to cite
If you use Book Compare in your research, please cite it, and please also cite **Image Compare**, on which it is based. On this page, the button "Cite this repository" (right-hand column) gives both in the usual formats (APA, BibTeX); the information comes from the file `CITATION.cff`.

Book Compare: Schiefelbein, Torge. *Book Compare* (software). https://github.com/PeerPioneer/Book-Compare

Image Compare: Sridhar, Prasanna, Abhishek Dutta and Andrew Zisserman (2021). *Image Compare* (software), Visual Geometry Group (VGG), University of Oxford. https://www.robots.ox.ac.uk/~vgg/software/image-compare/

Book Compare is a modification of Image Compare and is distributed under the same BSD 2-Clause licence (see `LICENSE`). A version number, a year and a DOI will be added with the first release.

## What is in this repository
- `PLAN.md` (the plan for Book Compare, in plain language), `CITATION.cff` (how to cite it).
- `desktop/`: the desktop program (Electron): `main.js` (the window, the Windows folder and Open windows), `server.js` (reads the scan folders and writes only the project file, reachable only from Book Compare on the same computer), `build/installer.nsh` (the installer's Shortcuts page). GitHub builds and tests the installer and publishes each new version on the Releases page (`.github/workflows/desktop.yml`). `START-HERE.txt`: how to install and start.
- `app/`: the working two-image app (open `app/index.html` in Edge or Firefox; works offline). Contrast and black-and-white were removed after tests showed no benefit for alignment.
- **Whole-book workspace** (button "Compare copies of a book" on the start screen; code in `app/js/workspace.js` and `workspace.css`): add each copy as a folder of scans, see all copies side by side (columns = copies, rows = page positions), fix the page order by hand (delete files - one, or a whole range with Shift -, add files from another folder, pagination or foliation, move copies by dragging their headings, change the column widths), save the project in a separate folder (reopening needs one permission click, not one folder choice per copy), and open a chosen pair of pages in the **Compare tab** (`app/js/compare-tab.js`): the two pages are aligned automatically, a left panel holds the two copies (menus, swap) and the list of pages with a search box, and previous/next page buttons and the keys ← → (page), ↑ ↓ (copy 2), Shift+↑ ↓ (copy 1) go through the book. Pages can be **flagged** (button or key F, six colours, saved in the project, filter in the page list), and a thin **book map** along the bottom edge shows the whole book at a glance (flags, pages a copy lacks, the page on screen; hover for a small picture, click to jump). **Annotations** (circle, rectangle, text note with a comment, six colours, saved in the project, shown on every pairing of the page) can be drawn on the superimposed picture. Page matching is still manual. **Focus mode** (arrows button at the top right, Esc leaves it) hides everything except the pictures; the keys keep working. The two-image screen of the start page is unchanged. Scan folders are only ever read. Tests: `tests/workspace/`.
- **Speed test** (Pages view, menu More > "Measure speed on this computer ..."; code in `app/js/speedtest.js`): aligns a few real pages of your project and shows how long opening a scan, finding the alignment and drawing the result take on your computer, and what a whole book would need. It only reads the scans.
- `prototypes/whole-book-workspace/`: a clickable **mock-up** of the planned whole-book screen (the Pages grid, the Compare tab with flags, book map, annotations and focus mode now exist for real, see above; "next to check", quality dots and "Prepare whole book" are still only in the mock-up).
- `research/`: the alignment engine (`research/js/`, built into `app/js/align-worker.js`), the checks against known differences, earlier Python experiments and notes - start with `research/README.md` and `research/FINDINGS.md`.
No scan images are included. The new folders `prototypes/` and `research/` have no licence chosen yet; the rest remains under the original BSD 2-Clause licence.



# Image Compare
Image Compare is a lightweight, standalone and offline application to visually compare two images and highlight their differences. This application can be used in desktop computers and mobile phones without requiring installation as it runs entires in a web browser. Image Compare is an open source software developed and maintained by the [VGG Oxford](https://www.robots.ox.ac.uk/~vgg/).

More details about Image Compare software application is available in the following websites:
 - https://www.robots.ox.ac.uk/~vgg/software/image-compare/
 - https://vgg.gitlab.io/image-compare/ (mirror)

The latest version of Image Compare software application is available at: https://www.robots.ox.ac.uk/~vgg/software/image-compare/app/latest/

## Features
 - Offline : Can be used without an active internet connection.
 - Open Source : Complete freedom to use this application or modify its source code.
 - Standalone : No installation is required as the application runs entirely in a web browser.
 - Visualisations : Several ways to visualise the similarity and difference between images.
 - Light Weight : The full application is less than 2Mb in size and therefore is faster to load and easier to share.
 - Advanced Mode : Choose geometric transformation (e.g. similarity, affine, thin-plate spline, etc.)

## Use Cases
See https://www.robots.ox.ac.uk/~vgg/software/image-compare/#usecases which shows the application of Image Compare software for the following:
 - Art Restoration : Identify the changes caused by art restoration process
 - Digital Collation : Compare different editions of the same book and identify variants
 - Photograph : Identify alteration in digital photographs
 - Satellite : Identify changes in satellite imagery
 - Music : Identify variants in music sheet

## About
Image Compare software application is developed and maintained by Prasanna Sridhar, Abhishek Dutta and Andrew Zisserman.

Development and maintenance of the Image Compare software has been supported by the [VisualAI](https://gtr.ukri.org/projects?ref=EP%2FT028572%2F1) research grant.

Contact [Prasanna Sridhar](removeme-prasanna@robots.ox.ac.uk) for any queries or feedback related to this software application.
