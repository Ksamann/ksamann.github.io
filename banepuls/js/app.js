/* Banepuls: app shell, Log / Trips / More tabs, and the glue between live data, logging and export. */
import { $, esc, hm, hms, fmt, sgn, store, toast, buzz, t, lang, setLang, dateStr, uid, isoLocal, askPersist, storageOk, APP_VERSION, COLORS, INK } from "./core.js";
import { L, POLL_MS, loadNetwork, loadCalls, departures, fetchJourney, situations, stateAt } from "./entur.js";
import { openTimetable, refresh as refreshTT } from "./timetable.js";
import { rtValue } from "./model.js";
import { createDetector, requestMotion, listen, sensorPrecision } from "./motion.js";
import { V, initLive, build as buildLive, tick as tickLive, setStation, buildPicker, locate, focusTrain } from "./live.js";
import { syncClock, fresh, clockState } from "./clock.js";
import { tripState, stops, segments, totals, quality, compare, summary, platformRows, platformStats, trends, median, off } from "./model.js";
import { toJSON, makeFiles, download, shareFiles, sendForAnalysis, readImport, baseName } from "./export.js";

/* ---------- state ---------- */
try{ const q=new URLSearchParams(location.search).get("submit"); if(q && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) store("bp.addr", q.trim()); }catch(e){}
const A = {
  tab: store("bp.tab")||"now", step:"start", mode: store("bp.mode")||"study",
  items: Array.isArray(store("bp.items")) ? store("bp.items") : [],
  active: store("bp.active"), plat: store("bp.plat"),
  prep:null, manual:null, viewId:null, justFinished:null, noteOpen:false, confirmEnd:false, confirmDel:null, pingFor:null, sits:[], syncing:false
};
if(!["now","log","trips","more"].includes(A.tab)) A.tab="now";
if(A.active){ A.tab="log"; A.step="run"; } else if(A.plat){ A.tab="log"; A.step="platform"; }
try{ const q=new URLSearchParams(location.search); if(q.get("train")){ A.tv={id:q.get("train"), d:q.get("d")||isoLocal(Date.now()).slice(0,10), to:q.get("to")||"", jr:null, err:null, back:null}; A.tab="train"; } }catch(e){}
const content=$("#content"), sheet=$("#sheet");
const saveItems = () => store("bp.items", A.items);
const saveActive = () => store("bp.active", A.active);
const savePlat = () => store("bp.plat", A.plat);
const addr = () => (store("bp.addr")||"").trim();
const isLive = () => A.tab==="now";

/* ---------- shell ---------- */
function setLiveBadge(){
  const el=$("#live"), age=Date.now()-L.lastOk;
  if(!L.lastOk){ el.className="live"+(L.lastErr?" off":""); el.textContent=L.lastErr?t("noData"):t("connecting"); return; }
  if(age<POLL_MS*2.5){ el.className="live"; el.textContent=t("live"); }
  else if(age<5*60e3){ el.className="live stale"; el.textContent=t("minOld",Math.round(age/60e3)||1); }
  else { el.className="live off"; el.textContent=t("offline"); }
}
function renderTabs(){
  document.querySelectorAll("[data-tab]").forEach(b=>{ b.setAttribute("aria-selected",b.dataset.tab===A.tab); b.querySelector("span").textContent=t({now:"tabNow",log:"tabLog",trips:"tabTrips",more:"tabMore"}[b.dataset.tab]); });
  const sub=$("#sub"); sub.hidden = A.tab!=="now";
  sub.innerHTML = [["stn","vStation"],["line","vLine"],["net","vMap"],["sl","vGraph"],["tt","vTable"]].map(([k,s])=>`<button data-view="${k}" aria-pressed="${V.view===k}">${t(s)}</button>`).join("");
  $("#title").textContent = (A.tab==="now"||A.tab==="train") ? "Banepuls" : t({log:"tabLog",trips:"tripsTitle",more:"moreTitle"}[A.tab]);
}
function draw(){
  clearInterval(draw.tick); sheet.hidden=true;
  document.documentElement.lang = lang==="no"?"no":"en";
  renderTabs();
  content.classList.toggle("full", A.tab==="now" && V.view==="net");
  wantWake(A.tab==="log" && (A.step==="run"||A.step==="platform"));
  if(A.tab==="train") return drawDeparture();
  if(A.tab==="now"){ if(!L.NET) return netWait(); if(V.view==="tt") return openTimetable(content, {openDep:(id,d)=>openDep(id,d,"")}); buildLive(); return; }
  document.documentElement.style.setProperty("--c", COLORS[(A.active&&A.active.line)||V.line]||COLORS["5"]);
  ({log:drawLog, trips:drawTrips, more:drawMore})[A.tab]();
}
function netWait(){
  content.innerHTML = L.lastErr ? `<div class="msg"><b>${t("netFail")}</b><button class="btn" id="retry">${t("retry")}</button></div>` : `<div class="msg">${t("connecting")} …</div>`;
  const r=$("#retry"); if(r) r.onclick=boot;
}
function go(tab, step){ A.tab=tab; if(step) A.step=step; store("bp.tab",tab); A.confirmDel=null; A.noteOpen=false; A.confirmEnd=false; draw(); content.scrollTop=0; }
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{
  const tab=b.dataset.tab;
  if(tab==="log" && !A.active && !A.plat && !["prep","manual"].includes(A.step)) A.step="start";
  if(tab==="log" && A.active) A.step="run"; else if(tab==="log" && A.plat) A.step="platform";
  go(tab);
});
$("#sub").addEventListener("click",e=>{ const b=e.target.closest("[data-view]"); if(!b) return; V.view=b.dataset.view; store("bp.view",V.view); draw(); content.scrollTop=0; });

/* ---------- live hooks ---------- */
initLive(content, sheet, {
  active: isLive,
  onView: ()=>draw(),
  onLog: (j, station)=>{ if(A.active){ go("log","run"); return; } startPrep(j, station); },
  onPing: (j, station)=>doPing(j, station),
  onShare: j=>shareTrain(j.id, j.date, "", j.line, j.dest),
  onDetails: (id, date)=>openDep(id, date, ""),
  banner: name=>sitBanner([...(L.LINESAT[name]||[])])
});

/* ---------- service messages ---------- */
function sitBanner(lines){
  const list=A.sits.filter(s=>s.lines.some(l=>lines.includes(l))); if(!list.length) return "";
  return `<div class="alert"><span aria-hidden="true">⚠</span><div>${list.slice(0,3).map(s=>`<p><b>${s.lines.map(l=>`<span class="lb" style="background:${COLORS[l]};color:${INK[l]}">${l}</span>`).join("")} ${esc((lang==="en"&&s.summaryEn)||s.summary)}</b>${esc(((lang==="en"&&s.descriptionEn)||s.description||"").slice(0,220))}</p>`).join("")}</div></div>`;
}
async function loadSits(){ try{ A.sits=await situations(); }catch(e){} }

/* =====================================================================
   LOG TAB
   ===================================================================== */
