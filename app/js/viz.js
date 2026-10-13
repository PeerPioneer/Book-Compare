const MAX_DIM = Infinity; // always compare at full resolution - no downscaling
let BW_ENABLED_1 = false; // set from image 1's "Black & white" checkbox before Compare is clicked
let BW_ENABLED_2 = false; // set from image 2's "Black & white" checkbox before Compare is clicked
let CONTRAST_PERCENT_1 = 100; // contrast of the first scan, from its slider; 100 = no change
let CONTRAST_PERCENT_2 = 100; // contrast of the second scan, from its slider

// Applies the black & white / contrast settings to a raw ImageData object.
// Called once per image, inside process(), before the alignment/warp step,
// so both the matching computation and every visualisation mode
// (Difference, Toggle, Overlay, ...) see the same treated pixels.
const apply_bw_contrast = (imageData, bwEnabled, contrastPercent) => {
    if (!bwEnabled && contrastPercent === 100) {
        return imageData;
    }
    const data = imageData.data;
    const contrastFactor = contrastPercent / 100;
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        if (bwEnabled) {
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b; // same weights as the on-screen preview filter
            r = g = b = gray;
        }
        data[i]     = (r - 127.5) * contrastFactor + 127.5;
        data[i + 1] = (g - 127.5) * contrastFactor + 127.5;
        data[i + 2] = (b - 127.5) * contrastFactor + 127.5;
    }
    return imageData;
};

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

        // Holds image 1 after black & white / contrast treatment is applied,
        // so every visualisation mode (not just the alignment computation)
        // shows the same treated version of image 1 that image 2 gets
        // automatically via the warp step in process().
        this.ocanvas = document.createElement('canvas');
        this.octx = this.ocanvas.getContext('2d');

        // Hold the untreated, "Original" versions of image 1 and (aligned)
        // image 2, for the "Only image 1" / "Only image 2" modes' switch
        // between "User-adjusted" and "Original".
        this.rcanvas1 = document.createElement('canvas');
        this.rctx1 = this.rcanvas1.getContext('2d');
        this.rcanvas2 = document.createElement('canvas');
        this.rctx2 = this.rcanvas2.getContext('2d');

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

    // The superimposition can be drawn from four versions of the two pages:
    // black & white or colour, each with or without the contrast boost chosen
    // in Step 2. The alignment is computed ONCE (from the version that was
    // used when Compare was pressed) and never again: the other versions are
    // made by treating the untouched scans (rcanvas1 / rcanvas2, already
    // moved with that same alignment), so nothing shifts between versions.
    _variant(bw, ctr) {
        if (bw === this.bw0 && ctr) return { a: this.ocanvas, b: this.tcanvas };
        const key = bw + '|' + ctr;
        if (!this._variants) this._variants = new Map();
        if (this._variants.has(key)) return this._variants.get(key);
        const make = (src, pct) => {
            const d = src.getContext('2d').getImageData(0, 0, src.width, src.height);
            apply_bw_contrast(d, bw, ctr ? pct : 100);
            const cv = document.createElement('canvas');
            cv.width = src.width;
            cv.height = src.height;
            cv.getContext('2d').putImageData(d, 0, 0);
            return cv;
        };
        const v = {
            a: make(this.rcanvas1, this.c1),
            b: make(this.rcanvas2, this.c2),
        };
        this._variants.set(key, v);
        // keep memory in check: at most two extra versions at a time
        while (this._variants.size > 2) {
            this._variants.delete(this._variants.keys().next().value);
        }
        return v;
    }

    set_view(bw, ctr) {
        const v = this._variant(bw, ctr);
        this._input_image = v.a;
        this._aligned = v.b;
        document.dispatchEvent(new CustomEvent('redraw_view'));
    }

    get aligned() {
        return this._aligned || this.tcanvas;
    }

    set_filename_list(filename_list) {
        this.selected_filename_list = filename_list;
    }

    process(img1, img2, transform) {
        let im1Data = this.getImageData(img1);
        let im2Data = this.getImageData(img2);

        // Keep untouched copies of both, for the "Original" option on the
        // "Only image 1" / "Only image 2" modes - apply_bw_contrast mutates
        // its argument in place, so these have to be cloned first.
        const raw_im1 = new ImageData(
            new Uint8ClampedArray(im1Data.data), im1Data.width, im1Data.height
        );
        const raw_im2 = new ImageData(
            new Uint8ClampedArray(im2Data.data), im2Data.width, im2Data.height
        );

        im1Data = apply_bw_contrast(im1Data, BW_ENABLED_1, CONTRAST_PERCENT_1);
        im2Data = apply_bw_contrast(im2Data, BW_ENABLED_2, CONTRAST_PERCENT_2);

        // Store the treated version of image 1 and use it as input_image from
        // now on, so Toggle/Difference/etc. all show the same black & white
        // / contrast treatment that image 2 gets automatically via warp_image.
        this.ocanvas.width = im1Data.width;
        this.ocanvas.height = im1Data.height;
        this.octx.putImageData(im1Data, 0, 0);
        // remember the Step 2 settings this comparison was made with
        this.bw0 = BW_ENABLED_1;
        this.c1 = CONTRAST_PERCENT_1;
        this.c2 = CONTRAST_PERCENT_2;
        this._variants = new Map();
        this._aligned = null;
        this.input_image = this.ocanvas;

        // The untreated, original image 1 needs no alignment - it's the
        // reference image everything else is aligned to.
        this.rcanvas1.width = raw_im1.width;
        this.rcanvas1.height = raw_im1.height;
        this.rctx1.putImageData(raw_im1, 0, 0);

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

        // Also warp the untreated, original image 2 using the exact same
        // transform H, so "Only image 2: Original" still lines up - just
        // without the black & white / contrast treatment.
        const _raw_warped_buf = this.transform.warp_image(
            raw_im2.data,
            raw_im2.height,
            H,
            im1Data.height,
            im1Data.width,
            transform,
        );
        this.rcanvas2.width = im1Data.width;
        this.rcanvas2.height = im1Data.height;
        this.rctx2.putImageData(
            new ImageData(new Uint8ClampedArray(_raw_warped_buf), im1Data.width, im1Data.height),
            0, 0
        );

        this.canvas.dispatchEvent(new CustomEvent('transform', {
            bubbles: true,
        }));

        window.requestAnimationFrame(() => {
            this._measure_canvas();
        })
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

    draw_slide_image(slide_factor, is_horizontal = false) {
        const rw = this.canvas.width;
        const rh = this.canvas.height;

        const iw = this.input_image.naturalWidth || this.input_image.width;
        const ih = this.input_image.naturalHeight || this.input_image.height;

        const ow = is_horizontal ? slide_factor * rw : rw;
        const oh = is_horizontal ? rh : slide_factor * rh;

        this.ctx.clearRect(0, 0, rw, rh);

        if (is_horizontal) {
          this.ctx.drawImage(this.input_image, 0, 0, iw * slide_factor, ih, 0, 0, ow, oh);
          this.ctx.drawImage(
            this.aligned,
            ow,
            0,
            rw - ow,
            oh,
            ow,
            0,
            rw - ow,
            oh
          );
        } else {
          this.ctx.drawImage(this.input_image, 0, 0, iw, ih * slide_factor, 0, 0, ow, oh);
          this.ctx.drawImage(
            this.aligned,
            0,
            oh,
            rw,
            rh - oh,
            0,
            oh,
            rw,
            rh - oh
          );
        }
    };

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

        // Based on
        // 1. https://stackoverflow.com/questions/60937639/canvas-splitting-image-into-rgba-components
        // 2. https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Compositing
        // 3. https://stackoverflow.com/questions/33822092/greyscale-canvas-make-canvas-color-to-black-and-white

        const { bctx, dctx, dcanvas, input_image } = this;
        const tcanvas = this.aligned;

        // Copy image 1. Tinted teal: a pixel that's dark (inked) in image 1
        // stays dark regardless of tint, so the tint only shows through
        // where image 1 is blank - i.e. this layer's colour marks spots
        // that are unique to image 2 (see the "lighter" blend below).
        copyImage(dctx, input_image);

        // gray scale
        grayscale(dctx);

        // Get channel
        multiplyChannel(dctx, "bg");

        // Copy it to diff canvas
        this._draw_image(dcanvas, true);

        // copy image2, tinted red - by the same logic, this layer's colour
        // marks spots that are unique to image 1, so after the "lighter"
        // (additive) blend below: red = image 1, teal = image 2.
        copyImage(dctx, tcanvas);

        // grayscale
        grayscale(dctx);

        // multiply red
        multiplyChannel(dctx, "red");

        // Copy it over diff canvas
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
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
