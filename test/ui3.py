from playwright.sync_api import sync_playwright
U='http://localhost:8787/'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    m=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg=m.new_page(); pg.on('pageerror', lambda x: errs.append(str(x)))
    pg.goto(U); pg.fill('#pw','dongi-1234'); pg.click('button[type=submit]')
    pg.wait_for_selector('.who-grid'); pg.screenshot(path='shots/30-who.png')
    pg.click('[data-act=pick-me][data-id=m1]'); pg.wait_for_selector('.ov-grid')
    # upload doc on OS
    pg.goto(U+'#/b/os'); pg.wait_for_selector('.docs-block')
    pg.click('[data-act=doc-upload]'); pg.set_input_files('input[name=file]', '/tmp/up/OS 인계장 2026-11.pdf')
    pg.fill('input[name=title]','OS 인계장'); pg.click('#doc-form [type=submit]'); pg.wait_for_selector('.doc-card')
    # replace
    pg.click('[data-act=doc-more]'); pg.click('[data-act=doc-replace]'); pg.set_input_files('input[name=file]', '/tmp/up/OS 인계장 2026-11.pdf')
    pg.fill('input[name=note]','2026년 12월 업데이트'); pg.click('#doc-form [type=submit]'); pg.wait_for_timeout(300)
    pg.screenshot(path='shots/31-os-docs.png', full_page=True)
    pg.click('[data-act=doc-more]'); pg.wait_for_selector('.list'); pg.screenshot(path='shots/32-versions.png')
    pg.click('[data-act=close] >> nth=-1')
    # link doc
    pg.click('[data-act=doc-upload]'); pg.click('[data-mode=link]'); pg.fill('input[name=url]','https://drive.google.com/x'); pg.fill('input[name=title]','OS 수술 리스트'); pg.click('#doc-form [type=submit]'); pg.wait_for_timeout(300)
    # anon post
    pg.click('.fab'); pg.fill('textarea[name=text]','익명 테스트 글'); pg.check('input[name=anon]'); pg.click('#composer [type=submit]'); pg.wait_for_selector('text=익명 테스트 글')
    pg.goto(U); pg.wait_for_selector('.ov-grid'); pg.screenshot(path='shots/33-home.png', full_page=True)
    # section deep link
    pg.click('.ov-card >> nth=4 >> .ov-secs a >> nth=2'); pg.wait_for_timeout(300); pg.screenshot(path='shots/34-deeplink.png')
    pg.goto(U+'#/b/peds/prof'); pg.wait_for_selector('.list-row'); pg.click('text=지상환 교수님'); pg.wait_for_selector('.section'); pg.screenshot(path='shots/35-prof-real.png', full_page=True)
    # admin links desktop
    d=b.new_context(viewport={'width':1366,'height':900}); dp=d.new_page(); dp.on('pageerror', lambda x: errs.append(str(x)))
    dp.goto(U); dp.fill('#pw','admin-1234'); dp.click('button[type=submit]'); dp.click('[data-act=pick-me][data-id=m1]'); dp.wait_for_selector('.ov-grid')
    dp.screenshot(path='shots/36-home-desktop.png', full_page=True)
    dp.goto(U+'#/admin'); dp.click('[data-tab=links]'); dp.fill('#bulk-links', "🍀마취과 링크\n\n🗂️새 링크\nhttps://example.org/a\n🗂️'26 R1 구글드라이브\nhttps://drive.google.com/drive/folders/1saz3063J9U7k3YO9jWM6rkeYVtv0ROmd?usp=sharing")
    dp.click('[data-act=bulk-links]'); dp.wait_for_timeout(200); dp.screenshot(path='shots/37-admin-links.png', full_page=True)
    dp.click('[data-act=admin-save]'); dp.wait_for_timeout(300)
    print('links after save', dp.evaluate("JSON.parse(localStorage.getItem('hb.cache')).config.links.map(l=>l.icon+l.title)"))
    b.close()
print('errors', errs)