function drawLog(){
  if(A.step==="run" && A.active) return drawRun();
  if(A.step==="platform" && A.plat) return drawPlatform();
  if(A.step==="prep" && A.prep) return drawPrep();
  if(A.step==="manual") return drawManual();
  if(A.step==="result" && viewItem()) return drawResult();
  A.step="start"; drawStart();
}
const modeCard=(k,icon,title,desc)=>`<button class="mode" data-mode="${k}" aria-pressed="${A.mode===k}"><i>${icon}</i><div><b>${t(title)}</b><span>${t(desc)}</span></div></button>`;
function drawStart(){
  const stn=V.stn && L.IDSOF && L.IDSOF[V.stn] ? V.stn : null;
  content.innerHTML=`<section class="screen">
    <div class="modes">${modeCard("study","⏱","modeStudy","modeStudyD")}${modeCard("platform","▤","modePlatform","modePlatformD")}${modeCard("ping","✓","modePing","modePingD")}</div>
    <div class="row2"><span class="label">${stn?t("fromStation",esc(stn)):t("pickStation")}</span><button class="linkbtn" id="chs">${stn?t("changeStation"):t("pickStation")}</button></div>
    <div id="deps"></div>
    ${A.mode==="study"?`<p class="hint">${t("manual")}</p><button class="btn" id="man">${t("manualBtn")}</button>`:""}
  </section>`;
  content.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ A.mode=b.dataset.mode; store("bp.mode",A.mode); draw(); });
  $("#chs").onclick=()=>pickStationInto($("#deps"));
  const man=$("#man"); if(man) man.onclick=()=>{ A.manual={line:V.line, dir:0, start:0, end:null}; go("log","manual"); };
  if(!L.NET){ $("#deps").innerHTML=`<p class="hint">${t("connecting")} …</p>`; return; }
  if(!stn){ pickStationInto($("#deps")); return; }
  const fill=()=>{ const box=$("#deps"); if(!box || box.dataset.picking) return;
    if(A.mode==="platform"){ box.innerHTML=`${sitBanner([...(L.LINESAT[stn]||[])])}<button class="cta" id="startP">${t("modePlatform")} · ${esc(stn)}</button><p class="hint" style="margin-top:8px">${t("platformHint")}</p>`;
      $("#startP").onclick=()=>startPlatform(stn); return; }
    const deps=departures(stn,Date.now()).slice(0,10);
    box.innerHTML=`${sitBanner([...(L.LINESAT[stn]||[])])}<span class="label">${A.mode==="ping"?t("pingPick"):t("pickTrain")}</span>
      ${deps.length?`<div class="list">${deps.map(d=>{ const m=Math.max(0,Math.floor((d.when-Date.now())/60e3));
        return `<button class="dep pick" data-j="${esc(d.j.id)}"><span class="badge" style="background:${COLORS[d.j.line]};color:${INK[d.j.line]}">${esc(d.j.line)}</span><span class="t"><b>${esc(d.j.dest||"")}</b><small>${t("nextStop",esc(d.next))} · ${hm(d.when)}${d.delay>=60?` · <span class="lt">+${Math.round(d.delay/60)} min</span>`:""}</small></span><span class="m num">${m<1?t("now"):m}<small>${m<1?"":t("min")}</small></span></button>`; }).join("")}</div>`
      :`<p class="none">${t("noDeps")}</p>`}`;
    box.querySelectorAll("[data-j]").forEach(b=>b.onclick=()=>{ const j=L.JOURNEYS.find(x=>x.id===b.dataset.j); if(!j) return; if(A.mode==="ping") doPing(j,stn); else startPrep(j,stn); });
  };
  fill(); draw.tick=setInterval(fill, 15000);
}
function pickStationInto(box){
  if(!L.NET) return;
  box.dataset.picking="1"; buildPicker(box);
  box.onclick=async e=>{
    const ps=e.target.closest("[data-stn]"); if(ps){ setStation(ps.dataset.stn); box.onclick=null; draw(); return; }
    const lc=e.target.closest("#loc"); if(lc){ lc.textContent=t("locating"); try{ V.near=await locate(); if(V.near[0]){ setStation(V.near[0].name); box.onclick=null; draw(); } }catch(err){ lc.textContent=t("locFail"); } }
  };
}

/* ---------- prep: the chosen departure ---------- */
async function startPrep(j, station){
  A.prep={ j:{id:j.id, date:j.date, line:j.line, dest:j.dest}, station, jr:null, err:null, endIdx:null, note:"" };
  go("log","prep");
  if(!fresh()) runSync();
  try{
    const jr=await fetchJourney(j.id, j.date), calls=jr.calls.filter(c=>!c.cancel);
    const now=Date.now(), cand=calls.map((c,i)=>({c,i})).filter(x=>x.c.name===station && x.i<calls.length-1);
    const pickIx=(cand.find(x=>(x.c.eDep??x.c.aDep??0)>=now-3*60e3)||cand[0]||{i:0}).i;
    A.prep.jr={...jr, calls}; A.prep.startIdx=pickIx; A.prep.endIdx=calls.length-1;
  }catch(e){ A.prep.err=e.message; }
  if(A.tab==="log" && A.step==="prep") draw();
}
async function runSync(){
  if(A.syncing) return; A.syncing=true; if(A.tab==="log"||A.tab==="more") draw();
  try{ const c=await syncClock(); if(c){ if(A.active && !A.active.clock){ A.active.clock=c; saveActive(); } if(A.plat && !A.plat.clock){ A.plat.clock=c; savePlat(); } } }catch(e){}
  A.syncing=false; if(A.tab==="log"||A.tab==="more") draw();
}
function clockLine(){
  const c=fresh();
  if(A.syncing) return `<div class="sync"><i class="busy"></i>${t("clockSyncing")}</div>`;
  return c ? `<div class="sync"><i></i>${t("clockSynced",c.offset,Math.max(c.err,50))}</div>` : `<div class="sync"><i class="off"></i>${t("clockNone")} <button class="linkbtn" id="sync">${t("syncNow")}</button></div>`;
}
function drawPrep(){
  const P=A.prep, jr=P.jr;
  const calls=jr?jr.calls:null, s=calls?calls[P.startIdx]:null;
  content.innerHTML=`<section class="screen">
    <div class="bar"><button class="iconbtn" id="back" aria-label="Back">←</button><h1>${t("chosenTrain")}</h1></div>
    <div class="match"><span class="badge" style="background:${COLORS[P.j.line]};color:${INK[P.j.line]}">${esc(P.j.line)}</span>
      <div><b>${esc(P.j.dest||"")}</b><div class="hint">${s?`${t("fromStation",esc(s.name))} · ${t("plannedDep")} ${hm(s.aDep??s.aArr)} · ${t("realtimeDep")} ${hms(s.xDep??s.eDep??s.aDep)}`:P.err?esc(t("journeyFail")):t("loadingJourney")}</div></div></div>
    ${calls?`<div class="field"><label class="label" for="endsel">${t("endAt")}</label><select id="endsel">${calls.map((c,i)=>i>P.startIdx?`<option value="${i}" ${i===P.endIdx?"selected":""}>${esc(c.name)} · ${hm(c.aArr??c.aDep)}</option>`:"").join("")}</select></div>`:""}
    <div class="field"><label class="label" for="pnote">${t("noteOpt")}</label><input id="pnote" value="${esc(P.note)}" autocomplete="off"></div>
    ${clockLine()}
    <div class="dock"><button class="cta" id="go" ${calls||P.err?"":"disabled"}>${t("startStudy")}</button></div>
  </section>`;
  $("#back").onclick=()=>{ A.prep=null; go("log","start"); };
  const es=$("#endsel"); if(es) es.onchange=()=>P.endIdx=+es.value;
  $("#pnote").oninput=e=>P.note=e.target.value;
  const sy=$("#sync"); if(sy) sy.onclick=runSync;
  $("#go").onclick=()=>{
    if(!calls){ // journey couldn't be fetched: fall back to the line's station list
      const Ln=L.NET.lines[P.j.line]; const j=L.JOURNEYS.find(x=>x.id===P.j.id);
      const route = j && j.dir===1 ? Ln.stations.slice().reverse() : Ln.stations.slice();
      const si=Math.max(0,route.findIndex(r=>r.name===P.station));
      return startStudy({line:P.j.line, dest:P.j.dest, journey:{id:P.j.id,date:P.j.date}, route, startIdx:Math.min(si,route.length-2), endIdx:route.length-1, rt:null, note:P.note});
    }
    startStudy({line:P.j.line, dest:P.j.dest, journey:{id:P.j.id,date:P.j.date}, route:calls.map(c=>({id:c.id,name:c.name})), startIdx:P.startIdx, endIdx:P.endIdx,
      rt:{fetchedAt:jr.fetchedAt, calls:calls.map(rtCall)}, note:P.note});
  };
}
const rtCall = c => ({aArr:c.aArr, aDep:c.aDep, eArr:c.eArr, eDep:c.eDep, xArr:c.xArr, xDep:c.xDep});

