# Book Compare
Do you work with books? Do you want to compare them? Boy, do I have good news for you. Use Book Compare to compare books.
Book compare is based on Image Compare but has a few added features and modifications that makes it more suitable for comparing entire books with each other.
This is still very much a work in progress.

## What is in this repository
- `app/`: the working two-image app (open `app/index.html` in Edge or Firefox; works offline). Contrast and black-and-white were removed after tests showed no benefit for alignment.
- `prototypes/whole-book-workspace/`: a clickable **mock-up** of the planned whole-book screen (not yet connected to the app).
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
