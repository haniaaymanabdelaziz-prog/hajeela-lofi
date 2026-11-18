// Turns the Hajeela website into a content-driven site.
// in:  index.html (content hardcoded)   out: index.html (renders from embedded content) + content.json
const ts = require('typescript'), fs = require('fs');
const [,, IN, OUT_HTML, OUT_JSON, OUT_REPORT] = process.argv;
const html = fs.readFileSync(IN, 'utf8');
const sOpen = html.indexOf('<script'), jsStart = html.indexOf('>', sOpen) + 1, jsEnd = html.lastIndexOf('</script>');
const js = html.slice(jsStart, jsEnd);
const sf = ts.createSourceFile('site.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const K = ts.SyntaxKind;

// ---- content types: top-level data lists that become structured, editable collections
const COLLECTIONS = ['WORLDS','HEAD','HEAD_ENV','DEST','PACK','CLIM','BRING','CARDN','FOUND','INTRO','TRAVEL','STORY',
  'TRIPS','TRATE','MOMENT','DESTS','DINFO','HOURS','EXPS','EXPINFO','FAVS','FAVX','READS','MADE','PLANS','OCCASIONS',
  'CARDS','RESULTS','LW','KINDS','LEVELS','MET','RLAB','RTAG','DIFF','KINDB','PREP','TIPS'];
// top-level consts that stay code (layout, maps, prototype tools) — their strings are not touched
const KEEP_CODE = new Set(['RULES','ORDER','MON','SUN','MAPXY','PLACES','GEO','GEOD','WCITY','WCTRY','WREG','SPOS','NAVMAP','CLEAN','MN','MNF','DNS','RATE','ENVS']);
// impure top-level consts whose words become text entries
const TEXT_CONSTS = new Set(['PLAY','ART','SLOTS']);

const edits = []; // {start,end,text}
const content = { c: {}, t: {}, meta: { texts: {} } };
const report = { collections: [], texts: 0, skippedMixed: [], skippedStrings: 0 };

// ---- evaluate pure collections (D() is the only helper they use)
const top = [];
ts.forEachChild(sf, function walk(n) {
  if (ts.isVariableStatement(n) || ts.isVariableDeclarationList(n)) {}
  ts.forEachChild(n, walk);
});
function topLevelDecls() {
  // the site wraps everything in an IIFE; "top level" = the IIFE body statements
  const out = [];
  (function find(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      // depth: inside no function other than the outer IIFE
      let p = n.parent, fns = 0;
      while (p) { if (ts.isFunctionLike(p)) fns++; p = p.parent; }
      out.push({ n, fns });
    }
    ts.forEachChild(n, find);
  })(sf);
  const minFns = Math.min(...out.map(o => o.fns));
  return out.filter(o => o.fns === minFns).map(o => o.n);
}
const decls = topLevelDecls();
const declByName = {}; decls.forEach(d => { (declByName[d.name.text] = declByName[d.name.text] || []).push(d); });
const D = (d, left) => ({ d, left });
for (const name of COLLECTIONS) {
  const ds = declByName[name];
  if (!ds || ds.length !== 1) { report.collections.push([name, 'NOT FOUND or ambiguous']); continue; }
  const d = ds[0], src = d.initializer.getText();
  let val;
  try { val = Function('D', '"use strict";return (' + src + ')')(D); }
  catch (e) { report.collections.push([name, 'EVAL FAILED ' + e.message]); continue; }
  const json = JSON.stringify(val);
  if (JSON.stringify(JSON.parse(json)) !== json) throw new Error('not json-stable ' + name);
  content.c[name] = val;
  edits.push({ start: d.initializer.getStart(), end: d.initializer.getEnd(), text: `CONTENT.c.${name}` });
  report.collections.push([name, 'ok', json.length]);
}

