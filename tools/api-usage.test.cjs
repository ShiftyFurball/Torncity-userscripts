const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync('torn-tax-tracker.user.js','utf8');
function extract(name){const at=source.search(new RegExp('  (?:async )?function '+name+'\\('));assert(at>=0,name);const tail=source.slice(at), end=tail.slice(1).search(/\n  (?:async )?function /);return end<0?tail:tail.slice(0,end+1);}
let now=1000000, calls=0, result, savedSettings, slots=0;
const storage=new Map();
const ctx=vm.createContext({URLSearchParams,Date:class extends Date{static now(){return now;}},console,navigator:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
SETTINGS:{apiKey:'invalid-test-key'},PROFILE_META:{knownProfileIds:['default','other']},getSettingsStorageKey:id=>'settings_'+id,saveSettings:s=>{savedSettings={...s};},
waitForApiSlot:async()=>{slots++;},setApiCooldown:()=>{},delay:async()=>{},retryDelayMs:()=>1,isRetryableNetworkError:()=>false,
fetch:async()=>{calls++;return {status:200,ok:true,text:async()=>JSON.stringify(result)};}});
vm.runInContext(extract('retireApiKey')+'\n'+extract('tornFetch'),ctx);
(async()=>{
  storage.set('settings_default',JSON.stringify({apiKey:'invalid-test-key',keep:1}));storage.set('settings_other',JSON.stringify({apiKey:'different-key'}));
  result={error:{code:2,error:'Incorrect Key'}};
  await assert.rejects(ctx.tornFetch('user/',{}),/removed from use/);
  assert.equal(calls,1);assert.equal(ctx.SETTINGS.apiKey,'');assert.equal(savedSettings.apiKey,'');
  assert.equal(JSON.parse(storage.get('settings_default')).apiKey,'');assert.equal(JSON.parse(storage.get('settings_default')).keep,1);
  assert.equal(JSON.parse(storage.get('settings_other')).apiKey,'different-key');
  await assert.rejects(ctx.tornFetch('user/',{}),/No Torn API key/);assert.equal(calls,1,'cleared keys must not make another request');
  for(const code of [10,13,18]){ctx.SETTINGS.apiKey='invalid-test-key';result={error:{code,error:'Disabled'}};await assert.rejects(ctx.tornFetch('user/',{}),/removed from use/);assert.equal(ctx.SETTINGS.apiKey,'');}
  ctx.SETTINGS.apiKey='valid-test-key';result={error:{code:5,error:'Too many requests'}};
  const previous=calls;await assert.rejects(ctx.tornFetch('user/',{}),/paused/);assert.equal(calls,previous+1,'rate limits are not retried immediately');
  assert(slots===calls,'every request uses the scheduler');
  const schedule=vm.createContext({Date:class extends Date{static now(){return now;}},navigator:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},delay:async ms=>{now+=ms;}});
  vm.runInContext('let apiRequestQueue=Promise.resolve(),nextApiRequestAt=0,apiCooldownUntil=0;'+['readApiSchedule','setApiCooldown','waitForApiSlot'].map(extract).join('\n'),schedule);
  await schedule.waitForApiSlot();const first=now;await schedule.waitForApiSlot();assert(now-first>=1100);
  schedule.setApiCooldown(60000);await assert.rejects(schedule.waitForApiSlot(),/paused/);
  now+=60000;await schedule.waitForApiSlot();
  const disclosure=vm.runInNewContext(extract('apiUsageDisclosure')+'\napiUsageDisclosure()');
  for(const phrase of ['Purpose','Storage','Sharing','Required access','not encrypted','torn/logtypes'])assert(disclosure.includes(phrase));
  assert.equal((source.match(/\bfetch\(/g)||[]).length,1,'all direct API requests must use tornFetch');
  assert.equal((source.match(/\$\{apiUsageDisclosure\(\)\}/g)||[]).length,2,'both key forms must disclose usage');
  console.log('API disclosure, centralized pacing, cooldown and invalid-key retirement passed.');
})().catch(err=>{console.error(err);process.exitCode=1;});
