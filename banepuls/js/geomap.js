/* Geographic map: Kartverket's grey base map, the real metro tracks from Entur (pointsOnLink),
   stations and trains in realtime placed along the track. Leaflet is vendored in vendor/leaflet
   and loaded the first time the map opens. Without network the tracks and trains still show. */
import { esc, t, store, COLORS } from "./core.js";
import { L as E, loadGeometry, geoAt, linePath, pieceOf } from "./entur.js";

const TILES = "https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png";
const ATTR = '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a> · Rutedata <a href="https://entur.no/" target="_blank" rel="noopener">Entur</a>';
const ORDER = ["3","2","1","4","5"];
export const GM = { shown: new Set(store("bp.geoLines")||Object.keys(COLORS)), view: store("bp.geoView")||null };

let LF=null, map=null, box=null, hooks={}, trainLayer=null, lineLayers={}, markers=new Map(), me=null, follow=null, sel=null, last=0, ready=false;

function loadLeaflet(){
  if(window.L && window.L.map) return Promise.resolve(window.L);
  if(loadLeaflet.p) return loadLeaflet.p;
  const css=document.createElement("link"); css.rel="stylesheet"; css.href="vendor/leaflet/leaflet.css"; document.head.appendChild(css);
  loadLeaflet.p=new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="vendor/leaflet/leaflet.js"; s.onload=()=>res(window.L); s.onerror=()=>{ loadLeaflet.p=null; rej(new Error("leaflet")); }; document.head.appendChild(s); });
  return loadLeaflet.p;
}

