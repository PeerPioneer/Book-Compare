const MAX_DIM = Infinity; // always compare at full resolution - no downscaling
const COLOR_CHANNELS = {
    red: "#F00",
    green: "#0F0",
    blue: "#00F",
    // Difference mode blends this with red using additive ("lighter")
    // blending - see draw_diff_image() below. For a spot that's blank/white
    // in both images to come out white (not tinted), this color plus red
    // must add up to exactly white: red (255,0,0) + this must equal
    // (255,255,255), which only works for full-strength cyan (0,255,255).
    // A duller shade like teal breaks that and tints the whole background.
    bg: "#0FF",
    rg: "#FF0",
    rb: "#F0F",
    rgb: "#FFF",
};

// Colours of the Difference view: ink that is only in image 1 / only in image 2.
// The user can change them via More > "Change colors (Difference mode)";
// the choice is remembered in this browser (if it allows storing).
const DIFF_PRESETS = [
    { id: "blue-red",    name: "Blue / red",    c1: "#0046C8", c2: "#E60000", n1: "Blue",   n2: "Red",
      note: "Default. Clear for all common forms of colour blindness." },
    { id: "teal-pink",   name: "Teal / pink",   c1: "#00A09A", c2: "#E6007E", n1: "Teal",   n2: "Pink",
      note: "Hard to tell apart with red-green colour blindness (the two look alike)." },
    { id: "green-red",   name: "Green / red",   c1: "#00961E", c2: "#FF0000", n1: "Green",  n2: "Red",
      note: "Hard to tell apart with red-green colour blindness." },
    { id: "blue-orange", name: "Blue / orange", c1: "#005AC8", c2: "#E66100", n1: "Blue",   n2: "Orange",
      note: "Clear for all common forms of colour blindness." },
];
let DIFF_COLOR_1 = DIFF_PRESETS[0].c1;
let DIFF_COLOR_2 = DIFF_PRESETS[0].c2;
try {
    const saved = JSON.parse(localStorage.getItem("bookcompare_diff_colors") || "null");
    const ok = (c) => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c);
    if (saved && ok(saved.c1) && ok(saved.c2)) { DIFF_COLOR_1 = saved.c1; DIFF_COLOR_2 = saved.c2; }
} catch (e) { /* storing is optional */ }

const set_diff_colors = (c1, c2) => {
    DIFF_COLOR_1 = c1;
    DIFF_COLOR_2 = c2;
    try { localStorage.setItem("bookcompare_diff_colors", JSON.stringify({ c1, c2 })); } catch (e) {}
    document.dispatchEvent(new CustomEvent("diffcolorschange"));
};

