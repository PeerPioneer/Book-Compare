// Three-panel result view (superimposed image | copy 1 | copy 2), each panel
// with its own scrollbars. The vertical scrollbar carries four buttons at the
// top: zoom in, fit height, zoom out, scroll up. Panels can be linked so that
// zooming or scrolling in one moves the other two to the same spot.
(function () {
    'use strict';

    const STEP = 1.25; // zoom factor per click
    const Z_MIN = 0.25; // zoom relative to "fit height"
    const MAX_SCALE = 8; // display pixels per image pixel
    const MAX_DISPLAY_PX = 30000; // browsers struggle with larger elements
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    const ICON = {
        zoomIn: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M7 10h6M10 7v6"/></svg>',
        zoomOut: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M7 10h6"/></svg>',
        fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
        paletteBW: '<svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="4.2" fill="#222" stroke="#777" stroke-width="1.2"/><circle cx="16" cy="9" r="4.2" fill="#999" stroke="#777" stroke-width="1.2"/><circle cx="12" cy="16" r="4.2" fill="#fff" stroke="#777" stroke-width="1.2"/></svg>',
        paletteColor: '<svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="4.2" fill="#d93025" stroke="#777" stroke-width="1.2"/><circle cx="16" cy="9" r="4.2" fill="#1a73e8" stroke="#777" stroke-width="1.2"/><circle cx="12" cy="16" r="4.2" fill="#f9ab00" stroke="#777" stroke-width="1.2"/></svg>',
        contrast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path class="f" d="M12 4a8 8 0 0 1 0 16z"/></svg>',
        tune: '<svg viewBox="0 0 24 24"><path d="M4 7h8M18 7h2M4 12h2M12 12h8M4 17h10M20 17h0"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="17" r="2.2"/></svg>',
        up: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 7l6 9H6z"/></svg>',
        down: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 17l-6-9h12z"/></svg>',
        left: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 12l9-6v12z"/></svg>',
        right: '<svg viewBox="0 0 24 24" class="fill"><path d="M17 12l-9-6v12z"/></svg>',
    };

    const mk = (tag, cls, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html) e.innerHTML = html;
        return e;
    };

    // A button; with `repeat` it keeps firing while held down (scroll arrows)
    const button = (icon, title, action, repeat) => {
        const b = mk('button', 'pane__btn', icon);
        b.type = 'button';
        b.title = title;
        if (!repeat) {
            b.addEventListener('click', action);
            return b;
        }
        let delay = null;
        let timer = null;
        const stop = () => {
            clearTimeout(delay);
            clearInterval(timer);
        };
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            action();
            delay = setTimeout(() => {
                timer = setInterval(action, 40);
            }, 350);
            try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) =>
            b.addEventListener(ev, stop)
        );
        return b;
    };

    // Custom scrollbar track + handle for one direction of one panel
    class Track {
        constructor(pane, vertical) {
            this.pane = pane;
            this.vertical = vertical;
            this.el = mk('div', 'pane__track');
            this.thumb = mk('div', 'pane__thumb');
            this.el.appendChild(this.thumb);
            this.el.addEventListener('pointerdown', (e) => this._track_down(e));
            this.thumb.addEventListener('pointerdown', (e) => this._thumb_down(e));
        }

        metrics() {
            const vp = this.pane.vp;
            const v = this.vertical;
            return {
                view: v ? vp.clientHeight : vp.clientWidth,
                total: v ? vp.scrollHeight : vp.scrollWidth,
                pos: v ? vp.scrollTop : vp.scrollLeft,
                len: v ? this.el.clientHeight : this.el.clientWidth,
            };
        }

        thumb_len(m) {
            return Math.max(28, (m.len * m.view) / m.total);
        }

        update() {
            const m = this.metrics();
            if (m.total <= m.view + 1 || m.len <= 0) {
                this.thumb.style.display = 'none';
                return;
            }
            const tl = this.thumb_len(m);
            const tp = (m.len - tl) * (m.pos / (m.total - m.view));
            this.thumb.style.display = 'block';
            if (this.vertical) {
                this.thumb.style.top = tp + 'px';
                this.thumb.style.height = tl + 'px';
            } else {
                this.thumb.style.left = tp + 'px';
                this.thumb.style.width = tl + 'px';
            }
        }

        _scroll_to(pos) {
            if (this.vertical) this.pane.vp.scrollTop = pos;
            else this.pane.vp.scrollLeft = pos;
        }

        _thumb_down(e) {
            e.preventDefault();
            e.stopPropagation();
            const start = this.vertical ? e.clientY : e.clientX;
            const start_pos = this.metrics().pos;
            const thumb = this.thumb;
            thumb.classList.add('active');
            try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            const move = (ev) => {
                const m = this.metrics();
                const range = m.len - this.thumb_len(m);
                if (range <= 0) return;
                const d = (this.vertical ? ev.clientY : ev.clientX) - start;
                this._scroll_to(start_pos + (d * (m.total - m.view)) / range);
            };
            const up = () => {
                thumb.classList.remove('active');
                thumb.removeEventListener('pointermove', move);
                thumb.removeEventListener('pointerup', up);
                thumb.removeEventListener('pointercancel', up);
            };
            thumb.addEventListener('pointermove', move);
            thumb.addEventListener('pointerup', up);
            thumb.addEventListener('pointercancel', up);
        }

        _track_down(e) {
            if (e.target !== this.el) return;
            const r = this.thumb.getBoundingClientRect();
            const before = this.vertical ? e.clientY < r.top : e.clientX < r.left;
            const m = this.metrics();
            const amount = (before ? -1 : 1) * m.view * 0.9;
            if (this.vertical) this.pane.vp.scrollBy(0, amount);
            else this.pane.vp.scrollBy(amount, 0);
        }
    }

    // One panel. State: z (zoom relative to "fit height", 1 = whole page
    // height visible) and cx/cy (which point of the picture is in the middle
    // of the panel, as a fraction 0..1).
    class Pane {
        constructor(root, pad) {
            this.root = root;
            this.vp = root.querySelector('.pane__vp');
            this.content = root.querySelector('.pane__content');
            this.canvas = this.content.querySelector('canvas');
            this.pad = pad || 0; // padding around the picture inside the canvas
            this.nw = 0;
            this.nh = 0;
            this.z = 1;
            this.cx = 0.5;
            this.cy = 0.5;
            this.W = 0; // displayed picture width / height in px
            this.H = 0;
            this.locked = false;
            this.onchange = null;
            this._expected = null;

            this._build();
            this.vp.addEventListener('scroll', () => this._on_scroll());
            this.vp.addEventListener('wheel', (e) => this._on_wheel(e), { passive: false });
            new ResizeObserver(() => this._on_resize()).observe(this.vp);
        }

        _build() {
            const vbar = mk('div', 'pane__vbar');
            this.zoom_in_btn = button(ICON.zoomIn, 'Zoom in', () => this.user_zoom(STEP));
            this.fit_btn = button(ICON.fit, 'Fit height to panel', () => this.fit_height());
            this.zoom_out_btn = button(ICON.zoomOut, 'Zoom out', () => this.user_zoom(1 / STEP));
            // Two display buttons: black & white / colour, and
            // user-adjusted / original. Their behaviour is wired up
            // below, in the workspace section.
            this.gray_btn = button(ICON.paletteColor, 'Show in black and white / in colour', () => {
                if (this.on_gray) this.on_gray();
            });
            this.variant_btn = button(ICON.tune, 'Show the user-adjusted version / the original', () => {
                if (this.on_variant) this.on_variant();
            });
            this.on_gray = null;
            this.on_variant = null;
            this.vtrack = new Track(this, true);
            vbar.append(
                this.zoom_in_btn,
                this.fit_btn,
                this.zoom_out_btn,
                this.gray_btn,
                this.variant_btn,
                button(ICON.up, 'Scroll up', () => this.vp.scrollBy(0, -40), true),
                this.vtrack.el,
                button(ICON.down, 'Scroll down', () => this.vp.scrollBy(0, 40), true)
            );

            const hbar = mk('div', 'pane__hbar');
            this.htrack = new Track(this, false);
            hbar.append(
                button(ICON.left, 'Scroll left', () => this.vp.scrollBy(-40, 0), true),
                this.htrack.el,
                button(ICON.right, 'Scroll right', () => this.vp.scrollBy(40, 0), true)
            );

            this.label = mk('div', 'pane__label');
            this.label.style.display = 'none';
            this.root.append(vbar, hbar, mk('div', 'pane__corner'), this.label);
        }

        set_label(text) {
            // text may hold several lines, separated by "\n" (e.g. the
            // Difference-mode note under "Superimposed"); everything here
            // is app-controlled except filenames, which are escaped before
            // reaching this point isn't guaranteed, so escape defensively.
            if (!text) {
                this.label.innerHTML = '';
                this.label.style.display = 'none';
                return;
            }
            const escape_html = (s) =>
                s.replace(/[&<>"']/g, (c) => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
                }[c]));
            this.label.innerHTML = String(text).split('\n').map(escape_html).join('<br>');
            this.label.style.display = 'block';
        }

        set_locked(locked) {
            this.locked = locked;
            [this.zoom_in_btn, this.fit_btn, this.zoom_out_btn].forEach((b) => {
                b.disabled = locked;
            });
        }

        update_bars() {
            this.vtrack.update();
            this.htrack.update();
        }

        get_view() {
            return { z: this.z, cx: this.cx, cy: this.cy };
        }

        // Called for changes coming from another panel (no notification back)
        apply_view(v) {
            const vw = this.vp.clientWidth;
            const vh = this.vp.clientHeight;
            this._apply(v.z, { fx: v.cx, fy: v.cy, px: vw / 2, py: vh / 2 });
        }

        set_natural(w, h) {
            this.nw = w;
            this.nh = h;
            this.apply_view({ z: 1, cx: 0.5, cy: 0.5 });
        }

        // Show picture fraction (a.fx, a.fy) at viewport pixel (a.px, a.py)
        _apply(z, a) {
            if (!this.nw || !this.nh) return;
            const vw = this.vp.clientWidth;
            const vh = this.vp.clientHeight;
            if (vw <= 0 || vh <= 0) return;
            const pad = this.pad;
            const fit = Math.max(1, vh - 2 * pad) / this.nh; // scale where picture height = panel height
            const max_scale = Math.min(MAX_SCALE, MAX_DISPLAY_PX / Math.max(this.nw, this.nh));
            z = clamp(z, Z_MIN, Math.max(Z_MIN, max_scale / fit));
            const scale = fit * z;

            this.z = z;
            this.W = this.nw * scale;
            this.H = this.nh * scale;
            const cw = this.W + 2 * pad;
            const ch = this.H + 2 * pad;
            this.content.style.width = Math.round(cw) + 'px';
            this.content.style.height = Math.round(ch) + 'px';

            const left = cw > vw ? clamp(pad + a.fx * this.W - a.px, 0, cw - vw) : 0;
            const top = ch > vh ? clamp(pad + a.fy * this.H - a.py, 0, ch - vh) : 0;
            this.vp.scrollLeft = left;
            this.vp.scrollTop = top;

            // scroll events caused by us must not be mistaken for the user
            this._expected = { left: this.vp.scrollLeft, top: this.vp.scrollTop };
            window.requestAnimationFrame(() => {
                this._expected = null;
            });
            this._read_center();
            this.update_bars();
        }

        _read_center() {
            const vw = this.vp.clientWidth;
            const vh = this.vp.clientHeight;
            const pad = this.pad;
            const cw = this.W + 2 * pad;
            const ch = this.H + 2 * pad;
            this.cx = cw > vw + 0.5 ? clamp((this.vp.scrollLeft + vw / 2 - pad) / this.W, 0, 1) : 0.5;
            this.cy = ch > vh + 0.5 ? clamp((this.vp.scrollTop + vh / 2 - pad) / this.H, 0, 1) : 0.5;
        }

        _notify() {
            if (this.onchange) this.onchange(this);
        }

        _on_scroll() {
            const e = this._expected;
            if (
                e &&
                Math.abs(this.vp.scrollLeft - e.left) < 1.5 &&
                Math.abs(this.vp.scrollTop - e.top) < 1.5
            ) {
                this.update_bars();
                return;
            }
            this._read_center();
            this.update_bars();
            this._notify();
        }

        _on_resize() {
            const vw = this.vp.clientWidth;
            const vh = this.vp.clientHeight;
            this._apply(this.z, { fx: this.cx, fy: this.cy, px: vw / 2, py: vh / 2 });
        }

        _on_wheel(e) {
            if (!e.ctrlKey) return; // plain wheel = normal scrolling
            e.preventDefault();
            if (this.locked) return;
            this.user_zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
        }

        // Zoom by a factor, keeping the point under (clientX, clientY) - or the
        // middle of the panel - where it is.
        user_zoom(factor, clientX, clientY) {
            if (this.locked || !this.nw) return;
            const rect = this.vp.getBoundingClientRect();
            const vw = this.vp.clientWidth;
            const vh = this.vp.clientHeight;
            const px = clientX === undefined ? vw / 2 : clientX - rect.left;
            const py = clientY === undefined ? vh / 2 : clientY - rect.top;
            const pad = this.pad;
            const cw = this.W + 2 * pad;
            const ch = this.H + 2 * pad;
            const off_x = cw < vw ? (vw - cw) / 2 : -this.vp.scrollLeft;
            const off_y = ch < vh ? (vh - ch) / 2 : -this.vp.scrollTop;
            const fx = clamp((px - off_x - pad) / this.W, 0, 1);
            const fy = clamp((py - off_y - pad) / this.H, 0, 1);
            this._apply(this.z * factor, { fx, fy, px, py });
            this._notify();
        }

        fit_height() {
            if (this.locked || !this.nw) return;
            this.apply_view({ z: 1, cx: 0.5, cy: 0.5 });
            this._notify();
        }
    }

    // ---- Workspace: three panels, splitters, link toggle ----
    const el = (id) => document.getElementById(id);
    if (!el('pane_main')) return;

    const main = new Pane(el('pane_main'), 0.25 * parseFloat(getComputedStyle(el('result').querySelector('canvas')).fontSize));
    const copy1 = new Pane(el('pane_o1'), 0);
    const copy2 = new Pane(el('pane_o2'), 0);
    const panes = [main, copy1, copy2];

    const state = { linked: true, last: main };

    const on_change = (src) => {
        state.last = src;
        if (!state.linked) return;
        const v = src.get_view();
        panes.forEach((p) => {
            if (p !== src) p.apply_view(v);
        });
        if (typeof result !== 'undefined' && result) result._measure_canvas();
    };
    panes.forEach((p) => {
        p.onchange = on_change;
    });

    // Link toggle in the footer
    const link_btn = el('link_toggle');
    const link_icon = el('link_icon');
    const link_label = el('link_label');
    const show_link_state = () => {
        link_icon.textContent = state.linked ? 'link' : 'link_off';
        link_label.textContent = state.linked ? 'Linked' : 'Unlinked';
    };
    link_btn.addEventListener('click', () => {
        state.linked = !state.linked;
        show_link_state();
        if (state.linked) {
            const v = state.last.get_view();
            panes.forEach((p) => {
                if (p !== state.last) p.apply_view(v);
            });
        }
    });
    show_link_state();

    // Splitters (drag to resize)
    const splitter = (node, move) => {
        node.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            node.classList.add('active');
            document.body.classList.add('splitting');
            try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            const onmove = (ev) => move(ev);
            const onup = () => {
                node.classList.remove('active');
                document.body.classList.remove('splitting');
                node.removeEventListener('pointermove', onmove);
                node.removeEventListener('pointerup', onup);
                node.removeEventListener('pointercancel', onup);
            };
            node.addEventListener('pointermove', onmove);
            node.addEventListener('pointerup', onup);
            node.addEventListener('pointercancel', onup);
        });
    };
    // The left splitter resizes the first column (--col1), whether that
    // column is "merged picture vs. the two side panels" (ws-three) or
    // "copy 1 vs. copy 2" (ws-sidebyside). The top splitter resizes the
    // first row (--row1): "copy 1 vs. copy 2", whether they're the narrow
    // right-hand panels (ws-three) or full-width (ws-stacked). Same two
    // variables, reused by whichever shape is currently active.
    const workspace_el = el('workspace');
    splitter(el('split_v'), (e) => {
        const r = workspace_el.getBoundingClientRect();
        const x = clamp(e.clientX - r.left, 160, r.width - 160 - 6);
        workspace_el.style.setProperty('--col1', x + 'px');
    });
    splitter(el('split_h'), (e) => {
        const r = workspace_el.getBoundingClientRect();
        const y = clamp(e.clientY - r.top, 120, r.height - 120 - 6);
        workspace_el.style.setProperty('--row1', y + 'px');
    });

    // Slide mode measures the picture once, so it only works unzoomed
    const remeasure = () =>
        window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

    // "Top and bottom" / "Left and right" / "Only image 1" / "Only image 2"
    // don't merge the images at all, so they drop the merged-picture panel
    // and show copy 1 and/or copy 2 full-size instead. Switching back to any
    // of the other modes (Toggle/Difference/Slide) restores the normal
    // three-panel view.
    const WS_CLASSES = ['ws-three', 'ws-stacked', 'ws-sidebyside', 'ws-single1', 'ws-single2'];
    const shape_for_mode = (mode) => {
        if (mode === 'topbottom') return 'ws-stacked';
        if (mode === 'leftright') return 'ws-sidebyside';
        if (mode === 'onlyimage1') return 'ws-single1';
        if (mode === 'onlyimage2') return 'ws-single2';
        return 'ws-three';
    };

    // "Only image 1" / "Only image 2": a per-pane User-adjusted / Original
    // switch. "Adjusted" is whatever Step 2's black & white / contrast
    // settings produced (r.ocanvas / r.tcanvas, already loaded into the
    // panes below); "Original" is the untreated version - still aligned for
    // image 2 - kept on r.rcanvas1 / r.rcanvas2.
    // The two side panels start out showing the ORIGINAL scans (image 2
    // aligned); each can be switched to the user-adjusted version, and to
    // black & white, independently. None of this touches the alignment -
    // it only changes which picture is drawn / how it is displayed.
    const pane_variant = { 1: 'original', 2: 'original' };
    const redraw_pane_source = (n) => {
        const r = result;
        if (!r || !r.ocanvas.width) return;
        const p = n === 1 ? copy1 : copy2;
        const src =
            pane_variant[n] === 'original'
                ? n === 1 ? r.rcanvas1 : r.rcanvas2
                : n === 1 ? r.ocanvas : r.tcanvas;
        p.canvas.width = src.width;
        p.canvas.height = src.height;
        p.canvas.getContext('2d').drawImage(src, 0, 0);
    };
    // Keeps the footer's "User-adjusted / Original" switch (Only image 1/2
    // modes) and the panel button in step with pane_variant.
    const sync_variant_ui = (n) => {
        const p = n === 1 ? copy1 : copy2;
        p.variant_btn.classList.toggle('on', pane_variant[n] === 'adjusted');
        const container = el('onlyimage' + n);
        if (container) {
            container.querySelectorAll('button').forEach((b) => {
                b.classList.toggle('active', b.dataset.variant === pane_variant[n]);
            });
        }
    };
    const set_pane_variant = (n, v) => {
        pane_variant[n] = v;
        redraw_pane_source(n);
        sync_variant_ui(n);
    };
    [1, 2].forEach((n) => {
        const container = el('onlyimage' + n);
        if (!container) return;
        container.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', () => set_pane_variant(n, btn.dataset.variant));
        });
        const p = n === 1 ? copy1 : copy2;
        p.on_variant = () =>
            set_pane_variant(n, pane_variant[n] === 'original' ? 'adjusted' : 'original');
    });

    // Black & white / colour on the two side panels: a display filter on
    // the picture, so it is instant and the pixels stay exactly as they are.
    // The button shows the palette of the state currently displayed.
    const gray_state = new Map();
    [copy1, copy2].forEach((p) => {
        gray_state.set(p, false);
        p.on_gray = () => {
            const on = !gray_state.get(p);
            gray_state.set(p, on);
            p.canvas.style.filter = on ? 'grayscale(1)' : '';
            p.gray_btn.innerHTML = on ? ICON.paletteBW : ICON.paletteColor;
            p.gray_btn.title = on
                ? 'Showing black and white - click for colour'
                : 'Showing colour - click for black and white';
        };
        p.gray_btn.title = 'Showing colour - click for black and white';
    });

    // Superimposed panel. It can be drawn from black & white or colour
    // versions of the two pages, with or without the contrast boost from
    // Step 2. Alignment is never recomputed (see Visualization.set_view).
    //   colour button   - always available (except in Difference mode, which
    //                     is grey by design); starts in the Step 2 state
    //   contrast button - only available if contrast was raised in Step 2
    const mainview = { bw: false, ctr: true, ctr_possible: false };
    const refresh_main_buttons = () => {
        const diff = current_mode === 'diff';
        main.gray_btn.innerHTML = mainview.bw ? ICON.paletteBW : ICON.paletteColor;
        main.gray_btn.classList.toggle('na', diff);
        main.gray_btn.title = diff
            ? 'Not available in Difference mode (it is always shown in red and green)'
            : mainview.bw
            ? 'Showing black and white - click for colour'
            : 'Showing colour - click for black and white';
        main.variant_btn.innerHTML = ICON.contrast;
        main.variant_btn.classList.toggle('na', !mainview.ctr_possible);
        main.variant_btn.classList.toggle('on', mainview.ctr_possible && mainview.ctr);
        main.variant_btn.title = !mainview.ctr_possible
            ? 'Nothing to switch off: contrast was not adjusted in step 2.'
            : mainview.ctr
            ? 'Contrast boost is on - click to switch it off'
            : 'Contrast boost is off - click to switch it on';
    };
    const apply_main_view = () => {
        if (typeof result !== 'undefined' && result && result.ocanvas.width) {
            result.set_view(mainview.bw, mainview.ctr);
        }
        refresh_main_buttons();
    };
    main.on_gray = () => {
        if (current_mode === 'diff') return;
        mainview.bw = !mainview.bw;
        apply_main_view();
    };
    main.on_variant = () => {
        if (!mainview.ctr_possible) return;
        mainview.ctr = !mainview.ctr;
        apply_main_view();
    };
    // The main panel's label is always "Superimposed", plus two extra lines
    // explaining the colors while in Difference mode specifically.
    let current_mode = 'diff'; // the app starts in Difference mode
    const update_main_label = () => {
        main.set_label(
            current_mode === 'diff'
                ? 'Superimposed\nRed = image 1\nGreen = image 2'
                : 'Superimposed'
        );
    };

    document.addEventListener('modechange', (e) => {
        const mode = e.detail;
        const slide = mode === 'slide';
        panes.forEach((p) => {
            p.set_locked(slide);
            if (slide) p.apply_view({ z: 1, cx: 0.5, cy: 0.5 });
        });

        workspace_el.classList.remove(...WS_CLASSES);
        workspace_el.classList.add(shape_for_mode(mode));

        current_mode = mode;
        update_main_label();
        refresh_main_buttons();

        if (slide) remeasure();
        // Panels just changed visibility/size (main hidden, or o1/o2 now
        // full-width/full-height) - their ResizeObservers pick this up on
        // their own, but slide mode's own geometry cache needs a nudge too.
        remeasure();
    });

    // A new comparison arrived: load the three pictures and start from the whole page
    document.addEventListener('transform', () => {
        const r = result;
        const w = r.ocanvas.width;
        const h = r.ocanvas.height;

        // A new comparison starts from its defaults again: the side panels
        // show the originals; the superimposed panel starts in the state
        // chosen in Step 2 (black & white or colour, contrast on).
        mainview.bw = r.bw0;
        mainview.ctr = true;
        mainview.ctr_possible = r.c1 > 100 || r.c2 > 100;
        refresh_main_buttons();
        [1, 2].forEach((n) => set_pane_variant(n, 'original'));
        [copy1, copy2].forEach((p) => {
            gray_state.set(p, false);
            p.canvas.style.filter = '';
            p.gray_btn.innerHTML = ICON.paletteColor;
        });

        const names = r.selected_filename_list || [];
        update_main_label();
        copy1.set_label('Copy 1' + (names[0] ? ': ' + names[0] : ''));
        copy2.set_label('Copy 2, aligned' + (names[1] ? ': ' + names[1] : ''));
        panes.forEach((p) => {
            p.set_locked(false);
            p.set_natural(w, h);
        });
        state.last = main;
        r._measure_canvas();
        remeasure();
    });
})();
