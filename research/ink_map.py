"""Ink map: turns a scan into a picture where printed ink is 1 and paper is 0.

Recipe (the same one used in all tests):
  1. take the red channel (printed ink is dark in red; red library stamps and red rubrication nearly vanish)
  2. divide by a smooth estimate of the paper brightness (dilate 15x15, then Gaussian sigma 25), so shadows and stains drop out
  3. choose the ink/paper threshold automatically (Otsu) from the central half of the page
  4. soft ramp around the threshold, so thin strokes keep partial values instead of being cut off
All scans are first resized to the same height (3000 px) so that sizes are comparable.
"""
import numpy as np, cv2

H0 = 3000

def blur(x, sigma):
    return cv2.GaussianBlur(x, (0, 0), sigma)

def load_scaled(path, height=H0):
    im = cv2.imread(path)
    if im is None:
        raise RuntimeError('cannot read ' + path)
    im = im.astype(np.float32)
    s = height / im.shape[0]
    return cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)

def ink_map(im):
    r = im[:, :, 2]
    paper = cv2.GaussianBlur(cv2.dilate(r, np.ones((15, 15))), (0, 0), 25)
    n = np.clip(r / np.maximum(paper, 1), 0, 1.2)
    h, w = n.shape
    centre = n[h // 4:3 * h // 4, w // 4:3 * w // 4]
    t, _ = cv2.threshold((np.clip(centre, 0, 1) * 255).astype(np.uint8), 0, 255, cv2.THRESH_OTSU)
    t /= 255.
    k = cv2.GaussianBlur(n, (0, 0), 0.7)
    return np.clip(0.5 + (t - k) / (0.5 * (1 - t) + 1e-4) * 0.5, 0, 1).astype(np.float32)
