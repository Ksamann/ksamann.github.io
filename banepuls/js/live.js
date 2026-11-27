/* The "Now" tab: station departures, line strip, network map and timetable graph.
   Ported from Linjeblikk (linjeblikk.html) with two additions: Log and Ping on each
   departure and in the train sheet, and the nearest station from the phone's position. */
import { $, esc, pad, hm, store, t, COLORS } from "./core.js";
import { L, stateAt, delayOf, departures, indexStations } from "./entur.js";

export const V = { view: store("bp.view")||"stn", line: store("bp.line")||"5", sel:null,
  stn: store("bp.stn"), walk: store("bp.walk")??4, pinned: store("bp.pin")||{}, recent: store("bp.recent")||[], picking:false, seg: store("bp.seg")||"tunnel", near:null };
if(!["stn","line","net","sl"].includes(V.view)) V.view="stn";
let content=null, sheet=null, hooks={};
export function initLive(c, s, h){ content=c; sheet=s; hooks=h; bind(); }

const dCls = d => d<60?"":d<180?"late":"bad";
const dTxt = d => d<60 ? "0" : (d>0?"+":"")+Math.round(d/60);

export function setStation(name){ V.stn=name; V.picking=false; store("bp.stn",name); V.recent=[name,...V.recent.filter(x=>x!==name)].slice(0,5); store("bp.recent",V.recent); }

/* nearest stations from coordinates in the cached network (works offline) */
export function nearestFromPos(lat, lon){
  const R=6371e3, rad=x=>x*Math.PI/180, out={};
  for(const [id,p] of Object.entries(L.NET.pos||{})){ const n=L.NAMEOF[id]; if(!n) continue;
    const dl=rad(p[0]-lat), dg=rad(p[1]-lon), a=Math.sin(dl/2)**2+Math.cos(rad(lat))*Math.cos(rad(p[0]))*Math.sin(dg/2)**2, d=2*R*Math.asin(Math.sqrt(a));
    if(out[n]==null || d<out[n]) out[n]=d; }
  return Object.entries(out).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([name,d])=>({name, distance:Math.round(d)}));
}
export function locate(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation) return rej(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(p=>res(nearestFromPos(p.coords.latitude,p.coords.longitude)), rej, {enableHighAccuracy:true, timeout:12000, maximumAge:60000});
  });
}

/* ---------- build & tick ---------- */
export function build(){
  if(!L.NET || !content) return;
  indexStations();
  closeSheet();
  ({line:buildLine, net:buildNet, stn:buildStn, sl:buildSL})[V.view]();
  tick();
}
export function tick(){
  if(!L.NET || !content) return;
  const now=Date.now();
  if(V.view==="line"){ drawLine(now); drawSheet(now); }
  else if(V.view==="net"){ drawNet(now); drawSheet(now); }
  else if(V.view==="stn") drawStn(now);
  else drawSL(now);
  if(!L.JOURNEYS.length && L.lastOk){
    if(!$("#empty",content)) content.insertAdjacentHTML("afterbegin",`<div class="msg" id="empty"><b>${t("nightPause")}</b>${t("nightPauseText")}</div>`);
  } else { const e=$("#empty",content); if(e) e.remove(); }
}