// Turns the picture on this canvas into an "ink layer": blank paper becomes
// white and printed ink is tinted with `color`.
// 0.11.0 (whole pages tinted in one copy's colour): the paper is measured
//  - only on the page itself: the parts of the canvas outside the aligned
//    copy (transparent) no longer count as "paper" (they made the paper
//    level pure white, so the real paper came out tinted), and
//  - locally: a coarse map of the paper brightness (darker towards the
//    binding, uneven light, a photographed page) is divided out first
//    ("flat field"), so every part of the paper comes out white. The map may
//    only lighten the page by a limited amount, so large areas of ink (a
//    woodcut) stay dark.
// `lighten` (0..1, optional, per copy) pushes light grey (paper tone,
// show-through, stains) further towards white.
const PAPER_GRID = 48;          // cells across the longer side of the page
const inkLayer = (_ctx, color, lighten = 0) => {
    const c = _ctx.canvas, W = c.width, H = c.height;
    if (!W || !H) return;
    // a medium-size copy for measuring (transparent = outside the page)
    const k = Math.min(1, 720 / Math.max(W, H));
    const mw = Math.max(1, Math.round(W * k)), mh = Math.max(1, Math.round(H * k));
    const med = document.createElement("canvas");
    med.width = mw; med.height = mh;
    const mctx = med.getContext("2d", { willReadFrequently: true });
    mctx.drawImage(c, 0, 0, mw, mh);
    const d = mctx.getImageData(0, 0, mw, mh).data;
    const lum = new Uint8Array(mw * mh), on = new Uint8Array(mw * mh);
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
        if (d[i + 3] < 200) continue;                       // outside the page
        const v = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;
        lum[j] = v; on[j] = 1; hist[v]++; n++;
    }
    let level = 255;
    if (n) { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.9 * n) { level = v; break; } } }
    const g = Math.min(1, Math.max(0.5, level / 255));      // the paper of the whole page (90th percentile)

    // the paper map: per cell the 90th percentile, then the brightest of the
    // neighbouring cells (a cell full of notes is not paper), limited to
    // 80-100 % of the whole page's paper
    const cs = Math.max(4, Math.round(Math.max(mw, mh) / PAPER_GRID));
    const gw = Math.ceil(mw / cs), gh = Math.ceil(mh / cs);
    const cell = new Float32Array(gw * gh).fill(-1);
    const ch = new Uint32Array(256);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        ch.fill(0); let m = 0;
        const x1 = Math.min(mw, (gx + 1) * cs), y1 = Math.min(mh, (gy + 1) * cs);
        for (let y = gy * cs; y < y1; y++) for (let x = gx * cs, o = y * mw + x; x < x1; x++, o++) if (on[o]) { ch[lum[o]]++; m++; }
        if (m < cs * cs * 0.3) continue;                    // mostly outside the page
        let acc = 0, v = 255; for (let t = 0; t < 256; t++) { acc += ch[t]; if (acc >= 0.9 * m) { v = t; break; } }
        cell[gy * gw + gx] = v / 255;
    }
    const pm = document.createElement("canvas");
    pm.width = gw; pm.height = gh;
    const pctx = pm.getContext("2d");
    const pd = pctx.createImageData(gw, gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let best = -1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx, y = gy + dy;
            if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
            best = Math.max(best, cell[y * gw + x]);
        }
        const v = best < 0 ? g : Math.min(1, Math.max(0.8 * g, best));
        const inv = Math.round((1 - v) * 255), o = (gy * gw + gx) * 4;
        pd.data[o] = pd.data[o + 1] = pd.data[o + 2] = inv; pd.data[o + 3] = 255;
    }
    pctx.putImageData(pd, 0, 0);

    // put the scan on white (outside the page = blank paper), grey
    _ctx.save();
    _ctx.globalCompositeOperation = "destination-over";
    _ctx.fillStyle = "#FFF";
    _ctx.fillRect(0, 0, W, H);
    _ctx.restore();
    grayscale(_ctx);
    // divide by the paper map: colour-dodge with (1 - paper) = scan / paper
    _ctx.save();
    _ctx.globalCompositeOperation = "color-dodge";
    _ctx.imageSmoothingEnabled = true;
    _ctx.imageSmoothingQuality = "high";
    _ctx.drawImage(pm, 0, 0, W, H);
    _ctx.restore();

    // stretch so that paper -> white and the darker ink -> full ink strength
    const L = Math.min(Math.max(+lighten || 0, 0), 1);
    const p = 0.95 - 0.15 * L;                             // light grey (paper texture) counts as paper; "whiter" goes further
    const lo = 0.45 * p;
    const m = 1 / (p - lo);
    const q = -lo * m;
    const cc = 1 - 2 * q;
    const b = m / cc;
    const tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = H;
    tmp.getContext("2d").drawImage(c, 0, 0);
    _ctx.save();
    _ctx.clearRect(0, 0, W, H);
    _ctx.filter = `brightness(${b}) contrast(${cc})`;
    _ctx.drawImage(tmp, 0, 0);
    _ctx.restore();

    // "screen" with the colour: white stays white, black (ink) becomes `color`
    _ctx.save();
    _ctx.globalCompositeOperation = "screen";
    _ctx.fillStyle = color;
    _ctx.fillRect(0, 0, W, H);
    _ctx.restore();
};

const multiplyChannel = (_ctx, cname) => {
    _ctx.save();
    _ctx.fillStyle = COLOR_CHANNELS[cname] || "#000";
    _ctx.globalCompositeOperation = "multiply";
    _ctx.fillRect(0, 0, _ctx.canvas.width, _ctx.canvas.height);
    _ctx.restore();
};
const grayscale = (_ctx) => {
    _ctx.save();
    _ctx.fillStyle = "#000";
    _ctx.globalCompositeOperation = "saturation";
    _ctx.fillRect(0, 0, _ctx.canvas.width, _ctx.canvas.height);
    _ctx.restore();
};

