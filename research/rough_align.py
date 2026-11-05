"""Rough (whole-page) alignment of one scan onto another: scale + rotation/shear + shift (an affine transform).

Step 1: find scale and position. A small picture of the reference's printed area is searched for in the other copy at
        scales 0.70 ... 1.44 (step 0.02), at a quarter of the working resolution. Best match wins.
Step 2: refine with ECC (an iterative method that maximises the correlation of two pictures), first on heavily blurred
        pictures (sigma 8, 4), then on lightly blurred ones (sigma 2).
Step 3: two extra refinements that look only at places where both copies agree (so that parts that differ - a wrongly
        set letter, a stain - cannot pull the result away).
Known weak point: Step 1 can fail when the reference crop contains a lot of non-print (the D-W title page); the printed-area
box must therefore be right. This is on the to-do list (see ROADMAP.md).
"""
import numpy as np, cv2

def blur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s)

def local_correlation(a, b, s=40):
    A, B = blur(a, s), blur(b, s)
    ab = blur(a * b, s) - A * B
    va = blur(a * a, s) - A * A
    vb = blur(b * b, s) - B * B
    return ab / np.sqrt(np.maximum(va * vb, 1e-6))

def _ecc(ref, mov, W, mask, stages, size):
    cc = -1
    for sigma, iterations in stages:
        warped = cv2.warpAffine(mov, W, size, flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
        try:
            cc, C = cv2.findTransformECC(blur(ref, sigma), blur(warped, sigma), np.eye(2, 3, dtype=np.float32), cv2.MOTION_AFFINE,
                                         (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iterations, 1e-6), mask, 5)
        except cv2.error:
            return W, -1
        W = (np.vstack([W, [0, 0, 1]]) @ np.vstack([C, [0, 0, 1]]))[:2].astype(np.float32)
    return W, cc

def rough_align(ref, mov, box):
    """ref, mov: ink maps (same size). box = (x0, y0, x1, y1): printed area of the reference.
    Returns W (2x3, maps reference coordinates to coordinates in `mov`, i.e. use with WARP_INVERSE_MAP), ecc, template score, scale."""
    H, Wd = ref.shape
    size = (Wd, H)
    rx, ry, rx1, ry1 = box
    rw, rh = rx1 - rx, ry1 - ry
    mask = np.zeros(ref.shape, np.uint8)
    mask[ry:ry + rh, rx:rx + rw] = 1
    P4 = cv2.resize(blur(ref, 3)[ry:ry + rh, rx:rx + rw], None, fx=.25, fy=.25, interpolation=cv2.INTER_AREA)
    c = blur(mov, 3)
    best = (-1,)
    for s in np.arange(0.70, 1.45, 0.02):
        f = 0.25 / s
        C4 = cv2.resize(c, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        if C4.shape[0] < P4.shape[0] or C4.shape[1] < P4.shape[1]:
            continue
        r = cv2.matchTemplate(C4, P4, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(r)
        if mx > best[0]:
            best = (mx, s, loc)
    mx, s, loc = best
    if mx < 0:
        raise RuntimeError('rough alignment: reference area does not fit into the other scan at any scale')
    cx, cy = loc[0] * 4 * s, loc[1] * 4 * s
    W = np.array([[s, 0, cx - s * rx], [0, s, cy - s * ry]], np.float32)
    W, cc = _ecc(ref, mov, W, mask, [(8, 300), (4, 300), (2, 400)], size)
    for _ in range(2):
        warped = cv2.warpAffine(mov, W, size, flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
        agree = ((local_correlation(ref, warped) > 0.5) & (blur(ref, 15) > 0.08)).astype(np.uint8)
        agree = cv2.morphologyEx(agree, cv2.MORPH_CLOSE, np.ones((31, 31))) & mask
        W2, cc2 = _ecc(ref, mov, W, agree, [(3, 300), (1.5, 300)], size)
        if cc2 > 0:
            W, cc = W2, cc2
    return W, cc, mx, s
