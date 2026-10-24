import assert from 'node:assert/strict';
export function resumePlan({run,user,clusters,topics,groups,subscriptions}) {
  assert(/^fe-ojb-[0-9a-f]{16}$/.test(run),'REVIEW_RESUME_RUN');
  const suffix=run.slice(-8), roles=['delivered','dead','pull'];
  assert(clusters.length===1&&topics.length===1&&groups.length===3&&subscriptions.length===2,'REVIEW_RESUME_COUNTS');
  const topic=topics[0];
  assert(topic.name==='review.orders.'+suffix&&topic.owner===user&&topic.clusterId===clusters[0].id,'REVIEW_RESUME_TOPIC');
  const ordered=roles.map(role=>groups.find(group=>group.name==='review-'+role+'-'+suffix));
  assert(ordered.every(group=>group&&group.owner===user)&&new Set(ordered.map(group=>group.id)).size===3,'REVIEW_RESUME_GROUPS');
  const subs=ordered.slice(0,2).map(group=>subscriptions.find(sub=>sub.groupId===group.id&&sub.topicId===topic.id));
  assert(subs.every((sub,index)=>sub&&sub.spec.mode==='PUSH'&&sub.spec.push.urls.length===1&&sub.spec.push.urls[0]===(index===0?'http://push-sink:8080/events':'http://push-sink:9/unreachable'))&&new Set(subs.map(sub=>sub.id)).size===2,'REVIEW_RESUME_SUBSCRIPTIONS');
  return {topic,groups:ordered,subscriptions:subs,ids:{topic:topic.id,groups:ordered.map(g=>g.id),subscriptions:subs.map(s=>s.id)}};
}
export function acceptedDelay(grpc,delayId) {
  // producer.proto is proto3; common.proto Code.OK = 0. grpcurl omits
  // default-valued scalar fields unless emit-defaults is explicitly enabled.
  assert(grpc&&grpc.exitCode===0&&grpc.response&&typeof grpc.response==='object','REVIEW_GRPC_RESULT');
  const code=Object.hasOwn(grpc.response,'code')?grpc.response.code:0;
  assert(['OK',0].includes(code)&&(grpc.response.delayId??grpc.response.delay_id)===delayId,'REVIEW_GRPC_RESULT');
  return {code:'OK',defaultCodeOmitted:!Object.hasOwn(grpc.response,'code')};
}
export function completedPlan(input) {
  assert(input.subscriptions.length===3,'REVIEW_COMPLETED_COUNTS');
  const push=input.subscriptions.filter(sub=>sub.spec.mode==='PUSH');
  const partial=resumePlan({...input,subscriptions:push});
  const pull=input.subscriptions.find(sub=>sub.spec.mode==='PULL');
  assert(pull&&pull.topicId===partial.topic.id&&pull.groupId===partial.groups[2].id&&pull.spec.concurrency===1&&pull.spec.pull.maxBatch===1,'REVIEW_COMPLETED_PULL');
  const subscriptions=[...partial.subscriptions,pull];
  assert(new Set(subscriptions.map(sub=>sub.id)).size===3,'REVIEW_COMPLETED_IDS');
  return {...partial,subscriptions,ids:{...partial.ids,subscriptions:subscriptions.map(sub=>sub.id)}};
}
