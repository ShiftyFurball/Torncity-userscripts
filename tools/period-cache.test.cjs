const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('torn-tax-tracker.user.js','utf8');
function extract(name) {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert(start>=0,name);
  const rest = source.slice(start); const next = rest.slice(1).search(/\n  (?:async )?function /);
  return next < 0 ? rest : rest.slice(0,next+1);
}
const ctx = vm.createContext({Date, SETTINGS:{}, console});
vm.runInContext('const MILLIS_PER_DAY=86400000, MILLIS_PER_WEEK=604800000;'+['parseWeekKey','formatWeekKey','compareWeekKeys','getIsoWeekKey','isoWeekStartDate','getTrackingPeriod','calculatePaymentLedger','calculatePeriodLedger'].map(extract).join('\n'),ctx);
const now = new Date('2026-10-21T12:00:00Z');
const period = ctx.getTrackingPeriod(now,{});
assert.equal(period.weeks.length,6);
assert.equal(period.startDate,'2026-09-13');
const historic = ctx.getTrackingPeriod(now,{periodStart:'2026-08-12',periodWeeks:6});
assert.equal(historic.startDate,'2026-08-09');
assert.equal(historic.weeks.length,6);
assert.throws(()=>ctx.getTrackingPeriod(now,{periodStart:'2027-01-01'}),/future/);
const cash=7500000, item=7, week=604800000;
const entry=(offset,amount,type='money',excluded=false)=>{
  const timestamp=period.startUnix*1000+offset*week+1000;
  return {timestamp,amount,type,excluded,weekKey:ctx.getIsoWeekKey(new Date(timestamp))};
};
const calc=(history,joinKey)=>ctx.calculatePeriodLedger(period,history,cash,item,true,joinKey);
let ledger=calc([entry(0,45000000)]);
assert.equal(ledger.owedWeeks,6,'six-week bulk payment clears the six preceding missed weeks first');
ledger=calc([entry(-6,45000000),entry(0,45000000)]);
assert.equal(ledger.owedWeeks,0,'paid previous period allows new payments to cover the visible period');
ledger=calc([entry(0,90000000)]);
assert.equal(ledger.lookbackWeeks,12,'large receipt checks its equivalent number of previous weeks');
assert.equal(ledger.owedWeeks,6);
ledger=calc([entry(-12,90000000),entry(0,90000000)]);
assert.equal(ledger.owedWeeks,0);
assert.equal(ledger.creditWeeks,6,'only remaining value after all lookback arrears becomes future credit');
ledger=calc([entry(0,3750000),entry(0,4,'item')],period.weeks[0]);
assert.equal(ledger.weeks[0].status,'Paid','cash and items combine for new joiners without earlier obligations');
assert.equal(calc([entry(0,45000000,'money',true)]).owedWeeks,6);
assert.equal(calc([entry(7,90000000)]).owedWeeks,6,'receipts after the selected period cannot pay historical balances');
assert.equal(calc(Array.from({length:6},(_,i)=>entry(i,cash))).owedWeeks,0,'ordinary weekly receipts stay in their receipt weeks despite earlier arrears');
assert.equal(calc([entry(0,cash)]).weeks[0].status,'Paid');

const storage=new Map(); const requests=[]; let failPartial=false;
const cacheCtx=vm.createContext({Date,TextEncoder,crypto:require('node:crypto').webcrypto,console,SETTINGS:{apiKey:'test-key-one'},ACTIVE_PROFILE_ID:'default',
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}, setStatus:()=>{},
  fetchAllLogs:async(type,from)=>{requests.push({type,from});return {logs:{same:{timestamp:Math.floor(Date.now()/1000)-5}},hitPageLimit:failPartial};}});
vm.runInContext(extract('fetchReceiptLogs')+'\n'+extract('paymentCacheKey'),cacheCtx);
(async()=>{
  const from=Math.floor(Date.now()/1000)-10000;
  let result=await cacheCtx.fetchReceiptLogs(['cash'],from,25);
  assert.equal(requests[0].from,from);
  result=await cacheCtx.fetchReceiptLogs(['cash'],from,25);
  assert(requests[1].from>from,'complete cache scans only recent receipts on refresh');
  assert.equal(Object.keys(result.logs).length,1,'cached receipts are deduplicated by log ID');
  await cacheCtx.fetchReceiptLogs(['cash'],from-10000,25);
  assert.equal(requests[2].from,from-10000,'earlier chosen periods trigger the missing history scan');
  failPartial=true; await cacheCtx.fetchReceiptLogs(['cash'],from-20000,25);
  failPartial=false; await cacheCtx.fetchReceiptLogs(['cash'],from-20000,25);
  assert.equal(requests.at(-1).from,from-20000,'partial cache must not be treated as complete history');
  cacheCtx.SETTINGS.apiKey='test-key-two'; await cacheCtx.fetchReceiptLogs(['cash'],from,25);
  assert.equal(requests.at(-1).from,from,'different API keys cannot share cached receipts');
  assert([...storage.keys()].every(k=>!k.includes('test-key')),'cache keys must not store API credentials');
  console.log('Selected periods, bulk arrears, extended lookback, mixed payments and persistent cache checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
