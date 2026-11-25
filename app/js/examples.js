/* Book Compare - the examples project (0.11.0; 0.13.0: six pages, three copies, one thing to try on each page).

   "Try the examples" on the start screen opens a small project made of pictures that come with Book Compare: each row (page) is
   one example, the first one a welcome page. workspace.js builds the project in memory (BookWorkspace.openExamples: nothing is saved),
   the Compare tab shows the note of each example in its left panel, with one "Try it" button (compare-tab.js, exampleAction).
   Order (owner, 25 Nov 2026): welcome, the Toggle view, the movement map (the tile alignment), side by side and zoomed in, a bent page
   (the whole-page step against the tiles), the whole book in the Pages view (three copies, a flag, an annotation).

   The book, music and puzzle pairs are Image Compare's (VGG, Oxford); the welcome, bent and last pages were made for Book Compare.
   The photographs of Image Compare (portrait, painting, satellite pictures) are left out: Book Compare looks at dark ink only. */
(function () {
  'use strict';
  var U = 'images/usecases/', X = 'images/examples/';
  window.BCExamples = {
    copies: ['Copy A', 'Copy B', 'Copy C'],
    list: [
      { label: 'Welcome', files: [X + 'welcome-1.jpg', X + 'welcome-2.jpg', null], welcome: true,
        title: 'Welcome to Book Compare',
        text: 'These are examples: every page in the list below is one pair of pictures. Book Compare has laid copy B over copy A, ' +
          'bent it into place and coloured what differs. Here the year was changed while the sheets were printed, and a reader made a pen mark in copy B.' },
      { label: 'Toggle', files: [U + 'book/case2-traherne2-a-original.jpg', U + 'book/case2-traherne2-b-original.jpg', null],
        title: 'The same page in two copies',
        text: 'Ben Jonson, “Epicoene, or The silent Woman”, page 529, in two copies. The heading was set with different type; the text below lines up. ' +
          'The Toggle view shows the two copies one after the other: what differs jumps.',
        tryit: { label: 'Try it: Toggle', act: 'toggle' } },
      { label: 'Movement map', files: [U + 'music/case5-music-sheet-1.jpg', U + 'music/case5-music-sheet-2.jpg', null],
        title: 'How Book Compare aligns a page',
        text: 'One page of an opera score in two editions. Book Compare does not only move the page as a whole: it bends it in small pieces (tiles), ' +
          'so that every part finds its partner. The movement map shows how far each piece had to move. Here the last system was engraved anew: ' +
          'it moved as one block, and Book Compare points it out (and asks whether this is the same page at all, because so much differs).',
        tryit: { label: 'Try it: the movement map', act: 'movement' } },
      { label: 'Side by side', files: [U + 'puzzle/case6-puzzle-1-a.jpg', U + 'puzzle/case6-puzzle-1-b.jpg', null],
        title: 'Spot the difference',
        text: 'A picture puzzle: every difference shows in one of the two colours. One of them is circled: an annotation (the pen button next to the zoom draws your own). ' +
          'Side by side, both pictures move and zoom together.',
        tryit: { label: 'Try it: side by side, zoomed in', act: 'sidebyside' } },
      { label: 'Bent page', files: [X + 'bent-1.jpg', X + 'bent-2.jpg', null],
        title: 'A bent page',
        text: 'Copy B was photographed in the bound book: towards the binding its lines bend. Moving the whole page at once leaves much in colour; ' +
          'the tiles follow the curve, and only the one changed word is left.',
        tryit: { label: 'Try it: the whole-page step only', act: 'rough', back: 'Back to the tile alignment' } },
      { label: 'The whole book', files: [X + 'book-1.jpg', X + 'book-2.jpg', X + 'book-3.jpg'],
        title: 'The whole book',
        text: 'In the Pages view every copy is a column and every page a row. This project has three copies; copy C has only this page. ' +
          'The flag on the movement-map page and the note on the puzzle are there too.',
        tryit: { label: 'Try it: open the Pages view', act: 'pages' } }
    ],
    // what the project holds besides the pictures (row numbers as in list)
    flags: { 2: 2 },
    annotations: { 3: [{ id: 1, t: 'ellipse', x: 0.79, y: 0.29, w: 0.19, h: 0.18, col: 1, text: 'One of the differences', pair: [1, 2] }] },
    credit: 'The book, music and puzzle pictures: Image Compare (VGG, University of Oxford).'
  };
})();
