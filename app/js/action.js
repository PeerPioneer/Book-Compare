const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

class Action {
    constructor(container, result) {
        this.c = container;

        this.el = [
            ...this.c.querySelectorAll(':scope > div')
        ].reduce((_r, el) => {
            _r[el.id] = el
            return _r;
        }, {});

        // Hover and Overlay are removed from the UI for now, but kept dormant
        // here in case they come back - guard every use of overlay_slider.
        this.overlay_slider = this.el['overlay'] ? this.el['overlay'].querySelector('.mdc-slider') : null;
        this.result_container = document.getElementById('result');
        //this.result_parent = this.result_container.parentElement
        this.image_slider = this.result_container.querySelector('.image_slider');
        this.dragElement(this.image_slider);
        this.result = result;

        // TODO: Infer from document or set the document
        this._MODE = 'diff';
        this._TOGGLE_SPEED = 2;
        this._OVERLAY = 0.5;
        this._SLIDE = 0.5;
        this._HORIZONTAL = true;
        this._HOVER = 1;

        this.download_el = document.createElement('a');

        this.el['toggle'].onclick = this.handle_toggle.bind(this);
        this.el['slide'].onchange = this.handle_slide.bind(this);
        // Difference mode's Download button is gone (the "Export Current
        // View" item in the "More" menu already covers it) - #diff now just
        // holds the "Red = image 1 / Cyan = Image 2" note, so it no longer
        // needs a click handler.

        this.hover_text = document.getElementById('hover-image');
        if (this.overlay_slider) {
            this.overlay_slider.addEventListener('MDCSlider:input', this.handle_overlay.bind(this));
        }

        this.draw = this._draw.bind(this);
        document.addEventListener('redraw_view', () => this._draw());
        this.updating = false;

        const { add: hover_add, remove: hover_remove } = this.hoverSwitch(this.result_container);
        this.hover_add = hover_add;
        this.hover_remove = hover_remove;

        // NOTE: the old magnifier-lens zoom (activated by mouse wheel) has been
        // replaced by simple zoom in/out buttons - see the zoom_in/zoom_out/zoom_reset
        // wiring near the bottom of index.html. handle_zoom() is kept below but no
        // longer attached, so the magnifier lens no longer appears.
        const { add_listeners: add_zoom_listener, remove_listeners: remove_zoom_listener } = this.handle_zoom();
        this.add_zoom_listener = add_zoom_listener;
        this.remove_zoom_listener = remove_zoom_listener;

        this.more_menu_el = document.getElementById('more_menu');
        this.info_dialog_el = document.getElementById('info-dialog');
        this.snack_el = document.getElementById('snack');

        this.more_menu_el.addEventListener('MDCMenu:selected', function(e) {
            const menu_item_name = e.detail.item.dataset.name;
            switch(menu_item_name) {
            case 'export_aligned_images':
                this.export_aligned_images();
                break;
            case 'export_toggle':
                this.export_gif();
                break;
            case 'export_diff_image':
                this.export_current_view();
                break;
            case 'licenses':
                this.download_el.href = 'licenses.txt';
                this.download_el.target = '_blank';
                this.download_el.removeAttribute('download');
                this.download_el.click();
                break;
            case 'about':
                this.info_dialog_el.MDCDialog.open();
                break;
            }
        }.bind(this));
    }

    get MODE() {
        return this._MODE;
    }

    set MODE(val) {
        // Hide current one
        if (this._MODE != val) {
            this.el[this._MODE].classList.add('hide');
            this.el[val].classList.remove('hide');
        }
        if (val === 'overlay') {
            window.requestAnimationFrame(() => {
                this.overlay_slider.MDCSlider.layout();
            });
        }
        if(val === 'slide') {
            this.image_slider.classList.remove('hide');
        } else {
            this.image_slider.classList.add('hide');
        }

        // Hover
        if (val === 'hover') {
            // Add handlers
            this.hover_add();
        } else {
            // Remove handlers
            this.hover_remove();
        }
        this._MODE = val;
        document.dispatchEvent(new CustomEvent('modechange', { detail: val }));
        this.show();
    }

    get TOGGLE_SPEED() {
        return this._TOGGLE_SPEED;
    }

    set TOGGLE_SPEED(val) {
        this._TOGGLE_SPEED = val;
        this.show();
    }

    get OVERLAY() {
        return this._OVERLAY;
    }
    set OVERLAY(val) {
        this._OVERLAY = val;
        this.show();
    }

    get SLIDE() {
        return this._SLIDE;
    }
    set SLIDE(val) {
        this._SLIDE = val;
        this.show();
    }

