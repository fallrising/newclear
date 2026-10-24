import test from 'node:test';
import assert from 'node:assert/strict';
import {resumePlan} from './resume-plan.mjs';
const input=()=>({run:'fe-ojb-0123456789abcdef',user:'fresh',clusters:[{id:3}],topics:[{id:5,name:'review.orders.89abcdef',owner:'fresh',clusterId:3}],groups:['delivered','dead','pull'].map((r,i)=>({id:i+7,name:'review-'+r+'-89abcdef',owner:'fresh'})),subscriptions:[0,1].map(i=>({id:i+10,topicId:5,groupId:i+7,spec:{mode:'PUSH',push:{urls:[i===0?'http://push-sink:8080/events':'http://push-sink:9/unreachable']}}}))});
test('only exact partial same-run resources can resume',()=>{assert.deepEqual(resumePlan(input()).ids,{topic:5,groups:[7,8,9],subscriptions:[10,11]});for(const mutate of [x=>x.topics[0].owner='foreign',x=>x.topics[0].name='other',x=>x.groups[2].id=7,x=>x.subscriptions[0].topicId=6,x=>x.subscriptions[1].spec.push.urls=['http://foreign/'],x=>x.subscriptions.push(x.subscriptions[0])]){const value=input();mutate(value);assert.throws(()=>resumePlan(value));}});

test('proto3 omitted default only succeeds with exit0 and exact accepted delay ID',async()=>{
 const {acceptedDelay,completedPlan}=await import('./resume-plan.mjs');
 assert.deepEqual(acceptedDelay({exitCode:0,response:{delayId:'expected'}},'expected'),{code:'OK',defaultCodeOmitted:true});
 for(const grpc of [{exitCode:1,response:{delayId:'expected'}},{exitCode:0,response:{code:'INTERNAL',delayId:'expected'}},{exitCode:0,response:{code:null,delayId:'expected'}},{exitCode:0,response:{delayId:'other'}},{exitCode:0,response:{}}])assert.throws(()=>acceptedDelay(grpc,'expected'));
 const full=input();full.subscriptions.push({id:12,topicId:5,groupId:9,spec:{mode:'PULL',concurrency:1,pull:{maxBatch:1}}});assert.deepEqual(completedPlan(full).ids.subscriptions,[10,11,12]);full.subscriptions[2].groupId=8;assert.throws(()=>completedPlan(full));
});
