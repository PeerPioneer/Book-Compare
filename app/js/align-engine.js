/* Book Compare: the tile-based alignment engine, as seen from the page.
   The work itself runs in js/align-worker.js (a Web Worker with OpenCV.js), so the page does not freeze while it runs.
     var engine = AlignEngine.create();
     await engine.init();                    // loads OpenCV.js (about 13 MB, cached by the browser after the first time)
     await engine.reference(file);           // the copy all others are aligned onto
     var r = await engine.align(file, true); // one more copy: times of every step and (measure = true) how well the ink matches
     engine.terminate();
   `file` is a File or Blob with the scan. Nothing is written anywhere. */
(function () {
  'use strict';
  function supported() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
  }
  function create() {
    var worker = new Worker('js/align-worker.js'), next = 1, pending = {}, dead = null;
    function failAll(msg) { dead = msg; Object.keys(pending).forEach(function (k) { pending[k].rej(new Error(msg)); delete pending[k]; }); }
    worker.onmessage = function (ev) {
      var m = ev.data, p = pending[m.id]; if (!p) return; delete pending[m.id];
      if (m.ok) p.res(m.result); else p.rej(new Error(m.error));
    };
    worker.onerror = function (ev) { failAll('The alignment worker stopped: ' + (ev && ev.message ? ev.message : 'unknown error')); };
    function call(cmd, extra) {
      return new Promise(function (res, rej) {
        if (dead) { rej(new Error(dead)); return; }
        var id = next++; pending[id] = { res: res, rej: rej };
        worker.postMessage(Object.assign({ id: id, cmd: cmd }, extra || {}));
      });
    }
    return {
      init: function () { return call('init'); },
      reference: function (file) { return call('reference', { file: file }); },
      align: function (file, measure) { return call('align', { file: file, measure: !!measure }); },
      terminate: function () { failAll('The alignment worker was closed.'); worker.terminate(); }
    };
  }
  window.AlignEngine = { supported: supported, create: create };
})();