/* ---------- line strip ---------- */
const ROW=44;
function buildLine(){
  const Ln=L.NET.lines[V.line]||L.NET.lines[Object.keys(L.NET.lines)[0]], st=Ln.stations, n=st.length;
  document.documentElement.style.setProperty("--c",COLORS[V.line]);
  content.innerHTML=`<div class="linebar"><div class="linepick" role="group" aria-label="${t("line")}">${Object.keys(COLORS).filter(k=>L.NET.lines[k]).map(k=>`<button style="--lc:${COLORS[k]}" data-l="${k}" aria-pressed="${k===V.line}">${k}</button>`).join("")}</div>
    <div class="dirhead"><span>${t("vStation")}</span><span>▼ ${esc(st[n-1].name)}</span><span>▲ ${esc(st[0].name)}</span></div></div>
    <div class="strip" style="height:${n*ROW}px"><div class="trk" style="left:calc(100% - 117px)"></div><div class="trk" style="left:calc(100% - 39px)"></div>${st.map((s,i)=>`<div class="st ${i===0||i===n-1?"term":""}"><span>${esc(s.name)}</span><i></i></div>`).join("")}<div id="trains"></div></div>`;
}
function drawLine(now){
  const box=$("#trains",content); if(!box) return;
  let html="";
  for(const j of L.JOURNEYS){ if(j.line!==V.line) continue;
    const s=stateAt(j,now); if(!s) continue;
    const y=s.pos*ROW+ROW/2;
    html+=`<button class="train ${s.wait?"wait":""} ${V.sel===j.id?"sel":""}" style="top:${y.toFixed(1)}px;left:calc(100% - ${j.dir===0?117:39}px)" data-j="${esc(j.id)}" aria-label="${t("towards")} ${esc(j.dest||"")}"><span>${j.dir===0?"▼":"▲"}</span><b class="${dCls(s.delay)}">${dTxt(s.delay)}</b></button>`;
  }
  box.innerHTML=html;
}
function closeSheet(){ V.sel=null; if(sheet) sheet.hidden=true; }
function drawSheet(now){
  if(!V.sel){ sheet.hidden=true; return; }
  const j=L.JOURNEYS.find(x=>x.id===V.sel), s=j&&stateAt(j,now);
  if(!s){ closeSheet(); return; }
  const st=L.NET.lines[j.line].stations, cs=j.calls.filter(c=>!c.cancel);
  const nxt=cs.slice(s.at?s.next+1:s.next).slice(0,5);
  const head = s.wait ? t("waitingFrom",esc(st[Math.round(s.pos)].name)) : s.at ? t("standingAt",esc(st[Math.round(s.pos)].name)) : t("between",esc(st[cs[s.next-1].ix].name),esc(st[cs[s.next].ix].name));
  const first=nxt[0], nIn=first?Math.max(0,Math.round(((first.arr||first.dep)-now)/60e3)):null;
  const last=cs[cs.length-1], lastName=st[last.ix].name, endKnown = j.dest && j.dest.indexOf(lastName)===0 && last.dep==null;
  const dl = s.delay<60 ? t("onTime") : `+${Math.round(s.delay/60)} min`;
  const other = V.view==="net" ? `<button class="sbtn" data-show="line">${t("showOnLine")}</button>` : `<button class="sbtn" data-show="net">${t("showOnMap")}</button>`;
  const ix = s.at ? Math.round(s.pos) : (cs[s.next]?cs[s.next].ix:null);
  const canLog = ix!=null && !(j.dir===0 ? ix>=st.length-1 : ix<=0);
  const html=`<div class="h"><span class="badge" style="background:${COLORS[j.line]}">${j.line}</span><div><b>${t("towards")} ${esc(j.dest||st[j.dir===0?st.length-1:0].name)}</b><small>${head}</small></div><button class="x" aria-label="${t("close")}">✕</button></div>
    <div class="tiles">
      <div><small>${t("delay")}</small><b class="${dCls(s.delay)}">${dl}</b></div>
      <div><small>${t("nextStopL")}</small><b>${first?esc(st[first.ix].name):"–"}</b><em>${first?(nIn<1?t("now"):t("in",nIn)):""}</em></div>
      <div><small>${endKnown?t("arrives"):t("terminus")}</small><b>${endKnown?hm(last.arr):esc(j.dest?j.dest.split(" via ")[0]:"–")}</b><em>${endKnown?esc(lastName):""}</em></div>
    </div>
    <ol>${nxt.map(c=>`<li><span>${esc(st[c.ix].name)}</span>${c.aArr&&Math.abs((c.arr||0)-c.aArr)>=60e3?`<s>${hm(c.aArr)}</s>`:"<s></s>"}<span class="mono num">${hm(c.arr||c.dep)}</span></li>`).join("")||`<li><span>${t("lastStation")}</span><s></s><span></span></li>`}</ol>
    <div class="sacts">${other}${canLog?`<button class="logbtn" data-logj="${esc(j.id)}" data-logs="${esc(st[ix].name)}" style="--c:${COLORS[j.line]}">${t("logFrom",esc(st[ix].name))}</button>`:""}</div>`;
  if(sheet._html!==html){ sheet.innerHTML=html; sheet._html=html; }
  sheet.hidden=false;
}

