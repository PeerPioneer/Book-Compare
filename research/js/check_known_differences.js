'use strict';
/* Check against known differences (PLAN.md section 4.4): is the alignment still right, and do the differences that are known
   from the owner's list (Mein Artikel\List of Differences.odt) stay visible?  Needs the test scans (not part of the repository):
       node check_known_differences.js "<folder 'Example pages'>"
   Case 1: Melopoiae, table of contents (List of Differences.odt, "Pair 02"). Group A: A-Wn1, A-Wn2, B-Br, DK-Kk, CH-Bu, D-Mu.
           Group B: A-Z, D-Mbs. Known: in group B the poem lines 5, 9 and 13 stand much further to the right.
   Reference B-Br.  Measured: share of the ink in a region that has no partner within 1 px after alignment.
   Expected: the table (columns 2-4) matches in every copy (< 5 %); the three poem lines match for group A copies (< 10 %)
   and stay clearly different for the group B copy (> 50 %). Boxes are in pixels at the working height of 3000 px.
   Case 2 (optional, second argument = the folder with the Melopoiae scans "NN. [copy].jpg"): the Concert of Gods woodcut, Melopoiae p. 19,
   B-Br against D-Mu. The owner marked the white lines (fractures of the woodcut) in both copies (known_differences/woodcut_lines.json).
   Measured: along each marked line (band of +-5 px, hand-marking offset of up to 4 px allowed) the share of ink that has no partner in the
   other copy. A line that exists in only ONE copy must show up as unmatched ink in the OTHER copy; a line both copies share must match.
       node check_known_differences.js "<Example pages>" "<Melopoiae folder, with B-Br and D-Mu subfolders>"
   Case 3 (also with the second argument): Melopoiae p. 8 ("Pair 08: Tercia facies"). Reference B-Br (group B). A-Wn1 (group A) differs in the
   wording "me onii" (B, C: "meonii"), has no custos at the end of line 4, and sets "amando" differently; D-Mbs (group B) and CH-Bu, DK-Kk,
   D-Mu (group C) agree with B-Br in these places. Measured: share of the ink in a region without partner after alignment (both directions).
   Case 4 (first argument only): Liber selectarum cantionum f.19v, "Musical notation" (list of differences, Folio 19v). CH-E (group A1) against D-FUl
   (group A2) and US-CA (group B). A1 and A2 differ only in details, group B differs in several systems (text and notes). Measured: share of the
   ink in the whole printed area without partner: A1/A2 < 3 %, A1/B > 5 %. (The list names single notes; those regions are not yet in the check.)
   Two kinds of difference are only REPORTED, not asserted: the title and the kerning are "shifted slightly" in group A. After tile alignment
   they show as 0-3 % unmatched, i.e. the alignment absorbs a shift of a few pixels (an honest limit, see PLAN.md V16). */
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

