import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {origin,privateJSON} from './browser-support.mjs';
import {visibleSecretRectangles} from './browser-policy.mjs';
import {maskCoverage,pngPixels} from './png-mask.mjs';
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
export async function retakeSecrets(page,fixture,out,receipt) {
  const prior=privateJSON('chart-proof.json');
  assert(prior.run===receipt.run&&prior.source===receipt.source,'REVIEW_RETAKE_IDENTITY');
  for(const file of ['console-web/src/pages/DashboardPage.tsx','console-web/src/styles.css'])assert.equal(prior.sourceHashes[file],receipt.sourceHashes[file],'REVIEW_RETAKE_PRODUCT_HASH');
  receipt.redactionRetakes=[];receipt.auditPrivacyChecks=[];
  for(const size of [{name:'desktop',width:1440,height:900},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}]) {
    await page.setViewportSize({width:size.width,height:size.height});
    for(const kind of ['topic-configuration','group']) {
      receipt.failureSite='redaction:'+size.name+':'+kind;
      const topic=kind==='topic-configuration';
      const response=await page.goto(origin+(topic?'/topics':'/groups'));assert.equal(response.status(),200);
      await page.getByRole('cell',{name:topic?fixture.topic.name:fixture.groups[0].name,exact:true}).click();
      await page.getByRole('dialog').waitFor();
      const key=size.name+'-'+kind;
      const buffer=await page.screenshot({path:out+'/screenshots/'+key+'.png',fullPage:false});
      receipt.redactionRetakes.push({key,sha256:hash(buffer),viewport:size.name,fullPage:false,maskCoverageRequired:true});
    }
    receipt.failureSite='audit-privacy:'+size.name;
    await page.goto(origin+'/admin/audit');await page.getByRole('heading',{name:'Audit trail',exact:true}).waitFor();
    await page.locator('.ant-table-tbody tr.ant-table-row').first().waitFor();await page.waitForLoadState('networkidle');
    const oldBytes=readFileSync('/state/audit-'+size.name+'.png');
    const before=await visibleSecretRectangles(page,fixture.secrets.filter(Boolean),true);
    const image=pngPixels(oldBytes);
    const record={viewport:size.name,priorPngSha256:hash(oldBytes),sourceSame:true,deviceScale:before.metrics.deviceScale,visibleSecretRectangles:before.rectangles.length,retaken:false};
    assert.equal(image.width,size.width,'REVIEW_AUDIT_IMAGE_WIDTH');
    if(before.rectangles.length) {
      assert(Math.abs(image.height-before.metrics.documentHeight)<=1,'REVIEW_AUDIT_GEOMETRY_CHANGED');
      record.priorCoverage=maskCoverage(oldBytes,before.rectangles);
      if(record.priorCoverage.some(item=>item.coverage<0.99)) {
        const key=size.name+'-admin-audit';
        const buffer=await page.screenshot({path:out+'/screenshots/'+key+'.png',fullPage:true});
        record.retaken=true;record.key=key;record.sha256=hash(buffer);
      }
    } else record.note='No token code rectangle intersects the current viewport width; historical zero-mask pixels alone are not exposure proof.';
    receipt.auditPrivacyChecks.push(record);
  }
}
