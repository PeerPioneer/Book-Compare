# Book Compare
Do you work with books? Do you want to compare them? Boy, do I have good news for you. Use Book Compare to compare books.
Book compare is based on Image Compare but has a few added features and modifications that makes it more suitable for comparing entire books with each other.
This is still very much a work in progress.

## How to use it on your own computer (Windows)
Download the ZIP, unzip the whole folder, double-click `Start Book Compare.bat`. A small helper starts quietly in the background (icon near the clock) and Book Compare opens in your default browser (Edge, Chrome or Firefox). The helper reads your scan folders itself, so the browser never asks for permission to each folder, and folders are remembered across restarts. Nothing is uploaded; scans are only ever read. Details in `START-HERE.txt`. Opening `app/index.html` directly still works (two-image screen; the workspace then uses the browser's own folder permissions, Edge/Chrome only).

## What is in this repository
- `Start Book Compare.bat`, `launcher/`, `START-HERE.txt`: the double-click start and the helper (`serve.ps1`: local web server for `app/` plus a small read-only file service for the scan folders, only reachable from Book Compare on the same computer; `pickfolder.ps1`: Windows folder window; `tray.ps1`: icon near the clock). Uses only what Windows already contains (PowerShell).
- `app/`: the working two-image app (open `app/index.html` in Edge or Firefox; works offline). Contrast and black-and-white were removed after tests showed no benefit for alignment.
- **Whole-book workspace** (button "Compare copies of a book" on the start screen; code in `app/js/workspace.js` and `workspace.css`): add each copy as a folder of scans, see all copies side by side (columns = copies, rows = page positions), fix the page order by hand (delete files, add files from another folder, pagination or foliation), save the project in a separate folder (reopening needs one permission click, not one folder choice per copy), and open a chosen pair of pages in the **Compare tab** (`app/js/compare-tab.js`): the two pages are aligned automatically, a left panel holds the two copies (menus, swap) and the list of pages with a search box, and previous/next page buttons and the keys ← → (page), ↑ ↓ (copy 2), Shift+↑ ↓ (copy 1) go through the book. Pages can be **flagged** (button or key F, six colours, saved in the project, filter in the page list), and a thin **book map** along the bottom edge shows the whole book at a glance (flags, pages a copy lacks, the page on screen; hover for a small picture, click to jump). **Annotations** (circle, rectangle, text note with a comment, six colours, saved in the project, shown on every pairing of the page) can be drawn on the superimposed picture. Page matching is still manual. The two-image screen of the start page is unchanged. Scan folders are only ever read. Tests: `tests/workspace/`.
- `prototypes/whole-book-workspace/`: a clickable **mock-up** of the planned whole-book screen (the Pages grid, the Compare tab with flags, book map and annotations now exist for real, see above; "next to check", focus mode and "Prepare whole book" are still only in the mock-up).
- `research/`: Python code and notes for printed-area detection and tile-based alignment (not yet part of the app) - start with `research/README.md` and `research/FINDINGS.md`.
- `website/`: the original Image Compare website.
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
