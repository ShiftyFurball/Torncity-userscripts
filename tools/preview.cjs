// Local preview only: no Torn requests and no real API key.
const fs = require('node:fs');
const source = fs.readFileSync('torn-tax-tracker.user.js', 'utf8');
const html = `<!doctype html><meta charset="utf-8"><title>Staff payments preview</title><body style="background:#111;color:white;font:16px system-ui"><p>Staff payments preview · simulated data only</p><script>
localStorage.setItem('torn_tax_settings_v5_default',JSON.stringify({testMode:true,startYear:2026,startWeek:40,defaultMoneyTax:10000000,defaultItemTax:7}));
Math.random=()=>0.4;
</script><script>${source.replaceAll('</script','<\\/script')}</script>`;
require('node:http').createServer((req,res) => {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(html);
}).listen(8766,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8766 (simulated data)'));