const copyImage = (_ctx, _img, bbox = null) => {
    // Copy image to canvas
    const iw = _img.naturalWidth || _img.width;
    const ih = _img.naturalHeight || _img.height;
    _ctx.canvas.width = (bbox === null ? iw : bbox.width);
    _ctx.canvas.height = (bbox === null ? ih : bbox.height);
    _ctx.clearRect(0, 0, _ctx.canvas.width, _ctx.canvas.height);
    if (bbox === null) {
        _ctx.drawImage(_img, 0, 0);
    } else {
        _ctx.drawImage(_img,
            bbox.x,
            bbox.y,
            bbox.width,
            bbox.height,
            0,
            0,
            _ctx.canvas.width,
            _ctx.canvas.height
        );
    }
};

const debounce = (f, delay=250) => {
    let timeout = null;
    return () => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(f, delay);
    }
}

const getImageBounds = (img, cw, ch) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    let rh = 0;
    let rw = 0;
    // Get Image and Rendered Canvas Aspect ratio
    const iar = iw / ih;
    const ar = cw / ch;

    if (iar < ar) {
        // Rendered on a wider canvas
        rh = ch;
        rw = rh * iar;
    } else {
        // Rendered on a taller canvas
        rw = cw;
        rh = rw / iar;
    }
    return {
        offset_x: (cw - rw) / 2,
        offset_y: (ch - rh) / 2,
        width: rw,
        height: rh
    }
}

class Visualization {

    constructor(c, transform) {
        this.c = c;
        this.canvas = c.querySelector("canvas");
        this.primary_colour = getComputedStyle(document.documentElement).getPropertyValue('--mdc-theme-primary') || "#6200ee";
        this.transform = transform;

        // Canvas to hold the transformed result
        this.tcanvas = document.createElement('canvas')

        // Temporary canvas to read / write image data
        this.bcanvas = document.createElement('canvas');

        // Temporary canvas to use for computing diff
        this.dcanvas = document.createElement('canvas');

        // Holds image 1 (the reference everything else is aligned to), so
        // every visualisation mode draws from the same picture.
        this.ocanvas = document.createElement('canvas');
        this.octx = this.ocanvas.getContext('2d');

        this.bcanvas.width = this.tcanvas.width = this.dcanvas.width = this.canvas.width;
        this.bcanvas.height = this.tcanvas.height = this.dcanvas.height = this.canvas.height;

        this.ctx = this.canvas.getContext('2d');
        this.bctx = this.bcanvas.getContext('2d');
        this.tctx = this.tcanvas.getContext('2d');
        this.dctx = this.dcanvas.getContext('2d');

        this.selected_filename_list = [];

        // Internal state
        this._input_image = null;
        this._image_bounds = {
            offset_x: 0,
            offset_y: 0,
            width: 0,
            height: 0,
        };

        this._identity = {
            scale: 1.0,
            tx: 0.0,
            ty: 0.0
        };
        this._current_transform = Object.assign({}, this._identity);

        window.addEventListener('resize', debounce(() => {
            this._measure_canvas();
        }));
    }
    _measure_canvas() {
        const { width, height } = this.canvas.getBoundingClientRect();
        if (this._input_image) {
            this._image_bounds = getImageBounds(
                this._input_image,
                width,
                height
            );
        }
    }

    get current_transform () {
        return this._current_transform;
    }

    set current_transform(val) {
        this._current_transform = Object.assign({}, val);
    }

    get width() {
        return this.canvas.width;
    }

    get height() {
        return this.canvas.height;
    }

    get input_image(){
        return this._input_image;
    }

    set input_image(val) {
        this._input_image = val;
    }

    // Image 2 after it has been moved onto image 1
    get aligned() {
        return this.tcanvas;
    }

    set_filename_list(filename_list) {
        this.selected_filename_list = filename_list;
    }

