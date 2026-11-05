"""Tile-based (local) registration: after the whole page has been brought roughly into place, the page is cut into overlapping
square tiles; every tile of the reference is searched for in the other copy, and the little shifts found are smoothed into a
smooth movement field that is used to bend the second copy onto the first. This is repeated four times with smaller tiles.

Level = (tile size, step, search radius, outlier threshold) in pixels at the 3000 px working height:
    (384, 192, 56, 8.0)   large tiles, large search: catches what is left of the rough step
    (192,  96, 14, 3.0)
    ( 96,  48,  6, 2.0)
    ( 48,  24,  3, 1.5)   small tiles: follows local paper distortion
Tiles that contain almost no ink, or that find no convincing match, are replaced by the median of their neighbours
(in the spirit of Savino, whose repair idea this follows); isolated outliers are replaced the same way.
"""
import warnings
import numpy as np, cv2
from scipy.interpolate import RegularGridInterpolator
from scipy.ndimage import median_filter

LEVELS = [(384, 192, 56, 8.0), (192, 96, 14, 3.0), (96, 48, 6, 2.0), (48, 24, 3, 1.5)]

def blur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s)

def _subpixel(v, i):
    if 0 < i < len(v) - 1:
        den = v[i - 1] - 2 * v[i] + v[i + 1]
        return i + 0.5 * (v[i - 1] - v[i + 1]) / den if den else float(i)
    return float(i)

def measure_level(ref, mov, box, tile, step, search, min_ink=0.04, min_corr=0.45):
    """Shift of every tile. box = (x0, x1, y0, y1): the region (printed area plus a margin) in which tiles are placed."""
    x0, x1, y0, y1 = box
    xs = np.arange(x0, x1 - tile, step)
    ys = np.arange(y0, y1 - tile, step)
    SX = np.full((len(ys), len(xs)), np.nan, np.float32)
    SY = SX.copy()
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            t = ref[y:y + tile, x:x + tile]
            if t.mean() < min_ink:
                continue                                   # nearly empty tile: nothing to follow
            s = mov[y - search:y + tile + search, x - search:x + tile + search]
            r = cv2.matchTemplate(s, t, cv2.TM_CCOEFF_NORMED)
            _, best, _, (px, py) = cv2.minMaxLoc(r)
            if best < min_corr:
                continue                                   # no convincing match
            SX[j, i] = _subpixel(r[py, :], px) - search
            SY[j, i] = _subpixel(r[:, px], py) - search
    return xs + tile / 2, ys + tile / 2, SX, SY

def repair(S, threshold):
    """Fill missing tiles with the median of their valid neighbours; replace outliers by the local median."""
    S = S.copy()
    for _ in range(6):
        missing = np.isnan(S)
        if not missing.any():
            break
        P = np.pad(S, 1, constant_values=np.nan)
        stack = np.stack([P[1 + dy:P.shape[0] - 1 + dy, 1 + dx:P.shape[1] - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)      # all-empty neighbourhoods are expected
            neighbours = np.nanmedian(stack, axis=0)
        S = np.where(missing, neighbours, S)
    med = median_filter(np.nan_to_num(S), size=3, mode='nearest')
    bad = np.abs(S - med) > threshold
    return np.nan_to_num(np.where(bad, med, S)), int(bad.sum())

def dense_field(cx, cy, SX, SY, shape):
    """Interpolate the tile shifts to a shift for every pixel."""
    H, W = shape
    ix = RegularGridInterpolator((cy, cx), SX, bounds_error=False, fill_value=None)
    iy = RegularGridInterpolator((cy, cx), SY, bounds_error=False, fill_value=None)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    pts = np.stack([np.clip(yy, cy[0], cy[-1]).ravel(), np.clip(xx, cx[0], cx[-1]).ravel()], 1)
    return ix(pts).reshape(H, W).astype(np.float32), iy(pts).reshape(H, W).astype(np.float32), xx, yy

def tile_align(ref, mov, box, extras=(), levels=LEVELS):
    """Bend `mov` onto `ref` (both ink maps of the same size, already roughly aligned).
    `extras` are further pictures (e.g. the colour scan) that get exactly the same bending. Returns (mov, extras)."""
    extras = list(extras)
    for tile, step, search, threshold in levels:
        cx, cy, SX, SY = measure_level(blur(ref, 0.8), blur(mov, 0.8), box, tile, step, search)
        SX, _ = repair(SX, threshold)
        SY, _ = repair(SY, threshold)
        fx, fy, xx, yy = dense_field(cx, cy, SX, SY, ref.shape)
        mapx, mapy = xx + fx, yy + fy
        mov = cv2.remap(mov, mapx, mapy, cv2.INTER_LINEAR, borderValue=0)
        extras = [cv2.remap(e, mapx, mapy, cv2.INTER_LINEAR, borderValue=0) for e in extras]
    return mov, extras
