// Split-double-pages.jsx  -  Book Compare helper script for Adobe Photoshop
//
// What it does
//   Many libraries scan a book as DOUBLE pages (a left and a right page in one picture). Book Compare needs ONE page per picture.
//   This script goes through a folder of such scans, cuts every double page in the middle and saves the LEFT and the RIGHT page as two
//   new files in ANOTHER folder, in reading order:
//        00001.jpg  ->  00001_L.jpg  (left page)  and  00001_R.jpg  (right page)
//   Pictures that are not double pages (a cover, a back cover: taller than wide) are copied unchanged as  00000_single.jpg .
//   Sorted by name the new files are in the right order: 00000_single, 00001_L, 00001_R, 00002_L, 00002_R, ...
//
// Safety
//   * The original files are only READ. They are never saved, renamed, moved or deleted (each picture is opened, copied and closed
//     WITHOUT saving).
//   * The new files go to a different folder. The script refuses a folder that is the scan folder itself or lies inside it.
//   * A file that already exists in the new folder is not touched ("skipped"). So you can stop the script (press Esc) and start it
//     again later: it carries on where it stopped.
//
// How to run (Photoshop):  File > Scripts > Browse ...  then choose this file.  (No installation needed.)
//
// For the programmers: this is ExtendScript (old JavaScript, ES3). The logic is in small functions; tests with a stand-in for Photoshop
// are in tests/photoshop/ of the Book Compare repository.

#target photoshop

var BC_VERSION = '1.0';

