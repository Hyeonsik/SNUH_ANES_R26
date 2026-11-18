from playwright.sync_api import sync_playwright
U='http://localhost:8787/'
with sync_playwright() as p:
    b=p.chromium.launch(); dp=b.new_page(viewport={'width':1366,'height':900})
    dp.goto(U); dp.fill('#pw','dongi-1234'); dp.click('button[type=submit]'); dp.click('[data-act=pick-me][data-id=m1]'); dp.wait_for_selector('.ov-grid')
    dp.goto(U+'#/b/study'); dp.wait_for_selector('.gallery')
    dp.click('.scard:has-text("Mallampati")'); dp.wait_for_selector('.ed'); dp.keyboard.press('Escape'); dp.wait_for_timeout(200)
    print('sheet hidden', dp.evaluate("document.getElementById('sheet').hidden"), 'focus', dp.evaluate("document.activeElement.tagName+'#'+document.activeElement.id"))
    dp.keyboard.press('Control+k'); dp.wait_for_timeout(200); print('palette', dp.locator('.palette').count())
    dp.keyboard.type('half-time'); dp.wait_for_timeout(200); print(dp.inner_text('.palette-list')[:300])
    b.close()