/* ---------- manual setup (no signal / no realtime) ---------- */
function drawManual(){
  const M=A.manual, Ln=L.NET&&L.NET.lines[M.line];
  if(!Ln){ content.innerHTML=`<div class="msg">${t("connecting")} …</div>`; return; }
  const st=M.dir===0?Ln.stations:Ln.stations.slice().reverse(); if(M.end==null||M.end<=M.start) M.end=st.length-1;
  content.innerHTML=`<section class="screen">
    <div class="bar"><button class="iconbtn" id="back" aria-label="Back">←</button><h1>${t("manualTitle")}</h1></div>
    <div class="field"><span class="label">${t("line")}</span><div class="lines">${Object.keys(COLORS).filter(k=>L.NET.lines[k]).map(k=>`<button style="--c:${COLORS[k]};--k:${INK[k]}" aria-pressed="${k===M.line}" data-ml="${k}">${k}</button>`).join("")}</div></div>
    <div class="field"><span class="label">${t("direction")}</span><div class="seg">${[0,1].map(d=>{ const s=d===0?Ln.stations:Ln.stations.slice().reverse(); return `<button aria-pressed="${M.dir===d}" data-md="${d}"><small>${t("towards")}</small>${esc(s[s.length-1].name)}</button>`; }).join("")}</div></div>
    <div class="grid2"><div class="field"><label class="label" for="ms">${t("startStn")}</label><select id="ms">${st.slice(0,-1).map((s,i)=>`<option value="${i}" ${i===M.start?"selected":""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label class="label" for="me">${t("endStn")}</label><select id="me">${st.map((s,i)=>i>M.start?`<option value="${i}" ${i===M.end?"selected":""}>${esc(s.name)}</option>`:"").join("")}</select></div></div>
    ${clockLine()}
    <div class="dock"><button class="cta" id="go">${t("startStudy")}</button></div>
  </section>`;
  $("#back").onclick=()=>go("log","start");
  content.querySelectorAll("[data-ml]").forEach(b=>b.onclick=()=>{ M.line=b.dataset.ml; M.dir=0; M.start=0; M.end=null; draw(); });
  content.querySelectorAll("[data-md]").forEach(b=>b.onclick=()=>{ M.dir=+b.dataset.md; M.start=0; M.end=null; draw(); });
  $("#ms").onchange=e=>{ M.start=+e.target.value; if(M.end<=M.start) M.end=null; draw(); };
  $("#me").onchange=e=>M.end=+e.target.value;
  const sy=$("#sync"); if(sy) sy.onclick=runSync;
  $("#go").onclick=()=>startStudy({line:M.line, dest:st[st.length-1].name, journey:null, route:st.map(s=>({id:s.id,name:s.name})), startIdx:M.start, endIdx:M.end, rt:null, note:""});
}

/* ---------- time study ---------- */
function startStudy(o){
  A.active={ id:uid("S"), kind:"study", v:3, ...o, events:[], notes:{}, undos:0, clock:fresh(), startedAt:Date.now(), endedAt:null, endedBy:null };
  A.prep=null; saveActive(); askPersist(); startSensor(); go("log","run"); pollJourney();
}
let lastPress=0, lastPointer=0;
function press(e){
  const wall=Date.now(); if(wall-lastPress<400) return; lastPress=wall;     // ignore accidental double taps
  const lag = e && e.timeStamp>0 ? Math.min(1000, Math.max(0, performance.now()-e.timeStamp)) : 0;
  addEvent(Math.round(wall-lag), "manual");
}
function addEvent(now, source){
  const trip=A.active, st=tripState(trip), last=trip.events[trip.events.length-1];
  if(last && now<=last.t) return;
  const ev={type:st.mode, idx:st.idx, t:now, ts:isoLocal(now+off(trip))}; if(source==="sensor") ev.source="sensor";
  trip.events.push(ev); if(SENS) SENS.sugg=null; saveActive(); buzz(); A.noteOpen=false;
  if(st.mode==="arr" && st.idx===trip.endIdx){ toast(t("arrivedEnd",trip.route[st.idx].name)); return finishStudy("auto"); }
  draw();
}

/* ---------- sensor assistance (beta) ---------- */
let SENS=null;
const sensorOn = () => store("bp.sensor")===true;
async function startSensor(){
  if(!sensorOn() || !A.active || SENS) return;
  const ok=await requestMotion(); if(!ok){ A.sensorDenied=true; if(A.tab==="log") draw(); return; }
  const trip=A.active; trip.sensor=trip.sensor||{events:[]}; A.sensorDenied=false;
  const det=createDetector(ev=>onSensor(ev), {keepRaw: store("bp.sensorRaw")===true});
  SENS={det, lis:listen(det), sugg:null};
  if(A.tab==="log") draw();
}
function stopSensor(trip){ if(!SENS) return; SENS.lis.stop(); if(trip && SENS.det.raw.length){ trip.sensor=trip.sensor||{events:[]}; trip.sensor.raw=(trip.sensor.raw||[]).concat(SENS.det.raw); } SENS=null; }
function onSensor(ev){
  const trip=A.active; if(!trip || !SENS) return;
  trip.sensor.events.push(ev);
  const st=tripState(trip), last=trip.events[trip.events.length-1];
  if(ev.type===st.mode && (!last || ev.t>last.t+1500)) SENS.sugg=ev;
  saveActive(); if(A.tab==="log" && A.step==="run" && !A.noteOpen && !A.confirmEnd) draw();
}
function sensorLine(){
  if(!sensorOn()) return "";
  if(!SENS) return `<div class="sens"><i class="off"></i>${t("sensorOn")}: ${A.sensorDenied?t("sensorOff"):""} <button class="linkbtn" id="senson">${t("sensorEnable")}</button></div>`;
  const sg=SENS.sugg;
  return `<div class="sens"><i id="sdot"></i>${t("sensorOn")}: <span id="sstate">${t("sensorWait")}</span>${sg?`<span class="sugg">${esc(t("sensorSuggest", sg.type==="dep"?t("sensorDep"):t("sensorArr"), hms(sg.t+off(A.active))))}<button class="mini log" id="suse">${t("use")}</button></span>`:""}</div>`;
}

/* ---------- share a train ---------- */
function shareUrl(id,date,to){ const u=new URL("./", location.href); u.search=""; u.hash=""; u.searchParams.set("train",id); u.searchParams.set("d",date); if(to) u.searchParams.set("to",to); return u.href; }
async function shareTrain(id, date, to, line, dest){
  const url=shareUrl(id,date,to), text=t("shareText",line,dest||"",to);
  try{ if(navigator.share){ await navigator.share({title:"Banepuls", text, url}); return; } }catch(e){ if(e && e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(url); toast(t("linkCopied")); }catch(e){ toast(url); }
}
async function loadTv(){
  clearTimeout(loadTv.t); const tv=A.tv; if(!tv) return;
  try{ tv.jr=await fetchJourney(tv.id, tv.d); tv.err=null; }catch(e){ tv.err=e.message; }
  if(A.tab==="train") drawDeparture();
  loadTv.t=setTimeout(loadTv, POLL_MS);
}
function openDep(id, date, to){
  clearTimeout(loadTv.t); loadTv.t=null;
  A.tv={id, d:date||isoLocal(Date.now()).slice(0,10), to:to||"", jr:null, err:null, back:A.tab==="train"?(A.tv&&A.tv.back):A.tab};
  A.tab="train"; draw(); content.scrollTop=0; loadTv();
}
function closeDep(){
  clearTimeout(loadTv.t); loadTv.t=null; const back=A.tv&&A.tv.back; A.tv=null;
  try{ if(location.search) history.replaceState(null,"",location.pathname); }catch(e){}
  if(back) go(back, back==="log"&&A.active?"run":undefined); else go(A.active?"log":"now", A.active?"run":undefined);
}
const ttCls = d => d==null ? "" : Math.abs(d)<60 ? "" : Math.abs(d)<180 ? "late" : "bad";
function drawDeparture(){
  clearInterval(draw.tick);
  const tv=A.tv; if(!tv){ A.tab="now"; return draw(); }
  const backBtn = `<button class="iconbtn" id="tvback" aria-label="${t("back")}">${tv.back?"←":t("openApp")}</button>`;
  if(!tv.jr){ content.innerHTML=`<section class="screen"><div class="bar">${backBtn}</div><div class="msg">${tv.err?`<b>${t("trainFail")}</b>`:t("trainLoading")}</div></section>`; $("#tvback").onclick=closeDep; if(!tv.err && !loadTv.t) loadTv(); return; }
  const jr=tv.jr, calls=jr.calls, now=Date.now();
  const j={calls:calls.map((c,i)=>({ix:i, p:i, arr:c.xArr??c.eArr, dep:c.xDep??c.eDep, aArr:c.aArr, aDep:c.aDep, cancel:c.cancel}))};
  const s=stateAt(j,now), pos=s?Math.floor(s.pos):(now<(j.calls[0].dep||0)?0:calls.length-1);
  const ended=!s && now>(j.calls[0].dep||0), allCx=calls.every(c=>c.cancel);
  let toIx=-1; if(tv.to){ toIx=calls.findIndex((c,i)=>c.name===tv.to && i>=Math.min(pos,calls.length-1)); if(toIx<0) toIx=calls.findIndex(c=>c.name===tv.to); }
  const status = allCx ? t("cancelled") : s ? (s.wait ? t("waitingFrom",esc(calls[Math.round(s.pos)].name)) : s.at ? t("standingAt",esc(calls[Math.round(s.pos)].name)) : t("between",esc(calls[Math.floor(s.pos)].name),esc(calls[Math.ceil(s.pos)].name)))
    : ended ? t("trainDone") : t("waitingFrom",esc(calls[0].name));
  const dl = s ? (s.delay<60 ? t("onTime") : `+${Math.round(s.delay/60)} min`) : "";
  let arrive="";
  if(toIx>=0){ const c=calls[toIx], at=c.xArr??c.eArr??c.aArr, done=(c.xArr!=null && c.xArr<=now) || (at!=null && now>at+60e3 && (ended || pos>=toIx));
    arrive=`<div class="arrive"><span class="label">${done?t("arrivedAt",esc(c.name)):t("arrivesAt",esc(c.name))}</span><b class="num">${done?hms(c.xArr??at):`${hm(at)}`}</b>${!done&&c.aArr&&Math.abs(at-c.aArr)>=60e3?`<s class="num">${hm(c.aArr)}</s>`:""}</div>`; }
  const sign=(calls[Math.min(Math.max(pos,0),calls.length-1)]||{}).dest||jr.dest||calls[calls.length-1].name;
  const states=new Set(calls.map(c=>c.state)), inacc=calls.some(c=>c.inaccurate), occ=calls.map(c=>c.occ).find(o=>o&&o!=="noData");
  const rtLabel = inacc ? t("rtInaccurate") : (states.has("updated")||calls.some(c=>c.xDep||c.xArr)) ? t("rtLive") : t("rtPlanOnly");
  const first=calls[0], last=calls[calls.length-1];
  const fact=(k,v)=>v?`<div><span>${k}</span><b>${esc(v)}</b></div>`:"";
  const msgs=[...jr.situations.map(x=>(lang==="en"&&x.en)||x.no||x.en), ...jr.notices, ...calls.flatMap(c=>c.situations.map(x=>`${c.name}: ${(lang==="en"&&x.en)||x.no||x.en}`)), ...calls.flatMap(c=>c.notices.map(n=>`${c.name}: ${n}`))].filter(Boolean);
  const curIx = s ? (s.at?Math.round(s.pos):Math.ceil(s.pos)) : (ended?calls.length:0);
  const rows=calls.map((c,i)=>{
    const planT=c.aDep??c.aArr, rv=rtValue(c, c.aDep!=null?"dep":"arr"), rtT=rv&&rv.v, d=rtT!=null&&planT!=null?(rtT-planT)/1000:null;
    const cls=[i<curIx?"past":"", i===curIx?"cur":"", i===toIx?"to":"", c.cancel?"cx":""].join(" ");
    const plat=[c.quay?`${t("platform")} ${c.quay}`:"", c.quayDesc].filter(Boolean).join(" · ");
    const restr=!c.board&&c.alight?t("onlyAlight"):c.board&&!c.alight&&i>0?t("onlyBoard"):"";
    return `<tr class="${cls}"><td>${esc(c.name)}<small>${esc(plat)}${restr?` · <span class="warn">${restr}</span>`:""}${c.cancel?` · <span class="bd">${t("cancelled")}</span>`:""}</small></td>
      <td class="p">${planT!=null?hm(planT):"–"}</td><td class="r ${rv&&!rv.actual?"exp":""}">${rtT!=null?(rv.copy?"≈ ":"")+hms(rtT)+(rv.actual&&!rv.copy?" ✓":""):"–"}</td><td class="d ${ttCls(d)}">${d==null?"–":(Math.abs(d)<30?"0":sgn(Math.round(d/60))+" min")}</td></tr>`; }).join("");
  const live=L.JOURNEYS.find(x=>x.id===jr.id), myStn=V.stn, myIx=live?calls.findIndex((c,i)=>i>=curIx && c.name===myStn && i<calls.length-1):-1;
  content.innerHTML=`<section class="screen">
    <div class="bar">${backBtn}<span class="badge" style="background:${COLORS[jr.line]};color:${INK[jr.line]}">${esc(jr.line)}</span><h1>${t("towards")} ${esc(sign)}<small>${status}${dl?` · ${dl}`:""}</small></h1></div>
    ${arrive}
    <div class="facts">${fact(t("depNo"),jr.code)}${fact(t("date"),jr.date?dateStr(Date.parse(jr.date+"T12:00:00")):"")}${fact(t("planned"),first?`${hm(first.aDep??first.aArr)} ${first.name} → ${hm(last.aArr??last.aDep)} ${last.name}`:"")}${fact(t("lineName"),jr.lineName)}${fact(t("pattern"),jr.pattern)}${fact(t("operator"),jr.operator)}${fact(t("rtStatus"),rtLabel)}${occ?fact(t("occupancy"),occ):""}</div>
    ${msgs.length?`<div class="alert"><span aria-hidden="true">⚠</span><div>${msgs.slice(0,4).map(m=>`<p>${esc(m)}</p>`).join("")}</div></div>`:""}
    <div class="tblwrap"><table class="tri dept"><thead><tr><th>${t("colStation")}</th><th>${t("colPlan")}</th><th>${t("colRt")}</th><th>${t("delay")}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="btnrow">${myIx>=0&&!A.active?`<button class="btn primary" id="tvlog">${t("logFrom",esc(myStn))}</button>`:""}<button class="btn" id="tvshare">↗ ${t("shareTrain")}</button>${live?`<button class="btn" id="tvline">${t("showOnLine")}</button><button class="btn" id="tvmap">${t("showOnMap")}</button>`:""}</div>
    <p class="hint">${t("deltaHelp2")} · Entur ${hms(jr.fetchedAt)}</p>
  </section>`;
  $("#tvback").onclick=closeDep;
  $("#tvshare").onclick=()=>shareTrain(tv.id, tv.d, tv.to, jr.line, sign);
  const tl=$("#tvlog"); if(tl) tl.onclick=()=>{ const lj=L.JOURNEYS.find(x=>x.id===jr.id); if(lj){ A.tv=null; startPrep(lj, myStn); } };
  const tln=$("#tvline"); if(tln) tln.onclick=()=>{ V.view="line"; V.line=jr.line; store("bp.view","line"); store("bp.line",jr.line); const id=jr.id; A.tv=null; go("now"); V.sel=id; tickLive(); };
  const tmp=$("#tvmap"); if(tmp) tmp.onclick=()=>{ V.view="net"; store("bp.view","net"); const id=jr.id; A.tv=null; go("now"); V.sel=id; focusTrain(id); tickLive(); };
  draw.tick=setInterval(()=>{ if(A.tab==="train" && !document.hidden) drawDeparture(); }, 10000);
}
function drawRun(){
  const trip=A.active, r=trip.route, st=tripState(trip), calls=trip.rt&&trip.rt.calls;
  const pos=(st.mode==="dep"?st.idx:st.from)-trip.startIdx+1, total=trip.endIdx-trip.startIdx+1, noteIdx=st.mode==="dep"?st.idx:st.from;
  const c=calls&&calls[st.idx], exp = c ? (st.mode==="dep" ? (c.xDep??c.eDep??c.aDep) : (c.xArr??c.eArr??c.aArr)) : null;
  const rows=compare(trip).reverse();
  content.innerHTML=`<section class="run">
    <div class="panel">
      <div class="bar"><span class="badge" style="background:${COLORS[trip.line]};color:${INK[trip.line]}">${esc(trip.line)}</span><h1>${t("towards")} ${esc(r[trip.endIdx].name)}${trip.journey?`<small>${t("journeyId")} ${hm(calls&&calls[trip.startIdx]?(calls[trip.startIdx].aDep??0):trip.startedAt)} · ${esc(r[trip.startIdx].name)}</small>`:""}</h1>${trip.journey?`<button class="iconbtn" id="shr" aria-label="${t("shareTrain")}">↗</button>`:""}<button class="iconbtn" id="end">${t("finish")}</button></div>
      ${A.confirmEnd?`<div class="confirm"><b>${t("finishQ")}</b><span class="hint">${t("finishHint")}</span><div class="btnrow"><button class="btn" id="no">${t("keepLogging")}</button><button class="btn primary" id="yes">${t("finishTrip")}</button></div></div>`:""}
      <div class="now"><div class="where"><span class="label">${st.mode==="dep"?(st.since?t("at"):t("readyAt")):t("nextL")}</span><b>${esc(r[st.idx].name)}</b></div>
        <span class="timer num" id="timer">${st.since?"0:00<span class=\"ds\">.0</span>":"–:––"}</span>
        <span class="what">${st.since?(st.mode==="dep"?t("dwell"):t("run")):t("waiting")}${exp?`<br>${t("rtExpect",st.mode==="dep"?t("rtDep"):t("rtArr"),hms(exp))}`:""}</span></div>
      <button class="big ${st.mode}" id="press"><span class="verb">${st.mode==="dep"?t("depart"):t("arrive")}</span><span class="sub">${st.mode==="dep"?t("from"):t("toAt")} ${esc(r[st.idx].name)}</span></button>
      <div class="tools"><button class="tool" id="undo" ${trip.events.length?"":"disabled"}>${t("undo")}</button><span class="progress num">${t("progress",pos,total)}${trip.clock?` · ⏱ ±${(Math.max(trip.clock.err,50)/1000).toFixed(1)} s`:""}</span><button class="tool" id="note">${t("note")}</button></div>
      ${sensorLine()}
      ${A.noteOpen?`<div class="notebox"><label class="label" for="nt">${esc(t("noteFor",r[noteIdx].name))}</label><textarea id="nt">${esc(trip.notes[noteIdx]||"")}</textarea><div class="btnrow"><button class="btn" id="ntc">${t("cancel")}</button><button class="btn primary" id="nts">${t("saveNote")}</button></div></div>`:""}
    </div>
    ${rows.length?`<div class="tblwrap"><table class="tri"><thead><tr><th>${t("colStation")}</th><th>${t("colPlan")}</th><th>${t("colRt")}</th><th>${t("colMe")}</th><th>${t("colD")}</th></tr></thead><tbody>${rows.map(triRow).join("")}</tbody></table></div>
      <p class="hint pad">${t("deltaHelp")}</p>`:`<p class="hint pad">${t("emptyLog")}</p>`}
  </section>`;
  const pb=$("#press");
  pb.onpointerdown=e=>{ if(!e.isPrimary || e.button!==0) return; e.preventDefault(); lastPointer=Date.now(); press(e); };
  pb.onclick=e=>{ if(e.detail>0 && Date.now()-lastPointer<3000) return; press(null); };
  $("#undo").onclick=()=>{ trip.events.pop(); trip.undos=(trip.undos||0)+1; saveActive(); toast(t("undone")); draw(); };
  $("#note").onclick=()=>{ A.noteOpen=!A.noteOpen; draw(); if(A.noteOpen) $("#nt").focus(); };
  if(A.noteOpen){ $("#ntc").onclick=()=>{ A.noteOpen=false; draw(); };
    $("#nts").onclick=()=>{ const v=$("#nt").value.trim(); if(v) trip.notes[noteIdx]=v; else delete trip.notes[noteIdx]; saveActive(); A.noteOpen=false; toast(t("noteSaved")); draw(); }; }
  $("#end").onclick=()=>{ A.confirmEnd=true; draw(); };
  if(A.confirmEnd){ $("#no").onclick=()=>{ A.confirmEnd=false; draw(); }; $("#yes").onclick=()=>finishStudy("manual"); }
  const sh=$("#shr"); if(sh) sh.onclick=()=>shareTrain(trip.journey.id, trip.journey.date, r[trip.endIdx].name, trip.line, trip.dest);
  const so=$("#senson"); if(so) so.onclick=()=>startSensor();
  const su=$("#suse"); if(su) su.onclick=()=>{ const sg=SENS&&SENS.sugg; if(sg) addEvent(sg.t,"sensor"); };
  const upd=()=>{ const ss=$("#sstate"); if(ss&&SENS){ const k=SENS.det.state; ss.textContent=k==="still"?t("sensorStill"):k==="moving"?t("sensorMoving"):t("sensorWait"); const d=$("#sdot"); if(d) d.className=k; }
    if(!st.since) return; const s=fmt(Date.now()-st.since), el=$("#timer"); if(el) el.innerHTML=s.slice(0,-2)+`<span class="ds">${s.slice(-2)}</span>`; };
  upd(); draw.tick=setInterval(upd,100);
}
function triRow(r){
  const rv=r.rt, d=r.delta;
  return `<tr><td>${esc(r.station)}<small>${r.kind==="arr"?t("arrS"):t("depS")}</small></td><td class="p">${r.plan!=null?hm(r.plan):"–"}</td>
    <td class="r ${rv&&!rv.actual?"exp":""}">${rv&&rv.v!=null?(rv.copy?"≈ ":"")+hms(rv.v):"–"}</td><td class="m">${hms(r.me)}</td>
    <td class="d ${d>0?"pos":d<0?"neg":""}">${d==null?"–":sgn(d,1)+" s"}</td></tr>`;
}
function finishStudy(how){
  const trip=A.active; trip.endedAt=Date.now(); trip.endedBy=how; stopSensor(trip);
  A.items=[trip, ...A.items.filter(x=>x.id!==trip.id)]; saveItems();
  A.active=null; saveActive(); A.viewId=trip.id; A.justFinished=trip.id; A.confirmEnd=false;
  go("log","result"); finalRealtime(trip.id);
}
function resumeStudy(id){
  const trip=A.items.find(x=>x.id===id); if(!trip) return;
  trip.endedAt=null; trip.endedBy=null; A.active=trip; A.items=A.items.filter(x=>x.id!==id); saveItems(); saveActive();
  A.justFinished=null; toast(t("resumed")); go("log","run");
}

/* realtime for the departure: polled during the trip, and fetched again just after it */
function mergeRt(trip, jr){
  const calls=jr.calls.filter(c=>!c.cancel);
  if(!trip.route.every((r,i)=>calls[i] && (!r.id || calls[i].id===r.id))) return false;   // the journey changed shape: keep what we have
  const old=trip.rt&&trip.rt.calls||[];
  trip.rt={fetchedAt:jr.fetchedAt, calls:calls.map((c,i)=>{ const n=rtCall(c), o=old[i]||{}; if(n.xArr==null&&o.xArr!=null) n.xArr=o.xArr; if(n.xDep==null&&o.xDep!=null) n.xDep=o.xDep; return n; })};
  return true;
}
async function pollJourney(){
  clearTimeout(pollJourney.t);
  const trip=A.active; if(!trip || !trip.journey) return;
  if(document.visibilityState==="visible"){
    try{ const jr=await fetchJourney(trip.journey.id, trip.journey.date); if(A.active===trip && mergeRt(trip,jr)){ saveActive(); if(A.tab==="log"&&A.step==="run"&&!A.noteOpen&&!A.confirmEnd) draw(); } }catch(e){}
  }
  pollJourney.t=setTimeout(pollJourney, POLL_MS);
}
async function finalRealtime(id, attempt=0){
  const trip=A.items.find(x=>x.id===id); if(!trip || !trip.journey) return;
  if(Date.now()-trip.endedAt > 70*60e3){ trip.rtFinal="late"; saveItems(); return; }
  try{ const jr=await fetchJourney(trip.journey.id, trip.journey.date); if(mergeRt(trip,jr)){ trip.rtFinal=Date.now(); saveItems(); if(A.tab==="log"&&A.step==="result"&&A.viewId===id) draw(); } }catch(e){}
  if(attempt<3) setTimeout(()=>finalRealtime(id, attempt+1), [60e3,180e3,600e3][attempt]);
}

/* ---------- result ---------- */
function viewItem(){ return A.items.find(x=>x.id===A.viewId); }
function drawResult(){
  const x=viewItem();
  if(x.kind==="platform") return drawPlatformResult(x);
  if(x.kind==="ping") return drawPingResult(x);
  const s=summary(x), tt=totals(x), sg=segments(x), q=quality(x), to=addr();
  const kp=(v,lbl)=>`<div class="kpi"><b class="num">${v}</b><span>${lbl}</span></div>`;
  const finds=[];
  if(!x.rt) finds.push(t("fNoRt"));
  else { if(s.n) finds.push(s.max<=5 ? t("fGood",Math.max(1,Math.round(s.max))) : t("fBad",Math.round(s.max),esc(s.maxAt)));
    if(s.vsPlan!=null && Math.abs(s.vsPlan)>=30e3) finds.push(s.vsPlan>0 ? t("fPlusPlan",(s.vsPlan/60e3).toFixed(1).replace(".",lang==="no"?",":"."), s.worstLeg&&s.worstLeg.loss>20e3?esc(`${s.worstLeg.from}–${s.worstLeg.to}`):"") : t("fMinusPlan",(-s.vsPlan/60e3).toFixed(1).replace(".",lang==="no"?",":".")));
    if(s.copies) finds.push(t("fCopies",s.copies)); }
  const sp=sensorPrecision(x); if(sp && sp.matched) finds.push(t("sensorStats",sp.medianAbs.toFixed(1),sp.matched,sp.maxAbs.toFixed(1),sp.missed));
  const rtState = !x.journey ? "" : x.rtFinal==="late" ? t("rtLate") : x.rtFinal ? t("rtFetched",hm(x.rtFinal)) : t("rtPending");
  content.innerHTML=`<section class="screen">
    <div class="bar"><span class="badge" style="background:${COLORS[x.line]};color:${INK[x.line]}">${esc(x.line)}</span><h1>${esc(x.route[x.startIdx].name)} → ${esc(tt.endName)}<small>${dateStr(x.startedAt)} ${hm(x.startedAt)} · ${t("legs",tt.legs)}${rtState?` · ${rtState}`:""}</small></h1></div>
    <div class="kpis3">${kp(s.n?sgn(+s.mean.toFixed(1),1)+" s":"–",t("kMean"))}${kp(s.n?Math.round(s.max)+" s":"–",t("kMax"))}${kp(s.vsPlan!=null?sgn(+(s.vsPlan/60e3).toFixed(1),1)+" min":"–",t("kPlan",s.planSpan?Math.round(s.planSpan/60e3):"–"))}</div>
    ${chart(x)}
    ${finds.length?`<div class="finding">${finds.join(" ")}</div>`:""}
    ${q.status==="review"?`<p class="hint warn">${q.flags.filter(f=>!["ended_early","clock_unsynced"].includes(f.code)).map(f=>f.code+(f.seq?"@"+f.seq:"")).join(" · ")}</p>`:""}
    <div class="tblwrap"><table class="tri"><thead><tr><th>${t("colStation")}</th><th>${t("colPlan")}</th><th>${t("colRt")}</th><th>${t("colMe")}</th><th>${t("colD")}</th></tr></thead><tbody>${s.rows.map(triRow).join("")}</tbody></table></div>
    <p class="hint">${t("deltaHelp")}</p>
    <div class="tblwrap"><table class="segs"><thead><tr><th>${t("colStation")}</th><th class="n">${t("dwell")}</th><th class="n">${t("run")}</th></tr></thead><tbody>${sg.map(g=>`<tr><td>${esc(g.station)}${g.note?` <span title="${esc(g.note)}">✎</span>`:""}</td><td class="n">${g.dwell!=null?fmt(g.dwell):"–"}</td><td class="n">${g.run!=null?fmt(g.run):"–"}</td></tr>`).join("")}</tbody></table></div>
    ${sendBlock(x,to)}
    ${x.journey && Date.now()-x.startedAt<20*3600e3?`<button class="btn" id="tshare">↗ ${t("shareTrain")}</button>`:""}
    ${A.justFinished===x.id?`<button class="linkbtn" id="resume">${t("resume")}</button>`:""}
  </section>`;
  bindSend(x);
  const rs=$("#resume"); if(rs) rs.onclick=()=>resumeStudy(x.id);
  const ts=$("#tshare"); if(ts) ts.onclick=()=>shareTrain(x.journey.id, x.journey.date, segments(x).slice(-1)[0]?.station||"", x.line, x.dest);
}
function sendBlock(x,to){
  return `${to?`<button class="cta" id="send">${x.sentAt?t("sendAgain"):t("sendAnalysis")}</button><p class="hint">${x.sentAt?"✓ "+esc(t("sentOn",dateStr(x.sentAt)+" "+hm(x.sentAt))):esc(to)}</p>`:`<p class="hint">${t("noAddress")}</p>`}
    <div class="btnrow"><button class="btn" id="shr">${t("share")}</button><button class="btn" id="csv">CSV</button><button class="btn" id="json">JSON</button><button class="btn" id="newl">${t("newLog")}</button></div>`;
}
function bindSend(x){
  const sb=$("#send"); if(sb) sb.onclick=()=>sendItems([x]);
  $("#shr").onclick=async()=>{ const r=await shareFiles([x]); if(r!=="aborted"){ x.exportedAt=Date.now(); saveItems(); } if(r==="downloaded") toast(t("shareFallback")); };
  $("#csv").onclick=()=>{ const f=makeFiles([x],baseName([x])).csv; download(f); x.exportedAt=Date.now(); saveItems(); toast(t("downloaded",f.name)); };
  $("#json").onclick=()=>{ const f=makeFiles([x],baseName([x])).json; download(f); x.exportedAt=Date.now(); saveItems(); toast(t("downloaded",f.name)); };
  $("#newl").onclick=()=>{ A.justFinished=null; go("log","start"); };
}
async function sendItems(list){
  const to=addr(); if(!to){ toast(t("noAddress")); return go("more"); }
  const r=await sendForAnalysis(list,to);
  if(r==="aborted") return;
  const now=Date.now(); list.forEach(x=>{ x.sentAt=now; x.exportedAt=x.exportedAt||now; }); saveItems();
  toast(r==="mail"?t("mailOpened"):t("mailLong",to)); draw();
}
/* stringline of one trip: plan (dashed), realtime (blue), measured (white). Time across, stations down. */
function chart(x){
  const st=stops(x); if(st.length<2) return "";
  const i0=st[0].idx, i1=st[st.length-1].idx, calls=x.rt&&x.rt.calls, names=x.route.slice(i0,i1+1).map(r=>r.name);
  const series={plan:[],rt:[],me:[]};
  for(let i=i0;i<=i1;i++){ const c=calls&&calls[i];
    if(c){ const pa=c.aArr??c.aDep, pd=c.aDep??c.aArr; if(pa!=null) series.plan.push([pa,i],[pd,i]);
      const ra=c.xArr??c.eArr??c.aArr, rd=c.xDep??c.eDep??c.aDep; if(ra!=null) series.rt.push([ra,i],[rd??ra,i]); } }
  st.forEach(s=>{ if(s.arr!=null) series.me.push([s.arr,s.idx]); if(s.dep!=null) series.me.push([s.dep,s.idx]); });
  const all=[...series.plan,...series.rt,...series.me].map(p=>p[0]); let t0=Math.min(...all), t1=Math.max(...all); const padT=(t1-t0)*0.04+5e3; t0-=padT; t1+=padT;
  const W=400, rowH=Math.max(18,Math.min(34,190/Math.max(1,i1-i0))), H=Math.round(rowH*(i1-i0))+34, Lf=104, R=8, Tp=10;
  const X=v=>Lf+(v-t0)/(t1-t0)*(W-Lf-R), Y=i=>Tp+(i-i0)*rowH;
  const path=a=>a.map((p,k)=>(k?"L":"M")+X(p[0]).toFixed(1)+","+Y(p[1]).toFixed(1)).join("");
  const step=[60e3,120e3,300e3,600e3,900e3].find(s=>(t1-t0)/s<=6)||1800e3;
  let ticks=""; for(let v=Math.ceil(t0/step)*step; v<=t1; v+=step) ticks+=`<text x="${X(v).toFixed(1)}" y="${H-4}" text-anchor="middle" class="tk">${hm(v)}</text>`;
  const labelEvery=Math.ceil((i1-i0+1)/12);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t("legendPlan")}, ${t("legendRt")}, ${t("legendMe")}">
    ${names.map((n,k)=>`<line x1="${Lf}" x2="${W-R}" y1="${Y(i0+k)}" y2="${Y(i0+k)}" class="gl"/>${k%labelEvery===0||k===names.length-1?`<text x="${Lf-6}" y="${Y(i0+k)+4}" text-anchor="end" class="sn">${esc(n)}</text>`:""}`).join("")}
    ${ticks}
    ${series.plan.length?`<path d="${path(series.plan)}" class="pl"/>`:""}${series.rt.length?`<path d="${path(series.rt)}" class="rtl"/>`:""}<path d="${path(series.me)}" class="mel"/>
  </svg><div class="legend"><span><i class="lp"></i>${t("legendPlan")}</span><span><i class="lr"></i>${t("legendRt")}</span><span><i class="lm"></i>${t("legendMe")}</span></div></div>`;
}

/* ---------- platform mode ---------- */
function startPlatform(station){
  A.plat={ id:uid("P"), kind:"platform", v:3, station, startedAt:Date.now(), endedAt:null, clock:fresh(), recs:[], open:{} };
  if(!fresh()) runSync();
  savePlat(); askPersist(); go("log","platform");
}
function platGroups(){
  const now=Date.now(), deps=departures(A.plat.station, now), g=new Map();
  for(const d of deps){ if(!g.has(d.next)) g.set(d.next,[]); g.get(d.next).push(d); }
  Object.keys(A.plat.open).forEach(k=>{ if(!g.has(k)) g.set(k,[]); });
  return [...g.entries()].sort((a,b)=>a[0].localeCompare(b[0],"no"));
}
function platPress(grp, e){
  const wall=Date.now(); if(wall-lastPress<400) return; lastPress=wall;
  const lag = e && e.timeStamp>0 ? Math.min(1000, Math.max(0, performance.now()-e.timeStamp)) : 0, now=Math.round(wall-lag), P=A.plat;
  const openIx=P.open[grp];
  if(openIx!=null){ P.recs[openIx].dep=now; delete P.open[grp]; }
  else {
    const cand=departures(P.station, now-60e3).filter(d=>d.next===grp && !P.recs.some(r=>r.jid===d.j.id));
    const ct=now+off(P); const best=cand.sort((a,b)=>Math.abs(a.when-ct)-Math.abs(b.when-ct))[0];
    const m = best && Math.abs(best.when-ct)<6*60e3 ? best : null;
    P.recs.push({grp, jid:m?m.j.id:null, date:m?m.j.date:null, line:m?m.j.line:"", dest:m?m.j.dest:"", aDep:m?m.aimed:null, rtDep:m?m.when:null, arr:now, dep:null});
    P.open[grp]=P.recs.length-1;
  }
  savePlat(); buzz(); draw();
}
function drawPlatform(){
  const P=A.plat, groups=platGroups(), rows=platformRows(P).slice().reverse(), now=Date.now();
  content.innerHTML=`<section class="run">
    <div class="panel plat">
      <div class="bar"><h1>${esc(t("platformTitle",P.station))}<small>${t("trainsLogged",P.recs.length)}</small></h1><button class="iconbtn" id="end">${t("endSession")}</button></div>
      ${groups.length?groups.map(([g,deps])=>{ const oi=P.open[g], o=oi!=null?P.recs[oi]:null, nd=deps[0];
        return `<div class="pgrp"><div class="pg-h"><b>${esc(t("toward",g))}</b><span class="hint">${o?(o.jid?esc(t("matchedTo",o.line,o.dest,o.aDep?hm(o.aDep):"–")):t("unmatched")):nd?`${t("nextDep")}: <span class="badge sm" style="background:${COLORS[nd.j.line]};color:${INK[nd.j.line]}">${esc(nd.j.line)}</span> ${esc(nd.j.dest||"")} ${hm(nd.when)}`:t("noneDue")}</span></div>
          <button class="big ${o?"arr2":"dep2"}" data-g="${esc(g)}"><span class="verb">${o?t("depart"):t("arrive")}</span>${o?`<span class="sub num" data-since="${o.arr}">0:00</span>`:""}</button></div>`; }).join("")
      :`<p class="none">${t("noDeps")}</p>`}
      <div class="tools"><button class="tool" id="undo" ${P.recs.length?"":"disabled"}>${t("undo")}</button><span class="progress">${fresh()?`⏱ ±${(Math.max(fresh().err,50)/1000).toFixed(1)} s`:""}</span><span></span></div>
    </div>
    <p class="hint pad">${t("platformHint")}</p>
    ${rows.length?`<div class="tblwrap"><table class="segs"><thead><tr><th>${t("pTrains")}</th><th class="n">${t("arrS")}</th><th class="n">${t("dwell")}</th><th class="n">${t("headway")}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.line?`<span class="badge sm" style="background:${COLORS[r.line]};color:${INK[r.line]}">${esc(r.line)}</span> `:""}${esc(r.dest||r.grp)}</td><td class="n">${hms(r.arrC)}</td><td class="n">${r.dwell!=null?fmt(r.dwell):"…"}</td><td class="n">${r.headway!=null?fmt(r.headway,false):"–"}</td></tr>`).join("")}</tbody></table></div>`:""}
  </section>`;
  content.querySelectorAll("[data-g]").forEach(b=>{ let lp=0;
    b.onpointerdown=e=>{ if(!e.isPrimary||e.button!==0) return; e.preventDefault(); lp=Date.now(); platPress(b.dataset.g,e); };
    b.onclick=e=>{ if(e.detail>0 && Date.now()-lp<3000) return; platPress(b.dataset.g,null); }; });
  $("#undo").onclick=()=>{ const P=A.plat, last=P.recs[P.recs.length-1]; if(!last) return;
    const lastDep = P.recs.reduce((b,r,i)=>r.dep!=null&&(b<0||r.dep>P.recs[b].dep)?i:b,-1);
    if(lastDep>=0 && P.recs[lastDep].dep>last.arr){ P.open[P.recs[lastDep].grp]=lastDep; P.recs[lastDep].dep=null; }
    else { P.recs.pop(); Object.keys(P.open).forEach(k=>{ if(P.open[k]===P.recs.length) delete P.open[k]; }); }
    savePlat(); toast(t("undone")); draw(); };
  $("#end").onclick=()=>{ const P=A.plat; P.endedAt=Date.now(); delete P.open;
    if(P.recs.length){ A.items=[P,...A.items]; saveItems(); A.viewId=P.id; A.plat=null; savePlat(); go("log","result"); } else { A.plat=null; savePlat(); go("log","start"); } };
  const upd=()=>content.querySelectorAll("[data-since]").forEach(el=>el.textContent=fmt(Date.now()-(+el.dataset.since)));
  upd(); draw.tick=setInterval(()=>{ upd(); if(Date.now()-now>15000 && !content.querySelector("[data-since]")) draw(); },250);
}
function drawPlatformResult(x){
  const s=platformStats(x), rows=platformRows(x), to=addr();
  content.innerHTML=`<section class="screen">
    <div class="bar"><h1>${esc(t("platformTitle",x.station))}<small>${dateStr(x.startedAt)} ${hm(x.startedAt)}–${hm(x.endedAt||x.startedAt)}</small></h1></div>
    <div class="kpis3"><div class="kpi"><b class="num">${s.trains}</b><span>${t("pTrains")}</span></div><div class="kpi"><b class="num">${s.dwell!=null?fmt(s.dwell):"–"}</b><span>${t("pDwellMedian")}</span></div><div class="kpi"><b class="num">${s.headway!=null?fmt(s.headway,false):"–"}</b><span>${t("pHeadway")}</span></div></div>
    <div class="tblwrap"><table class="segs"><thead><tr><th>${t("pTrains")}</th><th class="n">${t("colPlan")}</th><th class="n">${t("arrS")}</th><th class="n">${t("dwell")}</th><th class="n">${t("headway")}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.line?`<span class="badge sm" style="background:${COLORS[r.line]};color:${INK[r.line]}">${esc(r.line)}</span> `:""}${esc(r.dest||r.grp)}</td><td class="n">${r.aDep?hm(r.aDep):"–"}</td><td class="n">${hms(r.arrC)}</td><td class="n">${r.dwell!=null?fmt(r.dwell):"–"}</td><td class="n">${r.headway!=null?fmt(r.headway,false):"–"}</td></tr>`).join("")}</tbody></table></div>
    ${sendBlock(x,to)}
  </section>`;
  bindSend(x);
}

