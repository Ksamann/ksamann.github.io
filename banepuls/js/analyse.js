/* Banepuls analysis tool: combine data sent by many people and summarise it.
   Everything runs in the browser. The combined data set is kept in IndexedDB on this
   computer only, until "Clear" is pressed. Reads Banepuls JSON (v3), T-bane logger JSON,
   and emails (.eml/.txt or pasted text) containing the BANEPULS-JSON blocks. */
import { $, esc, hm, fmt } from "./core.js";
import { segments, compare, platformRows, quality, median } from "./model.js";
import { toCSV, readImport, download, MARK_START, MARK_END } from "./export.js";

/* ---------- storage (IndexedDB, one key) ---------- */
const DB="banepuls-analyse";
function idb(mode, fn){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore("kv");
  r.onsuccess=()=>{ const tx=r.result.transaction("kv",mode), st=tx.objectStore("kv"), q=fn(st); tx.oncomplete=()=>res(q&&q.result); tx.onerror=()=>rej(tx.error); }; r.onerror=()=>rej(r.error); }); }
const saveSet = items => idb("readwrite", st=>st.put(items,"items")).catch(()=>{});
const loadSet = () => idb("readonly", st=>st.get("items")).catch(()=>null);

/* ---------- reading emails and text ---------- */
function qp(s){ const b=s.replace(/=\r?\n/g,""); const bytes=[]; for(let i=0;i<b.length;i++){ if(b[i]==="="&&/^[0-9A-F]{2}$/i.test(b.substr(i+1,2))){ bytes.push(parseInt(b.substr(i+1,2),16)); i+=2; } else bytes.push(b.charCodeAt(i)&255); } return new TextDecoder().decode(new Uint8Array(bytes)); }
function b64(s){ try{ const bin=atob(s.replace(/\s+/g,"")); return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))); }catch(e){ return ""; } }
// Decode every MIME part we can find; plain text comes back unchanged.
function mimeTexts(raw){
  const out=[raw], re=/Content-Transfer-Encoding:\s*(base64|quoted-printable)[^\n]*\n(?:[^\n]*\S[^\n]*\n)*?\r?\n([\s\S]*?)(?=\r?\n--|\s*$)/gi; let m;
  while((m=re.exec(raw))) out.push(m[1].toLowerCase()==="base64" ? b64(m[2]) : qp(m[2]));
  return out;
}
function htmlToText(s){ if(!/<[a-z][\s\S]*>/i.test(s)) return s; try{ return new DOMParser().parseFromString(s,"text/html").body.textContent||s; }catch(e){ return s; } }
export function jsonBlocks(text){
  const found=[];
  for(const part of mimeTexts(text)){
    for(const src of [part, htmlToText(part)]){
      let i=0; while((i=src.indexOf(MARK_START,i))>=0){ const j=src.indexOf(MARK_END,i); if(j<0) break;
        const body=src.slice(i+MARK_START.length,j).replace(/\r?\n/g,"").replace(/^>+\s?/gm,"").trim(); found.push(body); i=j; }
      const tr=src.trim(); if(tr.startsWith("{") && /"app"\s*:\s*"(banepuls|tbane-tidslogger)"/.test(tr)) found.push(tr);
    }
  }
  return [...new Set(found)];
}
async function ingest(files, pasted){
  const jsonFiles=[]; let bad=0;
  for(const f of files){
    const txt=await f.text();
    if(/\.json$/i.test(f.name) || txt.trim().startsWith("{")) jsonFiles.push(f);
    else { const bl=jsonBlocks(txt); if(!bl.length) bad++; bl.forEach((b,k)=>jsonFiles.push(new File([b], `${f.name}#${k+1}`))); }
  }
  if(pasted){ const bl=jsonBlocks(pasted); if(!bl.length) bad++; bl.forEach((b,k)=>jsonFiles.push(new File([b], `pasted#${k+1}`))); }
  const r=await readImport(jsonFiles, true);
  return {items:r.items, bad:bad+r.bad};
}

