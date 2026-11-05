#!/usr/bin/env python3
"""Align one scan onto another and report how well they agree. Needs: numpy, opencv-python, scipy.

    python3 align_pair.py reference.jpg other.jpg out_prefix [--rough-only]

Writes   out_prefix_overlay.png   reference in red, aligned copy in blue (agreement looks dark)
         out_prefix_aligned.png   the aligned ink map of the other copy
and prints the "unmatched ink" share: the part of all ink (in the printed area) that has no partner within 1 pixel in the
other copy. Lower is better. Typical values in our tests: rough ~ 5-12 %, after tile alignment ~ 1-2 %.
"""
import sys, time, numpy as np, cv2
from ink_map import load_scaled, ink_map
from printed_area import printed_box, with_margin
from rough_align import rough_align
from tile_align import tile_align

def unmatched_share(a, b, mask):
    A = (a > 0.5).astype(np.uint8)
    B = (b > 0.5).astype(np.uint8)
    K = np.ones((3, 3), np.uint8)
    ua = (A & (1 - cv2.dilate(B, K)) & mask).sum()
    ub = (B & (1 - cv2.dilate(A, K)) & mask).sum()
    return float((ua + ub) / max(1, (A & mask).sum() + (B & mask).sum()))

def main(ref_path, mov_path, prefix, rough_only=False):
    t0 = time.time()
    ref_im, mov_im = load_scaled(ref_path), load_scaled(mov_path)
    ref, mov = ink_map(ref_im), ink_map(mov_im)
    H, W = ref.shape
    x0, y0, x1, y1 = printed_box(ref_im)
    mask = np.zeros(ref.shape, np.uint8)
    mask[y0:y1, x0:x1] = 1
    Wm, ecc, score, scale = rough_align(ref, mov, (x0, y0, x1, y1))
    warped = cv2.warpAffine(mov, Wm, (W, H), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
    print('rough: scale %.2f, template score %.2f, ecc %.3f, unmatched ink %.1f %%  (%.0f s)' % (scale, score, ecc, 100 * unmatched_share(ref, warped, mask), time.time() - t0))
    result = warped
    if not rough_only:
        bx0, by0, bx1, by1 = with_margin((x0, y0, x1, y1), ref.shape, fraction=0.02, minimum=60)
        box = (max(60, bx0), min(W - 60, bx1), max(60, by0), min(H - 60, by1))
        result, _ = tile_align(ref, warped, box)
        print('tile : unmatched ink %.1f %%  (%.0f s)' % (100 * unmatched_share(ref, result, mask), time.time() - t0))
    r, g = np.clip(ref, 0, 1), np.clip(result, 0, 1)
    overlay = np.stack([255 - 255 * r, 255 - 255 * np.maximum(r, g), 255 - 255 * g], axis=2)   # BGR: reference red, other copy blue, both dark
    small = cv2.resize(overlay.astype(np.uint8), None, fx=0.3, fy=0.3, interpolation=cv2.INTER_AREA)
    cv2.imwrite(prefix + '_overlay.png', small)
    cv2.imwrite(prefix + '_aligned.png', (255 - 255 * np.clip(result, 0, 1)).astype(np.uint8))

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 3:
        sys.exit(__doc__)
    main(*args, rough_only='--rough-only' in sys.argv)
