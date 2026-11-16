from playwright.sync_api import sync_playwright
U='http://localhost:8787/'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    m=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True)
    pg=m.new_page(); pg.on('pageerror', lambda x: errs.append(str(x)))
    pg.goto(U); pg.fill('#pw','dongi-1234'); pg.click('button[type=submit]'); pg.click('[data-act=pick-me][data-id=m1]'); pg.wait_for_selector('.ov-grid')
    pg.goto(U+'#/b/peds/prof'); pg.wait_for_selector('.prof-chips'); pg.screenshot(path='shots/40-merged.png', full_page=True)
    d=b.new_context(viewport={'width':1280,'height':900}); dp=d.new_page(); dp.on('pageerror', lambda x: errs.append(str(x)))
    dp.goto(U); dp.fill('#pw','dongi-1234'); dp.click('button[type=submit]'); dp.click('[data-act=pick-me][data-id=m2]'); dp.wait_for_selector('.ov-grid')
    dp.goto(U+'#/b/ns'); dp.wait_for_selector('.docs-block')
    js = """(sel) => { const el=document.querySelector(sel); const dt=new DataTransfer(); dt.items.add(new File(['%PDF-1.4 x'], 'NS 인계장 11월.pdf', {type:'application/pdf'}));
      for (const t of ['dragenter','dragover','drop']) el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt})); }"""
    dp.evaluate(js, '.docs-block .empty-line')
    dp.wait_for_selector('#doc-form'); dp.wait_for_timeout(250); dp.screenshot(path='shots/41-drop-sheet.png')
    print('title prefilled:', dp.input_value('input[name=title]'))
    dp.click('#doc-form [type=submit]'); dp.wait_for_selector('.doc-card'); print('uploaded card:', dp.inner_text('.doc-card b'))
    # drop into dropzone inside sheet (replace)
    dp.click('[data-act=doc-more]'); dp.click('[data-act=doc-replace]'); dp.wait_for_selector('.dropzone')
    dp.evaluate(js.replace("NS 인계장 11월.pdf","NS 인계장 12월.pdf"), '.dropzone'); dp.wait_for_timeout(150)
    print('dropzone text:', dp.inner_text('.dz-text'))
    dp.click('#doc-form [type=submit]'); dp.wait_for_timeout(300)
    dp.click('[data-act=doc-more]'); print('versions:', dp.locator('.sheet .list-row').count())
    b.close()
print('errors', errs)