/* ---------- aggregation ---------- */
const P = (a,p) => { if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), i=(s.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return s[lo]+(s[hi]-s[lo])*(i-lo); };
const off = x => x.clock && Number.isFinite(x.clock.offset) ? x.clock.offset : 0;
export function band(t){ const d=new Date(t), h=d.getHours(), w=d.getDay(); if(w===0||w===6) return "weekend"; if(h>=20||h<6) return "evening"; if((h>=7&&h<9)||(h>=15&&h<17)) return "peak"; return "day"; }
const when = x => x.startedAt||x.t;
export function filtered(items, F){
  return items.filter(x=>{
    if(F.line && String(x.line)!==F.line && x.kind!=="platform") return false;
    if(F.role && (x._role||"-")!==F.role) return false;
    const w=when(x); if(F.from && w<Date.parse(F.from)) return false; if(F.to && w>Date.parse(F.to)+864e5) return false;
    return true;
  });
}
function badSeqs(x){ return new Set(quality(x).flags.filter(f=>f.seq).map(f=>f.seq)); }
export function legRows(items, F){
  const by={};
  for(const x of items){ if(x.kind!=="study") continue;
    const sg=segments(x), bad=F.okOnly?badSeqs(x):new Set(), calls=x.rt&&x.rt.calls;
    sg.forEach((g,i)=>{ if(g.run==null || bad.has(g.seq)) return; if(F.band && band(g.dep)!==F.band) return;
      const k=g.station+" → "+g.to, r=by[k]||(by[k]={leg:k, from:g.station, to:g.to, runs:[], plans:[], lines:new Set(), devs:new Set()});
      r.runs.push(g.run/1000); r.lines.add(x.line); r.devs.add(x._dev||x._obs||x.id);
      const nx=sg[i+1]; if(calls&&nx){ const a=calls[g.idx], b=calls[nx.idx]; const pa=a&&(a.aDep??a.aArr), pb=b&&(b.aArr??b.aDep); if(pa!=null&&pb!=null) r.plans.push((pb-pa)/1000); } });
  }
  return Object.values(by).map(r=>{ const med=P(r.runs,.5), pm=P(r.plans,.5);
    return {leg:r.leg, lines:[...r.lines].sort().join(" "), n:r.runs.length, people:r.devs.size, median:med, p10:P(r.runs,.1), p90:P(r.runs,.9), plan:pm, diff:pm!=null?med-pm:null}; });
}
export function dwellRows(items, F){
  const by={}; const add=(st,v,src,t)=>{ if(v==null) return; if(F.band && band(t)!==F.band) return; (by[st]||(by[st]={station:st, v:[], study:0, platform:0})).v.push(v/1000); by[st][src]++; };
  for(const x of items){
    if(x.kind==="study"){ const bad=F.okOnly?badSeqs(x):new Set(); segments(x).forEach(g=>{ if(!bad.has(g.seq)) add(g.station,g.dwell,"study",g.arr); }); }
    if(x.kind==="platform") platformRows(x).forEach(r=>add(x.station,r.dwell,"platform",r.arrC));
  }
  return Object.values(by).map(r=>({station:r.station, n:r.v.length, from:`${r.study} / ${r.platform}`, median:P(r.v,.5), p90:P(r.v,.9), max:Math.max(...r.v)}));
}
export function rtRows(items, F){
  const by={}; let copies=0, forecast=0, actual=0;
  for(const x of items){ if(x.kind!=="study") continue;
    for(const r of compare(x)){ if(!r.rt || r.rt.v==null) continue; if(F.band && band(r.me)!==F.band) continue;
      const k=r.station, o=by[k]||(by[k]={station:k, d:[], copies:0, forecast:0});
      if(r.rt.copy){ o.copies++; copies++; continue; }
      if(!r.rt.actual){ o.forecast++; forecast++; continue; }
      actual++; o.d.push(r.delta); } }
  const rows=Object.values(by).map(o=>({station:o.station, n:o.d.length, median:P(o.d,.5), meanAbs:o.d.length?o.d.reduce((a,b)=>a+Math.abs(b),0)/o.d.length:null, max:o.d.length?Math.max(...o.d.map(Math.abs)):null, copies:o.copies, forecast:o.forecast}));
  return {rows, copies, forecast, actual};
}
export function doubleRows(items){
  const by={};
  for(const x of items){ if(x.kind==="study" && x.journey && x.journey.id) (by[x.journey.id]||(by[x.journey.id]=[])).push(x); }
  const out=[];
  for(const [jid,list] of Object.entries(by)){ if(list.length<2) continue;
    for(let a=0;a<list.length;a++) for(let b=a+1;b<list.length;b++){
      const A=compare(list[a]), B=compare(list[b]), d=[];
      A.forEach(r=>{ const s=B.find(q=>q.idx===r.idx && q.kind===r.kind); if(s) d.push((r.me-s.me)/1000); });
      if(!d.length) continue;
      out.push({journey:jid.split(":").pop().slice(0,10), line:list[a].line, date:new Date(when(list[a])).toLocaleDateString("en-GB"), who:`${list[a]._obs||list[a]._dev||"?"} / ${list[b]._obs||list[b]._dev||"?"}`, n:d.length, meanAbs:d.reduce((s,v)=>s+Math.abs(v),0)/d.length, max:Math.max(...d.map(Math.abs)), mean:d.reduce((s,v)=>s+v,0)/d.length});
    } }
  return out;
}
export function headwayRows(items, F){
  const by={};
  for(const x of items){ if(x.kind!=="platform") continue;
    platformRows(x).forEach(r=>{ if(r.headway==null) return; if(F.line && r.line!==F.line) return; if(F.band && band(r.depC)!==F.band) return;
      const k=`${x.station} → ${r.grp}`; (by[k]||(by[k]={dir:k, h:[]})).h.push(r.headway/1000); }); }
  return Object.values(by).map(o=>({dir:o.dir, n:o.h.length, median:P(o.h,.5), p10:P(o.h,.1), p90:P(o.h,.9)}));
}
export function overview(items){
  const kinds={study:0,platform:0,ping:0}, roles={}, people=new Set(), lines=new Set(); let t0=Infinity, t1=-Infinity, legs=0;
  for(const x of items){ kinds[x.kind]=(kinds[x.kind]||0)+1; roles[x._role||"not stated"]=(roles[x._role||"not stated"]||0)+1; people.add(x._dev||x._obs||"unknown");
    if(x.line) lines.add(String(x.line)); const w=when(x); t0=Math.min(t0,w); t1=Math.max(t1,w); if(x.kind==="study") legs+=segments(x).filter(g=>g.run!=null).length; }
  return {kinds, roles, people:people.size, lines:[...lines].sort(), t0, t1, legs};
}

