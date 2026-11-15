'use strict';
/* Check against known differences (PLAN.md section 4.4): is the alignment still right, and do the differences that are known
   from Differences.odt / Differences.pdf stay visible?  Needs the test scans (not part of the repository):
       node check_known_differences.js "<folder 'Example pages'>"
   Case 1: Melopoiae, table of contents (Differences.pdf, "Pair 02"). Group A: A-Wn1, A-Wn2, B-Br, DK-Kk, CH-Bu, D-Mu.
           Group B: A-Z, D-Mbs. Known: in group B the poem lines 5, 9 and 13 stand much further to the right.
   Reference B-Br.  Measured: share of the ink in a region that has no partner within 1 px after alignment.
   Expected: the table (columns 2-4) matches in every copy (< 5 %); the three poem lines match for group A copies (< 10 %)
   and stay clearly different for the group B copy (> 50 %). Boxes are in pixels at the working height of 3000 px.
   Case 2 (optional, second argument = the folder with the Melopoiae scans "NN. [copy].jpg"): the Concert of Gods woodcut, Melopoiae p. 19,
   B-Br against D-Mu. The owner marked the white lines (fractures of the woodcut) in both copies (known_differences/woodcut_lines.json).
   Measured: along each marked line (band of +-5 px, hand-marking offset of up to 4 px allowed) the share of ink that has no partner in the
   other copy. A line that exists in only ONE copy must show up as unmatched ink in the OTHER copy; a line both copies share must match.
       node check_known_differences.js "<Example pages>" "<Melopoiae folder, with B-Br and D-Mu subfolders>" */
const path = require('path'), fs = require('fs');
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


/* ---- Case 2: woodcut lines ---- */
function inkBand(cv, ref, aligned, pts, scale, shift, orient, half) {
  const w = ref.cols, h = ref.rows, r = ref.data32F, a = aligned.data32F;
  const band = new Uint8Array(w * h);
  const q = pts.map(p => [p[0] * scale + (orient === 'v' ? shift : 0), p[1] * scale + (orient === 'h' ? shift : 0)]);
  for (let i = 0; i + 1 < q.length; i++) {                                         // join the points with straight pieces
    const n = Math.max(1, Math.ceil(Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1])));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(q[i][0] + (q[i + 1][0] - q[i][0]) * k / n), y = Math.round(q[i][1] + (q[i + 1][1] - q[i][1]) * k / n);
      for (let d = -half; d <= half; d++) { const xx = orient === 'v' ? x + d : x, yy = orient === 'h' ? y + d : y; if (xx >= 0 && yy >= 0 && xx < w && yy < h) band[yy * w + xx] = 1; }
    }
  }
  const has = (m, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx] > 0.5) return true; } return false; };
  let nr = 0, na = 0, ur = 0, ua = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!band[y * w + x]) continue;
    if (r[y * w + x] > 0.5) { nr++; if (!has(a, x, y)) ur++; }
    if (a[y * w + x] > 0.5) { na++; if (!has(r, x, y)) ua++; }
  }
  return { refUnmatched: 100 * ur / Math.max(nr, 1), movUnmatched: 100 * ua / Math.max(na, 1), nr, na };
}
function woodcutCase(cv, mel, rows) {
  const lines = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'known_differences', 'woodcut_lines.json'), 'utf8'));
  const r = alignPair(cv, path.join(mel, 'B-Br', '19. B-Br.jpg'), path.join(mel, 'D-Mu', '19. D-Mu.jpg'));
  const scale = r.ref.rows / lines.reference_size[1];
  let total = 0, failed = 0;
  for (const L of lines.lines) {
    let best = null;
    for (let sft = -4; sft <= 4; sft++) { const m = inkBand(cv, r.ref, r.aligned, L.points, scale, sft, L.orientation, 5); const sc = Math.max(m.refUnmatched, m.movUnmatched); if (!best || sc > best.sc) best = { sc, m, sft }; }
    const m = best.m, label = `B-Br vs D-Mu  woodcut line "${L.description}" (marked in ${L.marked_in})`;
    let ok, expect;
    if (L.present_in === 'both') { ok = m.refUnmatched < 3 && m.movUnmatched < 3; expect = 'both copies match (< 3 % unmatched)'; }
    else if (L.present_in === 'B-Br') { ok = m.refUnmatched < 3 && m.movUnmatched > 15; expect = 'D-Mu ink unmatched > 15 %, B-Br < 3 %'; }
    else if (/Mercury/.test(L.description)) { ok = null; expect = 'hairline, only reported (too thin for the working resolution)'; }
    else { ok = m.refUnmatched > 10; expect = 'B-Br ink unmatched > 10 %'; }
    if (ok !== null) { total++; if (!ok) failed++; }
    rows.push(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${label}: B-Br ink unmatched ${m.refUnmatched.toFixed(1)} %, D-Mu ink unmatched ${m.movUnmatched.toFixed(1)} %   expected ${expect}`);
  }
  return { total, failed };
}

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
  if (process.argv[3]) { const w = woodcutCase(cv, process.argv[3], rows); total += w.total; failed += w.failed; }
  else rows.push('(case 2, the woodcut lines, skipped: give the Melopoiae folder as second argument)');
  console.log(rows.join('\n'));
  console.log(failed ? `\nKNOWN-DIFFERENCES CHECK FAILED: ${failed} of ${total}` : `\nKNOWN-DIFFERENCES CHECK OK (${total} of ${total})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
