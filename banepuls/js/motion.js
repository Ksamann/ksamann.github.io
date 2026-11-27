/* Sensor assistance (beta): detects when the train starts moving and when it has stopped,
   from the phone's accelerometer. The manual taps stay the reference; detections are
   stored separately and offered as suggestions.

   Signal: magnitude of linear acceleration (gravity removed), smoothed with a time
   constant of about 0.5 s. A standing train is quiet (< ~0.06 m/s²); a running train
   vibrates and accelerates (> ~0.15 m/s²). Walking gives much larger values.
     departure: quiet for ≥ stillDep, then above `move` for ≥ sustain → time = first rise above `low`
     arrival:   moving, then quiet for ≥ stillArr                     → time = fall below `low` − lagArr
   The detector is a pure function of the samples, so it can be tested without a phone. */

export const M = { tau:500, still:0.06, low:0.10, move:0.25, walk:2.5, stillDep:3000, sustain:1500, stillArr:2500, lagArr:1000, gravK:0.02, rawEvery:200 };

export function createDetector(onEvent, opts={}){
  const P = {...M, ...opts};
  let g=null, m=0, lastT=null, state="unknown";
  let quietSince=null, lowSince=null, riseAt=null, aboveSince=null, raw=[], lastRaw=0;
  const D = {
    get state(){ return state; }, get level(){ return m; }, raw,
    /* t in ms; (ax,ay,az) in m/s²; linear=true when gravity is already removed */
    feed(t, ax, ay, az, linear){
      if(![ax,ay,az].every(Number.isFinite)) return;
      let lx=ax, ly=ay, lz=az;
      if(!linear){
        if(!g) g=[ax,ay,az];
        const k=P.gravK; g=[g[0]+(ax-g[0])*k, g[1]+(ay-g[1])*k, g[2]+(az-g[2])*k];   // slow low-pass = gravity
        lx=ax-g[0]; ly=ay-g[1]; lz=az-g[2];
      }
      const a=Math.hypot(lx,ly,lz), dt=lastT==null?16:Math.max(1,Math.min(200,t-lastT)); lastT=t;
      m += (a-m) * (dt/(P.tau+dt));
      if(opts.keepRaw && t-lastRaw>=P.rawEvery){ raw.push([Math.round(t), Math.round(m*1000)/1000]); lastRaw=t; }

      if(m < P.low){ if(lowSince==null) lowSince=t; } else lowSince=null;
      const quiet = m < P.still;
      if(quiet){ if(quietSince==null) quietSince=t; riseAt=null; aboveSince=null; }
      else {
        if(m >= P.low && riseAt==null) riseAt=t;
        if(m >= P.move && m < P.walk){ if(aboveSince==null) aboveSince=t; } else if(m < P.move) aboveSince=null;
        if(m >= P.walk){ aboveSince=null; }                       // handling the phone or walking: ignore
      }
      if(state!=="still" && quiet && t-quietSince >= P.stillArr){
        const was=state; state="still";
        if(was==="moving") onEvent({type:"arr", t:Math.round((lowSince??quietSince)-P.lagArr), conf: Math.min(1,(t-quietSince)/(P.stillArr*2))});
      }
      if(state==="still" && !quiet) {
        const stillFor = quietSince!=null ? (riseAt??t) - quietSince : 0;
        if(aboveSince!=null && t-aboveSince >= P.sustain){
          state="moving"; const t0=riseAt??aboveSince;
          if(stillFor >= P.stillDep) onEvent({type:"dep", t:Math.round(t0), conf: Math.min(1,stillFor/(P.stillDep*3))});
          quietSince=null;
        }
      }
      if(state==="unknown" && aboveSince!=null && t-aboveSince >= P.sustain){ state="moving"; quietSince=null; }
    }
  };
  return D;
}

/* Browser binding. start() must be called from a user gesture (iOS asks for permission). */
export async function requestMotion(){
  try{
    if(typeof DeviceMotionEvent!=="undefined" && typeof DeviceMotionEvent.requestPermission==="function"){
      const r=await DeviceMotionEvent.requestPermission(); return r==="granted";
    }
    return typeof DeviceMotionEvent!=="undefined";
  }catch(e){ return false; }
}
export function listen(detector){
  let seen=false;
  const h=e=>{
    const t=Date.now(), a=e.acceleration, ag=e.accelerationIncludingGravity;
    if(a && a.x!=null){ seen=true; detector.feed(t,a.x,a.y,a.z,true); }
    else if(ag && ag.x!=null){ seen=true; detector.feed(t,ag.x,ag.y,ag.z,false); }
  };
  window.addEventListener("devicemotion",h);
  return { stop(){ window.removeEventListener("devicemotion",h); }, get active(){ return seen; } };
}

/* How well the sensor matched the manual taps: pairs each sensor event with the
   nearest manual tap of the same type within ±15 s. Times are raw (phone clock). */
export function sensorPrecision(trip){
  const sev=(trip.sensor&&trip.sensor.events)||[], man=trip.events.filter(e=>e.source!=="sensor");
  if(!sev.length) return null;
  const used=new Set(), diffs=[];
  for(const s of sev){
    let best=null; man.forEach((e,i)=>{ if(e.type!==s.type||used.has(i)) return; const d=s.t-e.t; if(Math.abs(d)<=15000 && (!best||Math.abs(d)<Math.abs(best.d))) best={i,d}; });
    if(best){ used.add(best.i); diffs.push(best.d/1000); }
  }
  const abs=diffs.map(Math.abs).sort((a,b)=>a-b), med=abs.length?(abs.length%2?abs[abs.length>>1]:(abs[abs.length/2-1]+abs[abs.length/2])/2):null;
  return { matched:diffs.length, sensorOnly:sev.length-diffs.length, missed:man.length-diffs.length, medianAbs:med, maxAbs:abs.length?abs[abs.length-1]:null, mean:diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:null };
}
