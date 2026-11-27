/* Export (CSV, JSON v3), sending for analysis (mailto with the data in the body, or
   shared files when too long) and import (Banepuls files and T-bane logger files). */
import { APP_VERSION, isoLocal, pad, store, t, lang, deviceId } from "./core.js";
import { sensorPrecision } from "./motion.js";
import { segments, compare, summary, quality, platformRows, platformStats, off } from "./model.js";

const iso = v => v==null ? "" : isoLocal(v);
const r1 = ms => ms==null ? null : Math.round(ms/100)/10;
export const profile = () => ({ observer:(store("bp.name")||"").trim(), role:store("bp.role")||"" });

/* ---------- JSON v3: the raw records plus derived values, so analysts don't have to recompute ---------- */
function derived(x){
  if(x.kind==="study"){
    const s=summary(x);
    return { quality:quality(x), sensor_precision:sensorPrecision(x), segments:segments(x).map(g=>({seq:g.seq, station:g.station, stop_id:g.stopId, arrival:iso(g.arr)||null, departure:iso(g.dep)||null, arrival_source:g.arrSrc||null, departure_source:g.depSrc||null,
        dwell_s:r1(g.dwell), to_station:g.to||null, run_s:r1(g.run), note:g.note||null})),
      comparison:s.rows.map(r=>({station:r.station, event:r.kind==="arr"?"arrival":"departure", plan:iso(r.plan)||null, realtime:r.rt&&r.rt.v!=null?iso(r.rt.v):null,
        realtime_is_actual:!!(r.rt&&r.rt.actual), realtime_equals_plan:!!(r.rt&&r.rt.copy), measured:iso(r.me), delta_s:r.delta})),
      summary:{mean_delta_s:s.mean!=null?+s.mean.toFixed(2):null, mean_abs_delta_s:s.meanAbs!=null?+s.meanAbs.toFixed(2):null, max_abs_delta_s:s.max??null, compared:s.n,
        measured_span_s:r1(s.meSpan), plan_span_s:r1(s.planSpan), vs_plan_s:r1(s.vsPlan)} };
  }
  if(x.kind==="platform"){ const st=platformStats(x);
    return { trains:platformRows(x).map(r=>({line:r.line, destination:r.dest, journey_id:r.jid||null, plan_departure:iso(r.aDep)||null, arrival:iso(r.arrC)||null, departure:iso(r.depC)||null,
      dwell_s:r1(r.dwell), headway_s:r1(r.headway), direction_next_stop:r.grp})), summary:{trains:st.trains, median_dwell_s:r1(st.dwell), median_headway_s:r1(st.headway)} }; }
  return {};
}
export function toJSON(items){
  const p=profile();
  return JSON.stringify({ app:"banepuls", version:3, app_version:APP_VERSION, exported_at:isoLocal(Date.now()), device_id:deviceId(), observer:p.observer||null, role:p.role||null,
    items: items.map(x=>({...x, derived:derived(x)})) }, null, 2);
}

/* ---------- CSV: one row per measured stop (study), per train (platform) or per ping ---------- */
const COLS=["kind","id","date","line","direction","journey_id","seq","station","stop_id","plan_arrival","plan_departure","rt_arrival","rt_departure",
  "rt_is_actual","rt_equals_plan","measured_arrival","measured_departure","delta_arrival_s","delta_departure_s","dwell_s","run_s","headway_s","to_station","note","clock_offset_ms","observer","role","arrival_source","departure_source"];
