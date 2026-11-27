/* Trips and their analysis. Three kinds share one list:
   study    – a time study along a departure: taps for arrival/departure at each stop,
              compared with the plan and realtime for that departure.
   platform – a session at one station: arrival/departure of every train, matched to departures.
   ping     – "I'm on this train": a departure and a moment, no timing.
   Tap times are stored raw (phone clock). The clock offset from the sync is stored with
   the trip and added when times are used, so the raw data stays available. */

export const Q = { runMin:20, runMax:600, dwellMin:5, dwellMax:300, undoMax:5 };
export const off = x => (x && x.clock && Number.isFinite(x.clock.offset)) ? x.clock.offset : 0;

/* ---------- study ---------- */
export function tripState(trip){
  const last=trip.events[trip.events.length-1];
  if(!last) return {mode:"dep", idx:trip.startIdx, since:null};
  if(last.type==="arr") return {mode:"dep", idx:last.idx, since:last.t};
  return {mode:"arr", idx:last.idx+1, from:last.idx, since:last.t};
}
export function stops(trip){
  const o=off(trip), out=[]; let cur=null;
  for(const e of trip.events){
    const t=e.t+o;
    const src=e.source||"manual";
    if(e.type==="dep"){ if(cur && cur.idx===e.idx && cur.dep==null){ cur.dep=t; cur.ds=src; } else { cur={idx:e.idx,arr:null,dep:t,as:null,ds:src}; out.push(cur);} }
    else { cur={idx:e.idx,arr:t,dep:null,as:src,ds:null}; out.push(cur); }
  }
  return out;
}
export function segments(trip){
  const list=stops(trip), r=trip.route;
  return list.map((s,i)=>{ const n=list[i+1]; return {
    seq:i+1, idx:s.idx, station:r[s.idx].name, stopId:r[s.idx].id||"", arr:s.arr, dep:s.dep, arrSrc:s.as, depSrc:s.ds,
    dwell:(s.arr!=null&&s.dep!=null)?s.dep-s.arr:null,
    run:(s.dep!=null&&n&&n.arr!=null)?n.arr-s.dep:null,
    to:n?r[n.idx].name:"", note:(trip.notes||{})[s.idx]||""
  };});
}
export function totals(trip){
  const sg=segments(trip), ev=trip.events, o=off(trip);
  return { total: ev.length>1 ? ev[ev.length-1].t-ev[0].t : 0,
    run: sg.reduce((a,x)=>a+(x.run||0),0), dwell: sg.reduce((a,x)=>a+(x.dwell||0),0), legs: sg.filter(x=>x.run!=null).length,
    endName: sg.length ? sg[sg.length-1].station : trip.route[trip.startIdx].name, o };
}
export function quality(trip){
  const flags=[];
  segments(trip).forEach(x=>{
    if(x.run!=null){ if(x.run<Q.runMin*1000) flags.push({code:"run_short",seq:x.seq}); else if(x.run>Q.runMax*1000) flags.push({code:"run_long",seq:x.seq}); }
    if(x.dwell!=null){ if(x.dwell<Q.dwellMin*1000) flags.push({code:"dwell_short",seq:x.seq}); else if(x.dwell>Q.dwellMax*1000) flags.push({code:"dwell_long",seq:x.seq}); }
  });
  if((trip.undos||0)>=Q.undoMax) flags.push({code:"many_undos"});
  trip.events.forEach((e,i)=>{ if(i && e.t<trip.events[i-1].t) flags.push({code:"clock_jump",seq:i}); });
  const st=stops(trip), lastIdx=st.length?st[st.length-1].idx:trip.startIdx;
  if(trip.endedBy==="manual" && lastIdx<trip.endIdx) flags.push({code:"ended_early"});
  if(!trip.clock) flags.push({code:"clock_unsynced"});
  return {flags, status: flags.some(f=>!["ended_early","clock_unsynced"].includes(f.code)) ? "review" : "ok"};
}

/* Realtime value for one stop and event: actual if there is one, else expected.
   copy = the "actual" time equals the plan to the second on a whole minute: probably not measured. */
