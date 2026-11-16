from playwright.sync_api import sync_playwright
U='http://localhost:8787/'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    m=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True)
    pg=m.new_page(); pg.on('pageerror', lambda x: errs.append(str(x)))
    pg.goto(U); pg.fill('#pw','dongi-1234'); pg.click('button[type=submit]'); pg.click('[data-act=pick-me][data-id=m1]'); pg.wait_for_selector('.ov-grid')
    pg.goto(U+'#/b/peds/prof'); pg.wait_for_selector('.prof-label'); pg.screenshot(path='shots/50-merged.png')
    d=b.new_context(viewport={'width':1280,'height':900}); dp=d.new_page(); dp.on('pageerror', lambda x: errs.append(str(x)))
    dp.goto(U); dp.fill('#pw','dongi-1234'); dp.click('button[type=submit]'); dp.click('[data-act=pick-me][data-id=m2]'); dp.wait_for_selector('.ov-grid')
    dp.goto(U+'#/b/ktpl'); dp.wait_for_selector('.section')
    dp.evaluate("""(sel) => { const el=document.querySelector(sel); const dt=new DataTransfer(); dt.items.add(new File(['x'], 'KTPL.hwp')); for (const t of ['dragenter','dragover','drop']) el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt})); }""", '.section:last-of-type .empty-line')
    dp.wait_for_selector('#doc-form'); print('drop anywhere ->', dp.input_value('input[name=title]'))
    b.close()
print('errors', errs)