/* ---------- ping ---------- */
function doPing(j, station){
  const now=Date.now(), d=departures(station, now-60e3).find(x=>x.j.id===j.id);
  const p={ id:uid("G"), kind:"ping", v:3, t:now, clock:fresh(), station, jid:j.id, date:j.date, line:j.line, dest:j.dest||"", aDep:d?d.aimed:null, eDep:d?d.when:null, delay:d?d.delay:null, rating:"" };
  A.items=[p,...A.items]; saveItems(); askPersist(); buzz();
  A.viewId=p.id; go("log","result");
}
function drawPingResult(x){
  const to=addr();
  content.innerHTML=`<section class="screen">
    <div class="bar"><span class="badge" style="background:${COLORS[x.line]};color:${INK[x.line]}">${esc(x.line)}</span><h1>${esc(t("pinged",x.line,x.dest))}<small>${esc(x.station)} · ${dateStr(x.t)} ${hms(x.t+off(x))}</small></h1></div>
    <div class="kpis3"><div class="kpi"><b class="num">${x.aDep?hm(x.aDep):"–"}</b><span>${t("colPlan")}</span></div><div class="kpi"><b class="num">${x.eDep?hms(x.eDep):"–"}</b><span>${t("colRt")}</span></div><div class="kpi"><b class="num">${x.delay!=null?sgn(Math.round(x.delay/60))+" min":"–"}</b><span>${t("delay")}</span></div></div>
    <span class="label">${t("pingRate")}</span>
    <div class="seg">${[["ontime","rOnTime"],["late","rLate"],["full","rFull"]].map(([k,s])=>`<button data-r="${k}" aria-pressed="${x.rating===k}">${t(s)}</button>`).join("")}</div>
    ${sendBlock(x,to)}
  </section>`;
  content.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{ x.rating = x.rating===b.dataset.r ? "" : b.dataset.r; saveItems(); toast(t("rSaved")); draw(); });
  bindSend(x);
}