/* ---------- network map ---------- */
const KEY = {
  "Majorstuen":[1040,260], "Tøyen":[1310,260], "Ullevål stadion":[1040,90], "Sinsen":[1360,90], "Carl Berners plass":[1360,210],
  "Sognsvann":[720,40], "Berg":[990,40], "Frognerseteren":[-28,110], "Frøen":[890,110],
  "Østerås":[494,200], "Makrellbekken":[872,200], "Smestad":[932,260], "Kolsås":[230,260],
  "Økern":[1480,90], "Vestli":[2128,90], "Brynseng":[1472,260], "Hellerud":[1526,260], "Tveita":[1636,150], "Ellingsrudåsen":[1906,150],
  "Godlia":[1581,205], "Mortensrud":[1959,205], "Høyenhall":[1522,310], "Bergkrystallen":[1900,310]
};
const LANE = {"5":-2,"4":-1,"1":0,"2":1,"3":2}, LANEW=3.4, WORLD={x:-190,y:-30,w:2460,h:390};
const INTERCHANGE = new Set(["Majorstuen","Nationaltheatret","Stortinget","Jernbanetorget","Grønland","Tøyen","Ensjø","Helsfyr","Brynseng","Smestad","Ullevål stadion","Sinsen","Økern","Carl Berners plass","Hellerud","Borgen","Forskningsparken","Blindern","Storo","Nydalen"]);
const TERM_LEFT = new Set(["Frognerseteren","Østerås","Kolsås","Sognsvann"]), TERM_RIGHT = new Set(["Vestli","Ellingsrudåsen","Mortensrud","Bergkrystallen"]);
const TERMINI_ALL = new Set([...TERM_LEFT,...TERM_RIGHT]);
let GEO=null, TRAINPOS=[];
function offsetPolyline(pts,d){
  if(!d) return pts.slice();
  const nrm=(a,b)=>{ const dx=b[0]-a[0], dy=b[1]-a[1], l=Math.hypot(dx,dy)||1; let n=[-dy/l,dx/l]; if(n[0]<-1e-9 || (Math.abs(n[0])<1e-9 && n[1]<0)) n=[-n[0],-n[1]]; return n; };
  return pts.map((p,i)=>{
    const n1=i>0?nrm(pts[i-1],p):null, n2=i<pts.length-1?nrm(p,pts[i+1]):null;
    if(!n1) return [p[0]+n2[0]*d,p[1]+n2[1]*d];
    if(!n2) return [p[0]+n1[0]*d,p[1]+n1[1]*d];
    const mx=n1[0]+n2[0], my=n1[1]+n2[1], k=1+n1[0]*n2[0]+n1[1]*n2[1];
    return [p[0]+mx/k*d, p[1]+my/k*d];
  });
}
function roundPath(P,r){
  const f=v=>v.toFixed(1); let d=`M${f(P[0][0])} ${f(P[0][1])}`;
  for(let i=1;i<P.length-1;i++){ const a=P[i-1], b=P[i], c=P[i+1];
    const l1=Math.hypot(b[0]-a[0],b[1]-a[1]), l2=Math.hypot(c[0]-b[0],c[1]-b[1]); if(!l1||!l2) continue;
    const rr=Math.min(r,l1/2,l2/2), p=[b[0]+(a[0]-b[0])*rr/l1, b[1]+(a[1]-b[1])*rr/l1], q=[b[0]+(c[0]-b[0])*rr/l2, b[1]+(c[1]-b[1])*rr/l2];
    d+=` L${f(p[0])} ${f(p[1])} Q${f(b[0])} ${f(b[1])} ${f(q[0])} ${f(q[1])}`; }
  const z=P[P.length-1]; return d+` L${f(z[0])} ${f(z[1])}`;
}
function buildGeo(){
  GEO={};
  for(const [code,Ln] of Object.entries(L.NET.lines)){
    const st=Ln.stations.map(s=>s.name), keyIdx=[];
    st.forEach((s,i)=>{ if(KEY[s]) keyIdx.push(i); });
    if(keyIdx.length<2) continue;
    const base=new Array(st.length);
    for(let k=0;k<keyIdx.length-1;k++){ const a=keyIdx[k], b=keyIdx[k+1], A=KEY[st[a]], B=KEY[st[b]];
      for(let i=a;i<=b;i++){ const f=(i-a)/(b-a); base[i]=[A[0]+(B[0]-A[0])*f, A[1]+(B[1]-A[1])*f]; } }
    for(let i=0;i<st.length;i++) if(!base[i]) base[i]=KEY[st[i<keyIdx[0]?keyIdx[0]:keyIdx[keyIdx.length-1]]];
    const path=offsetPolyline(keyIdx.map(i=>KEY[st[i]]), LANE[code]*LANEW);
    const off=new Array(st.length);
    for(let k=0;k<keyIdx.length-1;k++){ const a=keyIdx[k], b=keyIdx[k+1], P=path[k], Q=path[k+1];
      for(let i=a;i<=b;i++){ const f=(i-a)/(b-a); off[i]=[P[0]+(Q[0]-P[0])*f, P[1]+(Q[1]-P[1])*f]; } }
    for(let i=0;i<st.length;i++) if(!off[i]) off[i]=base[i];
    GEO[code]={path, pts:off, base};
  }
}
function labelFor(name, x, y, half, major){
  const tx=esc(name), cls=major?"major":"";
  const H=(lx,ly,an="start")=>`<text class="${cls}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${an}">${tx}</text>`;
  const R=(lx,ly,an="start")=>`<text class="${cls}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${an}" transform="rotate(-35 ${lx.toFixed(1)} ${ly.toFixed(1)})">${tx}</text>`;
  if(name==="Ullevål stadion") return H(x+half+6, y+half+24);
  if(name==="Sinsen") return H(x-half-4, y+half+12, "end");
  if(name==="Carl Berners plass") return H(x+half+8, y+4);
  if(name==="Hasle") return H(x+half+6, y+half+8);
  if(name==="Hellerud") return H(x-half-2, y-half-8, "end");
  if(name==="Brynseng") return R(x-2, y+half+9, "end");
  if(name==="Tøyen") return R(x-2, y+half+9, "end");
  if(name==="Godlia") return H(x+half+4, y+half+14);
  if(Math.abs(y-90)<10 && x>1050 && x<1350) return H(x, y+half+12, "middle");
  if(Math.abs(x-1040)<10 && y>100 && y<250) return H(x+half+6, y+4);
  return R(x+2, y-half-5);
}
function terminusLabel(name, x, y, half){
  const lines=[...(L.LINESAT[name]||[])].sort(), w=18, gap=3, right=TERM_RIGHT.has(name);
  let g="", bx = right ? x+half+8 : x-half-8-lines.length*(w+gap)+gap;
  for(const c of lines){ g+=`<rect x="${bx}" y="${y-w/2}" width="${w}" height="${w}" rx="3" fill="${COLORS[c]}"/><text class="tn" x="${bx+w/2}" y="${y+4.5}" text-anchor="middle">${c}</text>`; bx+=w+gap; }
  const tx = right ? bx+4 : x-half-12-lines.length*(w+gap);
  return g+`<text class="term" x="${tx}" y="${y+5}" text-anchor="${right?"start":"end"}">${esc(name)}</text>`;
}
function buildNet(){
  if(!GEO) buildGeo();
  let lines="", ticks="", labels="";
  for(const code of ["3","2","1","4","5"]){ const g=GEO[code]; if(!g) continue;
    lines+=`<path d="${roundPath(g.path,16)}" fill="none" stroke="${COLORS[code]}" stroke-width="3.2" stroke-linecap="round"/>`; }
  const seen=new Set();
  for(const Ln of Object.values(L.NET.lines)) Ln.stations.forEach(s=>{ if(seen.has(s.name)) return; seen.add(s.name);
    const users=Object.keys(L.NET.lines).filter(c=>GEO[c]&&L.NET.lines[c].stations.some(x=>x.name===s.name));
    const pts=users.map(c=>GEO[c].pts[L.NET.lines[c].stations.findIndex(x=>x.name===s.name)]);
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]), x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
    const cx=(x0+x1)/2, cy=(y0+y1)/2, half=Math.max(x1-x0,y1-y0)/2+3;
    const ic=users.length>1 && INTERCHANGE.has(s.name);
    if(ic) ticks+=`<rect x="${(x0-3.6).toFixed(1)}" y="${(y0-3.6).toFixed(1)}" width="${(x1-x0+7.2).toFixed(1)}" height="${(y1-y0+7.2).toFixed(1)}" rx="3.6" fill="#0c0f13" stroke="#eef1f4" stroke-width="1.4"/>`;
    else { const c0=users[0], st=L.NET.lines[c0].stations, i=st.findIndex(x=>x.name===s.name), B=GEO[c0].base;
      const P=B[Math.max(0,i-1)], Q=B[Math.min(st.length-1,i+1)], dx=Q[0]-P[0], dy=Q[1]-P[1], l=Math.hypot(dx,dy)||1, nx=-dy/l, ny=dx/l, e=half+1.5;
      ticks+=`<line x1="${(cx-nx*e).toFixed(1)}" y1="${(cy-ny*e).toFixed(1)}" x2="${(cx+nx*e).toFixed(1)}" y2="${(cy+ny*e).toFixed(1)}" stroke="#eef1f4" stroke-width="1.6" stroke-linecap="round"/>`; }
    labels += TERMINI_ALL.has(s.name) ? terminusLabel(s.name,cx,cy,half) : labelFor(s.name, cx, cy, half, ic);
  });
  content.innerHTML=`<div class="netview">
    <div class="map" id="map"><svg id="netsvg" role="img" aria-label="Network map">
      <g id="vp">${lines}${ticks}<g class="lbl">${labels}</g><g id="dots"></g></g></svg>
      <div class="zoom"><button id="zi" aria-label="Zoom in">+</button><button id="zo" aria-label="Zoom out">−</button><button id="zf" aria-label="Fit">⤢</button></div>
    </div>
    <div class="kpis"><div class="kpi"><small>${t("trainsOut")}</small><b class="num" id="kT">–</b></div><div class="kpi"><small>${t("punctual")}</small><b class="num" id="kP">–</b></div><div class="kpi"><small>${t("avgDelay")}</small><b class="num" id="kD">–</b></div></div>
  </div>`;
  initPanZoom();
}
function drawNet(now){
  const box=$("#dots",content); if(!box) return;
  let html="", sel="", n=0, ok=0, sum=0; TRAINPOS=[];
  for(const j of L.JOURNEYS){ const g=GEO[j.line]; if(!g) continue; const s=stateAt(j,now); if(!s) continue;
    const i0=Math.floor(s.pos), i1=Math.min(g.pts.length-1,i0+1), f=s.pos-i0, A=g.pts[i0], B=g.pts[i1];
    const x=A[0]+(B[0]-A[0])*f, y=A[1]+(B[1]-A[1])*f;
    TRAINPOS.push({id:j.id,x,y});
    const ring=s.delay>=180?"#ff5d4f":s.delay>=60?"#f0b43c":"#0c0f13";
    const dot=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${COLORS[j.line]}" stroke="${ring}" stroke-width="2.2"/>`;
    if(V.sel===j.id) sel=`<circle class="pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="none" stroke="#eef1f4" stroke-width="2"/>`+dot; else html+=dot;
    n++; if(s.delay<180) ok++; sum+=Math.max(0,s.delay);
  }
  box.innerHTML=html+sel;
  $("#kT",content).textContent=n; $("#kP",content).textContent=n?Math.round(100*ok/n)+"%":"–";
  const avg=n?sum/n:0; $("#kD",content).textContent=n?`+${Math.floor(avg/60)}:${pad(Math.round(avg%60))}`:"–";
}
const VIEW={k:0,tx:0,ty:0};
function initPanZoom(){
  const svg=$("#netsvg",content), vp=$("#vp",content), map=$("#map",content);
  const size=()=>{ const r=map.getBoundingClientRect(); return {w:r.width,h:r.height}; };
  const fitK=()=>{ const z=size(); return Math.min(z.w/WORLD.w, z.h/WORLD.h); };
  const clamp=()=>{ const z=size(), kMin=fitK()*0.9; VIEW.k=Math.min(8,Math.max(kMin,VIEW.k));
    const mw=WORLD.w*VIEW.k, mh=WORLD.h*VIEW.k, m=40;
    const lo=(view,map0,len)=> len<=view ? [ (view-len)/2-map0*VIEW.k, (view-len)/2-map0*VIEW.k ] : [ view-m-(map0+len/VIEW.k)*VIEW.k, m-map0*VIEW.k ];
    const [ax,bx]=lo(z.w,WORLD.x,mw), [ay,by]=lo(z.h,WORLD.y,mh);
    VIEW.tx=Math.min(bx,Math.max(ax,VIEW.tx)); VIEW.ty=Math.min(by,Math.max(ay,VIEW.ty)); };
  const apply=()=>{ clamp(); vp.setAttribute("transform",`translate(${VIEW.tx.toFixed(1)} ${VIEW.ty.toFixed(1)}) scale(${VIEW.k.toFixed(4)})`); };
  const zoomAt=(f,sx,sy)=>{ const k0=VIEW.k; VIEW.k=Math.min(8,Math.max(fitK()*0.9,k0*f)); const r=VIEW.k/k0; VIEW.tx=sx-(sx-VIEW.tx)*r; VIEW.ty=sy-(sy-VIEW.ty)*r; apply(); };
  const fitAll=()=>{ const z=size(); VIEW.k=fitK(); VIEW.tx=(z.w-WORLD.w*VIEW.k)/2-WORLD.x*VIEW.k; VIEW.ty=(z.h-WORLD.h*VIEW.k)/2-WORLD.y*VIEW.k; apply(); };
  const home=()=>{ const z=size(); VIEW.k=Math.max(fitK(), z.h/WORLD.h); VIEW.tx=z.w/2-1175*VIEW.k; VIEW.ty=(z.h-WORLD.h*VIEW.k)/2-WORLD.y*VIEW.k; apply(); };
  VIEW.center=(x,y,k)=>{ const z=size(); if(k) VIEW.k=Math.max(VIEW.k,k); VIEW.tx=z.w/2-x*VIEW.k; VIEW.ty=z.h*0.38-y*VIEW.k; apply(); };
  if(!VIEW.k) home(); else apply();
  new ResizeObserver(()=>apply()).observe(map);
  $("#zi",content).onclick=()=>{ const z=size(); zoomAt(1.6,z.w/2,z.h/2); };
  $("#zo",content).onclick=()=>{ const z=size(); zoomAt(1/1.6,z.w/2,z.h/2); };
  $("#zf",content).onclick=fitAll;
  svg.addEventListener("wheel",e=>{ e.preventDefault(); const r=svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY*0.0018),e.clientX-r.left,e.clientY-r.top); },{passive:false});
  const P=new Map(); let moved=0, downAt=0, lastTap=0, pinch=null;
  svg.addEventListener("pointerdown",e=>{ svg.setPointerCapture(e.pointerId); P.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(P.size===1){ moved=0; downAt=performance.now(); } pinch=null; });
  svg.addEventListener("pointermove",e=>{ const p=P.get(e.pointerId); if(!p) return; const r=svg.getBoundingClientRect();
    if(P.size===1){ const dx=e.clientX-p.x, dy=e.clientY-p.y; moved+=Math.abs(dx)+Math.abs(dy); VIEW.tx+=dx; VIEW.ty+=dy; p.x=e.clientX; p.y=e.clientY; apply(); return; }
    p.x=e.clientX; p.y=e.clientY; const [a,b]=[...P.values()], d=Math.hypot(a.x-b.x,a.y-b.y), mx=(a.x+b.x)/2-r.left, my=(a.y+b.y)/2-r.top; moved=99;
    if(pinch){ VIEW.tx+=mx-pinch.mx; VIEW.ty+=my-pinch.my; zoomAt(d/pinch.d,mx,my); }
    pinch={d,mx,my}; });
  const end=e=>{ if(!P.has(e.pointerId)) return; P.delete(e.pointerId); if(P.size){ pinch=null; return; }
    if(moved>8 || performance.now()-downAt>600) return;
    const r=svg.getBoundingClientRect(), sx=e.clientX-r.left, sy=e.clientY-r.top, nowp=performance.now();
    const wx=(sx-VIEW.tx)/VIEW.k, wy=(sy-VIEW.ty)/VIEW.k;
    let best=null, bd=Math.max(14,22/VIEW.k); for(const tp of TRAINPOS){ const d=Math.hypot(tp.x-wx,tp.y-wy); if(d<bd){ bd=d; best=tp; } }
    if(best){ V.sel=best.id; lastTap=0; tick(); return; }
    if(nowp-lastTap<320){ zoomAt(1.8,sx,sy); lastTap=0; return; }
    lastTap=nowp; if(V.sel){ closeSheet(); tick(); } };
  svg.addEventListener("pointerup",end); svg.addEventListener("pointercancel",e=>{ P.delete(e.pointerId); pinch=null; });
}
function focusTrain(id){ const tp=TRAINPOS.find(x=>x.id===id); if(tp && VIEW.center) VIEW.center(tp.x,tp.y,2.2); }