    process(img1, img2, transform) {
        const im1Data = this.getImageData(img1);
        const im2Data = this.getImageData(img2);

        // Image 1 is the reference: it is kept as it is and used as
        // input_image from now on, so Toggle/Difference/etc. all draw from it.
        this.ocanvas.width = im1Data.width;
        this.ocanvas.height = im1Data.height;
        this.octx.putImageData(im1Data, 0, 0);
        this.input_image = this.ocanvas;

        const buf = this.transform.estimate_transform(
            im2Data.data,
            im2Data.height,
            im1Data.data,
            im1Data.height,
            transform,
        );

        const H = new Float64Array(
            buf.buffer,
            buf.byteOffset,
            buf.length / Float64Array.BYTES_PER_ELEMENT
        ).slice();

        const _warped_buf = this.transform.warp_image(
            im2Data.data,
            im2Data.height,
            H,
            im1Data.height,
            im1Data.width,
            transform,
        )

        this.resultData = new ImageData(
            new Uint8ClampedArray(_warped_buf),
            im1Data.width,
            im1Data.height
        );

        this.tcanvas.width = this.bcanvas.width = this.canvas.width = im1Data.width;
        this.tcanvas.height = this.bcanvas.height = this.canvas.height = im1Data.height;
        this.tctx.putImageData(this.resultData, 0, 0);

        this.canvas.dispatchEvent(new CustomEvent('transform', {
            bubbles: true,
        }));

        window.requestAnimationFrame(() => {
            this._measure_canvas();
        })
    }

    // The Compare tab's tile alignment (V3): image 2 comes already bent onto image 1, in colour and as big as image 1 (from js/align-worker.js).
    process_aligned(img1, aligned) {
        const im1Data = this.getImageData(img1);
        this.ocanvas.width = im1Data.width;
        this.ocanvas.height = im1Data.height;
        this.octx.putImageData(im1Data, 0, 0);
        this.input_image = this.ocanvas;
        this.tcanvas.width = this.bcanvas.width = this.canvas.width = im1Data.width;
        this.tcanvas.height = this.bcanvas.height = this.canvas.height = im1Data.height;
        if (aligned.width === im1Data.width && aligned.height === im1Data.height) {
            this.resultData = aligned;
            this.tctx.putImageData(aligned, 0, 0);
        } else {                                                // (should not happen: the worker opens the same file; kept safe anyway)
            const tmp = document.createElement('canvas');
            tmp.width = aligned.width; tmp.height = aligned.height;
            tmp.getContext('2d').putImageData(aligned, 0, 0);
            this.tctx.clearRect(0, 0, im1Data.width, im1Data.height);
            this.tctx.drawImage(tmp, 0, 0, im1Data.width, im1Data.height);
            this.resultData = this.tctx.getImageData(0, 0, im1Data.width, im1Data.height);
        }
        this.canvas.dispatchEvent(new CustomEvent('transform', { bubbles: true }));
        window.requestAnimationFrame(() => { this._measure_canvas(); });
    }

    getImageData (img) {
        const { width: cw, height: ch } = this.bcanvas;
        this.bctx.clearRect(0, 0, cw, ch);
        const iw = img.naturalWidth || img.width,
            ih = img.naturalHeight || img.height;

        if (iw < MAX_DIM && ih < MAX_DIM) {
            this.bcanvas.width = iw;
            this.bcanvas.height = ih;
            this.bctx.drawImage(img, 0, 0);
            return this.bctx.getImageData(0, 0, this.bcanvas.width, this.bcanvas.height);
        }

        const max_dim = iw > ih ? iw : ih;
        const ow = Math.round((iw / max_dim) * MAX_DIM),
            oh = Math.round((ih / max_dim) * MAX_DIM);
        this.bcanvas.width = ow;
        this.bcanvas.height = oh;
        this.bctx.drawImage(img, 0, 0, iw, ih, 0, 0, ow, oh);
        return this.bctx.getImageData(0, 0, ow, oh);
    }