// ---- text entries
const slug = s => s.replace(/&[a-z]+;/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 5).join('-') || 'text';
function groupOf(n) {
  // nearest meaningful name: V.x = ..., function x(), const x = ..., object property x:
  let p = n.parent;
  while (p) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === K.EqualsToken && ts.isPropertyAccessExpression(p.left) && p.left.expression.getText() === 'V') return 'page.' + p.left.name.text;
    if (ts.isFunctionDeclaration(p) && p.name) return 'part.' + p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
      let q = p.parent, fns = 0; while (q) { if (ts.isFunctionLike(q)) fns++; q = q.parent; }
      const nm = p.name.text;
      if (/^[A-Z][A-Z_0-9]+$/.test(nm) && TEXT_CONSTS.has(nm)) return 'list.' + nm;
      if (fns <= 1 && !/^[A-Z][A-Z_0-9]+$/.test(nm)) return 'part.' + nm;
    }
    p = p.parent;
  }
  return 'part.shared';
}
const keyFor = {}; // group|text -> key
function addText(group, value) {
  const id = group + '|' + value;
  if (keyFor[id]) return keyFor[id];
  let base = group + '.' + slug(value), k = base, i = 2;
  while (content.t[k] !== undefined) k = base + '-' + (i++);
  content.t[k] = value; keyFor[id] = k; report.texts++;
  return k;
}
function insideKept(n) {
  let p = n.parent;
  while (p) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && (KEEP_CODE.has(p.name.text) || COLLECTIONS.includes(p.name.text))) {
      // only when it is the top-level declaration
      if (decls.includes(p)) return true;
    }
    p = p.parent;
  }
  return false;
}
function inFunctionOrTextConst(n) {
  let p = n.parent, fns = 0;
  while (p) {
    if (ts.isFunctionLike(p)) fns++;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && TEXT_CONSTS.has(p.name.text) && decls.includes(p)) return true;
    p = p.parent;
  }
  return fns >= 2; // the outer IIFE counts as one
}
const DOM_CALLS = /^(querySelector|querySelectorAll|closest|getElementById|matchMedia|setAttribute|getAttribute|removeAttribute|hasAttribute|addEventListener|removeEventListener|toggle|add|remove|contains|includes|startsWith|endsWith|test|replace|replaceAll|split|join|indexOf|lastIndexOf|getItem|setItem|removeItem|createElement|createElementNS|getPropertyValue|setProperty|scrollIntoView|animate|N|\$|\$\$|go|fetch|open|postMessage|dispatchEvent|Event|CustomEvent|RegExp|toLocaleString|toLocaleDateString|toLocaleTimeString|padStart|localeCompare|find|filter|Date)$/;
function stringIsCopy(n) {
  const v = n.text;
  if (!/[A-Za-z]{2}/.test(v)) return false;
  if (!/\s/.test(v) && !/[.!?…:]$/.test(v)) return false;           // single tokens stay code
  if (/^[.#\[:\/@]|^https?:|^data:|^mailto:|^tel:|[<>{}=;`$\\]/.test(v)) return false;
  if (/^[a-z0-9 _\-]+$/.test(v) && v.split(/\s+/).length <= 4) return false; // class lists, ids
  if (/^[MLHVCSQTAZmlhvcsqtaz0-9 ,.\-]+$/.test(v)) return false;   // svg paths
  if (/^\d|^[\d.,\s%px]+$/.test(v) && !/[A-Za-z]{3}/.test(v)) return false;
  const p = n.parent;
  if (ts.isPropertyAssignment(p) && p.name === n) return false;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return false;
  if (ts.isBinaryExpression(p) && [K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken, K.InKeyword].includes(p.operatorToken.kind)) return false;
  if (ts.isCaseClause(p)) return false;
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const c = p.expression, nm = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : '';
    if (DOM_CALLS.test(nm)) return false;
  }
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return false;
  return true;
}
// text runs inside template literal HTML: >text<  (fully bounded inside one template part)
function templateParts(n) {
  if (n.kind === K.NoSubstitutionTemplateLiteral) return [{ node: n, open: 1, close: 1 }];
  if (ts.isTemplateExpression(n)) {
    const parts = [{ node: n.head, open: 1, close: 2 }];
    n.templateSpans.forEach(sp => parts.push({ node: sp.literal, open: 1, close: sp.literal.kind === K.TemplateTail ? 1 : 2 }));
    return parts;
  }
  return [];
}
function visit(n) {
  if (insideKept(n)) return;
  if (ts.isTemplateExpression(n) || n.kind === K.NoSubstitutionTemplateLiteral) {
    if (inFunctionOrTextConst(n) || true) {
      // skip notes passed to N(...) (prototype annotations)
      let p = n.parent; const inN = p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'N';
      if (!inN) { let inTag = false, quote = null;
      for (const part of templateParts(n)) {
        const start = part.node.getStart() + part.open, end = part.node.getEnd() - part.close;
        const raw = js.slice(start, end);
        // walk the part: text outside tags becomes a run; tag state carries across ${...}
        let i = 0, runStart = inTag ? -1 : 0;
        const flush = (s0, e0) => {
          if (s0 < 0 || e0 <= s0) return;
          const full = raw.slice(s0, e0), lead = full.match(/^\s*/)[0], trail = full.match(/\s*$/)[0];
          const val = full.slice(lead.length, full.length - trail.length);
          if (!/[A-Za-z]{3}/.test(val) && !/^[A-Za-z]{2}$/.test(val)) return;
          if (raw.includes('\\')) return;
          if (/[;{}=`]|^[\w-]+:\S|\w\(|^[.#]|^https?:|^[\w-]+$(?<![A-Z][a-z]+)/.test(val) && !/\s/.test(val)) return;
          if (/[;{}=`]|\w\([^)]*\)\s*;|:\s*\d|px\b|rgba?\(|translate|var\(--/.test(val)) return;
          const k = addText(groupOf(n), val), s1 = start + s0 + lead.length;
          edits.push({ start: s1, end: s1 + val.length, text: '${T(' + JSON.stringify(k).replace(/"/g, "'") + ')}' });
        };
        for (; i < raw.length; i++) {
          const ch = raw[i];
          if (inTag) { if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') { inTag = false; runStart = i + 1; } }
          else if (ch === '<' && /[a-zA-Z\/!]/.test(raw[i + 1] || '')) { flush(runStart, i); inTag = true; runStart = -1; }
        }
        if (!inTag) flush(runStart, raw.length);
      } }
    }
  }
  if (n.kind === K.StringLiteral && inFunctionOrTextConst(n)) {
    if (stringIsCopy(n)) {
      let p = n.parent; const inN = p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'N';
      if (!inN) {
        const k = addText(groupOf(n), n.text);
        edits.push({ start: n.getStart(), end: n.getEnd(), text: `T('${k}')` });
      }
    } else report.skippedStrings++;
  }
  ts.forEachChild(n, visit);
}
visit(sf);

// ---- apply edits (non-overlapping, back to front)
edits.sort((a, b) => b.start - a.start);
for (let i = 1; i < edits.length; i++) if (edits[i].end > edits[i - 1].start) throw new Error('overlap at ' + edits[i].start);
let out = js;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

// ---- runtime: content loader + T() at the very top of the script
const RUNTIME = `
/* ---- Content: every word and list on this site comes from the content file below.
   Edit it in the admin portal (Website content). Draft previews come from ?preview. ---- */
const CONTENT=(()=>{let c={c:{},t:{}};try{c=JSON.parse(document.getElementById('hj-content').textContent)}catch(e){}
 try{const live=window.HJ_CONTENT;if(live&&live.t)c=live}catch(e){}
 try{if(/[?&]preview\\b/.test(location.search)){const d=JSON.parse(localStorage.getItem('hj-content-draft')||'null');if(d&&d.t)c=d}}catch(e){}
 return c})();
const T=k=>{const v=CONTENT.t[k];return v==null?'':v};
/* New trips, destinations and experiences added in the portal may not have every detail yet.
   Fill the gaps with clear [placeholders] so no page breaks and nothing is invented. */
(()=>{const c=CONTENT.c;if(!c||!c.TRIPS)return;const ph=s=>'['+s+']';
 ['TRATE','MOMENT','DINFO','HOURS','EXPINFO'].forEach(k=>{c[k]=c[k]||{}});
 c.TRIPS.forEach(t=>{t.dates=t.dates||[];t.mo=t.mo||[];t.exps=t.exps||[];t.m=t.m||[2,2,2,2];if(!c.TRATE[t.id])c.TRATE[t.id]=[2,2,2,1];if(c.MOMENT[t.id]==null)c.MOMENT[t.id]=ph('Favourite moment on this trip')});
 c.DESTS.forEach(d=>{if(!c.DINFO[d.id])c.DINFO[d.id]={best:[],bestWhy:ph('Best time to go'),local:[ph('Local host'),ph('Who they are'),ph('What they would tell you')],g:3,so:3,gs:ph('Better as a group or solo?'),pros:[1,2,3].map(i=>ph('Why go '+i)),cons:[1,2,3].map(i=>ph('Good to know '+i)),learn:[1,2,3].map(i=>ph('What you will learn '+i)),loved:[1,2,3].map(i=>[ph('Loved moment '+i),80]),n:[0,0,0,new Date().getFullYear()]};if(c.HOURS[d.id]==null)c.HOURS[d.id]=ph('Travel time from Cairo')});
 c.EXPS.forEach(e=>{if(!c.EXPINFO[e[0]])c.EXPINFO[e[0]]=[ph('One line about '+e[1]),1,[1,2,3].map(i=>ph('Highlight '+i)),ph('First time? What to know')]});
})();
`;
// insert after the opening of the IIFE / script start
out = out.replace('const GEO={};', "const GEO={};DESTS.forEach(d=>{if(Array.isArray(d.geo))GEO[d.id]=d.geo});");
if(!out.includes('DESTS.forEach(d=>{if(Array.isArray(d.geo))')) throw new Error('GEO hook not found');
const finalJs = RUNTIME + out;
const json = JSON.stringify(content);
const dataTag = `<script id="hj-content" type="application/json">${json.replace(/</g, '\\u003c')}</script>\n`;
const outHtml = html.slice(0, sOpen) + dataTag + html.slice(sOpen, jsStart) + finalJs + html.slice(jsEnd);
fs.writeFileSync(OUT_HTML, outHtml);
fs.writeFileSync(OUT_JSON, JSON.stringify(content, null, 1));
report.groups = {};
Object.keys(content.t).forEach(k => { const g = k.split('.').slice(0, 2).join('.'); report.groups[g] = (report.groups[g] || 0) + 1; });
report.skippedMixed = [...new Set(report.skippedMixed)];
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 1));
console.log('collections', report.collections.filter(c => c[1] === 'ok').length, '/', COLLECTIONS.length, '| texts', report.texts, '| mixed fragments left as code', report.skippedMixed.length, '| edits', edits.length);
report.collections.filter(c => c[1] !== 'ok').forEach(c => console.log('  !', c.join(' ')));
