const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('torn-tax-tracker.user.js','utf8');
function extract(name){const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));assert(start>=0,name);const rest=source.slice(start),next=rest.slice(1).search(/\n  (?:async )?function /);return next<0?rest:rest.slice(0,next+1);}
let now=Date.parse('2026-10-21T12:00:00Z');
const settings={defaultMoneyTax:7500000,defaultItemTax:7,taxItemName:'Xanax',manualMode:false};
const storage=new Map();
const cache=vm.createContext({Date:class extends Date{static now(){return now;}},SETTINGS:settings,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},paymentCacheKey:async()=>'test',normalizeItemName:s=>s.toLowerCase(),getTrackingPeriod:()=>({startUnix:1,weeks:['a','b'],requestedWeeks:2})});
vm.runInContext('const MILLIS_PER_DAY=86400000;'+['paymentViewSignature','loadPaymentView','savePaymentView'].map(extract).join('\n'),cache);
const events=[];
const flow=vm.createContext({Date,console,SETTINGS:{testMode:false,manualMode:false},loadPaymentView:async()=>({fresh:true,checkedAt:now,employees:{1:{name:'Alice'}},weeklyData:{},paymentHistory:{}}),setStatus:()=>{},renderOverview:()=>events.push('render'),tornFetch:async()=>{events.push('network');throw Error('simulated offline');}});
vm.runInContext('let fetching=false,scanComplete=false,lastEmployeesCache={},lastWeeklyDataCache={},lastPaymentHistoryCache={};'+extract('fetchData'),flow);
(async()=>{
  await cache.savePaymentView({1:{name:'Alice',joinDays:10,joinDate:null}},{},{});
  assert.equal((await cache.loadPaymentView()).fresh,true);
  now+=120000;assert.equal((await cache.loadPaymentView()).fresh,false);
  settings.defaultMoneyTax=10000000;assert.equal(await cache.loadPaymentView(),null,'changed rates invalidate the view');settings.defaultMoneyTax=7500000;
  const snapshot=JSON.parse(storage.get('test_view'));snapshot.complete=false;storage.set('test_view',JSON.stringify(snapshot));assert.equal(await cache.loadPaymentView(),null,'partial views are never confirmed');
  await flow.fetchData();assert.deepEqual(events,['render'],'fresh cached opens must not make any API calls');assert.equal(vm.runInContext('fetching',flow),false);
  events.length=0;await flow.fetchData(true);assert(events.includes('network'),'manual Refresh bypasses freshness');
  events.length=0;flow.loadPaymentView=async()=>({fresh:false,checkedAt:now,employees:{},weeklyData:{},paymentHistory:{}});await flow.fetchData();
  assert.equal(events[0],'render');assert.equal(events[1],'network','stale results render before checking the API');assert.equal(vm.runInContext('scanComplete',flow),false);
  console.log('Instant cached views, zero-call fresh opens, manual refresh and cache invalidation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
