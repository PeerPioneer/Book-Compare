"""Automatic proposal of the printed area of a scan (x0, y0, x1, y1), at the working height of 3000 px.

Idea: find where the print is, ignoring everything that is not print.
  1. ink map of the scan (see ink_map.py)
  2. drop big dark patches that touch the scan border (table, cover, spine shadow)
  3. drop long thin straight lines (page edges, frames, staff lines) - the notes and letters define the area instead
  4. drop long thick bands (scanner/board edges, page-edge shadows, frames)
  5. blur, threshold, join neighbouring ink into regions, remove thin leftovers
  6. take the biggest region that does not touch the scan border, plus smaller regions above/below it (headings)
Tested by eye on 116 scans (text, table, title, music, woodcut and coat-of-arms pages): 98 of 106 single-page scans right,
2 slightly too wide, 6 wrong; double-page spreads (about 10) need to be split into pages first.
It is only a proposal: Book Compare is meant to let the user correct the box by hand.
"""
import sys, numpy as np, cv2
from ink_map import load_scaled, ink_map, blur

def printed_box(im):
    a=ink_map(im).copy(); r=im[:,:,2]; Hh,Ww=a.shape
    # 1. big dark blobs touching the scan border (table, cover, spine shadow) -> not print
    dark=(r<60).astype(np.uint8); nl,lab,st,_=cv2.connectedComponentsWithStats(dark)
    for i in range(1,nl):
        x,y,w,h,ar=st[i]
        if ar>20000 and (x<=2 or y<=2 or x+w>=Ww-2 or y+h>=Hh-2): a[lab==i]=0
    # 2. long thin straight lines (page edges, frames, staff lines) -> not used to find the print; thick black areas are kept
    b=(a>0.5).astype(np.uint8); thick=cv2.dilate(cv2.morphologyEx(b,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9))),np.ones((7,7),np.uint8))
    Ln=250
    lh=cv2.morphologyEx(cv2.dilate(b,np.ones((7,1),np.uint8)),cv2.MORPH_OPEN,np.ones((1,Ln),np.uint8))
    lv=cv2.morphologyEx(cv2.dilate(b,np.ones((1,7),np.uint8)),cv2.MORPH_OPEN,np.ones((Ln,1),np.uint8))
    lines=cv2.dilate(lh|lv,np.ones((9,9),np.uint8)); lines[thick>0]=0
    a[lines>0]=0
    # 2b. long thick bands (scanner/board edges, page-edge shadows, frames): ink structures >=15 px wide and >=1200 px tall, or >=15 px tall and >=1000 px wide
    bands=cv2.dilate(cv2.morphologyEx(b,cv2.MORPH_OPEN,np.ones((1200,15),np.uint8))|cv2.morphologyEx(b,cv2.MORPH_OPEN,np.ones((15,1000),np.uint8)),np.ones((21,21),np.uint8)); a[bands>0]=0
    # 3. density of what is left, joined into regions; thin leftovers removed
    bw=(blur(a,25)>0.06).astype(np.uint8); bw=cv2.morphologyEx(bw,cv2.MORPH_CLOSE,np.ones((61,61),np.uint8)); bw=cv2.morphologyEx(bw,cv2.MORPH_OPEN,np.ones((101,101),np.uint8))
    nl,lab,st,_=cv2.connectedComponentsWithStats(bw)
    if nl<2: return (0,0,Ww,Hh)
    def touches(i): return st[i,0]<=2 or st[i,1]<=2 or st[i,0]+st[i,2]>=Ww-2 or st[i,1]+st[i,3]>=Hh-2   # frame / board remnants touch the scan border, print does not
    cand=[i for i in range(1,nl) if not touches(i)]
    if cand: bi=max(cand,key=lambda i:st[i,cv2.CC_STAT_AREA]); pool=cand
    else: bi=1+int(np.argmax(st[1:,cv2.CC_STAT_AREA])); pool=list(range(1,nl))
    bx0,bx1=st[bi,0],st[bi,0]+st[bi,2]
    keep=[bi]+[i for i in pool if i!=bi and st[i,cv2.CC_STAT_AREA]>=0.05*st[bi,cv2.CC_STAT_AREA] and (min(bx1,st[i,0]+st[i,2])-max(bx0,st[i,0]))>=0.5*st[i,2]]
    x0=int(min(st[i,0] for i in keep)); y0=int(min(st[i,1] for i in keep)); x1=int(max(st[i,0]+st[i,2] for i in keep)); y1=int(max(st[i,1]+st[i,3] for i in keep))
    return (x0,y0,x1,y1)


def with_margin(box, shape, fraction=0.04, minimum=40):
    """Grow the box by a small margin (4 % of its longer side, at least 40 px), clipped to the picture."""
    x0, y0, x1, y1 = box
    m = int(max(minimum, fraction * max(x1 - x0, y1 - y0)))
    h, w = shape[:2]
    return max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)

if __name__ == '__main__':
    # usage: python3 printed_area.py out.jpg scan1.jpg scan2.jpg ...   (draws the proposed box on small copies of the scans)
    out, paths = sys.argv[1], sys.argv[2:]
    tiles = []
    for p in paths:
        im = load_scaled(p)
        x0, y0, x1, y1 = printed_box(im)
        s = 330. / im.shape[0]
        t = cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA).astype(np.uint8)
        cv2.rectangle(t, (int(x0 * s), int(y0 * s)), (int(x1 * s), int(y1 * s)), (0, 0, 255), 2)
        tiles.append(t)
    hmax = max(t.shape[0] for t in tiles)
    cv2.imwrite(out, np.hstack([cv2.copyMakeBorder(t, 0, hmax - t.shape[0], 0, 6, cv2.BORDER_CONSTANT, value=(200, 200, 200)) for t in tiles]))