export function toCSV(items){
  const sep = lang==="no" ? ";" : ",", dec = lang==="no" ? "," : ".";
  const num = v => v==null ? "" : String(v).replace(".",dec);
  const p=profile(), rows=[];
  for(const x of items){
    const base={kind:x.kind, id:x.id, line:x.line, direction:x.dest||x.towards||"", journey_id:(x.journey&&x.journey.id)||x.jid||"", clock_offset_ms:x.clock?x.clock.offset:"", observer:x._obs??p.observer, role:x._role??p.role};
    if(x.kind==="study"){
      const cmp=compare(x), calls=x.rt&&x.rt.calls;
      segments(x).forEach(g=>{
        const c=calls?calls[g.idx]:null, ra=cmp.find(r=>r.idx===g.idx&&r.kind==="arr"), rd=cmp.find(r=>r.idx===g.idx&&r.kind==="dep");
        const rv=(r)=>r&&r.rt&&r.rt.v!=null?iso(r.rt.v):"";
        rows.push({...base, date:iso(x.startedAt).slice(0,10), seq:g.seq, station:g.station, stop_id:g.stopId, plan_arrival:iso(c&&c.aArr), plan_departure:iso(c&&c.aDep),
          rt_arrival:rv(ra), rt_departure:rv(rd), rt_is_actual:(rd||ra)&&(rd||ra).rt?String(!!(rd||ra).rt.actual):"", rt_equals_plan:(rd||ra)&&(rd||ra).rt?String(!!(rd||ra).rt.copy):"",
          measured_arrival:iso(g.arr), measured_departure:iso(g.dep), delta_arrival_s:num(ra&&ra.delta), delta_departure_s:num(rd&&rd.delta),
          dwell_s:num(r1(g.dwell)), run_s:num(r1(g.run)), to_station:g.to, note:g.note, arrival_source:g.arr!=null?g.arrSrc:"", departure_source:g.dep!=null?g.depSrc:""});
      });
    } else if(x.kind==="platform"){
      platformRows(x).forEach((r,i)=>rows.push({...base, line:r.line, direction:r.dest, journey_id:r.jid||"", date:iso(x.startedAt).slice(0,10), seq:i+1, station:x.station,
        plan_departure:iso(r.aDep), rt_departure:iso(r.rtDep), measured_arrival:iso(r.arrC), measured_departure:iso(r.depC), dwell_s:num(r1(r.dwell)), headway_s:num(r1(r.headway)), to_station:r.grp}));
    } else if(x.kind==="ping"){
      rows.push({...base, date:iso(x.t).slice(0,10), seq:1, station:x.station, plan_departure:iso(x.aDep), rt_departure:iso(x.eDep), measured_departure:iso(x.t+off(x)), note:x.rating||""});
    }
  }
  const cell=v=>{ const s=String(v==null?"":v); return (s.includes(sep)||/["\n\r]/.test(s)) ? `"${s.replace(/"/g,'""')}"` : s; };
  return "﻿" + [COLS, ...rows.map(r=>COLS.map(k=>r[k]??""))].map(r=>r.map(cell).join(sep)).join("\r\n") + "\r\n";
}

export function baseName(items){
  const d=new Date(items.length===1 ? (items[0].startedAt||items[0].t) : Date.now());
  const stamp=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  if(items.length!==1) return `banepuls_${items.length}_${stamp}`;
  const x=items[0], slug=s=>String(s||"").replace(/[\\/:*?"<>|]+/g,"").replace(/\s+/g,"");
  if(x.kind==="study") return `banepuls_L${x.line}_${slug(x.route[x.startIdx].name)}-${slug(segments(x).slice(-1)[0]?.station||"")}_${stamp}`;
  if(x.kind==="platform") return `banepuls_perrong_${slug(x.station)}_${stamp}`;
  return `banepuls_ping_L${x.line}_${stamp}`;
}
export function makeFiles(items, name){
  return { csv:new File([toCSV(items)], name+".csv", {type:"text/csv"}), json:new File([toJSON(items)], name+".json", {type:"application/json"}) };
}
export function download(file){
  const url=URL.createObjectURL(file), a=document.createElement("a");
  a.href=url; a.download=file.name; a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
export async function shareFiles(items){
  const name=baseName(items), f=makeFiles(items,name), files=[f.csv,f.json];
  try{ if(navigator.canShare && navigator.canShare({files})){ await navigator.share({files, title:name, text:name}); return "shared"; } }
  catch(e){ if(e && e.name==="AbortError") return "aborted"; }
  download(f.csv); setTimeout(()=>download(f.json),400); return "downloaded";
}

/* Send for analysis: opens the mail app with a summary and the JSON between markers. */
export const MARK_START="----- BANEPULS-JSON START -----", MARK_END="----- BANEPULS-JSON END -----";
export async function sendForAnalysis(items, to){
  const name=baseName(items), json=JSON.stringify(JSON.parse(toJSON(items)));
  const subject=`[BANEPULS] ${name}`;
  const lines=items.map(x=> x.kind==="study" ? `• ${t("kindStudy")}: L${x.line} ${x.route[x.startIdx].name} → ${segments(x).slice(-1)[0]?.station||""}, ${iso(x.startedAt).slice(0,16).replace("T"," ")}`
    : x.kind==="platform" ? `• ${t("kindPlatform")}: ${x.station}, ${iso(x.startedAt).slice(0,16).replace("T"," ")}, ${x.recs.length}`
    : `• ${t("kindPing")}: L${x.line} ${x.station} → ${x.dest}, ${iso(x.t).slice(0,16).replace("T"," ")}`).join("\n");
  const body=`${t("mailIntro")}\n\n${lines}\n\n${MARK_START}\n${json}\n${MARK_END}\n`;
  const url=`mailto:${encodeURIComponent(to).replace(/%40/g,"@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if(url.length<=15000){ window.location.href=url; return "mail"; }
  try{ await navigator.clipboard.writeText(to); }catch(e){}
  const r=await shareFiles(items); return r==="aborted" ? "aborted" : "files";
}

/* ---------- import ---------- */
// T-bane logger (tbane.html) export → study trip without realtime.
function fromTbane(o){
  if(!o || !o.id || !Array.isArray(o.route) || o.route.length<2) return null;
  const route=o.route.map(n=>({id:"",name:String(n)})), ok=i=>Number.isInteger(i)&&i>=0&&i<route.length;
  const events=(Array.isArray(o.events)?o.events:[]).map(e=>({type:e&&e.type==="departure"?"dep":e&&e.type==="arrival"?"arr":null, idx:Number(e&&e.station_index), t:Number(e&&e.epoch_ms), ts:String((e&&e.timestamp)||"")}));
  if(events.some(e=>!e.type||!ok(e.idx)||!Number.isFinite(e.t))) return null;
  const startIdx = ok(o.start_index)?o.start_index : events.length?events[0].idx : 0;
  let endIdx = ok(o.planned_end_index)?o.planned_end_index : route.length-1; if(endIdx<=startIdx) endIdx=route.length-1;
  const notes={}; (o.segments||[]).forEach(x=>{ if(x&&x.note&&ok(x.station_index)) notes[x.station_index]=String(x.note); });
  const startedAt=Date.parse(o.started_at)||(events[0]&&events[0].t); if(!Number.isFinite(startedAt)) return null;
  return { id:"TB-"+o.id, kind:"study", v:3, source:"tbane", line:String(o.line), dest:String(o.direction||route[route.length-1].name), journey:null, route, startIdx, endIdx,
    events, notes, undos:Number(o.undo_count)||0, clock:null, rt:null, note:String(o.note||""), train:String(o.train||""),
    startedAt, endedAt:Date.parse(o.ended_at)||(events.length?events[events.length-1].t:startedAt), endedBy:String(o.ended_by||"manual"), exportedAt:Date.now() };
}
const validItem = x => x && typeof x==="object" && typeof x.id==="string" && ["study","platform","ping"].includes(x.kind)
  && (x.kind!=="study" || (Array.isArray(x.route) && Array.isArray(x.events)))
  && (x.kind!=="platform" || Array.isArray(x.recs));
/* keepMeta: tag each item with the sender's device, name and role (used by the analysis tool). */
export async function readImport(files, keepMeta=false){
  const got=[]; let bad=0;
  for(const file of files){
    let d=null; try{ d=JSON.parse(await file.text()); }catch(e){}
    const meta = keepMeta && d ? {_dev:d.device_id||null, _obs:d.observer||"", _role:d.role||"", _src:file.name||""} : {};
    if(d && d.app==="banepuls" && Array.isArray(d.items)) d.items.forEach(x=>{ if(validItem(x)){ const {derived:_, ...raw}=x; got.push({...raw, exportedAt:raw.exportedAt||Date.now(), ...meta}); } else bad++; });
    else if(d && d.app==="tbane-tidslogger"){ (d.trip?[d.trip]:Array.isArray(d.trips)?d.trips:[]).forEach(o=>{ const x=fromTbane(o); if(x) got.push(keepMeta?{...x, _dev:null, _obs:String(o.observer||""), _role:"", _src:file.name||""}:x); else bad++; }); }
    else bad++;
  }
  return {items:got, bad};
}