/* ---------- station ---------- */
let stnHTML=null;
function buildStn(){
  if(!V.stn || !L.IDSOF[V.stn] || V.picking) return buildPicker();
  content.innerHTML=`<div class="stn" id="stn"></div>`; stnHTML=null;
}
function drawStn(now){
  const box=$("#stn",content); if(!box) return;
  const name=V.stn, all=departures(name,now), groups=new Map();
  for(const d of all){ if(!groups.has(d.next)) groups.set(d.next,[]); groups.get(d.next).push(d); }
  const keys=[...groups.keys()].sort((a,b)=>a.localeCompare(b,"no"));
  const pin=V.pinned[name] && groups.has(V.pinned[name]) ? V.pinned[name] : null;
  const walkMs=V.walk*60e3, pool=(pin?groups.get(pin):all).filter(d=>d.when-walkMs>=now-30e3);
  const target=pool[0], goMin=target?(target.when-walkMs-now)/60e3:null;
  const go = target ? `<div class="go ${goMin<1?"now":""}"><small>${goMin<1?t("go"):t("goIn")}</small><b class="num">${goMin<1?t("now"):Math.floor(goMin)+" min"}</b><em>${t("lineAt",esc(target.j.line),hm(target.when))}</em></div>` : `<div class="go"><small>${t("goIn")}</small><b>–</b></div>`;
  const near = V.near && V.near[0] && V.near[0].name===name ? `<small class="near">📍 ${V.near[0].distance} m</small>` : "";
  const row=d=>{
    const m=(d.when-now)/60e3, col=COLORS[d.j.line];
    let pos;
    if(d.away==null) pos = d.first===name ? t("startsHere") : t("waitingAt",esc(d.first));
    else if(d.at && d.away<0.05) pos = t("atStation");
    else { const n=Math.ceil(d.away-1e-6); pos = (n<=1 && !d.at) ? t("nextFrom",esc(d.where)) : t("stopsAway",n,d.at,esc(d.where)); }
    const dl = d.delay>=180 ? ` · <span class="bd">+${Math.round(d.delay/60)} min</span>` : d.delay>=60 ? ` · <span class="lt">+${Math.round(d.delay/60)} min</span>` : "";
    const pct = d.away==null ? 0 : Math.max(4, 100-Math.min(100,d.away*12));
    return `<div class="dep"><span class="badge" style="background:${col}">${esc(d.j.line)}</span><span class="t"><b>${esc(d.j.dest||"")}</b><small>${pos}${dl}</small></span>
      <span class="m num ${m<1?"now":""}">${m<1?t("now"):Math.floor(m)}${m<1?"":`<small>${t("min")}</small>`}</span><span class="prog"><i style="width:${pct}%;background:${col}"></i></span>
      <span class="acts"><button class="mini log" data-logj="${esc(d.j.id)}" data-logs="${esc(name)}">${t("logThis")}</button><button class="mini" data-pingj="${esc(d.j.id)}" data-logs="${esc(name)}">${t("pingThis")}</button></span></div>`;
  };
  const html=`<div class="fav"><div><b>${esc(name)}</b>${near}<button class="chg" id="chg">${t("changeStation")}</button></div>${go}</div>
    ${hooks.banner?hooks.banner(name):""}
    <div class="walk"><span>${t("walkTime")}</span><button id="wm" aria-label="−">−</button><b class="num">${V.walk} min</b><button id="wp" aria-label="+">+</button></div>
    ${keys.length ? keys.map(k=>`<div class="grp"><h3><span>${t("nextStop",esc(k))}</span><button data-pin="${esc(k)}" aria-pressed="${pin===k}">${pin===k?t("myDir"):t("notMyDir")}</button></h3>${groups.get(k).slice(0,4).map(row).join("")}</div>`).join("")
      : `<p class="none">${t("noDeps")}</p>`}`;
  if(html!==stnHTML){ box.innerHTML=html; stnHTML=html; }
}
export function buildPicker(target){
  const box=target||content;
  const names=Object.keys(L.IDSOF).sort((a,b)=>a.localeCompare(b,"no"));
  const item=n=>`<li><button data-stn="${esc(n)}"><span>${esc(n)}</span><span class="dots">${[...L.LINESAT[n]].sort().map(c=>`<i style="background:${COLORS[c]}"></i>`).join("")}</span></button></li>`;
  const recent=V.recent.filter(n=>L.IDSOF[n]);
  const near=(V.near||[]).filter(n=>L.IDSOF[n.name]);
  box.innerHTML=`<div class="picker">
    <label class="label" for="q">${t("pickStation")}</label>
    <input id="q" type="search" placeholder="${t("search")}" autocomplete="off" enterkeyhint="search">
    ${store("bp.loc")!==false?`<button class="btn" id="loc">📍 ${t("useLocation")}</button>`:""}
    ${near.length?`<h3>${t("nearby")}</h3><ul class="plist">${near.map(n=>item(n.name).replace("</span><span class=\"dots\">",` <small>${n.distance} m</small></span><span class="dots">`)).join("")}</ul>`:""}
    ${recent.length?`<h3>${t("recent")}</h3><ul class="plist">${recent.map(item).join("")}</ul>`:""}
    <h3>${t("allStations")}</h3><ul class="plist" id="all">${names.map(item).join("")}</ul></div>`;
  const q=$("#q",box), all=$("#all",box);
  q.oninput=()=>{ const v=q.value.trim().toLowerCase(); all.querySelectorAll("li").forEach(li=>li.hidden=!!v && !li.textContent.toLowerCase().includes(v)); };
}