    draw() {
        // Zoom
        const { scale, tx, ty } = this._current_transform;
        if (scale === 1.0) {
            // Copy over bcanvas
            copyImage(this.ctx, this.bcanvas);
            return;
        }

        // Convert mouse to image coordinates
        const {_image_bounds, width, height, ctx} = this;
        const { offset_x, offset_y, width: iw, height: ih } = _image_bounds;

        let ix = Math.min(iw, Math.max(0, tx - offset_x));
        let iy = Math.min(ih, Math.max(0, ty - offset_y));
        ix *= (width / iw);
        iy *= (height / ih);

        ix = Math.round(ix);
        iy = Math.round(iy);

        const zoom_radius = Math.round(0.30 * Math.min(width, height));
        const scaled_dim = Math.round(zoom_radius / scale);

        // Draw base layer
        copyImage(this.ctx, this.bcanvas);

        // Create a clipping mask with arc
        ctx.save();

        ctx.beginPath();
        ctx.arc(ix, iy, zoom_radius, 0, Math.PI * 2, true);
        ctx.clip();

        // Draw portion of canvas where mouse is and based on scale
        // back on canvas
        ctx.globalCompositeOperation = 'copy';
        ctx.globalAlpha = 1.0;

        ctx.drawImage(
            this.bcanvas,
            ix - scaled_dim,
            iy - scaled_dim,
            scaled_dim *2,
            scaled_dim *2,
            ix - zoom_radius,
            iy - zoom_radius,
            zoom_radius * 2,
            zoom_radius * 2
        );
        ctx.globalCompositeOperation = 'source-over';

        ctx.beginPath();
        ctx.arc(ix, iy, zoom_radius - 1, 0, Math.PI * 2, true);
        ctx.strokeStyle = this.primary_colour;
        ctx.lineWidth = '2';
        ctx.stroke();

        ctx.restore();
    }

    _draw_image(img = null, clear=false) {
        const { width, height } = this.bcanvas;
        if (clear) {
            this.bctx.clearRect(0, 0, width, height)
        }
        this.bctx.drawImage(
            img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height,
            0, 0, width, height
        );
    }

    draw_toggle_image(flag = false) {
        this._draw_image(flag ? this.aligned : this.input_image, true);
        this.draw();
    }

    draw_diff_image() {

        // How the Difference view is made (two "ink layers" multiplied):
        // each scan becomes a grey picture; blank paper stays white and
        // printed ink is tinted with that scan's colour (image 1 = red,
        // image 2 = green). The two layers are then multiplied, so:
        //   ink only in image 1  -> red
        //   ink only in image 2  -> green
        //   ink in both          -> dark (the two colours multiplied)
        //   blank in both        -> white
        const { bctx, dctx, dcanvas, input_image } = this;
        const tcanvas = this.aligned;

        // image 1
        const paper = window.BC_PAPER || [0, 0];        // "Whiter paper" per copy (Compare tab, 0.11.0)
        copyImage(dctx, input_image);
        inkLayer(dctx, DIFF_COLOR_1, paper[0]);
        this._draw_image(dcanvas, true);

        // image 2, multiplied onto image 1
        copyImage(dctx, tcanvas);
        inkLayer(dctx, DIFF_COLOR_2, paper[1]);
        bctx.save();
        bctx.globalCompositeOperation = "multiply";
        this._draw_image(dcanvas, false);
        bctx.restore();

        this.draw();
    }

    draw_overlay_image(factor) {
        this.bctx.save();
        this._draw_image(this.input_image, true);
        this.bctx.globalAlpha = factor;
        this._draw_image(this.aligned, false);
        this.bctx.restore();

        this.draw();
    }

    toggle_images(speed) {
        if (this.toggle_timer) {
            clearTimeout(this.toggle_timer);
            this.toggle_timer = null;
        }
        if (speed === 0) {
            this.TOGGLE_IMAGES = false;
            return;
        }
        this.TOGGLE_IMAGES = true;
        let toggle_flag = false;
        const cb = (function() {
            if (this.TOGGLE_IMAGES) {
                this.toggle_timer = setTimeout(cb, 1000 / speed);
            }
            this.draw_toggle_image(toggle_flag);
            toggle_flag = !toggle_flag;
        }.bind(this));
        this.toggle_timer = setTimeout(cb, 0);
    }
}
