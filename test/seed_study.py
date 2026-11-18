from PIL import Image, ImageDraw, ImageFont
import base64, io, json, urllib.request, glob
fonts=glob.glob('/usr/share/fonts/**/*CJK*', recursive=True)+glob.glob('/usr/share/fonts/**/*Nanum*', recursive=True)
font=lambda n: ImageFont.truetype(fonts[0], n) if fonts else ImageFont.load_default()
def img(w,h,bg,lines,curve=False):
    im=Image.new('RGB',(w,h),bg); d=ImageDraw.Draw(im); y=30
    for t,sz in lines: d.text((30,y),t,fill='#1a1a1a',font=font(sz)); y+=sz+18
    if curve:
        d.line([(60+i*8, h-60-int(200*(1-2.718**(-i/12)))) for i in range(70)],fill='#C0392B',width=5)
        d.line([(60+i*8, h-60-int(120*(1-2.718**(-i/40)))) for i in range(70)],fill='#2E6F95',width=5)
    b=io.BytesIO(); im.save(b,'JPEG',quality=85); return base64.b64encode(b.getvalue()).decode(), w, h
def api(body):
    return json.loads(urllib.request.urlopen(urllib.request.Request('http://localhost:8787/api', data=json.dumps(body).encode())).read())
cfg=api({'action':'getAll','pw':'dongi-1234'})['config']
sb=[b for b in cfg['boards'] if b['id']=='study'][0]; sec={s['name']:s['id'] for s in sb['sections']}
def up(data,w,h): return api({'action':'uploadImage','pw':'dongi-1234','by':'m1','ck':'seed','image':{'data':data,'mime':'image/jpeg','name':'x.jpg','w':w,'h':h,'ocr':True}})['image']
i1=up(*img(900,600,'#FBF7EC',[('Context-sensitive half-time',34),('fentanyl  sufentanil  remifentanil',24)],True))
i2=up(*img(700,900,'#F3F7FA',[('Mallampati class',34),('I  II  III  IV',28),('교수님 판서',26)]))
i3=up(*img(900,500,'#F7F2F7',[('TIVA vs Gas',36),('PONV · MEP · 코 수술',26)]))
def add(by,cat,title,text,tags,src,imgs=[]):
    e=api({'action':'addEntry','pw':'dongi-1234','by':by,'ck':'seed-'+by,'entry':{'scope':'board','target':'study','section':sec[cat],'title':title,'text':text,'tags':tags,'source':src,'images':imgs}})
    assert e['ok'], e; return e['entry']['id']
a=add('m1','약리','Sufentanil vs fentanyl CSHT','- 짧게 쓰면 sufentanil이 오히려 CSHT 짧음\n- 8시간 넘어가면 비슷해짐\n- remifentanil은 투여 시간과 무관하게 3~4분',['sufentanil','TCI','remifentanil'],'교수님 설명',[i1])
add('m2','기도','Mallampati 분류와 실제 어려움','Mallampati 단독으로는 예측력 낮음. thyromental distance, 개구 같이 보기.',['intubation','LMA'],'내 공부',[i2])
add('anon','약리','TIVA를 고르는 경우','코 수술, MEP 모니터링, PONV 고위험(젊은 여성·비흡연)에서 TIVA.\n**라인 확인** 필수 — 안 들어가면 awareness.',['TIVA','propofol','PONV'],'교수님 설명',[i3])
add('m3','수액·수혈·전해질','Albumin 20% 100cc는 몇 cc 효과?','이론상 3.5~4배 (약 360–400 mL). 근거는 약함.',['albumin'],'교과서')
add('m4','심혈관','Vasopressor 말초로 줘도 되나','antecubital 이상, 20G 이상, 6시간 이내면 대체로 OK. extravasation 시 phentolamine.',['vasopressor','C-line'],'논문')
add('m5','마취 전 평가','1도 AV block 단독은 추가 검사 불필요','증상, QRS 연장, PR 매우 김, 새로 발생이면 협진.',['ECG'],'교과서')
api({'action':'addComment','pw':'dongi-1234','by':'m2','ck':'c2','id':a,'text':'remi는 context-insensitive라서 그런 거죠?'})
api({'action':'addComment','pw':'dongi-1234','by':'m1','ck':'seed-m1','id':a,'text':'맞아요. ester hydrolysis라서 축적이 거의 없어요.'})
print('seeded')
