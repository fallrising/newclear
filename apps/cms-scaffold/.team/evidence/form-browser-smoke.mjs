import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const results = [];
try {
 for (const width of [1280, 390]) {
  const page = await browser.newPage({viewport:{width,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5194/entries/album?mockUser=seed-operator-album');
  await page.getByRole('link',{name:'Studio (unpublished)'}).click();
  const title=page.getByLabel('title (string)',{exact:true});
  await expect(title).toBeVisible();
  await title.fill('Browser draft');
  await expect(page.getByRole('button',{name:'發布',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'儲存草稿'}).click();
  await expect(page.getByTestId('editor-notice')).toContainText('已儲存工作副本');
  await expect(page.getByRole('button',{name:'發布',exact:true})).toBeEnabled();
  await page.getByLabel('visibility (enum)',{exact:true}).selectOption('unlisted');
  await expect(page.getByRole('button',{name:'發布',exact:true})).toBeDisabled();
  await page.screenshot({path:`.team/evidence/form-${width}.png`,fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);expect(errors).toEqual([]);
  results.push({width,passed:true,overflow,uncaughtErrors:errors,checks:['save-first lifecycle guard','successful save feedback','enum control','no horizontal overflow']});
  await page.close();
 }
 await writeFile('.team/evidence/form-browser-summary.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
} finally {await browser.close();}