/* ------------------------------------------------------------------------------------------------ small helpers (no Photoshop needed) */
function naturalCompare(a, b) {                               // "p2" before "p10"
    var ra = String(a).toLowerCase().match(/(\d+|\D+)/g) || [], rb = String(b).toLowerCase().match(/(\d+|\D+)/g) || [];
    for (var i = 0; i < ra.length && i < rb.length; i++) {
        var x = ra[i], y = rb[i];
        if (/^\d/.test(x) && /^\d/.test(y)) {
            var d = parseInt(x, 10) - parseInt(y, 10);
            if (d !== 0) return d < 0 ? -1 : 1;
            if (x.length !== y.length) return x.length < y.length ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return ra.length - rb.length;
}
function extOf(name) {                                        // 'jpg' for "00001.JPG" and "00001.jpeg"
    var m = /\.([A-Za-z0-9]+)$/.exec(name); if (!m) return '';
    var e = m[1].toLowerCase(); return e === 'jpeg' ? 'jpg' : e === 'tiff' ? 'tif' : e;
}
function baseOf(name) { return String(name).replace(/\.[A-Za-z0-9]+$/, ''); }
function isPicture(name) { var e = extOf(name); return e === 'jpg' || e === 'tif' || e === 'png'; }
function isDouble(w, h) { return w >= h * 1.1; }              // a double page is clearly wider than tall; a single page is taller than wide
function cutPosition(w, percent) { var c = Math.round(w * percent / 100); return Math.max(1, Math.min(w - 1, c)); }
function norm(path) { return String(path).replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '') + '\\'; }
function isInside(childPath, parentPath) { var c = norm(childPath), p = norm(parentPath); return c.indexOf(p) === 0; }   // also true when both are the same folder
function outName(base, ext, part) { return base + '_' + part + '.' + ext; }          // part = 'L', 'R' or 'single'
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

/* ------------------------------------------------------------------------------------------------ the work */
function listPictures(folder) {
    var all = folder.getFiles(), out = [];
    for (var i = 0; i < all.length; i++) if (all[i] instanceof File && isPicture(all[i].name)) out.push(all[i]);
    out.sort(function (a, b) { return naturalCompare(a.name, b.name); });
    return out;
}
function saveCopy(doc, target, ext, quality) {                // saves a COPY of the picture; the open picture and the original file stay as they are
    if (ext === 'jpg') {
        var j = new JPEGSaveOptions(); j.quality = quality; j.embedColorProfile = true; j.formatOptions = FormatOptions.STANDARDBASELINE; j.matte = MatteType.NONE;
        doc.saveAs(target, j, true, Extension.LOWERCASE);
    } else if (ext === 'tif') {
        var t = new TiffSaveOptions(); t.imageCompression = TIFFEncoding.TIFFLZW; t.embedColorProfile = true; t.layers = false;
        doc.saveAs(target, t, true, Extension.LOWERCASE);
    } else {
        var p = new PNGSaveOptions(); p.interlaced = false;
        doc.saveAs(target, p, true, Extension.LOWERCASE);
    }
}
function saveHalf(doc, bounds, target, ext, quality) {        // cut a copy of the picture, save it, close the copy
    var d = doc.duplicate();
    try { d.crop(bounds); saveCopy(d, target, ext, quality); }
    finally { d.close(SaveOptions.DONOTSAVECHANGES); }
}
function processOne(file, o, st) {
    var base = baseOf(file.name), ext = extOf(file.name);
    var fl = new File(o.outPath + '/' + outName(base, ext, 'L')), fr = new File(o.outPath + '/' + outName(base, ext, 'R')), fs = new File(o.outPath + '/' + outName(base, ext, 'single'));
    if ((fl.exists && fr.exists) || fs.exists) { st.skipped++; return; }
    var doc = app.open(file), w, h, single = false;
    try {
        w = doc.width.as('px'); h = doc.height.as('px');
        if (isDouble(w, h)) {
            var cut = cutPosition(w, o.percent);
            saveHalf(doc, [0, 0, cut, h], fl, ext, o.quality);
            saveHalf(doc, [cut, 0, w, h], fr, ext, o.quality);
            st.split++; st.files += 2;
        } else single = true;
    } finally { doc.close(SaveOptions.DONOTSAVECHANGES); }          // never saves anything into the original
    if (single) {
        if (o.copySingles) { if (!file.copy(fs)) throw new Error('could not copy ' + file.name); st.singles++; st.files++; }
        else st.ignored++;
    }
}
function runAll(o, progress) {
    var files = listPictures(o.inFolder), st = { total: files.length, split: 0, singles: 0, skipped: 0, ignored: 0, files: 0, failed: [], stopped: false };
    var oldUnits = app.preferences.rulerUnits, oldDlg = app.displayDialogs;
    app.preferences.rulerUnits = Units.PIXELS; app.displayDialogs = DialogModes.NO;            // no questions about colour profiles etc.
    try {
        for (var i = 0; i < files.length; i++) {
            if (progress) progress(i, files.length, files[i].name);
            try { processOne(files[i], o, st); }
            catch (e) {
                if (e && e.number === 8007) { st.stopped = true; break; }                     // Esc pressed: Photoshop's "cancel"
                st.failed.push(files[i].name + ': ' + (e && e.message ? e.message : e));
            }
        }
    } finally { app.preferences.rulerUnits = oldUnits; app.displayDialogs = oldDlg; }
    return st;
}
function summary(st) {
    var s = 'Pictures looked at: ' + st.total + '\n' +
        'Double pages split: ' + st.split + ' (' + plural(st.split * 2, 'new file', 'new files') + ')\n' +
        'Single pages copied unchanged: ' + st.singles + '\n' +
        'Skipped, already in the new folder: ' + st.skipped + '\n' +
        (st.ignored ? 'Single pages left out: ' + st.ignored + '\n' : '') +
        'Failed: ' + st.failed.length + '\n';
    for (var i = 0; i < st.failed.length; i++) s += '  - ' + st.failed[i] + '\n';
    if (st.stopped) s += '\nStopped before the end (Esc). Start the script again: finished files are skipped.\n';
    return s;
}
function writeLog(o, st) {
    try {
        var f = new File(o.outPath + '/split-log.txt'); f.encoding = 'UTF-8'; f.open('w');
        f.write('Book Compare - Split-double-pages.jsx ' + BC_VERSION + '\nFrom: ' + o.inFolder.fsName + '\nTo:   ' + o.outFolder.fsName + '\nCut at ' + o.percent + ' % from the left, JPEG quality ' + o.quality + '\n\n' + summary(st));
        f.close();
    } catch (e) { /* the log is a courtesy */ }
}

/* ------------------------------------------------------------------------------------------------ the question window */
function checkOptions(o) {                                    // returns a text when something is wrong, else ''
    if (!o.inFolder) return 'Please choose the folder with the double-page scans.';
    if (!o.outFolder) return 'Please choose the folder for the new single pages.';
    if (isInside(o.outFolder.fsName, o.inFolder.fsName)) return 'The new files must go to a DIFFERENT folder, not into the scan folder or a folder inside it. This keeps the original scans untouched.\n\nPlease choose another folder for the new files.';
    if (!(o.percent >= 20 && o.percent <= 80)) return 'The cut position must be a number between 20 and 80 (50 = exactly in the middle).';
    if (!(o.quality >= 1 && o.quality <= 12)) return 'The JPEG quality must be a number from 1 to 12 (12 = best).';
    return '';
}
function askOptions() {
    var inF = null, outF = null;
    var w = new Window('dialog', 'Split double-page scans into left and right pages');
    w.orientation = 'column'; w.alignChildren = 'fill'; w.margins = 16; w.spacing = 10;
    w.add('statictext', undefined, 'The original scans are only read, never changed. The new pages are saved in a different folder.', { multiline: true }).preferredSize.width = 520;
    var g1 = w.add('group'); g1.alignChildren = 'left';
    var b1 = g1.add('button', undefined, '1. Folder with the double-page scans ...'); b1.preferredSize.width = 250;
    var t1 = g1.add('statictext', undefined, '(not chosen yet)'); t1.preferredSize.width = 300;
    var g2 = w.add('group'); g2.alignChildren = 'left';
    var b2 = g2.add('button', undefined, '2. Folder for the new pages ...'); b2.preferredSize.width = 250;
    var t2 = g2.add('statictext', undefined, '(not chosen yet)'); t2.preferredSize.width = 300;
    var g3 = w.add('group'); g3.add('statictext', undefined, 'Cut at');
    var e3 = g3.add('edittext', undefined, '50'); e3.characters = 5;
    g3.add('statictext', undefined, '% from the left edge   (50 = exactly in the middle; if the spine of your book is a little left of the middle, try 49)');
    var g4 = w.add('group'); g4.add('statictext', undefined, 'JPEG quality');
    var e4 = g4.add('edittext', undefined, '12'); e4.characters = 3;
    g4.add('statictext', undefined, '(1 to 12, 12 = best; only used for JPEG files)');
    var c5 = w.add('checkbox', undefined, 'Copy pictures that are not double pages (covers: taller than wide) unchanged'); c5.value = true;
    w.add('statictext', undefined, 'Files that already exist in the new folder are skipped. To start again from zero, choose an empty folder.', { multiline: true }).preferredSize.width = 520;
    var bg = w.add('group'); bg.alignment = 'right';
    var ok = bg.add('button', undefined, 'Start', { name: 'ok' }), cancel = bg.add('button', undefined, 'Cancel', { name: 'cancel' });
    b1.onClick = function () { var f = Folder.selectDialog('Choose the folder with the double-page scans'); if (f) { inF = f; t1.text = f.fsName; } };
    b2.onClick = function () { var f = Folder.selectDialog('Choose the folder for the new single pages (NOT the scan folder)'); if (f) { outF = f; t2.text = f.fsName; } };
    ok.onClick = function () {
        var o = { inFolder: inF, outFolder: outF, percent: parseFloat(String(e3.text).replace(',', '.')), quality: parseInt(e4.text, 10), copySingles: c5.value };
        var msg = checkOptions(o);
        if (msg) { alert(msg); return; }
        w.close(1);
    };
    if (w.show() !== 1) return null;
    var res = { inFolder: inF, outFolder: outF, percent: parseFloat(String(e3.text).replace(',', '.')), quality: parseInt(e4.text, 10), copySingles: c5.value };
    return res;
}

/* ------------------------------------------------------------------------------------------------ start */
function main() {
    if (typeof BC_TEST === 'undefined') app.bringToFront();
    var o = (typeof BC_TEST !== 'undefined') ? BC_TEST.options : askOptions();
    if (!o) return;
    var msg = checkOptions(o); if (msg) { if (typeof BC_TEST !== 'undefined') { BC_TEST.error = msg; return; } alert(msg); return; }
    o.outPath = o.outFolder.absoluteURI;                                  // (the form that new File(...) understands best, also with spaces and umlauts)
    if (!o.outFolder.exists) o.outFolder.create();
    var prog = null, pw = null;
    if (typeof BC_TEST === 'undefined') {
        pw = new Window('palette', 'Splitting double pages ...'); pw.alignChildren = 'fill';
        var bar = pw.add('progressbar', undefined, 0, 100); bar.preferredSize.width = 420;
        var txt = pw.add('statictext', undefined, ''); txt.preferredSize.width = 420;
        pw.add('statictext', undefined, 'Press Esc to stop. You can start again later: finished files are skipped.');
        pw.show();
        prog = function (i, n, name) { bar.maxvalue = n; bar.value = i; txt.text = (i + 1) + ' of ' + n + ': ' + name; pw.update(); };
    }
    var st = runAll(o, prog);
    if (pw) pw.close();
    writeLog(o, st);
    if (typeof BC_TEST !== 'undefined') { BC_TEST.result = st; BC_TEST.summary = summary(st); return; }
    alert(summary(st) + '\nA short report was saved as split-log.txt in the new folder.');
}
main();
