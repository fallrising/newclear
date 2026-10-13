import { test, expect } from '@playwright/test';
import { startFixture } from './fixture.mjs';

async function connect(page, hub, role='reader') {
  await page.getByLabel('存取 token',{exact:true}).fill(hub.tokens[role]);
  await page.getByRole('button',{name:'驗證並連線'}).click();
  await expect(page.getByRole('button',{name:'清除 token'})).toBeVisible();
}
function browserHealth(page, expected403 = () => false) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()!=='error')return;
    if(expected403()&&message.text().includes('403')&&message.location().url.includes(':replay'))return;
    errors.push(message.text()+' '+message.location().url);
  });
  page.on('response',response=>{
    if(response.status()<400)return;
    if(expected403()&&response.status()===403&&response.url().includes(':replay'))return;
    errors.push('HTTP '+response.status()+' '+response.url());
  });
  return errors;
}

test('AC-37 six real decision and execution events form an ordered correlation chain', async ({page},testInfo)=>{
  const hub=await startFixture();
  const errors=browserHealth(page);
  try {
    await hub.configureDecisionSources();
    const types=['decision.case.opened','decision.proposal.ready','decision.choice.made','execution.run.started','execution.run.failed','execution.run.succeeded'];
    const events=types.map((type,index)=>({
      specversion:'1.0',id:'decision-chain-'+index,source:'urn:example:'+type.split('.')[0]+':synthetic',type,
      time:new Date(Date.now()-60_000+index*1000).toISOString(),correlationid:'synthetic-case-37',
      summary:'Synthetic decision chain '+index,subject:'synthetic-case',
      ...(index?{causationid:'urn:example:'+types[index-1].split('.')[0]+':synthetic#decision-chain-'+(index-1)}:{}),
      data:{synthetic:true},
    }));
    const sequences=[];
    for(const event of events)sequences.push((await hub.api('/v1/events',{role:event.type.split('.')[0],method:'POST',body:event})).seq);
    await page.goto(hub.base+'/?range=all&correlationid=synthetic-case-37');
    await connect(page,hub);
    await expect(page.locator('.events-table tbody tr')).toHaveCount(6);
    await page.getByRole('button',{name:'查看事件 #'+sequences[5],exact:true}).click();
    const detail=page.getByRole('dialog',{name:'事件詳情'});
    await expect(detail.locator('.detail-type')).toHaveText(types[5]);
    await expect(detail.locator('.related-list li')).toHaveCount(5);
    await expect(detail.locator('.related-list li > div > p')).toHaveText(events.slice(0,5).map(event=>event.summary));
    await expect(detail.locator('.related-list')).toContainText('直接原因');
    await detail.locator('.related-list').getByRole('button',{name:types[2],exact:true}).click();
    await expect(detail.locator('.detail-type')).toHaveText(types[2]);
    await expect(detail.locator('.related-list li > div > p')).toHaveText(events.filter((_,index)=>index!==2).map(event=>event.summary));
    await expect(detail.locator('.detail-meta')).toContainText('synthetic-case-37');
    await expect(detail.locator('.related-list')).toContainText('由此事件觸發');
    await page.screenshot({path:testInfo.outputPath('decision-correlation-chain.png'),fullPage:false});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'清除 token'}).click();
    await expect(detail).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {await hub.stop();}
});

test('real delivery queries paginate, filter and replay with owner audit while readonly stays connected', async ({page},testInfo)=>{
  const hub=await startFixture();
  let expectingForbidden=false;
  const errors=browserHealth(page,()=>expectingForbidden);
  try {
    await hub.configureSubscriptions();
    hub.seedDeliveryHistory();
    await page.goto(hub.base+'/?view=deliveries');
    await connect(page,hub);
    const cards=page.locator('.delivery-card');
    await expect(cards).toHaveCount(100);
    await expect(page.locator('.delivery-subscriptions .source-card')).toHaveCount(100);
    const subscription=page.locator('.delivery-subscriptions .source-card').filter({has:page.getByRole('heading',{name:'board-000',exact:true})});
    await expect(subscription.locator('dd')).toHaveText(['1','1','102','1']);
    await page.getByRole('button',{name:'載入更多訂閱',exact:true}).click();
    await expect(page.locator('.delivery-subscriptions .source-card')).toHaveCount(101);
    await page.getByRole('button',{name:'載入更多投遞',exact:true}).click();
    await expect(cards).toHaveCount(105);
    await page.getByLabel('訂閱 ID',{exact:true}).fill('missing');
    await expect(cards).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'此條件沒有投遞'})).toBeVisible();
    await page.getByLabel('訂閱 ID',{exact:true}).fill('board-000');
    await page.getByLabel('投遞狀態',{exact:true}).selectOption('dlq');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('HTTP 400');
    await expect(cards).toContainText('Synthetic rejected <script>inert</script>');
    await expect(cards.locator('script')).toHaveCount(0);
    const id=await cards.getByRole('heading').innerText();
    const button=cards.getByRole('button',{name:'重放（owner）',exact:true});
    await expect(button).toBeDisabled();
    await cards.getByLabel('重放理由',{exact:true}).fill('   ');
    await expect(button).toBeDisabled();
    await cards.getByLabel('重放理由',{exact:true}).fill('Synthetic receiver fixed');
    expectingForbidden=true;
    const denied=page.waitForResponse(response=>response.url().includes(':replay'));
    await button.click();
    expect((await denied).status()).toBe(403);
    await expect(cards.getByRole('alert')).toContainText('唯讀 token 可以繼續查詢');
    await expect(page.getByRole('button',{name:'清除 token'})).toBeVisible();
    expect(hub.replayAudit(id)).toHaveLength(0);
    await page.screenshot({path:testInfo.outputPath('desktop-deliveries.png'),fullPage:false});
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await cards.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath('mobile-deliveries.png'),fullPage:false});
    await page.getByRole('button',{name:'清除 token'}).click();
    await expect(cards).toHaveCount(0);
    await expect(page.locator('.delivery-subscriptions .source-card')).toHaveCount(0);
    await connect(page,hub,'owner');
    await page.getByLabel('投遞狀態',{exact:true}).selectOption('dlq');
    await expect(cards).toHaveCount(1);
    await cards.getByLabel('重放理由',{exact:true}).fill('Synthetic receiver fixed');
    const accepted=page.waitForResponse(response=>response.url().includes(':replay'));
    await cards.getByRole('button',{name:'重放（owner）',exact:true}).click();
    expect((await accepted).status()).toBe(202);
    await expect(page.locator('.notice[role=status]')).toContainText('已排入重放：'+id);
    await expect(cards).toHaveCount(0);
    expect(hub.replayAudit(id)).toEqual([expect.objectContaining({actor:'owner',target:id,reason:'Synthetic receiver fixed'})]);
    expect(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookie:document.cookie}))).toEqual({local:[],session:[],cookie:''});
    expect(page.url()).not.toContain(hub.tokens.owner);
    await page.getByRole('button',{name:'清除 token'}).click();
    await expect(page.getByText('已排入重放：',{exact:false})).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {await hub.stop();}
});
