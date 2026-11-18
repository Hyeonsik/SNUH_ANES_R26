from playwright.sync_api import sync_playwright
import base64,io
U='http://localhost:8787/'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    d=b.new_context(viewport={'width':1366,'height':900}); dp=d.new_page(); dp.on('pageerror', lambda x: errs.append(str(x))); dp.on('console', lambda m: m.type=='error' and errs.append(m.text))
    dp.goto(U); dp.fill('#pw','dongi-1234'); dp.click('button[type=submit]'); dp.click('[data-act=pick-me][data-id=m1]'); dp.wait_for_selector('.ov-grid')
    dp.wait_for_timeout(800); dp.screenshot(path='shots/70-home.png')
    dp.goto(U+'#/b/study'); dp.wait_for_selector('.gallery'); dp.wait_for_timeout(1200); dp.screenshot(path='shots/71-gallery.png')
    dp.click('[data-act=st-view][data-v=board]'); dp.wait_for_timeout(800); dp.screenshot(path='shots/72-kanban.png')
    dp.click('[data-act=st-view][data-v=list]'); dp.wait_for_timeout(300); dp.screenshot(path='shots/73-list.png')
    dp.click('[data-act=st-view][data-v=gallery]')
    dp.click('[data-act=st-tag][data-v=TIVA]'); dp.wait_for_timeout(300); print('TIVA filter count', dp.locator('.gallery .scard').count())
    dp.click('[data-act=st-clear]'); dp.fill('#st-q','Mallampati'); dp.wait_for_timeout(400); print('search Mallampati', dp.locator('.gallery .scard').count())
    dp.fill('#st-q','판서'); dp.wait_for_timeout(400); print('ocr search 판서', dp.locator('.gallery .scard').count(), dp.locator('.scard-ocr').count())
    dp.fill('#st-q',''); dp.wait_for_timeout(300)
    dp.click('.scard:has-text("Sufentanil")'); dp.wait_for_selector('.cm'); dp.wait_for_timeout(600); dp.screenshot(path='shots/74-detail.png')
    print('edit visible on own?', dp.locator('.ed-tools [data-act=edit]').count())
    dp.fill('#cm-form textarea','테스트 댓글'); dp.keyboard.press('Enter'); dp.wait_for_timeout(300); print('comments', dp.locator('.cm').count())
    dp.click('.ed-img'); dp.wait_for_selector('.lb-stage img'); dp.wait_for_timeout(500); dp.screenshot(path='shots/75-lightbox.png'); dp.keyboard.press('Escape')
    print('sheet still open', dp.locator('.sheet-panel').count())
    dp.keyboard.press('Escape')
    # composer with paste
    dp.click('.fab'); dp.wait_for_selector('#study-form'); dp.fill('[name=title]','붙여넣기 테스트')
    from PIL import Image
    im=Image.new('RGB',(1200,800),'#EEF'); bio=io.BytesIO(); im.save(bio,'PNG'); b64=base64.b64encode(bio.getvalue()).decode()
    dp.evaluate("""(b64)=>{const bin=atob(b64);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);
      const f=new File([a],'paste.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(f);
      document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));}""", b64)
    dp.wait_for_timeout(800); dp.click('[data-act=cmp-tag][data-v=TIVA]'); dp.fill('#kw-new','새키워드'); dp.keyboard.press('Enter')
    dp.screenshot(path='shots/76-composer.png')
    dp.click('#study-form [type=submit]'); dp.wait_for_selector('.ed-title'); print('saved title', dp.inner_text('.ed-title'), 'tags', dp.inner_text('.ed-tags'))
    dp.keyboard.press('Escape')
    # other user's card: no edit
    dp.click('.scard:has-text("Mallampati")'); dp.wait_for_selector('.ed'); print('edit on others?', dp.locator('.ed-tools [data-act=edit]').count()); dp.keyboard.press('Escape')
    # palette searches study + ocr
    dp.keyboard.press('Control+k'); dp.keyboard.type('CSHT'); dp.wait_for_timeout(200); print('palette:', dp.inner_text('.pal-item.sel'))
    dp.keyboard.press('Enter'); dp.wait_for_selector('.ed-title'); print('palette open study', dp.inner_text('.ed-title')); dp.keyboard.press('Escape')
    # handover bubble badge
    dp.goto(U+'#/b/peds'); dp.wait_for_selector('.bubble'); dp.click('.bubble >> nth=0'); dp.wait_for_selector('#cm-form'); dp.fill('#cm-form textarea','인계 댓글'); dp.keyboard.press('Enter'); dp.wait_for_timeout(300); dp.keyboard.press('Escape')
    print('badge', dp.locator('.bubble .cbadge').count()); dp.screenshot(path='shots/77-handover-badge.png')
    m=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True); pg=m.new_page(); pg.on('pageerror', lambda x: errs.append(str(x)))
    pg.goto(U); pg.fill('#pw','dongi-1234'); pg.click('button[type=submit]'); pg.click('[data-act=pick-me][data-id=m2]'); pg.wait_for_selector('.ov-grid')
    pg.goto(U+'#/b/study'); pg.wait_for_selector('.gallery'); pg.wait_for_timeout(1200); pg.screenshot(path='shots/78-mobile-study.png')
    pg.click('.scard:has-text("Sufentanil")'); pg.wait_for_selector('.cm'); pg.wait_for_timeout(500); pg.screenshot(path='shots/79-mobile-detail.png')
    b.close()
print('errors', errs[:8])