/* ---- Case 3: Melopoiae p. 8 ---- */
const P08_REGIONS = {   // pixels at the working height of 3000 px (reference B-Br)
  title: [860, 210, 1260, 280], line1_notes: [420, 340, 1900, 500], hostium: [800, 1436, 940, 1490], meonii: [1110, 1436, 1200, 1490],
  custos_line4: [1760, 1200, 1910, 1380], ephesum: [1200, 2040, 1300, 2096], amando: [1310, 2350, 1470, 2400], staves_bottom: [420, 2420, 1900, 2600],
};
function pair08Case(cv, mel, rows) {
  const file = { 'A-Wn1': 'A-Wn1 - SA.76.A.3  31 MUS MAG', 'D-Mbs': 'D-Mbs', 'CH-Bu': 'CH-Bu', 'DK-Kk': 'DK-Kk', 'D-Mu': 'D-Mu' };
  let cache, total = 0, failed = 0;
  for (const copy of ['A-Wn1', 'D-Mbs', 'CH-Bu', 'DK-Kk', 'D-Mu']) {
    const r = alignPair(cv, path.join(mel, 'B-Br', '08. B-Br.jpg'), path.join(mel, file[copy], '08. ' + copy + '.jpg'), cache); cache = r.cache;
    for (const [name, box] of Object.entries(P08_REGIONS)) {
      const pct = 100 * unmatchedShare(cv, r.ref, r.aligned, box).share;
      let ok = null, expect = 'only reported';
      const diff = copy === 'A-Wn1';
      if (name === 'line1_notes' || name === 'staves_bottom') { ok = pct < 8; expect = 'matching (< 8 %)'; }
      else if (['meonii', 'amando'].includes(name)) { ok = diff ? pct > 10 : pct < 6; expect = diff ? 'different (> 10 %)' : 'matching (< 6 %)'; }
      else if (name === 'custos_line4') { ok = diff ? pct > 30 : pct < 8; expect = diff ? 'different (> 30 %)' : 'matching (< 8 %)'; }
      if (ok !== null) { total++; if (!ok) failed++; }
      rows.push(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  p.8  B-Br vs ${copy.padEnd(5)} ${name.padEnd(13)} ${pct.toFixed(1).padStart(5)} % unmatched   expected ${expect}`);
    }
  }
  return { total, failed };
}

/* ---- Case 4: Liber f.19v ---- */
function folio19vCase(cv, root, rows) {
  const f = c => path.join(root, 'Musical notation. ' + c);
  let cache, total = 0, failed = 0;
  for (const [copy, file, group, ok_] of [['D-FUl', 'D-FUl.jpg', 'A2', pct => pct < 3], ['US-CA', 'US-CA.jpg', 'B', pct => pct > 5]]) {
    const r = alignPair(cv, f('CH-E.JPG'), f(file), cache); cache = r.cache;
    const [x0, y0, x1, y1] = r.box, pct = 100 * unmatchedShare(cv, r.ref, r.aligned, [x0, y0, x1, y1]).share, ok = ok_(pct);
    total++; if (!ok) failed++;
    rows.push(`${ok ? 'PASS' : 'FAIL'}  f.19v  CH-E (A1) vs ${copy.padEnd(5)} (${group})  whole printed area ${pct.toFixed(1).padStart(5)} % unmatched   expected ${group === 'A2' ? 'nearly matching (< 3 %)' : 'clearly different (> 5 %)'}`);
  }
  return { total, failed };
}

/* The cases run in SEPARATE processes: each one decodes big scans, and OpenCV.js (WebAssembly) would run out of memory when all cases share one
   process. "--only=3" runs just case 3 (cases: 1 table of contents, 2 woodcut, 3 page 8, 4 folio 19v). Without it all cases run, one process each. */
function tocCase(cv, root, rows) {
  const dir = path.join(root, 'Melopoiae. Table of contents'), file = c => path.join(dir, 'Text. ' + c + '.jpg');
  let cache, failed = 0, total = 0;
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
  return { total, failed };
}
(async () => {
  const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
  const root = pos[0], mel = pos[1], only = (flags.find(a => a.startsWith('--only=')) || '').slice(7);
  if (!root) { console.error('usage: node check_known_differences.js "<Example pages folder>" ["<Melopoiae folder>"]'); process.exit(2); }
  if (!only) {                                                                               // parent: one child process per case
    const cp = require('child_process'); let failed = 0, total = 0;
    for (const k of mel ? ['1', '2', '3', '4'] : ['1', '4']) {
      const r = cp.spawnSync(process.execPath, [__filename, '--only=' + k, ...pos], { encoding: 'utf8', maxBuffer: 1 << 26 });
      process.stdout.write(r.stdout || ''); if (r.stderr) process.stderr.write(r.stderr);
      const m = /RESULT (\d+) (\d+)/.exec(r.stdout || ''); if (m) { total += +m[1]; failed += +m[2]; } else { failed++; total++; console.log(`FAIL  case ${k} did not finish (exit code ${r.status})`); }
    }
    if (!mel) console.log('(cases 2 and 3, Melopoiae woodcut and page 8, skipped: give the Melopoiae folder as second argument)');
    console.log(failed ? `\nKNOWN-DIFFERENCES CHECK FAILED: ${failed} of ${total}` : `\nKNOWN-DIFFERENCES CHECK OK (${total} of ${total})`);
    process.exit(failed ? 1 : 0);
  }
  const cv = await loadCv(), rows = [];
  const res = { 1: () => tocCase(cv, root, rows), 2: () => woodcutCase(cv, mel, rows), 3: () => pair08Case(cv, mel, rows), 4: () => folio19vCase(cv, root, rows) }[only]();
  console.log(rows.join('\n')); console.log(`RESULT ${res.total} ${res.failed}`);
  process.exit(0);
})().catch(e => { console.error(e && e.message ? e : (typeof e === 'number' && typeof cvGlobal !== 'undefined' ? e : 'error ' + e)); process.exit(1); });