    get HORIZONTAL() {
        return this._HORIZONTAL;
    }
    set HORIZONTAL(val) {
        this._HORIZONTAL = val;
        this.show();
    }
    get HOVER() {
        return this._HOVER;
    }
    set HOVER(val) {
        this._HOVER = val;
        this.show();
    }

    _draw() {
        if (this.MODE !== 'toggle') {
            this.result.toggle_images(0);
        }

        switch(this.MODE){
            case 'toggle':
                this.result.toggle_images(this.TOGGLE_SPEED);
                break;
            case 'diff':
                this.result.draw_diff_image();
                break;
            case 'overlay':
                this.result.draw_overlay_image(this.OVERLAY);
                break;
            case 'slide':
                this.result.draw_slide_image(this.SLIDE, this.HORIZONTAL);
                break;
            case 'hover':
                this.hover_text.textContent = this.HOVER;
                this.result.draw_toggle_image(this.HOVER === '2');
                break;
            case 'topbottom':
            case 'leftright':
            case 'onlyimage1':
            case 'onlyimage2':
                // Nothing to draw here - none of these four modes merge the
                // images, they just show the "Copy 1" / "Copy 2, aligned"
                // panel(s) full-size instead of the merged-picture panel
                // (see the 'modechange' handling in panes.js).
                break;
            default:
                this.result.draw_diff_image();
                throw new Error('Unknown mode', this.MODE);
        }
        this.el[this.MODE].classList.remove('hide');
    }

    show() {
        if(this.updating) {
            return;
        }
        this.updating = true;
        window.requestAnimationFrame(() => {
            this.draw();
            this.updating = false;
        });
    }
    reset () {
        // Reset state
        this._MODE = 'diff';
        this._TOGGLE_SPEED = 2;
        this._OVERLAY = 0.5;
        this._SLIDE = 0.5;
        this._HORIZONTAL = true;
        this.result.toggle_images(0);

        // Hide all
        Object.values(this.el).forEach((_el) => {
            _el.classList.add('hide');
        });

        // Reset toggle ui
        const active_btn = this.el['toggle'].querySelector('button.mdc-tab.active');
        const clicked_btn = this.el['toggle'].querySelector('button.mdc-tab[data-speed="2"]');
        if (active_btn !== clicked_btn) {
            this.reset_toggle_ui(clicked_btn, active_btn);
        }

        // Reset radio and slider ui
        document.getElementById('radio-horizontal').checked = this._HORIZONTAL;
        document.getElementById('radio-vertical').checked = !this._HORIZONTAL;
        document.querySelectorAll('#slide_seg .seg').forEach((b) => {
            b.classList.toggle('active', (b.dataset.value === 'horizontal') === this._HORIZONTAL);
        });
        this.image_slider.classList.add('horizontal');
        this.image_slider.style.left = '50%';
        this.image_slider.style.top = '50%';

        // Reset overlay ui (if present - Overlay mode is currently removed)
        if (this.overlay_slider) {
            this.overlay_slider.MDCSlider.value = Math.round(this._OVERLAY * 100);
        }

        // Reset hover ui

    }
    handle_overlay(e) {
        this.OVERLAY = (e.detail.value / 100);
    }
    handle_diff(e) {
        if (e.target === e.currentTarget) {
            return;
        }
        e.stopPropagation();
        this.export_current_view();
    }

    export_current_view() {
        // Exports whatever is currently shown in the main result canvas
        // (e.g. the Difference view). Used both by the "Download" button
        // shown in Difference mode and by the "Export" menu item.
        this.download_el.href = this.result.canvas.toDataURL("image/png");
        this.download_el.download = "image_compare_visualisation.png";
        this.download_el.click();
        this.snack_el.MDCSnackbar.labelText = 'Saved current view as image.';
        this.snack_el.MDCSnackbar.open();
    }

    handle_slide(e) {
        if (e.target.checked) {
            this.HORIZONTAL = e.target.value === 'horizontal';
        }
        if (this.HORIZONTAL) {
            this.image_slider.classList.add('horizontal');
        } else {
            this.image_slider.classList.remove('horizontal');
        }
        this.image_slider.style.left = '50%';
        this.image_slider.style.top = '50%';
        this.SLIDE = 0.5;
    }

    handle_zoom() {
        const canvas = this.result.canvas;
        let scale = 1.0;
        let x = 0;
        let y = 0;

        let enabled = false;
        let mousemove_enabled = false;

        const add_mousemove = () => {
            if (mousemove_enabled) {
                return;
            }
            canvas.addEventListener('mousemove', onmousemove);
            mousemove_enabled = true;
        };

        const remove_mousemove = () => {
            if (!mousemove_enabled) {
                return;
            }
            canvas.removeEventListener('mousemove', onmousemove);
            mousemove_enabled = false;
        };
        const redraw = (transform = undefined) => {
            const _scale = transform && transform.scale || scale;
            if (_scale > 1) {
                add_mousemove();
            } else {
                remove_mousemove();
            }

            this.result.current_transform = transform || {
                scale,
                tx: x,
                ty: y
            }


            this.result.draw();

        }
        const onmousewheel = (e) => {
            e.stopPropagation();
            const current_scale = scale;
            const ox = x;
            const oy = y;

            scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (scale -  0.005 * e.deltaY)));

