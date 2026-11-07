"""Checks of the grid editing: column width (drag the edge of a heading), moving a copy (drag the heading or the toolbar buttons) and
deleting a whole range of files (Shift + click / Shift + arrow). Shared by test_workspace.py (Chromium, private browser storage) and
test_helper.py (Chromium AND Firefox, real folders). It expects the three test copies and leaves the grid exactly as it found it.
"""

def run(pg, col, read_proj=None):
    cell = lambda ci, r: pg.locator('#ws .ws-cell[data-c="%d"][data-r="%d"]' % (ci, r))
    names = lambda: pg.evaluate("[...document.querySelectorAll('#ws .ws-hname')].map(e=>e.textContent)")
    allcols = lambda: [col(pg, i) for i in range(3)]
    hw = lambda ci: pg.evaluate("ci=>document.querySelectorAll('#ws .ws-hcell')[ci].getBoundingClientRect().width", ci)
    cw = lambda ci: pg.evaluate("ci=>document.querySelector('#ws .ws-cell[data-c=\"'+ci+'\"]').getBoundingClientRect().width", ci)
    cut = lambda ci: pg.evaluate("ci=>[...document.querySelectorAll('#ws .ws-cell.filled[data-c=\"'+ci+'\"] .fn')].filter(e=>e.scrollWidth>e.clientWidth+1).length", ci)
    delbtn = lambda: pg.inner_text('#ws [data-act=del]')
    start_cols, start_names = allcols(), names()
    assert len(start_names) == 3 and start_cols[0][0] != start_cols[1][0]

    # ---- column width: drag the right edge of a heading -------------------------------------------------------------------
    assert abs(hw(0) - 172) < 2 and abs(hw(1) - 172) < 2
    def drag_edge(ci, dx):
        bb = pg.locator('#ws .ws-rz[data-c="%d"]' % ci).bounding_box(); x = bb['x'] + bb['width'] / 2; y = bb['y'] + bb['height'] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx / 2, y, steps=4); pg.mouse.move(x + dx, y, steps=4); pg.mouse.up(); pg.wait_for_timeout(120)
    drag_edge(0, 98)
    assert abs(hw(0) - 270) < 2 and abs(cw(0) - 270) < 2 and abs(hw(1) - 172) < 2, (hw(0), cw(0), hw(1))
    assert names() == start_names and allcols() == start_cols, 'resizing must not move or rename anything'
    lh = pg.evaluate("document.querySelectorAll('#ws .ws-hcell')[1].getBoundingClientRect().left"); lc = pg.evaluate("document.querySelector('#ws .ws-cell[data-c=\"1\"]').getBoundingClientRect().left")
    assert abs(lh - lc) < 1, 'the cells stay under their heading'
    drag_edge(0, -300); assert abs(hw(0) - 80) < 2, hw(0)                       # not narrower than 80
    drag_edge(0, 900); assert abs(hw(0) - 700) < 2, hw(0)                      # not wider than 700
    drag_edge(0, -560); assert abs(hw(0) - 140) < 2, hw(0)
    if read_proj:
        pg.wait_for_timeout(1500); assert read_proj()['copies'][0].get('w') == 140, read_proj()['copies'][0].get('w')
    # a narrow column cuts the names; a double-click on the edge fits them
    drag_edge(1, -100); assert abs(hw(1) - 80) < 2 and cut(1) > 0
    pg.locator('#ws .ws-rz[data-c="1"]').dblclick(); pg.wait_for_timeout(150)
    assert hw(1) > 100 and cut(1) == 0, (hw(1), cut(1))
    pg.click('#ws-more'); pg.click('[data-m=colw]'); pg.wait_for_timeout(200)
    assert abs(hw(0) - 172) < 2 and abs(hw(1) - 172) < 2 and abs(hw(2) - 172) < 2

    # ---- moving a copy ------------------------------------------------------------------------------------------------------
    drag_edge(0, 60)                                                            # copy 1 is wider now: the width goes with the column
    cell(1, 2).click(); pg.wait_for_timeout(100)
    assert pg.locator('#ws [data-act=mvr]').is_enabled() and pg.locator('#ws [data-act=mvl]').is_enabled()
    pg.click('#ws [data-act=mvl]'); pg.wait_for_timeout(250)
    assert names() == [start_names[1], start_names[0], start_names[2]], names()
    assert col(pg, 0) == start_cols[1] and col(pg, 1) == start_cols[0] and abs(hw(1) - 232) < 2, 'the files and the width move with the column'
    assert pg.evaluate("document.querySelector('#ws .ws-cell.sel').dataset.c") == '0' and not pg.locator('#ws [data-act=mvl]').is_enabled(), 'the selection follows the copy'
    pg.click('#ws [data-act=mvr]'); pg.click('#ws [data-act=mvr]'); pg.wait_for_timeout(250)
    assert names() == [start_names[0], start_names[2], start_names[1]] and not pg.locator('#ws [data-act=mvr]').is_enabled(), names()
    for _ in range(3): pg.keyboard.press('Control+z'); pg.wait_for_timeout(120)
    assert names() == start_names and allcols() == start_cols, 'Undo puts the copies back'
    # by dragging the heading: onto the right half of another heading = behind it, onto the left half = in front of it, onto "+" = to the end
    def drag_head(src, dst, right):
        s = pg.locator('#ws .ws-hcell[data-c="%d"]' % src); d = pg.locator('#ws .ws-hcell[data-c="%d"]' % dst)
        w = d.bounding_box()['width']
        s.drag_to(d, source_position={'x': 40, 'y': 55}, target_position={'x': (w - 15) if right else 15, 'y': 55}); pg.wait_for_timeout(300)
    drag_head(0, 2, True);  assert names() == [start_names[1], start_names[2], start_names[0]], names()
    drag_head(2, 0, False); assert names() == start_names, names()
    drag_head(0, 1, False); assert names() == start_names, 'in front of its right neighbour = same place'
    drag_head(1, 0, False); assert names() == [start_names[1], start_names[0], start_names[2]], names()
    pg.locator('#ws .ws-hcell[data-c="0"]').drag_to(pg.locator('#ws .ws-addcell'), source_position={'x': 40, 'y': 55}); pg.wait_for_timeout(300)
    assert names() == [start_names[0], start_names[2], start_names[1]], names()
    assert col(pg, 2) == start_cols[1], 'the files go with their copy'
    for _ in range(4): pg.keyboard.press('Control+z'); pg.wait_for_timeout(120)             # (four moves above; dropping in the same place is not a change)
    assert names() == start_names and allcols() == start_cols
    # renaming still works with a draggable heading (and the name can be typed)
    pg.locator('#ws .ws-hname').nth(2).click(); pg.keyboard.type('Zz'); pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    assert names() == start_names
    pg.click('#ws-more'); pg.click('[data-m=colw]'); pg.wait_for_timeout(150)

    # ---- several files at once: Shift + click, Shift + arrow --------------------------------------------------------------
    c2 = start_cols[2]; assert all(x != '-' for x in c2[:6])
    cell(2, 0).click(); assert delbtn() == 'Delete file'
    cell(2, 2).click(modifiers=['Shift']); pg.wait_for_timeout(120)
    assert pg.locator('#ws .ws-cell.rng[data-c="2"]').count() == 2 and pg.locator('#ws .ws-cell.sel[data-c="2"]').count() == 1
    assert delbtn() == 'Delete 3 files' and '3 rows' in pg.inner_text('#ws-toolbar .sel'), (delbtn(), pg.inner_text('#ws-toolbar .sel'))
    pg.keyboard.press('Delete'); pg.wait_for_timeout(200)                                  # the whole range goes at once, the pages below move up
    assert col(pg, 2)[:3] == c2[3:6] and allcols()[0] == start_cols[0] and allcols()[1] == start_cols[1], col(pg, 2)
    assert pg.locator('#ws .ws-cell.rng').count() == 0 and delbtn() == 'Delete file'
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)                               # ONE undo brings all three back
    assert allcols() == start_cols, 'a single undo restores the whole range'
    # Shift + arrows (from the active row, up and down), a plain arrow ends the range
    cell(2, 1).click(); pg.keyboard.press('Shift+ArrowDown'); pg.keyboard.press('Shift+ArrowDown'); pg.wait_for_timeout(120)
    assert delbtn() == 'Delete 3 files' and pg.locator('#ws .ws-cell.rng[data-c="2"]').count() == 2
    pg.keyboard.press('Shift+ArrowUp'); pg.wait_for_timeout(100); assert delbtn() == 'Delete 2 files'
    pg.keyboard.press('Shift+ArrowUp'); pg.keyboard.press('Shift+ArrowUp'); pg.wait_for_timeout(100)       # past the start row: now rows 0-1
    assert delbtn() == 'Delete 2 files' and pg.locator('#ws .ws-cell.sel[data-c="2"]').get_attribute('data-r') == '0', delbtn()
    pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(100); assert delbtn() == 'Delete file' and pg.locator('#ws .ws-cell.rng').count() == 0
    # Shift + click in another column does not make a range across columns; empty cells inside a range are removed with it
    cell(1, 0).click(); cell(1, 3).click(modifiers=['Shift']); pg.wait_for_timeout(100)
    assert delbtn() == 'Delete 3 files', delbtn()                                          # row 0 is empty in copy 2 (it starts at page 2)
    cell(0, 5).click(modifiers=['Shift']); pg.wait_for_timeout(100)
    assert pg.locator('#ws .ws-cell.rng').count() == 0 and delbtn() == 'Delete file', 'another column: a new selection'
    cell(1, 0).click(); cell(1, 3).click(modifiers=['Shift']); pg.keyboard.press('Delete'); pg.wait_for_timeout(200)
    b = col(pg, 1); assert b[:3] == start_cols[1][4:7] and set(b[3:]) == {'-'}, b
    pg.click('#ws [data-act=undo]'); pg.wait_for_timeout(200)                               # the Undo button works too
    assert allcols() == start_cols
    cell(2, 0).click(); pg.wait_for_timeout(100)
    assert names() == start_names
