import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',fullyParallel:false,workers:1,timeout:30000,retries:0,
 reporter:[['list'],['html',{open:'never'}]],use:{baseURL:'http://127.0.0.1:8787',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node --experimental-strip-types ../scripts/serve.mjs --demo',url:'http://127.0.0.1:8787/healthz',reuseExistingServer:false,timeout:20000,env:{PORT:'8787',DEMO_DB:'.local/browser-demo.sqlite'}}});
