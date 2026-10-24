import assert from 'node:assert/strict';
export function negativeState(viewport,status) {
  assert(['desktop','tablet','mobile'].includes(viewport),'REVIEW_NEGATIVE_VIEWPORT');
  assert.equal(status,401,'REVIEW_BAD_PASSWORD_STATUS');
  return {captureName:viewport+'-bad-password',evidence:{anonymousContext:viewport==='mobile',actualStatus:status,alert:true}};
}