/* Build the map inside `el` (an element in the Now tab). hooks: onTrain(id), onStation(name). */
export async function openGeoMap(el, h){
  close();
  box=el; hooks=h; ready=false;
  el.innerHTML=`<div class="gmap" id="gmap"><p class="hint pad">${t("mapLoading")}</p></div>
    <div class="gctl" role="group" aria-label="${t("line")}">${Object.keys(COLORS).filter(k=>E.NET.lines[k]).map(k=>`<button style="--lc:${COLORS[k]}" data-gl="${k}" aria-pressed="${GM.shown.has(k)}">${k}</button>`).join("")}</div>
    <div class="zoom"><button id="gzi" aria-label="Zoom in">+</button><button id="gzo" aria-label="Zoom out">−</button><button id="gzf" aria-label="${t("wholeNet")}">⤢</button>${navigator.geolocation?`<button id="gme" aria-label="${t("myPos")}">◎</button>`:""}</div>`;
  const mine=box;
  try{ LF=await loadLeaflet(); }catch(e){ if(box===mine) mine.querySelector("#gmap").innerHTML=`<p class="hint pad">${t("mapFail")}</p>`; return; }
  try{ await loadGeometry(); }catch(e){ /* straight lines between stations */ }
  if(box!==mine || !mine.isConnected) return;
  const div=mine.querySelector("#gmap"); div.innerHTML="";
  map=LF.map(div,{zoomControl:false, attributionControl:true, minZoom:10, maxZoom:18, zoomSnap:0.5, tap:false});
  map.attributionControl.setPrefix(false);
  LF.tileLayer(TILES,{maxZoom:18, attribution:ATTR, crossOrigin:true, className:"gtiles"}).addTo(map);
  // tracks: where lines share track they are drawn side by side (offset in screen pixels, redrawn on zoom)
  const all=[]; for(const code of ORDER) if(E.NET.lines[code]) all.push(...linePath(code));
  const casing=LF.layerGroup().addTo(map), colour=LF.layerGroup().addTo(map);
  for(const code of ORDER){ if(!E.NET.lines[code]) continue;
    const c=LF.polyline([],{color:"#0c0f13",weight:8,opacity:.75,interactive:false}).addTo(casing);
    const l=LF.polyline([],{color:COLORS[code],weight:4,opacity:1,interactive:false,lineJoin:"round"}).addTo(colour);
    lineLayers[code]={c,l}; }
  // stations
  const seen=new Set(), st=LF.layerGroup().addTo(map);
  for(const Ln of Object.values(E.NET.lines)) for(const s of Ln.stations){ if(seen.has(s.name)) continue; seen.add(s.name);
    const P=E.NET.pos[s.id]; if(!P) continue;
    const m=LF.circleMarker(P,{radius:4.5,color:"#0c0f13",weight:2,fillColor:"#eef1f4",fillOpacity:1,className:"gst"}).addTo(st);
    m.bindTooltip(esc(s.name),{permanent:true,direction:"right",offset:[6,0],className:"glbl"});
    m.on("click",()=>hooks.onStation&&hooks.onStation(s.name)); }
  trainLayer=LF.layerGroup().addTo(map);
  const bounds=LF.latLngBounds(all.length?all:[[59.85,10.6],[59.98,10.95]]);
  map._bpAll=bounds;
  map.setView(GM.view?GM.view.c:[59.924,10.77], GM.view?GM.view.z:12.5);
  drawTracks(); map.on("zoomend",drawTracks);
  const labels=()=>{ div.classList.toggle("labels", map.getZoom()>=14); div.classList.toggle("far", map.getZoom()<12); };
  map.on("zoomend",labels); labels();
  map.on("moveend",()=>{ const c=map.getCenter(); GM.view={c:[+c.lat.toFixed(5),+c.lng.toFixed(5)], z:map.getZoom()}; store("bp.geoView",GM.view); });
  map.on("dragstart",()=>{ follow=null; });
  map.on("click",()=>{ if(sel && hooks.onTrain) hooks.onTrain(null); });
  mine.querySelector("#gzi").onclick=()=>map.zoomIn();
  mine.querySelector("#gzo").onclick=()=>map.zoomOut();
  mine.querySelector("#gzf").onclick=()=>{ follow=null; map.fitBounds(map._bpAll,{padding:[16,16]}); };
  const gm=mine.querySelector("#gme"); if(gm) gm.onclick=locateMe;
  mine.querySelectorAll("[data-gl]").forEach(b=>b.onclick=()=>{ const k=b.dataset.gl;
    if(GM.shown.has(k) && GM.shown.size>1) GM.shown.delete(k); else GM.shown.add(k);
    if(GM.shown.size===Object.keys(COLORS).length-1 && !GM.shown.has(k)){}
    store("bp.geoLines",[...GM.shown]); applyFilter(); update(Date.now(),true); });
  applyFilter();
  ready=true; update(Date.now(),true);
  if(follow) focus(follow);
}
function applyFilter(){
  if(!box) return;
  box.querySelectorAll("[data-gl]").forEach(b=>b.setAttribute("aria-pressed",GM.shown.has(b.dataset.gl)));
  for(const [k,g] of Object.entries(lineLayers)){ const on=GM.shown.has(k); g.c.setStyle({opacity:on?.75:.08}); g.l.setStyle({opacity:on?1:.15}); }
}
/* lane offsets: for every stop pair, the lines that use it get a lane each, in a fixed order */
const uk=(a,b)=>a<b?a+"|"+b:b+"|"+a;
function lanes(){
  const u={};
  for(const code of ORDER){ const Ln=E.NET.lines[code]; if(!Ln) continue; const st=Ln.stations;
    for(let k=0;k<st.length-1;k++){ const key=uk(st[k].id,st[k+1].id); (u[key]||(u[key]=[])).includes(code)||u[key].push(code); } }
  return u;
}
function offsetLine(pts,d){
  if(!d || pts.length<2) return pts;
  const nrm=(a,b)=>{ const dx=b.x-a.x, dy=b.y-a.y, l=Math.hypot(dx,dy)||1; return [-dy/l,dx/l]; };
  return pts.map((p,i)=>{
    const n1=i>0?nrm(pts[i-1],p):null, n2=i<pts.length-1?nrm(p,pts[i+1]):null;
    if(!n1) return LF.point(p.x+n2[0]*d,p.y+n2[1]*d);
    if(!n2) return LF.point(p.x+n1[0]*d,p.y+n1[1]*d);
    const mx=n1[0]+n2[0], my=n1[1]+n2[1], k=Math.max(.35,1+n1[0]*n2[0]+n1[1]*n2[1]);
    return LF.point(p.x+mx/k*d, p.y+my/k*d);
  });
}
let LANES=null;
function drawTracks(){
  if(!map) return;
  if(!LANES) LANES=lanes();
  const z=map.getZoom(), w=z<11.5?2.5:z<13?3.5:z<15?4.5:6;
  for(const code of ORDER){ const g=lineLayers[code]; if(!g) continue; const st=E.NET.lines[code].stations, out=[];
    for(let k=0;k<st.length-1;k++){ const a=st[k].id, b=st[k+1].id, us=LANES[uk(a,b)]||[code];
      const lane=us.indexOf(code)-(us.length-1)/2, fwd=a<b;
      let piece=pieceOf(fwd?a:b, fwd?b:a).map(p=>map.latLngToLayerPoint(p));
      piece=offsetLine(piece, lane*w*1.1);
      if(!fwd) piece=piece.reverse();
      out.push(...piece.map(p=>map.layerPointToLatLng(p))); }
    g.c.setLatLngs(out).setStyle({weight:w+3.5}); g.l.setLatLngs(out).setStyle({weight:w}); }
}
function locateMe(){
  const b=box.querySelector("#gme"); b.classList.add("busy");
  navigator.geolocation.getCurrentPosition(p=>{ b.classList.remove("busy");
    const ll=[p.coords.latitude,p.coords.longitude];
    if(!me) me=LF.circleMarker(ll,{radius:7,color:"#fff",weight:2.5,fillColor:"#3d8bfd",fillOpacity:1,interactive:false}).addTo(map); else me.setLatLng(ll);
    follow=null; map.setView(ll, Math.max(map.getZoom(),15)); },
    ()=>{ b.classList.remove("busy"); b.classList.add("fail"); }, {enableHighAccuracy:true, timeout:12000, maximumAge:30000});
}
function icon(j,g,isSel){
  const ring=g.s.delay>=180?"bad":g.s.delay>=60?"late":"";
  return LF.divIcon({className:"gtr", iconSize:[30,30], iconAnchor:[15,15],
    html:`<span class="ar" style="transform:rotate(${Math.round(g.bearing)}deg)"><i style="border-bottom-color:${COLORS[j.line]}"></i></span><b class="${ring} ${g.s.wait?"wait":""} ${isSel?"sel":""}" style="background:${COLORS[j.line]}">${esc(j.line)}</b>`});
}
/* Called from the live tick (~every frame) and after each realtime poll. */
export function update(now, force){
  if(!ready || !map) return null;
  if(!force && now-last<500) return null; last=now;
  const seen=new Set(); let n=0, ok=0, sum=0;
  for(const j of E.JOURNEYS){
    const g=geoAt(j,now); if(!g) continue;
    n++; if(g.s.delay<180) ok++; sum+=Math.max(0,g.s.delay);
    if(!GM.shown.has(j.line) && j.id!==sel) continue;
    seen.add(j.id);
    const key=`${j.line}|${Math.round(g.bearing/15)}|${g.s.delay>=180?2:g.s.delay>=60?1:0}|${g.s.wait?1:0}|${j.id===sel?1:0}`;
    let m=markers.get(j.id);
    if(!m){ m=LF.marker([g.lat,g.lng],{icon:icon(j,g,j.id===sel), keyboard:true, title:`${j.line} ${j.dest||""}`, zIndexOffset:j.id===sel?1000:0}); m._k=key;
      m.on("click",e=>{ LF.DomEvent.stopPropagation(e); hooks.onTrain&&hooks.onTrain(j.id); }); m.addTo(trainLayer); markers.set(j.id,m); }
    else { m.setLatLng([g.lat,g.lng]); if(m._k!==key){ m.setIcon(icon(j,g,j.id===sel)); m.setZIndexOffset(j.id===sel?1000:0); m._k=key; } }
    if(follow===j.id) map.panTo(high([g.lat,g.lng]),{animate:true,duration:.5});
  }
  for(const [id,m] of markers) if(!seen.has(id)){ trainLayer.removeLayer(m); markers.delete(id); }
  return {n, ok, sum};
}
export function setSelected(id){ sel=id; if(ready) update(Date.now(),true); }
// Map centre that puts ll in the upper third (the train sheet covers the lower part).
function high(ll,z){ z=z??map.getZoom(); const h=map.getSize().y; return map.unproject(map.project(ll,z).add([0,h*0.22]),z); }
// Centre on a train and follow it until the map is dragged.
export function focus(id){
  follow=id; sel=id;
  if(!ready) return;
  const j=E.JOURNEYS.find(x=>x.id===id), g=j&&geoAt(j,Date.now());
  if(g){ const z=Math.max(map.getZoom(),14.5); map.setView(high([g.lat,g.lng],z), z); }
  update(Date.now(),true);
}
export function isOpen(){ return ready && box && box.isConnected; }
export function close(){
  if(map){ map.remove(); map=null; }
  markers.clear(); lineLayers={}; LANES=null; trainLayer=null; me=null; ready=false; box=null; follow=null; sel=null;
}