/* ---------- timetable graph ---------- */
const SEGS = { tunnel:{key:"slTunnel", st:["Majorstuen","Nationaltheatret","Stortinget","Jernbanetorget","Grønland","Tøyen"]},
  east:{key:"slEast", st:["Tøyen","Ensjø","Helsfyr","Brynseng"]} };
const SHORT = {"Majorstuen":"Majorst.","Nationaltheatret":"Nat.th.","Stortinget":"Storting.","Jernbanetorget":"Jernb.t.","Grønland":"Grønland","Tøyen":"Tøyen","Ensjø":"Ensjø","Helsfyr":"Helsfyr","Brynseng":"Brynseng"};
let slLast=0;
function buildSL(){
  if(!SEGS[V.seg]) V.seg="tunnel";
  content.innerHTML=`<div class="sl"><div class="seg2" role="group">${Object.entries(SEGS).map(([k,v])=>`<button data-seg="${k}" aria-pressed="${k===V.seg}">${t(v.key)}</button>`).join("")}</div>
    <svg id="slg" viewBox="0 0 360 560" role="img" aria-label="${t("vGraph")}"></svg>
    <div class="lg"><span>${t("slHelp1")}</span><span>${t("slHelp2")}</span></div></div>`;
  slLast=0;
}
function drawSL(now){
  const svg=$("#slg",content); if(!svg || now-slLast<1000) return; slLast=now;
  const seg=SEGS[V.seg].st, W=360, H=560, top=30, bot=10, left=40, right=22, past=8*60e3, fut=14*60e3;
  const xs=i=>left+i*(W-left-right)/(seg.length-1), yt=ts=>top+(ts-(now-past))/(past+fut)*(H-top-bot), yNow=yt(now);
  let g=`<defs><clipPath id="cp"><rect x="0" y="${top-2}" width="${W}" height="${yNow-top+2}"/></clipPath><clipPath id="cf"><rect x="0" y="${yNow}" width="${W}" height="${H-yNow}"/></clipPath></defs>`;
  seg.forEach((n,i)=>{ const an=i===0?"start":i===seg.length-1?"end":"middle", lx=xs(i)+(i===0?-6:i===seg.length-1?6:0);
    g+=`<line x1="${xs(i)}" x2="${xs(i)}" y1="${top-4}" y2="${H-bot}" stroke="#262e38"/><text class="st" x="${lx}" y="14" text-anchor="${an}">${esc(SHORT[n]||n)}</text>`; });
  for(let m=Math.ceil((now-past)/120e3)*120e3; m<=now+fut; m+=120e3){ const y=yt(m); g+=`<line x1="${left-4}" x2="${W-right}" y1="${y}" y2="${y}" stroke="#171c22"/><text x="0" y="${y+3}">${hm(m)}</text>`; }
  const ix={}; seg.forEach((n,i)=>ix[n]=i);
  let lines="";
  for(const j of L.JOURNEYS){
    const runs=[]; let cur=[];
    for(const c of j.calls){ if(c.cancel) continue; const i=ix[L.NAMEOF[c.stop]];
      if(i==null){ if(cur.length) runs.push(cur), cur=[]; continue; }
      const a=c.arr!=null?c.arr:c.dep, d=c.dep!=null?c.dep:c.arr; if(a==null) continue;
      cur.push([xs(i),yt(a)],[xs(i),yt(d)]); }
    if(cur.length) runs.push(cur);
    for(const r of runs){ if(r.length<4) continue;
      const pts=r.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
      lines+=`<polyline points="${pts}" fill="none" stroke="${COLORS[j.line]}" stroke-width="2.2" stroke-linejoin="round" clip-path="url(#cp)"/>`
           +`<polyline points="${pts}" fill="none" stroke="${COLORS[j.line]}" stroke-width="1.6" stroke-dasharray="4 3" opacity=".75" clip-path="url(#cf)"/>`; }
  }
  g+=`<svg x="${left-6}" y="${top-4}" width="${W-left-right+12}" height="${H-top-bot+4}" viewBox="${left-6} ${top-4} ${W-left-right+12} ${H-top-bot+4}" overflow="hidden">${lines}</svg>`;
  g+=`<line x1="${left-4}" x2="${W-right}" y1="${yNow}" y2="${yNow}" stroke="#eef1f4" stroke-width="1.4"/><rect x="${W-right-36}" y="${yNow-9}" width="36" height="17" rx="5" fill="#eef1f4"/><text x="${W-right-18}" y="${yNow+3.5}" text-anchor="middle" style="fill:#0c0f13;font-weight:700">${t("nowLbl")}</text>`;
  svg.innerHTML=g;
}

