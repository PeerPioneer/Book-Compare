"""Automatic page matching between two copies of the same book (research prototype, Python + OpenCV).

Question answered: "which page of copy B shows the same printed page as page i of copy A?"

Method (see FINDINGS.md, section 7):
  1. Page fingerprint: ink map (red channel, background-normalised), big dark blobs touching the border removed, 2 % border
     removed, long straight horizontal/vertical lines removed (staves, frames, page edges), shrunk to 240 px height, blurred.
  2. Similarity of two pages: best normalised cross-correlation over 13 scales (0.7 - 1.45), so that different scan sizes
     and zoom levels do not matter. Near-blank pages get similarity 0.
  3. Matching in two stages (this is what makes the result robust):
     a) ANCHORS: pairs that are each other's best match, clearly better than the runner-up (margin 0.05) and similar enough
        (>= 0.3). No page order is assumed, so swapped or shifted pages (e.g. versos listed one leaf off) are found.
     b) FILL: the remaining pages are matched with a page-order-preserving dynamic programme (threshold tau = 0.25).
        These matches are "probable"; anchors are "sure".

Usage:  python3 page_matching.py folderA folderB      (each folder: scans in page order, any size)
No scan images are stored in this repository; run it on your own copies (it only reads files).
"""
import sys, glob, os
import numpy as np, cv2

LH = 240                      # fingerprint height in px
SCALES = np.exp(np.linspace(np.log(0.7), np.log(1.45), 13))
LINE_FRAC = 0.05              # lines longer than 5 % of the page height are removed
H_WORK = 1000                 # working height for the ink map


def _odd(v, k, lo=3):
    v = max(lo, int(round(v * k)))
    return v if v % 2 else v + 1


def ink_map(im, k):
    r = im[:, :, 2].astype(np.float32)
    paper = cv2.GaussianBlur(cv2.dilate(r, np.ones((_odd(15, k), _odd(15, k)))), (0, 0), 25 * k)
    n = np.clip(r / np.maximum(paper, 1), 0, 1.2)
    h, w = n.shape
    c = n[h // 4:3 * h // 4, w // 4:3 * w // 4]
    t, _ = cv2.threshold((np.clip(c, 0, 1) * 255).astype(np.uint8), 0, 255, cv2.THRESH_OTSU)
    t /= 255.
    kk = cv2.GaussianBlur(n, (0, 0), max(0.5, 0.7 * k * 1.5))
    return np.clip(0.5 + (t - kk) / (0.5 * (1 - t) + 1e-4) * 0.5, 0, 1).astype(np.float32)


def fingerprint(path):
    im = cv2.imread(path)
    if im is None:
        raise RuntimeError('cannot read ' + path)
    s = H_WORK / im.shape[0]
    im = cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA).astype(np.float32)
    k = im.shape[0] / 3000.
    a = ink_map(im, k)
    hh, ww = a.shape
    dark = (im[:, :, 2] < 60).astype(np.uint8)
    nl, lab, st, _ = cv2.connectedComponentsWithStats(dark)
    for i in range(1, nl):
        x, y, w, h, ar = st[i]
        if ar > 20000 * k * k and (x <= 2 or y <= 2 or x + w >= ww - 2 or y + h >= hh - 2):
            a[lab == i] = 0
    m = int(0.02 * hh)
    a[:m] = 0; a[-m:] = 0; a[:, :m] = 0; a[:, -m:] = 0
    b = (a > 0.5).astype(np.uint8)
    L = max(9, int(LINE_FRAC * hh))
    lines = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((1, L), np.uint8)) | cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((L, 1), np.uint8))
    a[cv2.dilate(lines, np.ones((3, 3), np.uint8)) > 0] = 0
    f = LH / hh
    sm = cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(sm, (0, 0), 1.2).astype(np.float32)


def similarity(a, b):
    if a.sum() < 8 or b.sum() < 8:
        return 0.0
    best = -1.0
    ph, pw = a.shape
    for s in SCALES:
        bb = cv2.resize(b, None, fx=s, fy=s, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
        py = max(0, ph - bb.shape[0]) + ph // 5
        px = max(0, pw - bb.shape[1]) + pw // 5
        p = cv2.copyMakeBorder(bb, py, py, px, px, cv2.BORDER_CONSTANT, value=0)
        v = float(cv2.matchTemplate(p, a, cv2.TM_CCOEFF_NORMED).max())
        best = max(best, v)
    return best


def similarity_matrix(fa, fb):
    return np.array([[similarity(a, b) for b in fb] for a in fa])


def ordered_matches(S, tau):
    """Page-order-preserving matching: maximise the sum of (similarity - tau) over pairs with similarity > tau; gaps are free."""
    n, m = S.shape
    D = np.zeros((n + 1, m + 1))
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            w = S[i - 1, j - 1] - tau
            D[i, j] = max(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1] + w if w > 0 else -1)
    i, j, out = n, m, []
    while i > 0 and j > 0:
        w = S[i - 1, j - 1] - tau
        if w > 0 and abs(D[i, j] - (D[i - 1, j - 1] + w)) < 1e-9:
            out.append((i - 1, j - 1)); i -= 1; j -= 1
        elif D[i, j] == D[i - 1, j]:
            i -= 1
        else:
            j -= 1
    return out[::-1]


def anchors(S, min_sim=0.3, margin=0.05):
    out = []
    for i in range(S.shape[0]):
        j = int(S[i].argmax())
        if int(S[:, j].argmax()) != i:
            continue
        r = np.sort(S[i])[::-1]; c = np.sort(S[:, j])[::-1]
        if r[0] < min_sim or r[0] - r[1] < margin or c[0] - c[1] < margin:
            continue
        out.append((i, j))
    return out


def match_pages(S, tau=0.25):
    """Returns (sure, probable): lists of (index in A, index in B), both 0-based."""
    an = anchors(S)
    ra = {i for i, _ in an}; cb = {j for _, j in an}
    ri = [i for i in range(S.shape[0]) if i not in ra]
    ci = [j for j in range(S.shape[1]) if j not in cb]
    fill = []
    if ri and ci:
        fill = [(ri[a], ci[b]) for a, b in ordered_matches(S[np.ix_(ri, ci)], tau)]
    return an, fill


if __name__ == '__main__':
    def scans(d):
        return sorted(f for f in glob.glob(os.path.join(d, '*')) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    A, B = scans(sys.argv[1]), scans(sys.argv[2])
    S = similarity_matrix([fingerprint(f) for f in A], [fingerprint(f) for f in B])
    sure, probable = match_pages(S)
    for tag, pairs in (('sure', sure), ('probable', probable)):
        for i, j in sorted(pairs):
            print('%-8s %s  <->  %s   (similarity %.2f)' % (tag, os.path.basename(A[i]), os.path.basename(B[j]), S[i, j]))