/* ---------- UI ---------- */
const S={ items:[], tab:"overview", F:{line:"", band:"", role:"", from:"", to:"", okOnly:true}, sort:{} };
const s1 = v => v==null ? "–" : v.toFixed(1);
const mmss = v => v==null ? "–" : fmt(v*1000,true);
const TABS = [["overview","Overview"],["legs","Running times"],["dwell","Dwell times"],["rt","Realtime accuracy"],["doubles","Double measurements"],["headway","Headways"]];
function table(id, cols, rows, barKey){
  const sk=S.sort[id]||{k:(cols.find(c=>c.k==="n")||cols[1]).k,d:-1};
  rows=rows.slice().sort((a,b)=>{ const x=a[sk.k], y=b[sk.k]; if(x==null) return 1; if(y==null) return -1; return (typeof x==="string"?x.localeCompare(y,"no"):x-y)*sk.d; });
  const mx=barKey?Math.max(...rows.map(r=>r[barKey]||0),1):1;
  S.last={cols, rows};
  return `<div class="tblwrap"><table data-t="${id}"><thead><tr>${cols.map(c=>`<th class="${c.n?"n":""}" data-k="${c.k}" aria-sort="${sk.k===c.k?(sk.d>0?"ascending":"descending"):"none"}">${c.h}${sk.k===c.k?(sk.d>0?" ▲":" ▼"):""}</th>`).join("")}${barKey?"<th></th>":""}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.n?"n":""}">${c.f?c.f(r[c.k],r):esc(r[c.k]??"–")}</td>`).join("")}${barKey?`<td class="barc"><i style="width:${Math.max(2,(r[barKey]||0)/mx*100).toFixed(1)}%"></i>${r.plan!=null&&barKey==="median"?`<b style="left:${Math.min(100,r.plan/mx*100).toFixed(1)}%" title="plan"></b>`:""}</td>`:""}</tr>`).join("")||`<tr><td colspan="${cols.length+1}" class="none">No data with these filters.</td></tr>`}</tbody></table></div>`;
}
function render(){
  const items=filtered(S.items,S.F), F=S.F, box=$("#view");
  $("#count").textContent=`${S.items.length} records loaded · ${items.length} after filters`;
  document.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.tab===S.tab));
  if(!S.items.length){ box.innerHTML=`<div class="empty"><b>No data yet</b><p>Drop Banepuls JSON files or saved emails here, choose files, or paste the text of an email below. Several files and emails can be added at once; duplicates are skipped.</p></div>`; return; }
  if(S.tab==="overview"){ const o=overview(items);
    box.innerHTML=`<div class="kpis">${[["Time studies",o.kinds.study],["Platform sessions",o.kinds.platform],["Pings",o.kinds.ping],["Legs measured",o.legs],["Contributors",o.people],["Lines",o.lines.join(" ")||"–"]].map(([l,v])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
      <p class="hint">Period: ${isFinite(o.t0)?new Date(o.t0).toLocaleString("en-GB"):"–"} to ${isFinite(o.t1)?new Date(o.t1).toLocaleString("en-GB"):"–"}</p>
      <h3>Contributors by role</h3><ul class="roles">${Object.entries(o.roles).map(([k,v])=>`<li><span>${esc(k)}</span><b>${v}</b></li>`).join("")}</ul>
      <p class="hint">Contributors are counted by device. Names appear only where senders filled them in.</p>`; }
  if(S.tab==="legs") box.innerHTML=`<p class="hint">Running time from departure to the next arrival. Plan is the timetable for the same departures. Bars show the median; the white mark is the plan.</p>`+table("legs",[
    {k:"leg",h:"Leg"},{k:"lines",h:"Lines"},{k:"n",h:"n",n:1},{k:"people",h:"People",n:1},{k:"median",h:"Median",n:1,f:mmss},{k:"p10",h:"P10",n:1,f:mmss},{k:"p90",h:"P90",n:1,f:mmss},{k:"plan",h:"Plan",n:1,f:mmss},{k:"diff",h:"Median − plan (s)",n:1,f:v=>v==null?"–":(v>0?"+":"")+v.toFixed(0)}], legRows(items,F), "median");
  if(S.tab==="dwell") box.innerHTML=`<p class="hint">Dwell time from arrival to departure, from time studies and platform mode (count shown as study / platform). Realtime data for the metro has no dwell times, so this comes only from taps.</p>`+table("dwell",[
    {k:"station",h:"Station"},{k:"n",h:"n",n:1},{k:"from",h:"Study / platform",n:1},{k:"median",h:"Median",n:1,f:mmss},{k:"p90",h:"P90",n:1,f:mmss},{k:"max",h:"Max",n:1,f:mmss}], dwellRows(items,F), "median");
  if(S.tab==="rt"){ const r=rtRows(items,F), tot=r.actual+r.copies+r.forecast;
    box.innerHTML=`<div class="kpis">${[["Compared with actual times",r.actual],["Actual = plan (left out)",tot?Math.round(100*r.copies/tot)+" %":"–"],["Only a forecast (left out)",tot?Math.round(100*r.forecast/tot)+" %":"–"]].map(([l,v])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <p class="hint">Δ = measured minus Entur's actual time, in seconds, after clock correction. Positive means the event happened later than the realtime data says.</p>`+table("rt",[
    {k:"station",h:"Station"},{k:"n",h:"n",n:1},{k:"median",h:"Median Δ (s)",n:1,f:s1},{k:"meanAbs",h:"Mean |Δ| (s)",n:1,f:s1},{k:"max",h:"Max |Δ| (s)",n:1,f:s1},{k:"copies",h:"= plan",n:1},{k:"forecast",h:"Forecast only",n:1}], r.rows, "meanAbs"); }
  if(S.tab==="doubles") box.innerHTML=`<p class="hint">The same departure measured by two people. The difference between them shows how precise manual timing is.</p>`+table("doubles",[
    {k:"date",h:"Date"},{k:"line",h:"Line"},{k:"journey",h:"Departure"},{k:"who",h:"Measured by"},{k:"n",h:"Shared taps",n:1},{k:"meanAbs",h:"Mean |diff| (s)",n:1,f:s1},{k:"max",h:"Max (s)",n:1,f:s1},{k:"mean",h:"Mean diff (s)",n:1,f:s1}], doubleRows(items));
  if(S.tab==="headway") box.innerHTML=`<p class="hint">Time between departures in the same direction, from platform mode.</p>`+table("headway",[
    {k:"dir",h:"Station → next stop"},{k:"n",h:"n",n:1},{k:"median",h:"Median",n:1,f:mmss},{k:"p10",h:"P10",n:1,f:mmss},{k:"p90",h:"P90",n:1,f:mmss}], headwayRows(items,F), "median");
  box.querySelectorAll("th[data-k]").forEach(th=>th.onclick=()=>{ const id=th.closest("table").dataset.t, k=th.dataset.k, cur=S.sort[id]; S.sort[id]={k, d: cur&&cur.k===k ? -cur.d : -1}; render(); });
}
function roleOptions(){ const roles=[...new Set(S.items.map(x=>x._role||""))].sort(); $("#frole").innerHTML=`<option value="">All</option>`+roles.map(r=>`<option value="${esc(r||"-")}" ${S.F.role===(r||"-")?"selected":""}>${esc(r||"not stated")}</option>`).join(""); }
async function add(files, pasted){
  const {items, bad}=await ingest(files, pasted);
  let added=0, dup=0; for(const x of items){ if(S.items.some(y=>y.id===x.id)){ dup++; continue; } S.items.push(x); added++; }
  await saveSet(S.items); roleOptions(); render();
  $("#msg").textContent=`Added ${added}`+(dup?`, ${dup} already loaded`:"")+(bad?`, ${bad} not readable`:"")+".";
}
function bind(){
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ S.tab=b.dataset.tab; render(); });
  const fi=$("#files"); $("#pick").onclick=()=>fi.click(); fi.onchange=()=>{ const f=[...fi.files]; fi.value=""; if(f.length) add(f,""); };
  $("#addPaste").onclick=()=>{ const v=$("#paste").value; if(v.trim()){ add([],v); $("#paste").value=""; } };
  const dz=document.body;
  dz.addEventListener("dragover",e=>{ e.preventDefault(); document.body.classList.add("drag"); });
  dz.addEventListener("dragleave",e=>{ if(e.target===document.body||!e.relatedTarget) document.body.classList.remove("drag"); });
  dz.addEventListener("drop",e=>{ e.preventDefault(); document.body.classList.remove("drag"); const f=[...e.dataTransfer.files]; if(f.length) add(f,""); });
  [["fline","line"],["fband","band"],["frole","role"],["ffrom","from"],["fto","to"]].forEach(([id,k])=>$("#"+id).onchange=e=>{ S.F[k]=e.target.value; render(); });
  $("#fok").onchange=e=>{ S.F.okOnly=e.target.checked; render(); };
  $("#csvAll").onclick=()=>{ const it=filtered(S.items,S.F); if(!it.length) return; download(new File([toCSV(it)],"banepuls_combined.csv",{type:"text/csv"})); };
  $("#csvTable").onclick=()=>{ if(!S.last) return; const {cols,rows}=S.last, q=v=>{ const s=String(v??""); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
    const out="﻿"+[cols.map(c=>c.h), ...rows.map(r=>cols.map(c=>typeof r[c.k]==="number"?+r[c.k].toFixed(2):r[c.k]))].map(r=>r.map(q).join(",")).join("\r\n");
    download(new File([out],`banepuls_${S.tab}.csv`,{type:"text/csv"})); };
  $("#clear").onclick=()=>{ if(!$("#clear").dataset.sure){ $("#clear").dataset.sure="1"; $("#clear").textContent="Click again to clear"; return; }
    S.items=[]; saveSet([]); delete $("#clear").dataset.sure; $("#clear").textContent="Clear"; roleOptions(); render(); };
}
(async function boot(){ bind(); const it=await loadSet(); if(Array.isArray(it)) S.items=it; roleOptions(); render(); })();
