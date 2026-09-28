import {test,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const cli=(command:string)=>exec(process.execPath,['../scripts/mock-agent.mjs',command],{env:{...process.env,DEMO_URL:'http://127.0.0.1:8787'}});
test.beforeEach(async()=>{await cli('reset');});
test('empty → external mock Agent → fleet → detail → direct refresh',async({page},info)=>{
 await page.goto('/');await expect(page.getByText('尚未加入模擬節點')).toBeVisible();
 await cli('seed');await expect(page.getByRole('link',{name:/demo-web-01/})).toBeVisible();
 await page.screenshot({path:info.outputPath('fleet-desktop.png'),fullPage:true});
 await page.getByRole('link',{name:/demo-web-01/}).click();await expect(page.getByRole('heading',{level:1,name:'demo-web-01'})).toBeVisible();
 await expect(page.getByRole('img',{name:/CPU 一分鐘平均/})).toBeVisible();await expect(page.getByText('9007199254740993 bytes')).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{level:1,name:'demo-web-01'})).toBeVisible();
 await page.screenshot({path:info.outputPath('node-detail.png'),fullPage:true});
});
test('duplicate receipt → UI offline → genuine first-node recovery',async({page})=>{
 await cli('seed');await page.goto('/fleet');await expect(page.getByRole('link',{name:/demo-web-01/})).toBeVisible();
 await cli('replay');await page.getByRole('button',{name:'模擬失聯：前進 4 分鐘'}).click();
 await expect(page.getByText('離線',{exact:true})).toHaveCount(3);
 await cli('recover');await expect(page.getByRole('row').filter({hasText:'demo-web-01'}).getByText('在線',{exact:true})).toBeVisible();
 await expect(page.getByRole('row').filter({hasText:'demo-batch-02'}).getByText('離線',{exact:true})).toBeVisible();
});
test('API failure is visible and never replaced by browser fixtures',async({page})=>{
 await cli('seed');await page.goto('/fleet');await expect(page.getByRole('link',{name:/demo-web-01/})).toBeVisible();
 await page.route('**/api/v1/nodes',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'storage_unavailable',message:'Injected outage',retryable:true,request_id:'test-outage'})}));
 await expect(page.getByRole('alert')).toContainText('Injected outage');
 await expect(page.getByRole('row').filter({hasText:'demo-web-01'}).getByText('未確認',{exact:true})).toBeVisible();
 await page.unroute('**/api/v1/nodes');await expect(page.getByRole('alert')).toHaveCount(0);
});
test('mobile viewport has no page overflow and unsupported metrics stay labelled',async({page},info)=>{
 await cli('seed');await page.setViewportSize({width:390,height:844});await page.goto('/fleet');
 await expect(page.getByRole('link',{name:/demo-storage-03/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('fleet-mobile.png'),fullPage:true});
 await page.getByRole('link',{name:/demo-storage-03/}).click();await expect(page.getByText('尚無可繪製的 CPU 資料；null 不視為 0。')).toBeVisible();
});
test('synthetic names are escaped, not interpreted as HTML',async({page,request})=>{
 await request.post('/agent/v1/enroll',{headers:{authorization:'Demo node_demo01'},data:{node_id:'node_demo01',display_name:'<img src=x onerror=alert(1)>'}});
 await page.goto('/fleet');await expect(page.getByRole('link',{name:/<img src=x/})).toBeVisible();expect(await page.locator('img').count()).toBe(0);
});