/* =====================================================================
   TRIPS TAB
   ===================================================================== */
function drawTrips(){
  const tr=trends(A.items), unsent=A.items.filter(x=>!x.sentAt);
  const title=x=> x.kind==="study" ? `${esc(x.route[x.startIdx].name)} → ${esc(segments(x).slice(-1)[0]?.station||x.route[x.endIdx].name)}`
    : x.kind==="platform" ? esc(t("platformTitle",x.station)) : `${t("kindPing")}: ${esc(x.station)} → ${esc(x.dest)}`;
  const sub=x=>{ const when=x.startedAt||x.t;
    if(x.kind==="study"){ const s=summary(x); return `${dateStr(when)} ${hm(when)} · ${t("kindStudy")}${s.n?` · Δ ${sgn(+s.mean.toFixed(1),1)} s`:""}`; }
    if(x.kind==="platform") return `${dateStr(when)} ${hm(when)} · ${t("trainsLogged",x.recs.length)}`;
    return `${dateStr(when)} ${hm(when)}${x.rating?` · ${t({ontime:"rOnTime",late:"rLate",full:"rFull"}[x.rating])}`:""}`; };
  const badge=x=> x.line ? `<span class="badge" style="background:${COLORS[x.line]};color:${INK[x.line]}">${esc(x.line)}</span>` : `<span class="badge" style="background:var(--surface-2);color:var(--fg)">▤</span>`;
  content.innerHTML=`<section class="screen">
    <p class="hint">${t("tripsSub")}</p>
    <div class="kpis3"><div class="kpi"><b class="num">${A.items.length}</b><span>${t("kTrips")}</span></div><div class="kpi"><b class="num">${tr.legsN}</b><span>${t("kLegs")}</span></div><div class="kpi"><b class="num">${tr.lines.size}/5</b><span>${t("kLines")}</span></div></div>
    <div class="finding"><b>${t("myTrends")}</b><br>${tr.legs.length?tr.legs.map(l=>t("trendLeg",esc(l.a),esc(l.b),fmt(l.median,false),l.runs.length,l.planMedian?fmt(l.planMedian,false):"")).join("<br>"):t("trendNone")}${tr.rtN?`<br>${t("trendRt",tr.rtAbs.toFixed(1).replace(".",lang==="no"?",":"."),tr.rtN)}`:""}</div>
    ${A.items.length?`<ul class="trips">${A.items.map(x=>`<li><button class="open" data-open="${esc(x.id)}">${badge(x)}<div><div class="tt">${title(x)}</div><div class="ts">${sub(x)}</div></div></button>
      <div class="acts"><span class="chip ${x.sentAt?"ok":""}">${x.sentAt?"✓ "+t("sent"):t("notSent")}</span><button class="mini" data-del="${esc(x.id)}" aria-label="${t("del")}">✕</button></div>
      ${A.confirmDel===x.id?`<div class="confirm"><b>${t("delQ")}</b><div class="btnrow"><button class="btn" data-delno>${t("cancel")}</button><button class="btn primary" data-delyes="${esc(x.id)}">${t("del")}</button></div></div>`:""}</li>`).join("")}</ul>`
      :`<p class="none">${t("noTrips")}</p>`}
    <div class="btnrow">${addr()&&A.items.length?`<button class="btn primary" id="sendall">${t("sendSelected")}</button>`:""}${A.items.length?`<button class="btn" id="ej">${t("exportAll")}</button><button class="btn" id="ec">${t("exportCsv")}</button>`:""}<button class="btn" id="imp">${t("importBtn")}</button><input type="file" id="impf" accept=".json,application/json" multiple hidden></div>
    ${storageOk?"":`<p class="hint warn">Storage unavailable</p>`}
  </section>`;
  content.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{ A.viewId=b.dataset.open; A.justFinished=null; go("log","result"); });
  content.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{ A.confirmDel=b.dataset.del; draw(); });
  const no=content.querySelector("[data-delno]"); if(no) no.onclick=()=>{ A.confirmDel=null; draw(); };
  const yes=content.querySelector("[data-delyes]"); if(yes) yes.onclick=()=>{ A.items=A.items.filter(x=>x.id!==yes.dataset.delyes); saveItems(); A.confirmDel=null; toast(t("deleted")); draw(); };
  const sa=$("#sendall"); if(sa) sa.onclick=()=>{ if(!unsent.length) return toast(t("nothingToSend")); sendItems(unsent); };
  const ej=$("#ej"); if(ej) ej.onclick=()=>{ const f=makeFiles(A.items,baseName(A.items)).json; download(f); toast(t("downloaded",f.name)); };
  const ec=$("#ec"); if(ec) ec.onclick=()=>{ const f=makeFiles(A.items,baseName(A.items)).csv; download(f); toast(t("downloaded",f.name)); };
  const fi=$("#impf"); $("#imp").onclick=()=>fi.click();
  fi.onchange=async()=>{ const files=[...fi.files]; fi.value=""; if(!files.length) return;
    const {items, bad}=await readImport(files); if(!items.length && bad) return toast(t("importBad"));
    let a=0, d=0; for(const x of items){ if(A.items.some(y=>y.id===x.id)){ d++; continue; } A.items.push(x); a++; }
    A.items.sort((p,q)=>(q.startedAt||q.t)-(p.startedAt||p.t)); saveItems(); toast(t("imported",a,d,bad)); draw(); };
}

