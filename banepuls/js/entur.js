/* Entur Journey Planner v3 (open API, CORS enabled).
   Network model and realtime calls are ported from Linjeblikk. Additions for Banepuls:
   - the service date of each call (needed to fetch a whole journey afterwards),
   - fetchJourney(): every stop of one departure with plan, expected and actual times,
   - nearestStations(): metro stations near a position.
   Findings (Nov 2026): actual times exist for the metro with second resolution, usually one
   timestamp per stop (arrival = departure). Some "actual" times equal the plan to the second
   and are probably copied from it. Actual times disappear from the API after about 60–90 min. */
import { store } from "./core.js";

export const API = "https://api.entur.io/journey-planner/v3/graphql";
const CLIENT = "ksamann-banepuls";
export const POLL_MS = 20000;
const NET_TTL = 12 * 3600e3;
export const TERMINI = {"1":["Frognerseteren","Bergkrystallen"],"2":["Østerås","Ellingsrudåsen"],"3":["Kolsås","Mortensrud"],"4":["Vestli","Bergkrystallen"],"5":["Sognsvann","Vestli"]};

export const L = { NET:null, JOURNEYS:[], lastOk:0, lastErr:null, NAMEOF:null, IDSOF:null, LINESAT:null };

export async function gql(query){
  const r = await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","ET-Client-Name":CLIENT},body:JSON.stringify({query})});
  if(!r.ok) throw new Error("HTTP "+r.status);
  const j = await r.json(); if(j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
const T = s => s ? Date.parse(s) : null;

/* ---------- network: lines and their station order ---------- */
export async function loadNetwork(){
  const c = store("bp.net");
  if(c && Date.now()-c.at < NET_TTL && c.v===1){ L.NET=c.net; indexStations(true); return; }
  const d = await gql(`{ lines(transportModes:[metro], authorities:["RUT:Authority:RUT"]) { publicCode journeyPatterns { quays { stopPlace { id name latitude longitude } } } } }`);
  const lines={}, ids=new Set(), pos={};
  for(const l of d.lines){
    if(!TERMINI[l.publicCode]) continue;
    // main route: the longest pattern between the line's official termini (others are short turns or diversions)
    const [A,B]=TERMINI[l.publicCode]; let best=[], fallback=[];
    for(const jp of l.journeyPatterns){
      let s=jp.quays.map(q=>({id:q.stopPlace.id,name:q.stopPlace.name}));
      jp.quays.forEach(q=>{ ids.add(q.stopPlace.id); if(q.stopPlace.latitude) pos[q.stopPlace.id]=[q.stopPlace.latitude,q.stopPlace.longitude]; });
      if(s.length>fallback.length) fallback=s;
      if(s[0].name===B && s[s.length-1].name===A) s=s.slice().reverse();
      if(s[0].name===A && s[s.length-1].name===B && s.length>best.length) best=s;
    }
    if(!best.length) best=fallback;
    lines[l.publicCode]={stations:best};
  }
  L.NET={lines, stopIds:[...ids], pos};
  store("bp.net",{at:Date.now(),v:1,net:L.NET});
  indexStations(true);
}

export function indexStations(force){
  if(L.NAMEOF && !force) return;
  L.NAMEOF={}; L.IDSOF={}; L.LINESAT={};
  for(const [code,Ln] of Object.entries(L.NET.lines)) for(const s of Ln.stations){
    L.NAMEOF[s.id]=s.name; (L.IDSOF[s.name]||(L.IDSOF[s.name]=new Set())).add(s.id);
    (L.LINESAT[s.name]||(L.LINESAT[s.name]=new Set())).add(code);
  }
}

/* ---------- realtime calls (all metro stations, about 25 minutes) ---------- */
export async function loadCalls(){
  const start = new Date(Date.now()-8*60e3).toISOString();
  const d = await gql(`{ stopPlaces(ids:${JSON.stringify(L.NET.stopIds)}) { id estimatedCalls(startTime:"${start}", timeRange:1500, numberOfDepartures:50, whiteListedModes:[metro], includeCancelledTrips:true) {
    stopPositionInPattern date aimedArrivalTime expectedArrivalTime actualArrivalTime aimedDepartureTime expectedDepartureTime actualDepartureTime cancellation
    destinationDisplay{frontText} serviceJourney{ id line{publicCode} } } } }`);
  const by = new Map();
  for(const sp of d.stopPlaces) for(const c of sp.estimatedCalls){
    const id=c.serviceJourney.id;
    if(!by.has(id)) by.set(id,{id, date:c.date, line:c.serviceJourney.line.publicCode, dest:c.destinationDisplay&&c.destinationDisplay.frontText, calls:[]});
    by.get(id).calls.push({stop:sp.id, p:c.stopPositionInPattern, cancel:c.cancellation,
      aArr:T(c.aimedArrivalTime), arr:T(c.actualArrivalTime)||T(c.expectedArrivalTime), aDep:T(c.aimedDepartureTime), dep:T(c.actualDepartureTime)||T(c.expectedDepartureTime),
      actualDep:!!c.actualDepartureTime});
  }
  const out=[];
  for(const j of by.values()){
    const Ln = L.NET.lines[j.line]; if(!Ln) continue;
    j.calls.sort((a,b)=>a.p-b.p);
    const m = mapToLine(j.calls, Ln.stations); if(!m) continue;
    j.dir=m.dir; j.calls.forEach((c,i)=>c.ix=m.ix[i]);
    out.push(j);
  }
  L.JOURNEYS = out; L.lastOk = Date.now(); L.lastErr = null;
}
// Map a journey's calls (sorted by pattern position) onto the line's station list.
export function mapToLine(calls, st){
  const n=st.length; let best=null;
  for(const dir of [0,1]){
    const idAt = i => (dir===0 ? st[i] : st[n-1-i]).id;
    for(let o=-calls[0].p; o<n; o++){
      let ok=true;
      for(const c of calls){ const i=c.p+o; if(i<0||i>=n||idAt(i)!==c.stop){ ok=false; break; } }
      if(ok){ const score=Math.abs(o); if(!best||score<best.score) best={dir,o,score}; }
    }
  }
  if(!best) return null;
  return {dir:best.dir, ix:calls.map(c=>{ const i=c.p+best.o; return best.dir===0 ? i : n-1-i; })};
}
// Position of a journey at time t: {pos (fractional index in line order), at, next (call index), delay s} or null.
export function stateAt(j,t){
  const cs=j.calls.filter(c=>!c.cancel); if(cs.length<2) return null;
  let i=-1; for(let k=0;k<cs.length;k++){ if(cs[k].dep!=null && cs[k].dep<=t) i=k; else break; }
  if(i===-1){
    const f=cs[0];
    if(f.arr!=null && f.arr<=t) return {pos:f.ix, at:true, next:0, delay:delayOf(f)};
    if(f.p===0 && f.dep!=null && f.dep-t < 4*60e3) return {pos:f.ix, at:true, wait:true, next:0, delay:delayOf(f)};
    return null;
  }
  if(i===cs.length-1) return null;
  const a=cs[i], b=cs[i+1];
  if(b.arr!=null && b.arr<=t) return {pos:b.ix, at:true, next:i+1, delay:delayOf(b)};
  const span=Math.max(1,(b.arr||b.dep)-a.dep), f=Math.min(1,Math.max(0,(t-a.dep)/span));
  return {pos:a.ix+(b.ix-a.ix)*f, at:false, next:i+1, delay:delayOf(b)};
}
export function delayOf(c){ const e=c.arr||c.dep, a=c.aArr||c.aDep; return (e&&a) ? Math.round((e-a)/1000) : 0; }

/* Departures at a station (by name) from the realtime window, soonest first. */
export function departures(name,t){
  const ids=L.IDSOF&&L.IDSOF[name]; if(!ids) return [];
  const out=[];
  for(const j of L.JOURNEYS){
    const cs=j.calls.filter(c=>!c.cancel), st=L.NET.lines[j.line].stations;
    for(let k=0;k<cs.length;k++){ const c=cs[k];
      if(!ids.has(c.stop) || c.dep==null || c.dep<t-15e3) continue;
      const s=stateAt(j,t); let away=null, where="";
      if(s){ const d = j.dir===0 ? c.ix-s.pos : s.pos-c.ix; if(d<-0.05) continue; away=Math.max(0,d);
        where = s.at ? st[Math.round(s.pos)].name : st[cs[s.next-1] ? cs[s.next-1].ix : Math.round(s.pos)].name; }
      const nIx = j.dir===0 ? c.ix+1 : c.ix-1, nx=cs[k+1];
      const next = st[nIx] ? st[nIx].name : nx ? L.NAMEOF[nx.stop] : (j.dest||"");
      out.push({j, c, when:c.dep, aimed:c.aDep, delay:delayOf(c), away, at:s&&s.at, wait:s&&s.wait, where, first:L.NAMEOF[cs[0].stop], next});
      break;
    }
  }
  return out.sort((a,b)=>a.when-b.when);
}

/* Every stop of one departure, with plan, expected and actual times.
   Actual times are only available for about an hour after the train has passed. */
export async function fetchJourney(id, date){
  const d = await gql(`{ serviceJourney(id:${JSON.stringify(id)}) { id line{publicCode} estimatedCalls(date:${JSON.stringify(date)}) {
    quay{ id publicCode stopPlace{ id name } } aimedArrivalTime expectedArrivalTime actualArrivalTime aimedDepartureTime expectedDepartureTime actualDepartureTime cancellation destinationDisplay{frontText} } } }`);
  const sj=d.serviceJourney; if(!sj) throw new Error("journey not found");
  return { id:sj.id, line:sj.line.publicCode, date, fetchedAt:Date.now(),
    dest: sj.estimatedCalls.length ? (sj.estimatedCalls[0].destinationDisplay||{}).frontText||"" : "",
    calls: sj.estimatedCalls.map(c=>({ id:c.quay.stopPlace.id, name:c.quay.stopPlace.name, quay:c.quay.publicCode||"",
      aArr:T(c.aimedArrivalTime), aDep:T(c.aimedDepartureTime), eArr:T(c.expectedArrivalTime), eDep:T(c.expectedDepartureTime),
      xArr:T(c.actualArrivalTime), xDep:T(c.actualDepartureTime), cancel:!!c.cancellation })) };
}

export async function nearestStations(lat, lon){
  const d = await gql(`{ nearest(latitude:${+lat}, longitude:${+lon}, maximumDistance:2000, filterByPlaceTypes:[stopPlace], filterByModes:[metro], first:3){ edges{ node{ distance place{ ... on StopPlace { id name } } } } } }`);
  return d.nearest.edges.map(e=>({id:e.node.place.id, name:e.node.place.name, distance:Math.round(e.node.distance)}));
}

export async function situations(){
  const d = await gql(`{ lines(transportModes:[metro], authorities:["RUT:Authority:RUT"]) { publicCode situations { id summary{value language} description{value language} validityPeriod{startTime endTime} } } }`);
  const now=Date.now(), seen=new Map();
  for(const l of d.lines) for(const s of l.situations){
    const v=s.validityPeriod||{}; if(v.endTime && Date.parse(v.endTime)<now) continue;
    const pick = arr => { arr=arr||[]; return (arr.find(x=>/^(no|nob|nb)$/i.test(x.language||""))||arr[0]||{}).value||""; };
    const pickEn = arr => { arr=arr||[]; return (arr.find(x=>/^en/i.test(x.language||""))||{}).value||""; };
    if(!seen.has(s.id)) seen.set(s.id,{id:s.id, lines:new Set(), summary:pick(s.summary), summaryEn:pickEn(s.summary), description:pick(s.description), descriptionEn:pickEn(s.description), start:T(v.startTime), end:T(v.endTime)});
    seen.get(s.id).lines.add(l.publicCode);
  }
  return [...seen.values()].map(s=>({...s, lines:[...s.lines].sort()}));
}
