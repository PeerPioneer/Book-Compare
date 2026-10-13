const twice = () => {
    let count = 0;
    return function() {
        if (count == 1) {
            if (this.src.startsWith('blob:')) {
                URL.revokeObjectURL(this.src);
            }
            return;
        }
        count++;
    }
}
// Scrolls to one of the app's screens and remembers it, so that when the
// browser window is resized (or snapped to half the screen) the view can be
// put back exactly on that screen instead of staying at a stale pixel offset.
const go_to_screen = (el, opts) => {
    window.__screen = { el, opts };
    el.scrollIntoView(Object.assign({ behavior: 'smooth' }, opts));
};
window.addEventListener('resize', () => {
    const sc = window.__screen;
    if (!sc) return;
    window.requestAnimationFrame(() => {
        sc.el.scrollIntoView(Object.assign({}, sc.opts, { behavior: 'auto' }));
    });
});

class Compare {
    constructor(container, result, action_bar) {
        this.c = container;
        this.cc = document.getElementById('compare_container');
        this.h_image_list = this.c.querySelector('ul.mdc-image-list.horizontal-image-list');
        this.v_image_list = this.c.querySelector('ul.mdc-image-list.vertical-image-list');
        this.selected_filename_list = [];

        this.action_bar = action_bar;
        this.result = result;

        this.compare_btn = document.getElementById('compare');
        this.compare_label = this.compare_btn.querySelector('span.mdc-button__label');

        this.footer = this.c.querySelector('footer');

        this.visualisation_select = document.getElementById('visualisation_select');
        this.transform_select = document.getElementById('transform_select')
        this.link_option = document.getElementById('link_toggle');
        this.current_transform = 'affine';

        this.back_btn = document.getElementById('back');
        this.more_btn = document.getElementById('more');

        this.more_menu_el = document.getElementById('more_menu');

        this.input = document.getElementById('image_select_input2');
        const process_images = (function(){
            const v_imgs = this.v_image_list.querySelectorAll('img');
            if(this.selected_filename_list.length) {
                const selected_filename_list = this.selected_filename_list;
                this.result.set_filename_list(selected_filename_list);
            }
            this.result.process(...v_imgs, this.current_transform);
        }).bind(this);

        this.compare_btn.onclick = () => {
            this.compare_label.textContent = 'Processing ...'
            this.compare_btn.disabled = true;

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(process_images)
            })
        }

        this.c.addEventListener('transform', () => {
            var li = this.more_menu_el.querySelectorAll('.mdc-deprecated-list-item--disabled');
            for(var i=0; i<li.length; ++i) {
                li[i].classList.remove('mdc-deprecated-list-item--disabled');
            }

            this.show_result_screen();
            this.compare_label.textContent = 'Compare';
            this.compare_btn.disabled = false;
        });

        this.c.addEventListener('MDCSelect:change', ({detail: {value}, target}) => {
            // If transform select, set current transform
            if (target === this.transform_select) {
                this.current_transform = value;
            } else if (target === this.visualisation_select) {
                // If viz select set mode
                this.action_bar.MODE = value;
            }
        });
        this.back_btn.onclick = this.back.bind(this);

        this.more_btn.onclick = () => {
            this.c.dispatchEvent(new CustomEvent('more'));
        }

        this.input.oninput = this.image_onchange.bind(this);
        [].forEach.call(this.v_image_list.querySelectorAll('li'), (el) => {
            el.onclick = this.handle_image_click.bind(this);
        });
    }

    back () {
        this.c.dispatchEvent(new CustomEvent('back'));
    }

    handle_image_click (e) {
        this.input.setAttribute('data-click', e.currentTarget.dataset.index)
        this.input.click();
    }

    image_onchange(e) {
        if (e.target.files.length === 0) {
            // TODO: Raise an event to show toast / snackbar
            return;
        }

        // TODO: Raise warning if more than 2 images are selected.
        const { files } = e.target;
        this.set_image(
            [URL.createObjectURL(files[0])],
            Number.parseInt(e.target.dataset.click));
        this.selected_filename_list[e.target.dataset.click] = files[0].name || `im${e.target.dataset.click}`;
        e.target.value = null;
    }

    set_filename (filename_list) {
        this.selected_filename_list = filename_list;
    }

    set_image (images, index = -1) {

        if (images.length > 2 || images.length === 0) {
            throw new Error('Cannot use function with 0 or more than 2 images')
        }
        if (images.length === 1 && !(index === 0 || index === 1)) {
            index = 0;
            this.set_image(['./images/empty.svg'], 1);
        }

        const v_imgs = this.v_image_list.querySelectorAll('img');
        const h_imgs = this.h_image_list.querySelectorAll('img');

        if (images.length == 2) {
            if (!v_imgs) {
                //TODO Create new img elements if it doesn't exist?
                throw new Error('No Image elements!');
            }

            images.map((_im, idx) => {
                if (v_imgs[idx].onload === null) {
                    const handler = twice();
                    v_imgs[idx].onload = h_imgs[idx].onload = handler;
                }
                v_imgs[idx].src = h_imgs[idx].src = _im;
            });
            return;
        }

        if (v_imgs[index].onload === null) {
            const handler = twice();
            v_imgs[index].onload = h_imgs[index].onload = handler;
        }
        v_imgs[index].src = h_imgs[index].src = images[0]
    }

    show_compare_screen () {
        var li = this.more_menu_el.querySelectorAll('.mdc-deprecated-list-item');
        for(var i=0; i<3; ++i) {
            li[i].classList.add('mdc-deprecated-list-item--disabled');
        }

        this.transform_select.classList.remove('hide');
        this.link_option.classList.add('hide');

        this.visualisation_select.classList.add('hide');
        this.visualisation_select.MDCSelect.setValue('diff');
        this.visualisation_select.querySelector('#selected-text').textContent = 'Difference';

        go_to_screen(this.cc, {inline: 'start'});
        this.footer.querySelector('.bar').classList.replace('step3', 'step2');
        window.requestAnimationFrame(() => {
            this.action_bar.reset();
        })
        this.back_btn.onclick = this.back.bind(this);
    }

    show_result_screen () {
        this.visualisation_select.classList.remove('hide');

        this.transform_select.classList.add('hide');
        this.link_option.classList.remove('hide');

        this.action_bar.show();
        go_to_screen(this.cc, {inline: 'end'});
        this.footer.querySelector('.bar').classList.replace('step2', 'step3');
        this.back_btn.onclick = this.show_compare_screen.bind(this);
    }
}
