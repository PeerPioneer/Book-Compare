"""Stand-in for Photoshop's crop and save, used only by test_split_script.js:  python3 crop_helper.py size SRC   |   save SRC L T R B OUT KIND QUALITY"""
import sys, json
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
cmd = sys.argv[1]
if cmd == 'size':
    print(json.dumps(Image.open(sys.argv[2]).size))
elif cmd == 'save':
    src, l, t, r, b, out, kind, q = sys.argv[2], *map(int, sys.argv[3:7]), sys.argv[7], sys.argv[8], int(sys.argv[9])
    im = Image.open(src).convert('RGB').crop((l, t, r, b))
    if kind == 'jpg': im.save(out, 'JPEG', quality=max(1, q * 8))
    elif kind == 'tif': im.save(out, 'TIFF', compression='tiff_lzw')
    else: im.save(out, 'PNG')
