/* Book Compare - the examples project (0.11.0).

   "Try the examples" on the start screen opens a small project made of pictures that come with Book Compare: each row (page) is
   one example pair, the first one a welcome page. It replaces the old "Compare two single pictures" and "Try the samples" screens
   of Image Compare. The examples are read only in the sense that nothing is saved: workspace.js builds the project in memory
   (BookWorkspace.openExamples) and the Compare tab shows the card of each example (compare-tab.js).

   The pairs after the welcome page are the ones of Image Compare (VGG, Oxford) that the alignment for printed pages handles well;
   the photographs (portrait, painting, satellite pictures) are left out: Book Compare looks at dark ink only. */
(function () {
  'use strict';
  var U = 'images/usecases/';
  window.BCExamples = {
    copies: ['Copy A', 'Copy B'],
    list: [
      { label: 'Welcome', files: ['images/examples/welcome-1.jpg', 'images/examples/welcome-2.jpg'], welcome: true,
        title: 'Welcome to Book Compare',
        text: 'These are examples: every page in the list on the left is one pair of pictures. Book Compare has laid copy B over copy A, ' +
          'bent it into place and coloured what differs. Here the year was changed while the sheets were printed, and a reader made a pen mark in copy B.' },
      { label: 'Book', files: [U + 'book/case2-traherne2-a-original.jpg', U + 'book/case2-traherne2-b-original.jpg'],
        title: 'The same page in two copies',
        text: 'Ben Jonson, “Epicoene, or The silent Woman”, page 529, in two copies. The heading was set with different type; the text below lines up. ' +
          'The two photos were taken differently (size, slant, light): the alignment takes care of that.' },
      { label: 'Music', files: [U + 'music/case5-music-sheet-1.jpg', U + 'music/case5-music-sheet-2.jpg'],
        title: 'Two editions of a music page',
        text: 'One page of an opera score in two editions. The upper systems agree; the last one was engraved anew, so it shows in both colours. ' +
          'Book Compare points out the shifted block in the left panel, and because so much ink differs it asks whether this is the same page at all. ' +
          'Try the movement map under “Alignment of this page”.' },
      { label: 'Spot the difference', files: [U + 'puzzle/case6-puzzle-1-a.jpg', U + 'puzzle/case6-puzzle-1-b.jpg'],
        title: 'Spot the difference',
        text: 'A picture puzzle: every difference between the two drawings shows in one of the two colours. ' +
          'Key 2 (Toggle) shows the two pictures one after the other.' }
    ],
    credit: 'Example pictures after the welcome page: Image Compare (VGG, University of Oxford).'
  };
})();
