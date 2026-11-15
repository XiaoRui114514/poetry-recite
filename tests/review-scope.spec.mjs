import { test, expect } from '@playwright/test';

test('今日复习不受未选篇目的到期句卡影响', async ({page})=>{
 await page.route('**/api/auth/me',route=>route.fulfill({contentType:'application/json',body:'{"user":null}'}));
 await page.clock.install({time:new Date('2026-11-14T12:00:00Z')});
 await page.addInitScript(()=>localStorage.setItem('hison-poetry-notice-v1','1'));
 await page.goto('/index.html');
 await page.evaluate(()=>{
  const S=PoetryStorage;S.reset();S.patch({stage:'初中',selectedIds:['guan-ju','jian-jia']});S.markLearned('guan-ju');
  const p=PoetryDatabase.byId('jian-jia'),q=PoetryQuiz.__internals.buildQuestion(p,PoetryQuiz.__internals.unitsOf(p)[0],'full');
  S.recordQuiz(p.id,false,'full',{key:q.key,index:0,pairIndex:null});S.patch({selectedIds:['guan-ju']});
 });
 await page.clock.setSystemTime(new Date('2026-11-15T12:00:00Z'));
 await page.goto('/index.html#quiz?scope=review');
 await expect(page.locator('[data-scope="review"]')).toHaveClass(/active/);
 await expect(page.locator('.quiz-card').first()).toBeVisible();
 const state=await page.evaluate(()=>({quiz:PoetryQuiz.currentState(),selected:PoetryStorage.getState().selectedIds,due:PoetryStorage.duePoemIds()}));
 expect(state.selected).toEqual(['guan-ju']);expect(state.due).toContain('guan-ju');expect(state.quiz.questionCount).toBeGreaterThan(0);
});

test('混合句卡与篇目计划的复习保留两种来源',async ({page})=>{
 await page.route('**/api/auth/me',route=>route.fulfill({contentType:'application/json',body:'{"user":null}'}));
 await page.clock.install({time:new Date('2026-11-14T12:00:00Z')});
 await page.addInitScript(()=>localStorage.setItem('hison-poetry-notice-v1','1'));
 await page.goto('/index.html');
 await page.evaluate(()=>{
  const S=PoetryStorage;S.reset();S.patch({stage:'初中',selectedIds:['guan-ju','jian-jia'],prefs:{...S.getState().prefs,modes:['full'],quizCount:60}});
  S.markLearned('guan-ju');
  const p=PoetryDatabase.byId('jian-jia'),q=PoetryQuiz.__internals.buildQuestion(p,PoetryQuiz.__internals.unitsOf(p)[0],'full');
  S.recordQuiz(p.id,false,'full',{key:q.key,index:0,pairIndex:null});
 });
 await page.clock.setSystemTime(new Date('2026-11-15T12:00:00Z'));
 await page.goto('/index.html#quiz?scope=review');
 await expect(page.locator('.quiz-card').first()).toBeVisible();
 const keys=await page.locator('.quiz-card').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-key')));
 expect(keys.some(k=>k?.startsWith('guan-ju|full|'))).toBe(true);
 expect(keys.filter(k=>k?.startsWith('jian-jia|'))).toEqual(['jian-jia|full|0|s']);
});
