/* Clock sync against the app's own server (GitHub Pages).
   Entur doesn't expose its Date header to browsers, but a same-origin response does.
   The Date header has whole-second resolution, so we take several samples spread over
   the second and intersect the intervals they allow:
     server time at the moment of the reply is in [S, S+1000) and that moment lies in [t0, t1]
     => offset = server − local lies in [S − t1, S + 1000 − t0].
   offset > 0 means the phone is slow. Corrected time = Date.now() + offset. */
import { store } from "./core.js";

const sleep = ms => new Promise(r=>setTimeout(r,ms));
export const clock = store("bp.clock") || null;   // {offset, err, at}

export async function syncClock(samples=7){
  let lo=-Infinity, hi=Infinity, n=0;
  const url = new URL("./manifest.webmanifest", location.href).href;
  for(let i=0;i<samples;i++){
    const t0=Date.now();
    let r; try{ r=await fetch(url+"?cs="+Math.random().toString(36).slice(2),{method:"HEAD",cache:"no-store"}); }catch(e){ continue; }
    const t1=Date.now(), d=r.headers.get("Date"); if(!d) continue;
    const S=Date.parse(d); if(!Number.isFinite(S) || t1-t0>2500) continue;
    const a=S-t1, b=S+1000-t0;
    if(Math.max(lo,a) <= Math.min(hi,b)){ lo=Math.max(lo,a); hi=Math.min(hi,b); n++; }
    await sleep(120 + Math.random()*800);   // land at a different point in the next second
  }
  if(!n) return null;
  const res = {offset:Math.round((lo+hi)/2), err:Math.round((hi-lo)/2), at:Date.now(), n};
  store("bp.clock", res); Object.assign(clockState, {c:res});
  return res;
}
export const clockState = { c: clock };
export const fresh = () => clockState.c && Date.now()-clockState.c.at < 6*3600e3 ? clockState.c : null;
