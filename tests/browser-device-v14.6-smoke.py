"""Optional offline mobile Chromium smoke test (Playwright, no GitHub traffic)."""
import asyncio, hashlib, json, re
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent.parent
DATE=datetime.now(ZoneInfo('America/Monterrey')).strftime('%Y-%m-%d')
DB={'settings':{'timeZone':'America/Monterrey','eTicketEnabled':True,'meals':[{'id':'lunch','nameZh':'午餐','nameEn':'Lunch','nameEs':'Almuerzo','start':'00:00','end':'23:59','enabled':True}]},'employees':[{'employeeId':'8','name':'FAKE A'},{'employeeId':'14','name':'FAKE B'}],'reservations':[]}
SOURCES={p.name:p.read_text() for p in ROOT.glob('*.js') if p.name!='config.js'}
SOURCES['client-api.js']=SOURCES['client-api.js'].replace("const DEMO = new URLSearchParams(location.search).get('demo') === '1';","const DEMO = true;")
HTML=(ROOT/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css">','<style>'+(ROOT/'styles.css').read_text()+'</style>')
HTML=re.sub(r'<script src="./config.js"></script><script type="module" src="./staff.js"></script>','',HTML)
def modular_order():
    dag={name:re.findall(r'from\s+[\'\"]\.\/([^\'\"]+)[\'\"]',text) for name,text in SOURCES.items()}
    seen=set();order=[]
    def visit(n):
        if n in seen:return
        seen.add(n)
        for dep in dag[n]:visit(dep)
        order.append(n)
    visit('staff.js');return order
ORDER=modular_order()
async def render(browser,db,tickets=None):
    ctx=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
    page=await ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.set_content(HTML,wait_until='domcontentloaded')
    seed={'evan-canteen-local-demo-v1':json.dumps(db)}
    if tickets:seed['sanhua-canteen-tickets-v14']=json.dumps(tickets)
    hashes={ch: list(hashlib.sha256((ch*64).encode()).digest()) for ch in ('a','b')}
    await page.evaluate('''({seed,hashes})=>{
      const mem=new Map(Object.entries(seed));
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v))}});
      Object.defineProperty(window.crypto,'subtle',{configurable:true,value:{digest:async(alg,bytes)=>{
        const data=new TextDecoder().decode(bytes);
        return new Uint8Array(hashes[data.length===64&&data.split('').every(ch=>ch===data[0])?data[0]:'none']||Array(32).fill(19)).buffer;
      }}});
      window.__store=mem;
    }''',{'seed':seed,'hashes':hashes})
    await page.evaluate(r'''async({texts,order})=>{
      const urls={};
      for(const name of order){
        let src=texts[name].replace(/from ['"]\.\/([^'"]+)['"]/g,(whole,dep)=>'from "'+urls[dep]+'"');
        urls[name]=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
      }
      await import(urls['staff.js']);
    }''', {'texts':SOURCES,'order':ORDER})
    await page.locator('#languageSelect').select_option('zh')
    return ctx,page,errors
async def choose(page,employee):
    await page.locator('#employeeInput').fill(employee)
    await page.locator('.dropdown-item').first.wait_for(timeout=10000)
    await page.locator('.dropdown-item').first.click()
async def main():
 async with async_playwright() as pw:
    b=await pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx,page,errors=await render(b,DB)
    await choose(page,'8')
    await page.locator('#plantSelect').select_option('D')
    await page.locator('[data-meal="lunch"]').click()
    await page.locator('#confirmBtn').click()
    await page.wait_for_function("document.querySelector('#modalTitle').textContent.includes('成功')",timeout=10000)
    data=json.loads(await page.evaluate("window.__store.get('evan-canteen-local-demo-v1')"))
    assert len(data['reservations'])==1 and data['deviceBindings']['8']
    print('PASS mobile browser books first employee and writes binding')
    await page.locator('#cancelBtn').click()
    await page.locator('#selectedEmployee button').click()
    await choose(page,'14')
    await page.locator('[data-meal="lunch"]').click()
    assert '已绑定其他员工' in await page.locator('#globalStatus').inner_text()
    assert len(json.loads(await page.evaluate("window.__store.get('evan-canteen-local-demo-v1')"))['reservations'])==1
    print('PASS same browser prevents booking another employee')
    assert not errors,errors
    await ctx.close()
    mixed=json.loads(json.dumps(DB));tickets=[]
    for i,ch in enumerate(['a','b'],start=1):
      employee='8' if i==1 else '14';id=f'{DATE[2:4]}{DATE[5:7]}{DATE[8:10]}-D-{i:04d}'
      mixed['reservations'].append({'id':id,'employeeId':employee,'employeeName':employee,'plant':'D','mealId':'lunch','date':DATE,'mealStart':'00:00','mealEnd':'23:59','credentialHash':hashlib.sha256((ch*64).encode()).hexdigest(),'redeemStatus':'pending'})
      tickets.append({'id':id,'secret':ch*64})
    ctx,page,errors=await render(b,mixed,tickets)
    await page.wait_for_function("document.querySelectorAll('.ticket-item').length===2",timeout=10000)
    await page.wait_for_function("document.querySelector('#globalStatus').textContent.includes('多名员工')",timeout=10000)
    assert await page.locator('.ticket-item button:disabled').count()==2
    await choose(page,'8')
    await page.locator('[data-meal="lunch"]').click()
    assert '多名员工' in await page.locator('#globalStatus').inner_text()
    print('PASS migrated mixed-person browser disables new booking and redemption')
    await page.locator('#languageSelect').select_option('es')
    assert 'distintos empleados' in await page.locator('#globalStatus').inner_text()
    print('PASS mobile warning is available in Spanish')
    assert not errors,errors
    await ctx.close();await b.close()
asyncio.run(main())
