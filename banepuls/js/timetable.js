/* Line timetable: stations down, departures across, like a printed timetable.
   Planned times come from serviceJourneys(lines, activeDates). For today, departures that are
   in the realtime window (about 8 min back and 25 min ahead) also show deviations. */
import { $, esc, hm, store, t, pad, COLORS, INK } from "./core.js";
import { L, TERMINI, lineTimetable } from "./entur.js";

const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const TV = { line: store("bp.ttLine")||"5", dir: store("bp.ttDir")||0, date:null, from:null };
const SPAN = 4*3600e3, STEP = 3*3600e3;
let box=null, hooks={}, data=null, loading=false, err=null, req=0;

function today(){ return isoDay(new Date()); }
function defaultFrom(date){
  const now=new Date(), [y,m,d]=date.split("-").map(Number);
  if(date===today()) return Math.floor((Date.now()-3600e3)/3600e3)*3600e3;
  return new Date(y,m-1,d,5,0,0).getTime();
}
export function openTimetable(container, h){ box=container; hooks=h; if(!TV.date){ TV.date=today(); TV.from=defaultFrom(TV.date); } render(); load(); }
async function load(){
  if(!L.NET) return;
  const my=++req; loading=true; err=null; data=null; render();
  try{ const d=await lineTimetable(TV.line, TV.date); if(my!==req) return; data=d; }catch(e){ if(my!==req) return; err=e.message; }
  loading=false; render(true);
}
export function refresh(){ if(box && data) render(); }   // after a realtime poll

function render(scroll){
  if(!box || !L.NET) return;
  const Ln=L.NET.lines[TV.line]; if(!Ln) return;
  const st = TV.dir===0 ? Ln.stations : Ln.stations.slice().reverse(), n=st.length;
  const ends=[Ln.stations[Ln.stations.length-1].name, Ln.stations[0].name];
  const tomorrow=isoDay(new Date(Date.now()+864e5)), isToday=TV.date===today(), now=Date.now();
  const from=TV.from, to=from+SPAN;
  let head=`<div class="ttbar">
    <div class="linepick" role="group" aria-label="${t("line")}">${Object.keys(COLORS).filter(k=>L.NET.lines[k]).map(k=>`<button style="--lc:${COLORS[k]}" data-ttl="${k}" aria-pressed="${k===TV.line}">${k}</button>`).join("")}</div>
    <div class="ttrow"><div class="seg2" role="group">${[0,1].map(d=>`<button data-ttd="${d}" aria-pressed="${TV.dir===d}">→ ${esc(ends[d])}</button>`).join("")}</div></div>
    <div class="ttrow"><div class="seg2" role="group"><button data-ttday="${today()}" aria-pressed="${isToday}">${t("ttToday")}</button><button data-ttday="${tomorrow}" aria-pressed="${TV.date===tomorrow}">${t("ttTomorrow")}</button></div>
      <input type="date" id="ttdate" value="${TV.date}" aria-label="${t("ttDate")}"></div>
    <div class="ttrow nav"><button class="btn" id="ttprev">← ${t("ttEarlier")}</button><span class="num">${hm(from)}–${hm(to)}</span><button class="btn" id="ttnext">${t("ttLater")} →</button></div></div>`;
  if(loading || err || !data){ box.innerHTML=head+`<p class="hint pad">${err?esc(t("ttFail")):t("ttLoading")}</p>`; bind(); return; }
  const cols=data.filter(j=>{ const ts=Object.values(j.times).map(x=>x.dep??x.arr).filter(Boolean); return ((TV.dir===0)===(j.dir===0)) && ts.some(v=>v>=from && v<to); });
  const live=new Map(isToday ? L.JOURNEYS.filter(j=>j.line===TV.line).map(j=>[j.id,j]) : []);
  const ixOf = i => TV.dir===0 ? i : n-1-i;   // row i in display order → index in the line's station list
  let nextCol=-1;
  const colsH=cols.map((j,k)=>{
    const lj=live.get(j.id), past=isToday && j.last<now-30e3; if(nextCol<0 && isToday && (j.first>=now-60e3)) nextCol=k;
    const cancelled = lj && lj.calls.length && lj.calls.every(c=>c.cancel);
    return {j, lj, past, cancelled};
  });
  const cell=(c,i)=>{
    const tm=c.j.times[ixOf(i)]; if(!tm) return `<td class="nst">·</td>`;
    const plan=tm.dep??tm.arr; let extra="", cls="";
    if(c.lj){ const lc=c.lj.calls.find(x=>x.ix===ixOf(i));
      if(lc){ if(lc.cancel) cls="cx"; else { const e=lc.dep??lc.arr, a=lc.aDep??lc.aArr, d=e&&a?(e-a)/1000:0;
        if(Math.abs(d)>=60){ cls=Math.abs(d)>=180?"bad":"late"; extra=`<i>${hm(e)}</i>`; } } } }
    return `<td class="${cls}">${hm(plan)}${extra}</td>`;
  };
  const table = cols.length ? `<div class="ttwrap" id="ttwrap"><table class="tt">
      <thead><tr><th class="stc">${t("vStation")}</th>${colsH.map((c,k)=>`<th class="${c.past?"past":""} ${k===nextCol?"next":""} ${c.cancelled?"cx":""}"><button data-ttj="${esc(c.j.id)}" aria-label="${t("details")} ${esc(c.j.code)}">${esc(c.j.code||"·")}</button></th>`).join("")}</tr></thead>
      <tbody>${st.map((s,i)=>`<tr><th class="stc">${esc(s.name)}</th>${colsH.map((c,k)=>cell(c,i).replace("<td class=\"",`<td class="${c.past?"past ":""}${k===nextCol?"next ":""}${c.cancelled?"cx ":""}`)).join("")}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="none pad">${t("ttNone")}</p>`;
  box.innerHTML=head+table+`<p class="hint pad">${isToday?t("ttHint"):t("ttHintPlan")}</p>`;
  bind();
  if(scroll!==false && nextCol>=0){ const w=$("#ttwrap",box), th=w&&w.querySelectorAll("thead th")[nextCol+1]; if(th) w.scrollLeft=Math.max(0, th.offsetLeft-110); }
}
function bind(){
  box.querySelectorAll("[data-ttl]").forEach(b=>b.onclick=()=>{ TV.line=b.dataset.ttl; store("bp.ttLine",TV.line); document.documentElement.style.setProperty("--c",COLORS[TV.line]); load(); });
  box.querySelectorAll("[data-ttd]").forEach(b=>b.onclick=()=>{ TV.dir=+b.dataset.ttd; store("bp.ttDir",TV.dir); render(true); });
  box.querySelectorAll("[data-ttday]").forEach(b=>b.onclick=()=>{ TV.date=b.dataset.ttday; TV.from=defaultFrom(TV.date); load(); });
  const di=$("#ttdate",box); if(di) di.onchange=()=>{ if(!di.value) return; TV.date=di.value; TV.from=defaultFrom(TV.date); load(); };
  $("#ttprev",box).onclick=()=>{ TV.from-=STEP; render(false); };
  $("#ttnext",box).onclick=()=>{ TV.from+=STEP; render(false); };
  box.querySelectorAll("[data-ttj]").forEach(b=>b.onclick=()=>hooks.openDep(b.dataset.ttj, TV.date));
}
