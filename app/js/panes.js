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
            this._last_left = 0; // scroll position at the previous scroll event,
            this._last_top = 0;  // to tell which direction the user moved

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
            this.vtrack = new Track(this, true);
            vbar.append(
                this.zoom_in_btn,
                this.fit_btn,
                this.zoom_out_btn,
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
            // "[[#RRGGBB]]" becomes a small coloured square (the hex code is validated by the pattern)
            const squares = (s) => s.replace(/\[\[(#[0-9A-Fa-f]{6})\]\]/g,
                '<span style="color:$1;font-size:1.3em;line-height:1">\u25A0</span>');
            this.label.innerHTML = String(text).split('\n').map((l) => squares(escape_html(l))).join('<br>');
            this.label.style.display = 'block';
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
            this._last_left = this.vp.scrollLeft;
            this._last_top = this.vp.scrollTop;
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

        // `axes` says what changed ({x, y}); without it, everything changed
        // (zoom, fit). The other linked panels then take over only that.
        _notify(axes) {
            if (this.onchange) this.onchange(this, axes);
        }

        _on_scroll() {
            const e = this._expected;
            if (
                e &&
                Math.abs(this.vp.scrollLeft - e.left) < 1.5 &&
                Math.abs(this.vp.scrollTop - e.top) < 1.5
            ) {
                this._last_left = this.vp.scrollLeft;
                this._last_top = this.vp.scrollTop;
                this.update_bars();
                return;
            }
            const moved_x = Math.abs(this.vp.scrollLeft - this._last_left) > 0.5;
            const moved_y = Math.abs(this.vp.scrollTop - this._last_top) > 0.5;
            this._last_left = this.vp.scrollLeft;
            this._last_top = this.vp.scrollTop;
            this._read_center();
            this.update_bars();
            if (moved_x || moved_y) this._notify({ x: moved_x, y: moved_y });
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

    const on_change = (src, axes) => {
        state.last = src;
        if (!state.linked) return;
        // Scrolling in one direction passes on only that direction. The panels
        // differ in size, so sending the other direction too would drag them
        // (and, through them, this panel) sideways when you move up or down
        // while standing at a left or right edge.
        const a = axes || { x: true, y: true };
        const v = src.get_view();
        panes.forEach((p) => {
            if (p !== src) p.apply_view({ z: v.z, cx: a.x ? v.cx : p.cx, cy: a.y ? v.cy : p.cy });
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
    const toggle_link = () => {
        state.linked = !state.linked;
        show_link_state();
        if (state.linked) {
            const v = state.last.get_view();
            panes.forEach((p) => {
                if (p !== state.last) p.apply_view(v);
            });
        }
        document.dispatchEvent(new CustomEvent('linkchange'));
    };
    link_btn.addEventListener('click', toggle_link);
    show_link_state();
    // 0.14.0: the Compare tab has its own button for this in the left panel ("Zoom and move all panels together", js/compare-tab.js)
    window.BCLink = { linked: () => state.linked, toggle: toggle_link };

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

    // Tells the panels to measure their size again after the layout changed
    const remeasure = () =>
        window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

    // "Top and bottom" / "Left and right" / "Only image 1" / "Only image 2"
    // don't merge the images at all, so they drop the merged-picture panel
    // and show copy 1 and/or copy 2 full-size instead. Switching back to any
    // of the other modes (Toggle/Difference) restores the normal
    // three-panel view.
    const WS_CLASSES = ['ws-three', 'ws-stacked', 'ws-sidebyside', 'ws-single1', 'ws-single2'];
    const shape_for_mode = (mode) => {
        if (mode === 'topbottom') return 'ws-stacked';
        if (mode === 'leftright') return 'ws-sidebyside';
        if (mode === 'onlyimage1') return 'ws-single1';
        if (mode === 'onlyimage2') return 'ws-single2';
        return 'ws-three';
    };

    // The two side panels show copy 1 as it is and copy 2 moved onto it. In the "Copy 2" view the switch
    // "Aligned | Original scan" shows copy 2 as it was scanned instead: the whole scan, unchanged, scaled to fit
    // the same frame (copy 1 is the reference: the alignment never changes it, so it has no such switch).
    let o2_original = false;
    const original_copy2 = () => {
        const list = document.querySelector('ul.mdc-image-list.vertical-image-list');
        const img = list && list.querySelectorAll('img')[1];
        return img && img.complete && img.naturalWidth ? img : null;
    };
    const showing_original = () => o2_original && current_mode === 'onlyimage2' && !!original_copy2();
    const draw_copy2 = () => {
        const r = result;
        if (!r || !r.ocanvas.width) return;
        const c = copy2.canvas, w = r.tcanvas.width, h = r.tcanvas.height;
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        const img = showing_original() ? original_copy2() : null;
        if (img) {
            const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
            const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
            g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, w, h);
            g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } else {
            g.drawImage(r.tcanvas, 0, 0);
        }
        workspace_el.classList.toggle('ws-o2orig', !!img);
        update_copy_labels();
    };
    const draw_pane_sources = () => {
        const r = result;
        if (!r || !r.ocanvas.width) return;
        copy1.canvas.width = r.ocanvas.width;
        copy1.canvas.height = r.ocanvas.height;
        copy1.canvas.getContext('2d').drawImage(r.ocanvas, 0, 0);
        draw_copy2();
    };
    // Labels: in the Compare tab the copies are named as in the grid, with the file name below; the two-image
    // screens show the file names.
    const update_copy_labels = () => {
        const r = result;
        const files = (r && r.selected_filename_list) || [];
        const copies = window.BC_PANE_NAMES || [];          // Compare tab: "name of the copy · page" (js/compare-tab.js)
        const label = (i, head) => {
            if (copies[i]) return head + ' · ' + copies[i];
            return head + (files[i] ? ': ' + files[i] : '');
        };
        copy1.set_label(label(0, 'Copy 1'));
        copy2.set_label(label(1, showing_original() ? 'Copy 2, original scan' : 'Copy 2, aligned'));
    };
    const o2_switch = el('o2_switch');
    // (0.14.0: the switch and the short note of the Copy 1 view stand in the left panel of the Compare tab, under the name of their view: js/compare-tab.js)
    const render_o2_switch = () => {
        o2_switch.querySelectorAll('button').forEach((b) => {
            const on = (b.dataset.o2 === 'original') === o2_original;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    };
    o2_switch.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-o2]');
        if (!b) return;
        o2_original = b.dataset.o2 === 'original';
        render_o2_switch();
        draw_copy2();
        copy2.update_bars && copy2.update_bars();
    });
    render_o2_switch();
    window.BCCopy2View = { original: () => showing_original(), set: (orig) => { o2_original = !!orig; render_o2_switch(); draw_copy2(); }, relabel: () => update_copy_labels() };

    // The main panel's label is always "Superimposed", plus two extra lines
    // explaining the colors while in the Superimposed view (mode 'diff').
    let current_mode = 'diff'; // the app starts in the Superimposed view
    const update_main_label = () => {
        let note = '';
        if (current_mode === 'diff') {
            const preset = DIFF_PRESETS.find((p) => p.c1 === DIFF_COLOR_1 && p.c2 === DIFF_COLOR_2);
            const nm = (name) => (name ? ' ' + name : '');
            // In the Compare tab the two copies are named as in the grid ("Orange = A-Wn1"); the two-image screens still say image 1 / image 2.
            const copy = (i) => {
                const n = window.BC_COPY_NAMES && window.BC_COPY_NAMES[i];
                if (!n) return 'image ' + (i + 1);
                return n.length > 38 ? n.slice(0, 37) + '…' : n;
            };
            note = `\n[[${DIFF_COLOR_1}]]${nm(preset && preset.n1)} = ${copy(0)}` +
                   `\n[[${DIFF_COLOR_2}]]${nm(preset && preset.n2)} = ${copy(1)}`;
        }
        main.set_label((current_mode === 'toggle' ? 'Toggle (copy 1 and copy 2 in turn)' : 'Superimposed') + note);
        if (current_mode === 'diff' && !document.body.classList.contains('ct-active')) {   // the colour choice next to the legend (item 11); in the Compare tab: in the left panel (0.14.0)
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'pane__lblbtn'; b.id = 'legend_colors';
            b.textContent = 'Change colors …'; b.title = 'Choose the two colors of the Superimposed view';
            b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('opendiffcolors')));
            main.label.appendChild(document.createElement('br'));
            main.label.appendChild(b);
            if (window.BC_COPY_NAMES) {                     // Compare tab: make the paper of a copy whiter (0.11.0)
                const p = document.createElement('button');
                p.type = 'button'; p.className = 'pane__lblbtn'; p.id = 'legend_paper';
                p.textContent = 'Paper …'; p.title = 'Paper still tinted in a copy\'s colour? Make the paper of one copy whiter (only the picture on screen changes)';
                p.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openpaper')));
                main.label.appendChild(document.createTextNode(' '));
                main.label.appendChild(p);
            }
        }
    };

    document.addEventListener('diffcolorschange', update_main_label);

    document.addEventListener('modechange', (e) => {
        const mode = e.detail;
        workspace_el.classList.remove(...WS_CLASSES);
        workspace_el.classList.add(shape_for_mode(mode));

        current_mode = mode;
        update_main_label();
        draw_copy2();                       // the original scan of copy 2 only in the "Copy 2" view

        // Panels just changed visibility/size (main hidden, or o1/o2 now
        // full-width/full-height) - give them a nudge to measure again.
        remeasure();
    });

    // Copy 1 and copy 2 beside the superimposed picture: folded away by default (the strip at the right
    // edge opens them, "Fold away" closes them again); the choice is remembered on this computer.
    const FOLD_KEY = 'bookcompare_side_panels';
    const set_folded = (folded, keep) => {
        workspace_el.classList.toggle('ws-folded', folded);
        if (keep) { try { localStorage.setItem(FOLD_KEY, folded ? 'folded' : 'open'); } catch (err) { /* private mode */ } }
        remeasure();
    };
    let start_open = false;
    try { start_open = localStorage.getItem(FOLD_KEY) === 'open'; } catch (err) { /* private mode */ }
    set_folded(!start_open, false);
    el('fold_strip').addEventListener('click', () => set_folded(false, true));
    el('fold_btn').addEventListener('click', () => set_folded(true, true));
    window.BCPanels = { folded: () => workspace_el.classList.contains('ws-folded'), fold: (f) => set_folded(!!f, true) };

    // A new comparison arrived: load the three pictures and start from the whole page
    document.addEventListener('transform', () => {
        const r = result;
        const w = r.ocanvas.width;
        const h = r.ocanvas.height;

        draw_pane_sources();

        update_main_label();
        update_copy_labels();
        panes.forEach((p) => {
            p.set_natural(w, h);
        });
        state.last = main;
        r._measure_canvas();
        remeasure();
    });
})();
