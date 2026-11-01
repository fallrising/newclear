import assert from 'node:assert/strict';
import {ORIGIN,allowedURL} from './guards.mjs';
const observed=promise=>promise.then(value=>({value}),()=>({failed:true}));

export async function submitNavigation(page,{requestURL,status,finalURL},activate){
  const u=new URL(requestURL);
  assert(allowedURL(requestURL)||(u.origin===ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/admin\/keys\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/delete$/.test(u.pathname)),'REVIEW_SUBMIT_PATH');
  assert(allowedURL(finalURL),'REVIEW_SUBMIT_FINAL_PATH');
  // Both listeners are armed before Enter. An old document's already-idle state
  // cannot establish completion of the new POST/redirect/error document.
  const response=observed(page.waitForResponse(r=>r.url()===requestURL&&r.request().method()==='POST',{timeout:10000}));
  const navigation=observed(page.waitForNavigation({waitUntil:'networkidle',timeout:10000}));
  await activate();
  const [submitted,committed]=await Promise.all([response,navigation]);
  assert(!submitted.failed&&submitted.value.status()===status,'REVIEW_FORM_STATUS');
  assert(!committed.failed&&committed.value,'REVIEW_FORM_DOCUMENT');
  assert(page.url()===finalURL&&committed.value.url()===finalURL,'REVIEW_FORM_FINAL_URL');
  const documentStatus=status===303?200:status;
  assert(committed.value.status()===documentStatus,'REVIEW_FORM_DOCUMENT_STATUS');
  return {requestStatus:status,documentStatus,finalPath:new URL(finalURL).pathname,settlement:'new main-frame document networkidle'};
}
