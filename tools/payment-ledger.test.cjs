const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('torn-tax-tracker.user.js', 'utf8');
function extract(name) {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  assert(start >= 0, name);
  const tail = source.slice(start);
  const end = tail.slice(1).search(/\n  (?:async )?function /);
  return end < 0 ? tail : tail.slice(0, end + 1);
}
const context = vm.createContext({console, URLSearchParams, Date, setTimeout, Math});
const parser = vm.createContext({});
vm.runInContext(extract('isLikelyIncomingMoneyLog'), parser);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Item receive',data:{}}),true);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Money receive',data:{}}),true);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Money send',data:{money:10000000}}),false);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Item use',data:{}}),false);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Unknown',data:{amount:10000000}}),false);
assert.equal(parser.isLikelyIncomingMoneyLog({title:'Money receive',data:{message:'I sent this payment'}}),true);
vm.runInContext(extract('calculatePaymentLedger'), context);
const calc = (weeks, entries, complete = true) => context.calculatePaymentLedger(weeks, entries, 10000000, 7, complete);
const weeks = ['2026-W40','2026-W41','2026-W42'];
const p = (type, amount, weekKey = weeks[0], excluded = false) => ({type,amount,weekKey,excluded});
assert.equal(calc(weeks, [p('money', 10000000)]).weeks[0].status, 'Paid');
assert.equal(calc(weeks, [p('item', 7)]).weeks[0].status, 'Paid');
assert.equal(calc(weeks, [p('money', 5000000), p('item', 3)]).weeks[0].status, 'Part paid');
assert.equal(calc(weeks, [p('money', 5000000), p('item', 4)]).weeks[0].status, 'Paid');
assert.equal(calc(weeks, [p('money', 10000000), p('money', 10000000, weeks[0], true)]).owedWeeks, 2);
assert.equal(calc(weeks, [p('money', 30000000, weeks[2])]).weeks.every(w => w.status === 'Paid'), true);
assert.equal(calc(weeks, [p('item', 28)]).creditWeeks, 1);
assert.equal(calc(weeks, [], false).weeks[0].status, 'Unable to confirm');
assert.equal(calc(weeks, [p('item', 7)], false).weeks[0].status, 'Paid');
assert.equal(calc(weeks, [p('money', 10000000, '2025-W01')]).owedWeeks, 3);
assert.equal(calc(weeks, [p('money', -1)]).owedWeeks, 3);
const longWeeks = Array.from({length:12}, (_,i) => 'week-' + i);
assert.equal(calc(longWeeks, [p('money', 10000000, 'week-11')]).owedWeeks, 11);
assert.equal(calc(longWeeks, [p('money', 10000000, 'week-11')]).weeks[0].status, 'Paid');
vm.runInContext('const MILLIS_PER_DAY=86400000; const MILLIS_PER_WEEK=604800000;' + ['parseWeekKey','formatWeekKey','getIsoWeekKey','isoWeekStartDate'].map(extract).join('\n'), context);
for (const date of ['2025-12-28','2026-01-04','2026-10-18','2027-01-03']) {
  assert.equal(context.isoWeekStartDate(context.getIsoWeekKey(new Date(date))).toISOString().slice(0,10), date);
}
// Integration: exclusions are applied once, incomplete scans remain uncertain,
// and a failed request does not leave the refresh lock engaged.
vm.runInContext(`
let fetching=false, scanComplete=false;
let SETTINGS={testMode:false,manualMode:true,manualMembers:{1:{name:'Alice'}},memberRequirements:{},taxItemName:'Xanax',startYear:2026,startWeek:40,maxWeeks:8,maxLogPages:25,enableEmployeeMenu:false};
let DEFAULT_SETTINGS={taxItemName:'Xanax'}, DEFAULT_TAX_ITEM_ID=206, ACTIVE_PROFILE_ID='default', currentView='overview';
let lastEmployeesCache={},lastWeeklyDataCache={},lastPaymentHistoryCache={};
let fail=false, partial=false;
function setStatus(){} function normalizeEmployeeMap(m){return m;} function getDefaultRequirement(){return {type:'money',amount:10000000};}
async function ensureItemCatalog(){return {};} function getItemIdForName(){return 206;} function normalizeItemName(s){return s.toLowerCase();}
function buildEmployeeNameIndex(){return {};} function determineLogStartUnix(){return 1;} function formatWeekKey(){return '2026-W40';}
async function getReceiptLogTypes(){return ['1','2'];}
async function fetchReceiptLogs(){if(fail)throw Error('offline');return {logs:{a:{timestamp:1,data:{amount:10000000}},b:{timestamp:2,data:{amount:10000000}}},hitPageLimit:partial};}
function generateRecentWeekKeys(){return ['2026-W40'];} function unixLogDate(){return new Date();} function getIsoWeekKey(){return '2026-W40';}
function isWeekOnOrAfter(){return true;} function findEmployeeIdFromLog(){return '1';} function getItemQuantityFromLog(){return 0;}
function getMoneyAmountFromLog(l){return l.data.amount;} function isLikelyIncomingMoneyLog(){return true;} function isPaymentExcluded(id,p){return p==='money:b';}
function describeLogMedium(){return 'Cash';} function saveSettings(){} function renderOverview(){} function renderEmployeeMenu(){} function renderPaymentHistory(){}
`, context);
vm.runInContext(extract('fetchData'), context);
(async () => {
  await context.fetchData();
  assert.equal(vm.runInContext('lastWeeklyDataCache["2026-W40"][1].money',context),10000000);
  assert.equal(vm.runInContext('scanComplete',context),true);
  assert.equal(vm.runInContext('fetching',context),false);
  vm.runInContext('partial=true',context); await context.fetchData();
  assert.equal(vm.runInContext('scanComplete',context),false);
  vm.runInContext('fail=true',context); await context.fetchData();
  assert.equal(vm.runInContext('fetching',context),false);
  assert.equal(vm.runInContext('scanComplete',context),false);
  console.log('Payment ledger, year boundaries, exclusion integration, incomplete history and refresh recovery passed.');
})().catch(error => { console.error(error); process.exitCode=1; });