/* ---------- events (delegated on the content and sheet) ---------- */
function bind(){
  content.addEventListener("pointerdown",e=>{ if(hooks.active&&!hooks.active()) return; const b=e.target.closest(".train"); if(!b) return; V.sel=b.dataset.j; tick(); });
  sheet.addEventListener("pointerdown",e=>{ if(e.target.closest(".x")) closeSheet(); });
  sheet.addEventListener("click",e=>{
    const lg=e.target.closest("[data-logj]"); if(lg){ const j=L.JOURNEYS.find(x=>x.id===lg.dataset.logj); closeSheet(); if(j) hooks.onLog(j, lg.dataset.logs); return; }
    const b=e.target.closest("[data-show]"); if(!b) return;
    const id=V.sel, j=L.JOURNEYS.find(x=>x.id===id); if(!j) return;
    V.view=b.dataset.show; store("bp.view",V.view); if(V.view==="line"){ V.line=j.line; store("bp.line",V.line); }
    hooks.onView(); V.sel=id; tick();
    if(V.view==="line"){ const tr=content.querySelector(".train.sel"); if(tr) content.scrollTop=Math.max(0,parseFloat(tr.style.top)-140); } else focusTrain(id);
  });
  content.addEventListener("click",async e=>{
    if(hooks.active&&!hooks.active()) return;
    const tg=e.target;
    const lp=tg.closest("[data-l]"); if(lp){ V.line=lp.dataset.l; store("bp.line",V.line); closeSheet(); build(); content.scrollTop=0; return; }
    const sg=tg.closest("[data-seg]"); if(sg){ V.seg=sg.dataset.seg; store("bp.seg",V.seg); build(); return; }
    const lg=tg.closest("[data-logj]"); if(lg){ const j=L.JOURNEYS.find(x=>x.id===lg.dataset.logj); if(j) hooks.onLog(j, lg.dataset.logs); return; }
    const pg=tg.closest("[data-pingj]"); if(pg){ const j=L.JOURNEYS.find(x=>x.id===pg.dataset.pingj); if(j) hooks.onPing(j, pg.dataset.logs); return; }
    if(V.view!=="stn") return;
    if(tg.closest("#chg")){ V.picking=true; build(); return; }
    if(tg.closest("#wm")){ V.walk=Math.max(0,V.walk-1); store("bp.walk",V.walk); tick(); return; }
    if(tg.closest("#wp")){ V.walk=Math.min(30,V.walk+1); store("bp.walk",V.walk); tick(); return; }
    if(tg.closest("#loc")){ const b=tg.closest("#loc"); b.textContent=t("locating"); try{ V.near=await locate(); if(V.near[0]){ setStation(V.near[0].name); build(); } }catch(err){ b.textContent=t("locFail"); } return; }
    const pb=tg.closest("[data-pin]"); if(pb){ const k=pb.dataset.pin; if(V.pinned[V.stn]===k) delete V.pinned[V.stn]; else V.pinned[V.stn]=k; store("bp.pin",V.pinned); tick(); return; }
    const ps=tg.closest("[data-stn]"); if(ps){ setStation(ps.dataset.stn); build(); content.scrollTop=0; }
  });
}