/* =====================================================================
   MORE TAB
   ===================================================================== */
function drawMore(){
  const c=fresh(), roles=t("roles"), role=store("bp.role")||"";
  content.innerHTML=`<section class="screen">
    <span class="label">${t("sData")}</span>
    <div class="set">
      <div><label for="addr"><b>${t("sAddr")}</b><span>${t("sAddrD")}</span></label><input id="addr" type="email" inputmode="email" autocomplete="email" value="${esc(addr())}" placeholder="name@example.com"></div>
      <div><label for="name"><b>${t("sName")}</b><span>${t("sNameD")}</span></label><input id="name" value="${esc(store("bp.name")||"")}" autocomplete="name"></div>
      <div><label for="role"><b>${t("sRole")}</b><span>${t("sRoleD")}</span></label><select id="role">${Object.entries(roles).map(([k,v])=>`<option value="${k}" ${k===role?"selected":""}>${esc(v)}</option>`).join("")}</select></div>
    </div>
    <span class="label">${t("sMeasure")}</span>
    <div class="set">
      <div class="r"><div><b>${t("sClock")}</b><span>${t("sClockD")}</span><span>${A.syncing?t("clockSyncing"):c?t("clockSynced",c.offset,Math.max(c.err,50)):t("clockNone")}</span></div><button class="btn" id="sync">${t("syncNow")}</button></div>
      <div class="r"><div><b>${t("sLoc")}</b><span>${t("sLocD")}</span></div><button class="btn" id="loc" aria-pressed="${store("bp.loc")!==false}">${store("bp.loc")!==false?t("on"):t("off")}</button></div>
      <div class="r"><div><b>${t("sSensor")}</b><span>${t("sSensorD")}</span></div><button class="btn" id="sens" aria-pressed="${sensorOn()}">${sensorOn()?t("on"):t("off")}</button></div>
      ${sensorOn()?`<div class="r"><div><b>${t("sRaw")}</b><span>${t("sRawD")}</span></div><button class="btn" id="sraw" aria-pressed="${store("bp.sensorRaw")===true}">${store("bp.sensorRaw")===true?t("on"):t("off")}</button></div>`:""}
    </div>
    <span class="label">${t("sOther")}</span>
    <div class="set">
      <div class="r"><div><b>${t("sLang")}</b></div><div class="lang"><button data-lang="en" aria-pressed="${lang==="en"}">EN</button><button data-lang="no" aria-pressed="${lang==="no"}">NO</button></div></div>
      <div class="r"><div><b>${t("sGuide")}</b></div><a class="btn" href="guide.html">›</a></div>
      <div class="r"><div><b>${t("sAnalysis")}</b><span>${t("sAnalysisD")}</span></div><a class="btn" href="analyse.html">›</a></div>
      <div><b>${t("sPrivacy")}</b><span>${t("sPrivacyD")}</span></div>
      <div class="r"><div><b>${t("sOld")}</b></div><div class="btnrow"><a class="btn" href="../linjeblikk.html">Linjeblikk</a><a class="btn" href="../tbane.html">T-bane logger</a></div></div>
    </div>
    <p class="hint">${t("sVersion",APP_VERSION)}</p>
  </section>`;
  $("#addr").onchange=e=>{ const v=e.target.value.trim(); store("bp.addr", v||null); toast(t("saved")); };
  $("#name").onchange=e=>{ store("bp.name", e.target.value.trim()||null); toast(t("saved")); };
  $("#role").onchange=e=>{ store("bp.role", e.target.value||null); toast(t("saved")); };
  $("#sync").onclick=runSync;
  $("#loc").onclick=()=>{ store("bp.loc", store("bp.loc")===false); draw(); };
  $("#sens").onclick=async()=>{ const on=!sensorOn(); store("bp.sensor", on); if(on && A.active) await startSensor(); if(!on) stopSensor(A.active); draw(); };
  const sr=$("#sraw"); if(sr) sr.onclick=()=>{ store("bp.sensorRaw", store("bp.sensorRaw")!==true); draw(); };
  content.querySelectorAll("[data-lang]").forEach(b=>b.onclick=()=>{ setLang(b.dataset.lang); draw(); });
}

