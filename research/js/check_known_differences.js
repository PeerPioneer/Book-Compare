'use strict';
/* Check against known differences (PLAN.md section 4.4): is the alignment still right, and do the differences that are known
   from Differences.odt / Differences.pdf stay visible?  Needs the test scans (not part of the repository):
       node check_known_differences.js "<folder 'Example pages'>"
   Case 1: Melopoiae, table of contents (Differences.pdf, "Pair 02"). Group A: A-Wn1, A-Wn2, B-Br, DK-Kk, CH-Bu, D-Mu.
           Group B: A-Z, D-Mbs. Known: in group B the poem lines 5, 9 and 13 stand much further to the right.
   Reference B-Br.  Measured: share of the ink in a region that has no partner within 1 px after alignment.
   Expected: the table (columns 2-4) matches in every copy (< 5 %); the three poem lines match for group A copies (< 10 %)
   and stay clearly different for the group B copy (> 50 %). Boxes are in pixels at the working height of 3000 px. */
const path = require('path');
const { loadCv, alignPair, unmatchedShare } = require('./align_chain');

const REGIONS = {
  table_cols_2_to_4: [770, 330, 1560, 1600],
  poem_line_5: [1033, 2160, 1617, 2233],
  poem_line_9: [1100, 2373, 1617, 2440],
  poem_line_13: [1067, 2593, 1617, 2657],
};
const CASES = [
  { copy: 'D-Mu', group: 'A' }, { copy: 'A-Wn1', group: 'A' }, { copy: 'CH-Bu', group: 'A' }, { copy: 'D-Mbs', group: 'B' },
];

(async () => {
  const root = process.argv[2];
  if (!root) { console.error('usage: node check_known_differences.js "<Example pages folder>"'); process.exit(2); }
  const dir = path.join(root, 'Melopoiae. Table of contents'), file = c => path.join(dir, 'Text. ' + c + '.jpg');
  const cv = await loadCv();
  let cache, failed = 0, total = 0;
  const rows = [];
  for (const { copy, group } of CASES) {
    const r = alignPair(cv, file('B-Br'), file(copy), cache); cache = r.cache;
    for (const [name, box] of Object.entries(REGIONS)) {
      const pct = 100 * unmatchedShare(cv, r.ref, r.aligned, box).share;
      const isPoem = name.startsWith('poem');
      const expectDifferent = isPoem && group === 'B';
      const ok = expectDifferent ? pct > 50 : (isPoem ? pct < 10 : pct < 5);
      total++; if (!ok) failed++;
      rows.push(`${ok ? 'PASS' : 'FAIL'}  B-Br vs ${copy.padEnd(5)} (group ${group})  ${name.padEnd(18)} ${pct.toFixed(1).padStart(5)} % unmatched   expected ${expectDifferent ? 'clearly different (> 50 %)' : (isPoem ? 'matching (< 10 %)' : 'matching (< 5 %)')}`);
    }
  }
  console.log(rows.join('\n'));
  console.log(failed ? `\nKNOWN-DIFFERENCES CHECK FAILED: ${failed} of ${total}` : `\nKNOWN-DIFFERENCES CHECK OK (${total} of ${total})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
