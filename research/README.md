# research/: how the alignment was worked out

`FINDINGS.md` describes the tests behind the alignment (printed area, ink map, rough and tile alignment). They were first
done with a Python prototype; that prototype was rewritten in JavaScript in `js/` (see its README), which is what Book Compare
uses. The Python files were removed on 22 Nov 2026 because nothing uses them any more (they are still in the history of this
repository, before that date). `known_differences/` holds checked differences between copies that the check scripts in `js/` use.

Run the scripts in `js/` from inside that folder. Scans are only ever read, never changed. **No scan images are part of this repository**
(they belong to the libraries and to the thesis work); use your own.
