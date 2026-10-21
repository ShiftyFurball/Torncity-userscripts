// Local preview only: no Torn requests and no real API key.
const fs = require('node:fs');
require('node:http').createServer((req,res) => {
  const source = fs.readFileSync('torn-tax-tracker.user.js', 'utf8');
  const html = `<!doctype html><meta charset="utf-8"><title>Staff payments preview</title>
<style>td,th {color:black !important;background:#1b1b1b !important;}</style>
<body style="background:#111;color:white;font:16px system-ui"><p>Staff payments preview · mocked Torn API · hostile table colours</p><script>
const now = new Date(); const sunday = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-now.getUTCDay()));
const thursday = new Date(sunday.getTime()+86400000); const shifted = new Date(sunday.getTime()+86400000); const day=shifted.getUTCDay()||7;shifted.setUTCDate(shifted.getUTCDate()+4-day);const year=shifted.getUTCFullYear();const week=Math.ceil(((shifted-new Date(Date.UTC(year,0,1)))/86400000+1)/7);
localStorage.setItem('torn_tax_settings_v5_default',JSON.stringify({apiKey:'preview-only-not-a-key',testMode:false,startYear:year,startWeek:week,defaultMoneyTax:10000000,defaultItemTax:7}));
window.fetch=async input=>{
  const url=new URL(input); const select=url.searchParams.get('selections'); let data;
  if(select==='employees')data={company_employees:{101:{name:'Alice'},102:{name:'Bob'},103:{name:'Charlie'}}};
  else if(select==='items')data={items:{206:{name:'Xanax'}}};
  else if(select==='logtypes')data={logtypes:{1:'Money receive',2:'Item receive',3:'Attack win'}};
  else if(select==='log'){
    if(!url.searchParams.get('log')) throw Error('Unfiltered log scan attempted');
    const timestamp=Math.floor(sunday.getTime()/1000)+3600;
    data=url.searchParams.get('log')==='1'?{log:{cash:{timestamp,title:'Money receive',data:{sender:101,money:5000000}}}}:{log:{items:{timestamp,title:'Item receive',data:{sender:101,items:[{id:206,quantity:4}]}},partial:{timestamp,title:'Item receive',data:{sender:102,items:[{id:206,quantity:2}]}}}};
  } else throw Error('Unexpected API selection');
  return {ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)};
};
</script><script>${source.replaceAll('</script','<\\/script')}</script>`;
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(html);
}).listen(8766,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8766 (simulated data)'));