export function rtValue(call, kind){
  if(!call) return null;
  const a = kind==="arr" ? (call.aArr ?? call.aDep) : (call.aDep ?? call.aArr);
  const x = kind==="arr" ? (call.xArr ?? null) : (call.xDep ?? null);
  const e = kind==="arr" ? (call.eArr ?? call.eDep) : (call.eDep ?? call.eArr);
  if(x!=null) return {v:x, actual:true, copy: a!=null && x===a && x%60000===0, plan:a};
  if(e!=null) return {v:e, actual:false, copy:false, plan:a};
  return a!=null ? {v:null, actual:false, copy:false, plan:a} : null;
}
/* One row per measured event, with plan, realtime and Δ (measured − realtime, s). */
export function compare(trip){
  const rows=[], calls=trip.rt&&trip.rt.calls;
  for(const s of stops(trip)){
    for(const kind of ["arr","dep"]){
      const me = kind==="arr" ? s.arr : s.dep; if(me==null) continue;
      const call = calls ? calls[s.idx] : null, rv=rtValue(call,kind);
      const plan = rv ? rv.plan : null;
      const delta = rv && rv.v!=null && !rv.copy ? Math.round((me-rv.v)/100)/10 : null;
      rows.push({idx:s.idx, station:trip.route[s.idx].name, kind, plan, rt:rv, me, delta});
    }
  }
  return rows;
}
export function summary(trip){
  const rows=compare(trip), d=rows.filter(r=>r.delta!=null && r.rt.actual);
  const dAll = d.length ? d : rows.filter(r=>r.delta!=null);
  const out={rows, n:dAll.length, actualBased:d.length>0, copies:rows.filter(r=>r.rt&&r.rt.copy).length};
  if(dAll.length){
    out.mean = dAll.reduce((a,r)=>a+r.delta,0)/dAll.length;
    out.meanAbs = dAll.reduce((a,r)=>a+Math.abs(r.delta),0)/dAll.length;
    const w = dAll.reduce((b,r)=>Math.abs(r.delta)>Math.abs(b.delta)?r:b, dAll[0]);
    out.max=Math.abs(w.delta); out.maxAt=w.station;
  }
  // measured vs plan, from the first departure to the last arrival
  const st=stops(trip), calls=trip.rt&&trip.rt.calls;
  if(calls && st.length>1){
    const f=st[0], l=st[st.length-1], cf=calls[f.idx], cl=calls[l.idx];
    const pf = cf && (cf.aDep ?? cf.aArr), pl = cl && (cl.aArr ?? cl.aDep);
    if(f.dep!=null && l.arr!=null && pf!=null && pl!=null){
      out.planSpan=pl-pf; out.meSpan=l.arr-f.dep; out.vsPlan=out.meSpan-out.planSpan;
      // which leg (departure to next departure/arrival) lost most against the plan
      let worst=null;
      for(let i=0;i<st.length-1;i++){ const a=st[i], b=st[i+1], ca=calls[a.idx], cb=calls[b.idx];
        const me=(b.arr ?? b.dep)-(a.dep ?? a.arr), pa=ca&&(ca.aDep??ca.aArr), pb=cb&&(cb.aArr??cb.aDep);
        if(me==null||pa==null||pb==null||Number.isNaN(me)) continue; const loss=me-(pb-pa);
        if(!worst || loss>worst.loss) worst={loss, from:trip.route[a.idx].name, to:trip.route[b.idx].name}; }
      out.worstLeg=worst;
      out.departLate = (cf && cf.aDep!=null && f.dep!=null) ? f.dep-cf.aDep : null;
    }
  }
  return out;
}

/* ---------- platform ---------- */
const median = a => { if(!a.length) return null; const s=a.slice().sort((x,y)=>x-y), m=s.length>>1; return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
export { median };
export function platformRows(ses){
  const o=off(ses), byGrp={}, out=[];
  ses.recs.forEach(r=>{
    const arr=r.arr!=null?r.arr+o:null, dep=r.dep!=null?r.dep+o:null;
    const prev = byGrp[r.grp]; const headway = prev!=null && dep!=null ? dep-prev : null; if(dep!=null) byGrp[r.grp]=dep;
    out.push({...r, arrC:arr, depC:dep, dwell: arr!=null&&dep!=null ? dep-arr : null, headway});
  });
  return out;
}
export function platformStats(ses){
  const rows=platformRows(ses);
  return { trains:rows.length, dwell:median(rows.map(r=>r.dwell).filter(v=>v!=null)), headway:median(rows.map(r=>r.headway).filter(v=>v!=null)) };
}

/* ---------- my trends (study trips only) ---------- */
export function trends(trips){
  const legs={}, absD=[]; let legsN=0; const lines=new Set();
  for(const tr of trips){
    if(tr.kind==="ping"){ lines.add(tr.line); continue; }
    if(tr.kind!=="study") continue;
    const sg=segments(tr); if(sg.some(x=>x.run!=null)) lines.add(tr.line);
    const calls=tr.rt&&tr.rt.calls;
    sg.forEach((x,i)=>{ if(x.run==null) return; legsN++;
      const k=x.station+"|"+x.to; (legs[k]||(legs[k]={a:x.station,b:x.to,runs:[],plan:[]})).runs.push(x.run);
      if(calls){ const ca=calls[x.idx], nb=sg[i+1], cb=nb&&calls[nb.idx]; const p=ca&&cb&&(cb.aArr??cb.aDep)-(ca.aDep??ca.aArr); if(p) legs[k].plan.push(p); } });
    summary(tr).rows.forEach(r=>{ if(r.delta!=null && r.rt && r.rt.actual) absD.push(Math.abs(r.delta)); });
  }
  const top=Object.values(legs).sort((x,y)=>y.runs.length-x.runs.length).slice(0,4).map(l=>({...l, median:median(l.runs), planMedian:median(l.plan)}));
  return {legs:top, legsN, lines, rtAbs: absD.length ? absD.reduce((a,b)=>a+b,0)/absD.length : null, rtN:absD.length};
}