/* =====================================================================
   WAKE LOCK, POLLING, BOOT
   ===================================================================== */
let wakeLock=null;
async function wantWake(on){
  try{
    if(on && !wakeLock && "wakeLock" in navigator && document.visibilityState==="visible"){ wakeLock=await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release",()=>{ wakeLock=null; }); }
    else if(!on && wakeLock){ await wakeLock.release(); wakeLock=null; }
  }catch(e){ wakeLock=null; }
}
let pollTimer=null;
async function poll(){
  clearTimeout(pollTimer);
  if(document.visibilityState!=="visible" || !L.NET) return;
  try{ await loadCalls(); }catch(e){ L.lastErr=e; }
  if(A.tab==="now"){ if(V.view==="tt") refreshTT(); else tickLive(); }
  setLiveBadge();
  pollTimer=setTimeout(poll, POLL_MS);
}
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"){ poll(); pollJourney(); if(A.tab==="log"&&(A.step==="run"||A.step==="platform")) wantWake(true); } });
(function frame(){ if(A.tab==="now" && V.view!=="tt") tickLive(); setLiveBadge(); setTimeout(()=>requestAnimationFrame(frame),250); })();

async function boot(){
  draw();
  if(A.tv) loadTv();
  try{ await loadNetwork(); }catch(e){ L.lastErr=e; draw(); return; }
  if(!L.NET.lines[V.line]) V.line=Object.keys(L.NET.lines)[0];
  draw(); poll(); loadSits(); setInterval(loadSits, 5*60e3);
  if(A.active) pollJourney();
  A.items.filter(x=>x.kind==="study" && x.journey && !x.rtFinal && x.endedAt && Date.now()-x.endedAt<70*60e3).forEach(x=>finalRealtime(x.id));
  if(store("bp.loc")!==false && !V.stn && navigator.geolocation){ try{ V.near=await locate(); if(V.near[0] && !V.stn){ setStation(V.near[0].name); if(A.tab==="now"||A.tab==="log") draw(); } }catch(e){} }
}
setLang(lang);
boot();
if("serviceWorker" in navigator && (location.protocol==="https:" || location.hostname==="localhost" || location.hostname==="127.0.0.1")){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}
