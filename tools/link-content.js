// Step 2 of building the content-driven website (run after tools/extract-content.js).
// - Destination photos live on each destination (DESTS[i].img) instead of a separate list.
// - Each trip has its own day plan (TPLAN[tripId]); DEST[env] stays as the starting point for new trips.
// - Departures have a real date (YYYY-MM-DD) and time; labels, months, "today" and the calendar come from them.
// usage: node linkify.js in.html content.json out.html out.json
const fs = require('fs');
const [,, IN, CJSON, OUT, OUTJSON] = process.argv;
let html = fs.readFileSync(IN, 'utf8');
const content = JSON.parse(fs.readFileSync(CJSON, 'utf8'));
const c = content.c;

// ---- content: photos onto destinations
if (c.DIMG) {
  c.DESTS.forEach(d => { const p = c.DIMG[d.id]; d.img = p ? { src: p[0], pos: p[1] } : { src: '', pos: '50% 50%' }; });
  delete c.DIMG;
}

// ---- content: one day plan per trip, copied from what the trip shows today
const WRITTEN_FOR = { sea: 'ras-mohamed', sand: 'fayoum-day', summit: 'sinai-sunrise', snow: 'lebanon-cedars' };
if (!c.TPLAN) {
  c.TPLAN = {};
  c.TRIPS.forEach(t => {
    const plan = JSON.parse(JSON.stringify(c.DEST[t.w]));
    plan._copy = WRITTEN_FOR[t.w] === t.id ? '' : WRITTEN_FOR[t.w];   // which trip this text was written for
    c.TPLAN[t.id] = plan;
  });
}

// ---- content: real dates. "Thu 10 Dec" -> 2026-12-10 (the site's own rule: Nov and Dec are 2026, the rest 2027)
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DEFAULT_TIME = { day: '06:00', weekend: '22:00', long: '07:00' };
c.TRIPS.forEach(t => {
  t.dates = (t.dates || []).map(x => {
    if (x.date) return x;
    const p = x.d.split(' '), m = MN.indexOf(p[2]), y = m >= 10 ? 2026 : 2027;
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(+p[1]).padStart(2, '0')}`;
    return { date, time: DEFAULT_TIME[t.kind] || '07:00', left: x.left };
  });
  delete t.mo;   // months come from the dates now
});

// ---- code changes
const swap = (from, to, count = 1) => {
  const n = html.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count} of: ${from.slice(0, 80)} — found ${n}`);
  html = html.split(from).join(to);
};

// runtime: derive labels, months and today's date from real dates, before anything else reads TRIPS
swap("const T=k=>{const v=CONTENT.t[k];return v==null?'':v};",
`const T=k=>{const v=CONTENT.t[k];return v==null?'':v};
/* Dates: every departure has a real date (YYYY-MM-DD) and a time. The label ("Thu 10 Dec"), the months a trip
   shows under, and whether a date is past all come from that, so nothing is typed twice. */
const HJ_NOW=new Date(),HJ_ISO=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const HJ_TODAY=HJ_ISO(HJ_NOW),HJ_TODAYK=+HJ_TODAY.replace(/-/g,'');
(()=>{const c=CONTENT.c;if(!c||!c.TRIPS)return;const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 c.TRIPS.forEach(t=>{t.dates=(t.dates||[]).filter(x=>x&&x.date&&x.date>=HJ_TODAY).sort((a,b)=>a.date<b.date?-1:1);
  t.dates.forEach(x=>{const d=new Date(x.date+'T12:00:00');x.d=DN[d.getDay()]+' '+d.getDate()+' '+MN[d.getMonth()]});
  t.mo=[...new Set(t.dates.map(x=>MN[+x.date.slice(5,7)-1]))]});})();`);

// year comes from the date, not guessed from the month
html = html.split('y=m>=10?2026:2027').join("y=+String(x.date||'').slice(0,4)||(m>=10?2026:2027)");
// past departures drop off by today's real date
swap('d.k>=20261113', 'd.k>=HJ_TODAYK');
swap("const TODAY='2026-11-13';", 'const TODAY=HJ_TODAY;');
// the calendar runs for 12 months from this month
swap('const CALM=Array.from({length:12},(_,i)=>new Date(2026,10+i,1,12));',
     'const CALM=Array.from({length:12},(_,i)=>new Date(HJ_NOW.getFullYear(),HJ_NOW.getMonth()+i,1,12));');
html = html.split("l.start<'2027-11'").join('l.start<HJ_ISO(new Date(CALM[11].getFullYear(),CALM[11].getMonth()+1,1,12))');

// photos from the destination
swap('const DIMG=CONTENT.c.DIMG;',
     "const DIMG={};(CONTENT.c.DESTS||[]).forEach(d=>{if(d.img&&d.img.src)DIMG[d.id]=[d.img.src,d.img.pos||'50% 50%']});");

// each trip's own day plan; a destination page uses the plan of its first trip
swap('const DEST=CONTENT.c.DEST;', 'const DEST=CONTENT.c.DEST;const TPLAN=CONTENT.c.TPLAN||{};const planOf=t=>(t&&TPLAN[t.id])||DEST[t?t.w:\'sand\'];');
swap('W_=DEST[d.w]', 'W_=list.length?planOf(list[0]):DEST[d.w]');
swap('const d=DEST[t.w],av=availOf(t);', 'const d=planOf(t),av=availOf(t);');

// new trips added in the portal: fill a missing day plan from the environment default
swap("c.TRIPS.forEach(t=>{t.dates=t.dates||[];t.mo=t.mo||[];",
     "c.TPLAN=c.TPLAN||{};c.TRIPS.forEach(t=>{if(!c.TPLAN[t.id]&&c.DEST&&c.DEST[t.w])c.TPLAN[t.id]=c.DEST[t.w];t.dates=t.dates||[];t.mo=t.mo||[];");

// write content back into the page
const json = JSON.stringify(content);
html = html.replace(/(<script id="hj-content" type="application\/json">)[\s\S]*?(<\/script>)/, (m, a, b) => a + json.replace(/</g, '\\u003c') + b);
fs.writeFileSync(OUT, html);
fs.writeFileSync(OUTJSON, JSON.stringify(content, null, 1));
console.log('ok', c.TRIPS.length, 'trips,', Object.keys(c.TPLAN).length, 'day plans,', c.DESTS.filter(d => d.img.src).length, 'photos');