            x = e.offsetX;
            y = e.offsetY;

            if (scale !== current_scale || x !== ox || y !== oy) {
                redraw();
            }

        }

        const onmousemove = (e) => {
            e.preventDefault();
            const ox = x;
            const oy = y;

            x = e.offsetX;
            y = e.offsetY;

            if (x !== ox || y !== oy) {
                redraw();
            }
        }

        const add_listeners = () => {
            if (enabled) {
                return;
            }
            canvas.addEventListener('wheel', onmousewheel, {passive: true});
            redraw();
            enabled = true;
        }

        const remove_listeners = (reset = true) => {
            if (!enabled) {
                return;
            }
            if (reset) {
                scale = 1;
                x = 0;
                y = 0;
            }
            redraw({scale: 1, tx: 0, ty: 0});
            canvas.removeEventListener('wheel', onmousewheel, {passive: true});
            enabled = false;
        }

        return {
            add_listeners,
            remove_listeners
        }
    }

    dragElement(el) {
        // Track width and padding are equal
        let pw = 0;
        let ph = 0;
        let m = 0;
        let M = 0;
        let padding = 0;
        let padding_tb = 0;
        let padding_lr = 0;
        let timeout = null;
        const getBounds = () => {
            padding = (0.25 * parseFloat(getComputedStyle(el.parentElement).fontSize));
            let { x, y, width, height } = this.result.canvas.getBoundingClientRect();
            width -= 2*padding;
            height -= 2*padding;

            const iw = this.result.canvas.width;
            const ih = this.result.canvas.height;

            let rh = 0;
            let rw = 0;

            // Aspect ratio
            const iar = iw / ih;
            const ar = width / height;

            if (iar < ar) {
                // Rendered on wider screen
                rh = height;
                rw = rh * iar;
            } else {
                // Rendered on narrower screen
                rw = width;
                rh = rw / iar;
            }
            // TODO Get padding programmatically of the canvas element
            // Now the padding is manually copied from CSS - 2.5% LR and 0.5em TB;
            // TODO: Include track width.
            pw = rw + 2*padding;
            ph = rh + 2*padding;

            padding_lr = (width - rw) / 2;
            padding_tb = (height - rh) / 2;
            m = (this.HORIZONTAL ? x : y);
            M = this.HORIZONTAL ? (pw + padding_lr - padding / 2) : (ph + padding_tb - padding / 2);
        }
        window.addEventListener('resize', () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                getBounds();
                if (this.MODE === 'slide') {
                    this.show();
                }
            }, 250);
        });
        const dragMove = (e) => {
          e = e || window.event;

          if (
            e.touches &&
            (e.touches.length > 1 ||
              (e.type === "touchend" && e.touches.length > 0))
          ) {
            return;
          }
          e.preventDefault();

          let _slide_factor = 0.5;
          if (this.HORIZONTAL) {
            const cx = (e.clientX || e.changedTouches[0].clientX) - m;
            _slide_factor = Math.max(padding_lr + padding / 2, Math.min(cx, M));
            el.style.left = `${_slide_factor}px`;
          } else {
            const cy = (e.clientY || e.changedTouches[0].clientY) - m;
            _slide_factor = Math.max(padding_tb + padding / 2, Math.min(cy, M));
            el.style.top = `${_slide_factor}px`
          }

          const _padding = ((this.HORIZONTAL ? padding_lr : padding_tb) + padding / 2);

          // https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
          _slide_factor -= _padding;
          _slide_factor /= (M - _padding);
          _slide_factor = +_slide_factor.toFixed(3);
          this.SLIDE = _slide_factor;
        };

        const dragEnd = () => {
          window.onmouseup = null;
          window.ontouchend = null;
          this.result_container.ontouchmove = null;
          this.result_container.onmousemove = null;
        };

        const dragStart = (e) => {
          e = e || window.event;

          if (
            e.touches &&
            (e.touches.length > 1 ||
              (e.type === "touchend" && e.touches.length > 0))
          ) {
            return;
          }

          e.preventDefault();
          getBounds();
          this.result_container.onmousemove = this.result_container.ontouchmove =
            dragMove;
          window.onmouseup = window.ontouchend =
            dragEnd;
        };

        el.onmousedown = dragStart;
        el.ontouchstart = dragStart;
    }

    hoverSwitch (el) {
        let flag = false;
        const flip_draw = (flip) => {
          if (flip) {
            if (!flag) {
              this.HOVER = '2'
              flag = true;
            }
          } else {
            if (flag) {
              this.HOVER = '1'
              flag = false;
            }
          }
        };
        const hover_move_listener = (e) => {
          e = e || window.event;

          if (
            e.touches &&
            (e.touches.length > 1 ||
              (e.type === "touchend" && e.touches.length > 0))
          ) {
            return;
          }
          e.preventDefault();

          const { width: w, left: l} = el.getBoundingClientRect();
          const cx = e.offsetX || (e.changedTouches[0].clientX - l);
          flip_draw(cx > w / 2);
        };
        const touch_end_listener = (e) => {
          el.ontouchend = null;
          el.ontouchmove = null;
        };
        const touch_start_listener = (e) => {
          e = e || window.event;

          if (
            e.touches &&
            (e.touches.length > 1 ||
              (e.type === "touchend" && e.touches.length > 0))
          ) {
            return;
          }

          e.preventDefault();
          const { width: w, left: l} = el.getBoundingClientRect();
          const cx = e.offsetX || (e.changedTouches[0].clientX - l);
          flip_draw(cx > w / 2);

          el.ontouchmove = hover_move_listener;
          el.ontouchend = touch_end_listener;
        };
        const add = () => {
          flag = false;
          this.HOVER = '1'
          el.onmousemove = hover_move_listener;
          el.ontouchstart = touch_start_listener;
        };
        const remove = () => {
          el.onmousemove = null;
          el.ontouchstart = null;
        };
        return {
          add,
          remove,
        };
    };

    reset_toggle_ui(clicked_btn, active_btn) {

        clicked_btn.classList.add('active', 'mdc-theme--primary-bg');
        active_btn.classList.remove('active', 'mdc-theme--primary-bg');

        const clicked_label = clicked_btn.querySelector('span.mdc-tab__text-label');
        const active_label = active_btn.querySelector('span.mdc-tab__text-label');

        active_label.classList.replace('mdc-theme--on-primary', 'mdc-theme--primary');
        clicked_label.classList.replace('mdc-theme--primary', 'mdc-theme--on-primary');

    }

    handle_toggle(e) {
        const clicked_btn = e.target.closest('button.mdc-tab');
        if (!(clicked_btn)) {
            // Button is not clicked?
            return;
        }
        const active_btn = e.currentTarget.querySelector('button.mdc-tab.active');
        if (clicked_btn === active_btn) {
            // Active button is clicked
            return;
        }
        this.reset_toggle_ui(clicked_btn, active_btn);

        this.TOGGLE_SPEED = Number.parseInt(clicked_btn.dataset.speed);
    }

    export_aligned_images() {
        var filename_list = this.result.selected_filename_list;
        if(filename_list.length !== 2) {
            filename_list = ['im1.png', 'im2-aligned.png'];
        }
        const im1 = this.result.getImageData(this.result.ocanvas);
        this.result.bctx.putImageData( im1, 0, 0 );
        this.download_el.href = this.result.bcanvas.toDataURL("image/png");
        this.download_el.download = filename_list[0];
        this.download_el.click();

        this.download_el.href = this.result.tcanvas.toDataURL("image/png");
        this.download_el.download = filename_list[1];
        this.download_el.click();

        this.snack_el.MDCSnackbar.labelText = 'Saved two aligned images.';
        this.snack_el.MDCSnackbar.open();

    }

    export_gif() {
        var gif_filename = 'im1-im2-aligned-toggle.gif';
        const filename_list = this.result.selected_filename_list;
        if(filename_list.length === 2) {
            gif_filename = filename_list[0] + '-' + filename_list[1] + '.gif';
        }

        const im1_data = this.result.getImageData(this.result.ocanvas);
        this.result.bctx.putImageData( im1_data, 0, 0 );
        var im1 = document.createElement('img');
        im1.src = this.result.bcanvas.toDataURL("image/png");

        var im2 = document.createElement('img');
        im2.src = this.result.tcanvas.toDataURL("image/png");;

        gifshot.createGIF({
            'images':[im1, im2],
            'frameDuration':4,
            'gifWidth':im1_data.width,
            'gifHeight':im1_data.height
        }, function(obj) {
            if(!obj.error) {
                this.download_el.href = obj.image;
                this.download_el.download = gif_filename;
                this.download_el.click();
                this.snack_el.MDCSnackbar.labelText = 'Saved toggle visualization as GIF image.';
                this.snack_el.MDCSnackbar.open();
            } else {
                this.snack_el.MDCSnackbar.labelText = 'Failed to export toggle view as GIF image.';
                this.snack_el.MDCSnackbar.open();
            }
        }.bind(this));
    }
}
