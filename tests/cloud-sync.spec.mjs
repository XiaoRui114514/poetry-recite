/* Browser integration uses only synthetic learning records and an in-memory API. */
import {test, expect} from '@playwright/test';

test('cloud sync preserves migration, detects stale device, and isolates logout', async ({browser}) => {
  const cloud = new Map();
  let writes = 0;
  async function device() {
    const context = await browser.newContext({serviceWorkers:'block'});
    await context.addInitScript(() => localStorage.setItem('hison-poetry-notice-v1','1'));
    const page = await context.newPage();
    let user = null;
    await page.route('**/api/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      let out = {}, status = 200;
      if (path === '/api/auth/me') out = {user};
      else if (path === '/api/auth/login') {user = {id:req.postDataJSON().username,username:req.postDataJSON().username};out={user};}
      else if (path === '/api/auth/logout') {user=null;out={ok:true};}
      else if (path === '/api/sync/poetry') {
        if (!user || req.headers()['x-account-id'] !== user.id) {status=409;out={error:'account_changed'};}
        else {
          const old = cloud.get(user.id) || {revision:0,data:null};
          if(req.method()==='GET') out=old;
          else {
            const body=req.postDataJSON();
            if(body.baseRevision!==old.revision){status=409;out={error:'conflict',...old};}
            else {out={revision:old.revision+1,data:body.data};cloud.set(user.id,out);writes++;}
          }
        }
      } else {status=404;out={error:'missing'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(out)});
    });
    await page.goto('/');
    const notice=page.locator('#brandLicense [data-brand=ok]');
    if(await notice.isVisible()) await notice.click();
    await expect(page.locator('.learning-cloud-entry')).toBeVisible();
    return {context,page};
  }
  async function login(page,name='synthetic_alpha') {
    await page.locator('.learning-cloud-entry button').click();
    await page.getByLabel('用户名',{exact:true}).fill(name);
    await page.getByLabel('登录码',{exact:true}).fill('ab'.repeat(24));
    await page.getByRole('button',{name:'继续',exact:true}).click();
  }
  const a=await device();
  await a.page.evaluate(() => PoetryStorage.patch({stage:'初中',selectedIds:['guan-cang-hai']}));
  await login(a.page);
  await expect(a.page.locator('.learning-cloud-state')).toHaveText('数据冲突');
  expect(writes).toBe(0);
  expect(await a.page.evaluate(() => Object.keys(localStorage).some(k=>k.includes('-backup-')))).toBe(true);
  await a.page.getByRole('button',{name:'使用本机记录（上传）'}).click();
  await expect(a.page.locator('.learning-cloud-state')).toHaveText('已同步');
  expect(await a.page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ab'.repeat(24));
  await a.page.getByRole('button',{name:'关闭',exact:true}).click();
  const b=await device();
  await login(b.page);
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('已同步');
  expect(await b.page.evaluate(()=>PoetryStorage.getState().selectedIds)).toEqual(['guan-cang-hai']);
  await b.page.getByRole('button',{name:'关闭',exact:true}).click();
  await a.page.evaluate(()=>PoetryStorage.markLearned('guan-cang-hai'));
  await expect.poll(()=>cloud.get('synthetic_alpha').data.learnedIds['guan-cang-hai']).toBeTruthy();
  // A stale offline device must present a choice instead of overwriting A.
  await b.context.setOffline(true);
  await b.page.evaluate(()=>PoetryStorage.markLearned('wang-yue'));
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('离线使用');
  await b.context.setOffline(false);
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('数据冲突');
  expect(cloud.get('synthetic_alpha').data.learnedIds['guan-cang-hai']).toBeTruthy();
  expect(cloud.get('synthetic_alpha').data.learnedIds['wang-yue']).toBeUndefined();
  await b.page.getByRole('button',{name:'使用云端记录（下载）'}).click();
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('已同步');
  await b.page.getByRole('button',{name:'退出账号',exact:true}).click();
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('本机学习');
  expect(await b.page.evaluate(()=>PoetryStorage.getState().learnedIds['guan-cang-hai'])).toBeUndefined();
  await b.page.getByLabel('用户名',{exact:true}).fill('synthetic_beta');
  await b.page.getByLabel('登录码',{exact:true}).fill('ab'.repeat(24));
  await b.page.getByRole('button',{name:'继续',exact:true}).click();
  await expect(b.page.locator('.learning-cloud-state')).toHaveText('已同步');
  expect(cloud.has('synthetic_beta')).toBe(false);
  expect(await b.page.evaluate(()=>PoetryStorage.getState().learnedIds['guan-cang-hai'])).toBeUndefined();
  await a.context.close();await b.context.close();
});

for (const hosted of ['/index.html','/dist/index.html']) {
  test('account startup preserves study route and records learning: '+hosted, async ({page}) => {
    await page.addInitScript(()=>localStorage.setItem('hison-poetry-notice-v1','1'));
    let authenticated=false, remote=null;
    await page.route('**/api/**',async route=>{
      const req=route.request(), path=new URL(req.url()).pathname;
      if(path==='/api/auth/me') return route.fulfill({contentType:'application/json',body:JSON.stringify({user:authenticated?{id:'synthetic_alpha',username:'synthetic_alpha'}:null})});
      if(req.method()==='PUT') remote={revision:remote.revision+1,data:req.postDataJSON().data};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(remote||{revision:0,data:null})});
    });
    await page.goto(hosted);
    remote=await page.evaluate(()=>{
      const original=PoetryStorage.defaults();original.stage='初中';original.selectedIds=['guan-ju'];
      const snapshot={data:original,extras:null,revision:1,base:JSON.stringify(original)};
      localStorage.setItem('learning-cloud-poetry-v1',JSON.stringify({owner:'synthetic_alpha',accounts:{synthetic_alpha:snapshot},anonymous:{data:PoetryStorage.defaults(),extras:null}}));
      // Simulate an obsolete tab writing data after another account took ownership.
      localStorage.setItem(PoetryStorage.KEY,JSON.stringify(PoetryStorage.defaults()));
      return {revision:1,data:original};
    });
    authenticated=true;
    await page.goto('about:blank');
    await page.goto(hosted+'#/study?poem=guan-ju');
    await expect(page.locator('.poem-head h2')).toHaveText('关雎');
    expect(await page.evaluate(()=>location.hash)).toBe('#/study?poem=guan-ju');
    await expect.poll(()=>page.evaluate(()=>!!PoetryStorage.getState().learnedIds['guan-ju'])).toBe(true);
    await expect(page.locator('.learning-cloud-state')).toHaveText('已同步');
    await expect(page.locator('.poem-head h2')).toHaveText('关雎');
    expect(await page.evaluate(()=>location.hash)).toBe('#/study?poem=guan-ju');
    expect(remote.data.learnedIds['guan-ju']).toBeTruthy();
  });
}
