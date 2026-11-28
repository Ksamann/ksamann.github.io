/* Shared helpers, local storage and UI strings (English default, Norwegian). */
export const APP_VERSION = "1.2.0";
export const COLORS = {"1":"#009cdc","2":"#ea5b0b","3":"#a683a5","4":"#3d6fd1","5":"#3aaa35"};
export const INK = {"1":"#06131a","2":"#1a0a02","3":"#170f17","4":"#ffffff","5":"#061405"};

export const $ = (s, r=document) => r.querySelector(s);
export const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const pad = (n,w=2) => String(n).padStart(w,"0");
export const hm  = t => { const d=new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const hms = t => { const d=new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export function fmt(ms, tenths=true){
  ms=Math.max(0,ms); const tot=ms/1000, m=Math.floor(tot/60), s=tot-m*60, w=Math.floor(s), d=Math.floor((s-w)*10);
  return `${m}:${pad(w)}` + (tenths?`.${d}`:"");
}
export const sgn = (v, d=0) => v==null ? "–" : (v>0?"+":v<0?"−":"±") + Math.abs(v).toFixed(d);
export function isoLocal(t){
  const d=new Date(t), o=-d.getTimezoneOffset(), sg=o>=0?"+":"-", ao=Math.abs(o);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}${sg}${pad(Math.floor(ao/60))}:${pad(ao%60)}`;
}
export const uid = p => p + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();

/* localStorage: store(k) reads, store(k,v) writes, store(k,null) removes. Never throws. */
export let storageOk = true;
export function deviceId(){ let d=store("bp.device"); if(!d){ d="D"+Math.random().toString(36).slice(2,10).toUpperCase(); store("bp.device",d); } return d; }
export function store(k, v){
  try{
    if(v===undefined){ const s=localStorage.getItem(k); return s==null ? null : JSON.parse(s); }
    if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    return true;
  }catch(e){ storageOk=false; return v===undefined ? null : false; }
}
export function askPersist(){ try{ const st=navigator.storage; if(st && st.persist) st.persisted().then(p=>p||st.persist()).catch(()=>{}); }catch(e){} }

let tt; export function toast(m){ const el=$("#toast"); if(!el) return; el.textContent=m; el.hidden=false; clearTimeout(tt); tt=setTimeout(()=>el.hidden=true,3000); }
export function buzz(){ try{ navigator.vibrate && navigator.vibrate(30); }catch(e){} }

/* ---------- i18n ---------- */
export let lang = store("bp.lang") || "en";
if(lang!=="en" && lang!=="no") lang="en";
export function setLang(l){ lang=l; store("bp.lang",l); document.documentElement.lang = l==="no"?"no":"en"; }
export const locale = () => lang==="no" ? "nb-NO" : "en-GB";
export const dateStr = t => new Date(t).toLocaleDateString(locale(),{day:"2-digit",month:"2-digit",year:"numeric"});
export function t(key, ...a){ const v=(STR[lang]&&STR[lang][key]!==undefined)?STR[lang][key]:STR.en[key]; return typeof v==="function" ? v(...a) : (v===undefined ? key : v); }

const STR = {
en:{
  tabNow:"Now", tabLog:"Log", tabTrips:"Trips", tabMore:"More",
  vStation:"Station", vLine:"Line", vMap:"Map", vGraph:"Graph", vTable:"Table",
  live:"LIVE", connecting:"CONNECTING", noData:"NO DATA", offline:"OFFLINE", minOld:n=>`${n} MIN OLD`,
  netFail:"Couldn't load the lines. Check that you're online and try again.", retry:"Try again",
  nightPause:"No trains running right now", nightPauseText:"The metro has its night break. Trains appear here when service starts.",
  // station view
  pickStation:"Choose station", search:"Search, for example Tøyen", recent:"Recently used", allStations:"All stations", nearby:"Nearby",
  changeStation:"Change station", useLocation:"Use my location", locating:"Finding your position…", locFail:"Couldn't get your position. Choose a station instead.",
  walkTime:"Walking time to the station", go:"Leave", goIn:"Leave in", now:"now", lineAt:(l,tm)=>`Line ${l} at ${tm}`,
  nextStop:n=>`Next stop ${n}`, myDir:"★ My direction", notMyDir:"☆ My direction", noDeps:"No departures in the next few minutes.",
  startsHere:"starts here", waitingAt:n=>`waiting to leave <i>${n}</i>`, atStation:"<i>at the station</i>",
  nextFrom:n=>`next stop · from <i>${n}</i>`, stopsAway:(k,at,n)=>`${k} stops away · ${at?"at":"from"} <i>${n}</i>`,
  min:"min", logThis:"Log", pingThis:"Ping",
  // sheet
  towards:"Towards", standingAt:n=>`At ${n}`, waitingFrom:n=>`Waiting to leave ${n}`, between:(a,b)=>`Between ${a} and ${b}`,
  delay:"Delay", onTime:"On time", nextStopL:"Next stop", arrives:"Arrives", terminus:"Terminus", in:n=>`in ${n} min`, lastStation:"Last station",
  showOnLine:"Show on line", showOnMap:"Show on map", logFrom:n=>`Log from ${n}`, close:"Close",
  trainsOut:"Trains out", punctual:"Punctual", avgDelay:"Average",
  // timetable graph
  slTunnel:"Common tunnel", slEast:"Tøyen–Brynseng", slHelp1:"Time runs down. Solid has happened, dashed is the forecast.",
  slHelp2:"Steep is running, vertical is standing still. Lines closing in on each other are trains catching up.", nowLbl:"NOW",
  // log start
  newLog:"New log", modeStudy:"Time study", modeStudyD:"Log departure and arrival at each station. Compared with plan and realtime.",
  modePlatform:"Platform mode", modePlatformD:"Stay at one station and log arrival and departure of every train: dwell times and headways.",
  modePing:"Ping", modePingD:"One tap: “I'm on this train”. Linked to the departure, no timing.",
  pickTrain:"Pick the train you're taking", choose:"Choose", manual:"No signal or no realtime? Set up the trip by hand.", manualBtn:"Set up by hand",
  fromStation:n=>`From ${n}`, noStation:"Choose a station first.",
  // prep
  chosenTrain:"Chosen train", change:"Change", endAt:"End at", plannedDep:"Plan", realtimeDep:"Realtime", journeyId:"Departure",
  loadingJourney:"Fetching the whole departure…", journeyFail:"Couldn't fetch the departure. You can still log it; plan and realtime will be missing.",
  clockSynced:(o,e)=>`Clock synced: your phone is ${Math.abs(o/1000).toFixed(1)} s ${o<0?"fast":"slow"} (±${(e/1000).toFixed(1)} s). This is corrected.`,
  clockSyncing:"Syncing the clock with the server…", clockNone:"Clock not synced. Times use the phone's clock as is.",
  startStudy:"Start time study", noteOpt:"Note (optional)",
  // manual
  manualTitle:"Set up by hand", line:"Line", direction:"Direction", startStn:"Start", endStn:"End", next:"Next",
  // logging
  finish:"Finish", finishQ:"Finish this trip now?", finishHint:"Everything you've logged is kept.", keepLogging:"Keep logging", finishTrip:"Finish trip",
  at:"At", readyAt:"Ready at", nextL:"Next", dwell:"dwell", run:"run time", waiting:"waiting for<br>first departure",
  depart:"Depart", arrive:"Arrive", from:"from", toAt:"at", undo:"↶ Undo", note:"✎ Note", progress:(a,b)=>`Stop <b>${a}</b> of ${b}`,
  noteFor:n=>`Note for ${n}`, cancel:"Cancel", saveNote:"Save note", noteSaved:"Note saved", undone:"Last tap removed",
  rtExpect:(lbl,tm)=>`Realtime ${lbl} <b>${tm}</b>`, rtDep:"dep.", rtArr:"arr.",
  colStation:"Station", colPlan:"Plan", colRt:"Realtime", colMe:"Measured", colD:"Δ", arrS:"arrival", depS:"departure",
  deltaHelp:"Δ = measured minus realtime. ≈ marks a realtime time identical to the plan, probably not measured.",
  emptyLog:"No taps yet. Your times appear here, latest stop on top.",
  arrivedEnd:n=>`Arrived at ${n}. Trip finished.`,
  // result
  result:"Result", kMean:"Mean deviation, measured vs realtime", kMax:"Largest deviation vs realtime", kPlan:n=>`Used vs plan (${n} min)`,
  legendPlan:"Plan", legendRt:"Realtime (Entur)", legendMe:"Measured by you",
  fNoRt:"Realtime for this departure wasn't available, so only your own times are shown.",
  fGood:n=>`Realtime matched your measurements well, within ${n} s.`,
  fBad:(n,st)=>`Realtime was off by up to ${n} s, most at ${st}.`,
  fPlusPlan:(m,st)=>`The train used <b>${m} min more</b> than the timetable${st?`, most of it on ${st}`:""}.`,
  fMinusPlan:m=>`The train was <b>${m} min faster</b> than the timetable.`,
  fCopies:n=>`${n} realtime ${n===1?"time was":"times were"} identical to the plan and left out of the comparison.`,
  rtPending:"Fetching the final realtime times…", rtFetched:tm=>`Realtime fetched ${tm}`, rtLate:"Realtime is no longer available for this departure.",
  sendAnalysis:"Send for analysis", sent:"Sent", notSent:"Not sent", sentOn:d=>`Sent ${d}`, sendAgain:"Send again",
  noAddress:"Add an analysis address under More to send trips.", share:"Share", newLog:"New log",
  mailIntro:"Data from Banepuls. Don't edit the text between the markers.",
  mailOpened:"The email is ready. Tap Send in your mail app.", mailLong:a=>`Too long for a plain email. The files are shared instead and ${a} is copied: paste it as the recipient.`,
  downloaded:f=>`Downloaded ${f}`, shareFallback:"Sharing isn't supported here. The files were downloaded instead.",
  resume:"↶ Resume trip", resumed:"Trip resumed", legs:n=>`${n} ${n===1?"leg":"legs"}`,
  // platform
  platformTitle:n=>`Platform · ${n}`, platformHint:"Tap Arrive when a train stops and Depart when it starts moving. Each tap is matched to the departure in realtime.",
  toward:n=>`Towards ${n}`, nextDep:"Next", noneDue:"no train due", matchedTo:(l,d,tm)=>`Line ${l} ${d} · plan ${tm}`, unmatched:"not matched",
  trainsLogged:n=>`${n} ${n===1?"train":"trains"} logged`, headway:"headway", endSession:"End session", pDwellMedian:"Median dwell", pHeadway:"Median headway", pTrains:"Trains",
  // ping
  pingTitle:"Ping", pingPick:"Which train are you on?", pinged:(l,d)=>`Pinged line ${l} towards ${d}`, pingRate:"How is it going?", rOnTime:"On time", rLate:"Delayed", rFull:"Crowded", rSaved:"Thanks!",
  // trips
  tripsTitle:"Trips", tripsSub:"Stored only on this phone", kTrips:"Trips", kLegs:"Legs measured", kLines:"Lines",
  kindStudy:"Time study", kindPlatform:"Platform", kindPing:"Ping", noTrips:"No trips yet. Log one from the Now or Log tab.",
  myTrends:"My trends", trendLeg:(a,b,m,n,p)=>`${a} → ${b}: median ${m} over ${n} ${n===1?"trip":"trips"}${p?`, timetable ${p}`:""}.`,
  trendRt:(v,n)=>`Realtime has on average been ${v} s from your measurements (${n} ${n===1?"time":"times"}).`, trendNone:"Trends appear after a few time studies.",
  exportAll:"Export all (JSON)", exportCsv:"Export all (CSV)", importBtn:"Import", del:"Delete", delQ:"Delete this permanently?", deleted:"Deleted",
  imported:(a,d,b)=>`Imported ${a}`+(d?`, ${d} already here`:"")+(b?`, ${b} not readable`:""), importBad:"The file couldn't be read. Pick a JSON file from Banepuls or the T-bane logger.",
  sendSelected:"Send all unsent", nothingToSend:"Everything has been sent.",
  // more
  moreTitle:"More", sData:"Sharing data", sAddr:"Analysis address", sAddrD:"Where “Send for analysis” sends your data. Empty until you add one or open an invitation link.",
  sName:"Your name in sent data", sNameD:"Optional. Leave empty to stay anonymous.", sRole:"Who are you?", sRoleD:"Optional. Sent along with your data.",
  roles:{"":"Not stated", sporveien:"Sporveien", ruter:"Ruter", enthusiast:"Enthusiast", student:"Student or researcher", other:"Other"},
  sMeasure:"Measuring", sClock:"Clock sync", sClockD:"Compares the phone's clock with the server before each log", syncNow:"Sync now",
  sLoc:"Use location", sLocD:"Finds the nearest station. Used only on the phone.", on:"On", off:"Off",
  sOther:"Other", sLang:"Language", sGuide:"User guide", sPrivacy:"Privacy", sPrivacyD:"No account and no tracking. Data leaves the phone only when you send or share it. Realtime comes from Entur's open API.",
  sOld:"The original apps", sVersion:v=>`Banepuls ${v} · realtime: Entur`,
  saved:"Saved",
  // situations
  sitTitle:"Service messages",
  // share & train view
  shareTrain:"Share train", linkCopied:"Link copied", trainLoading:"Fetching the train…", trainFail:"Couldn't find this train. The link may be old: trains can only be followed on the day they run.",
  arrivesAt:n=>`Arrives at ${n}`, arrivedAt:n=>`Arrived at ${n}`, approx:"about", openApp:"Open Banepuls", nextStops:"Next stops", trainDone:"This train has finished its trip.",
  shareText:(l,d,to)=>`Follow my train: line ${l} towards ${d}`+(to?`, getting off at ${to}`:""),
  // sensor
  sSensor:"Sensor assistance (beta)", sSensorD:"The accelerometer suggests departure and arrival times. Your own taps are always kept as the reference.",
  sRaw:"Save raw sensor data", sRawD:"For calibration. About 100 kB per half hour, included in JSON exports.",
  sensorOn:"Sensor", sensorStill:"standing", sensorMoving:"moving", sensorWait:"waiting for data", sensorOff:"no access", sensorEnable:"Enable sensor",
  sensorSuggest:(k,tm)=>`Sensor: ${k} ${tm}`, use:"Use", sensorDep:"departure", sensorArr:"arrival",
  kSensor:"Sensor vs your taps (median)", sensorStats:(m,n,x,mi)=>`Sensor matched ${n} of your taps: median ${m} s, worst ${x} s. ${mi} taps without a sensor event.`,
  // analysis
  details:"Details", back:"Back", cancelled:"Cancelled", rtInaccurate:"Uncertain forecast", rtLive:"Realtime", rtPlanOnly:"Timetable only",
  depNo:"Departure no.", date:"Date", planned:"Planned", lineName:"Line", pattern:"Route", operator:"Operator", rtStatus:"Data", occupancy:"Occupancy", platform:"Platform",
  onlyAlight:"Set-down only", onlyBoard:"Pick-up only", deltaHelp2:"✓ = actual time reported. ≈ = identical to the plan, probably not measured. Faded = forecast.",
  ttToday:"Today", ttTomorrow:"Tomorrow", ttDate:"Date", ttEarlier:"Earlier", ttLater:"Later", ttLoading:"Fetching the timetable…", ttFail:"Couldn't fetch the timetable. Check your connection and try again.",
  ttNone:"No departures in this period.", ttHint:"Times are the timetable. Departures within about 25 minutes also show realtime: yellow and red are delayed, struck through is cancelled. Faded columns have run. Tap a departure number for details.",
  ttHintPlan:"Times are the timetable. Tap a departure number for details.",
  sAnalysis:"Analysis tool", sAnalysisD:"For whoever collects data: combine and analyse files and emails from many people. Runs in the browser; nothing is uploaded."
},
no:{
  tabNow:"Nå", tabLog:"Logg", tabTrips:"Turer", tabMore:"Mer",
  vStation:"Stasjon", vLine:"Linje", vMap:"Kart", vGraph:"Graf", vTable:"Tabell",
  live:"LIVE", connecting:"KOBLER TIL", noData:"INGEN DATA", offline:"FRAKOBLET", minOld:n=>`${n} MIN GAMMEL`,
  netFail:"Fikk ikke hentet linjene. Sjekk at du er på nett, og prøv igjen.", retry:"Prøv igjen",
  nightPause:"Ingen tog i trafikk akkurat nå", nightPauseText:"T-banen har nattpause. Togene dukker opp her når driften starter.",
  pickStation:"Velg stasjon", search:"Søk, for eksempel Tøyen", recent:"Nylig brukt", allStations:"Alle stasjoner", nearby:"I nærheten",
  changeStation:"Bytt stasjon", useLocation:"Bruk posisjonen min", locating:"Finner posisjonen din …", locFail:"Fikk ikke posisjonen din. Velg en stasjon i stedet.",
  walkTime:"Gåtid til stasjonen", go:"Gå", goIn:"Gå om", now:"nå", lineAt:(l,tm)=>`Linje ${l} kl. ${tm}`,
  nextStop:n=>`Neste stopp ${n}`, myDir:"★ Min retning", notMyDir:"☆ Min retning", noDeps:"Ingen avganger de neste minuttene.",
  startsHere:"starter her", waitingAt:n=>`venter på avgang fra <i>${n}</i>`, atStation:"<i>står på stasjonen</i>",
  nextFrom:n=>`neste stopp · fra <i>${n}</i>`, stopsAway:(k,at,n)=>`${k} stopp unna · ${at?"ved":"fra"} <i>${n}</i>`,
  min:"min", logThis:"Logg", pingThis:"Ping",
  towards:"Mot", standingAt:n=>`Står på ${n}`, waitingFrom:n=>`Venter på avgang fra ${n}`, between:(a,b)=>`Mellom ${a} og ${b}`,
  delay:"Forsinkelse", onTime:"I rute", nextStopL:"Neste stopp", arrives:"Fremme", terminus:"Endestasjon", in:n=>`om ${n} min`, lastStation:"Siste stasjon",
  showOnLine:"Vis på linjen", showOnMap:"Vis på kartet", logFrom:n=>`Logg fra ${n}`, close:"Lukk",
  trainsOut:"Tog ute", punctual:"Punktlige", avgDelay:"Snitt",
  slTunnel:"Fellestunnelen", slEast:"Tøyen–Brynseng", slHelp1:"Tiden går nedover. Heltrukket er kjørt, stiplet er prognose.",
  slHelp2:"Bratt linje er kjøring, loddrett er opphold. Linjer som nærmer seg hverandre er tog som tar igjen toget foran.", nowLbl:"NÅ",
  newLog:"Ny logg", modeStudy:"Tidsstudie", modeStudyD:"Logg avgang og ankomst på hver stasjon. Sammenlignes med plan og sanntid.",
  modePlatform:"Perrongmodus", modePlatformD:"Stå på én stasjon og logg ankomst og avgang for alle tog: oppholdstid og intervall.",
  modePing:"Ping", modePingD:"Ett trykk: «jeg er på dette toget». Kobles til avgangen, uten tidtaking.",
  pickTrain:"Velg toget du tar", choose:"Velg", manual:"Uten dekning eller sanntid? Sett opp turen manuelt.", manualBtn:"Sett opp manuelt",
  fromStation:n=>`Fra ${n}`, noStation:"Velg en stasjon først.",
  chosenTrain:"Valgt tog", change:"Bytt", endAt:"Slutt på", plannedDep:"Plan", realtimeDep:"Sanntid", journeyId:"Avgang",
  loadingJourney:"Henter hele avgangen …", journeyFail:"Fikk ikke hentet avgangen. Du kan logge likevel, men plan og sanntid mangler.",
  clockSynced:(o,e)=>`Klokka er synkronisert: telefonen går ${Math.abs(o/1000).toFixed(1).replace(".",",")} s for ${o<0?"fort":"sakte"} (±${(e/1000).toFixed(1).replace(".",",")} s). Det korrigeres.`,
  clockSyncing:"Synkroniserer klokka med serveren …", clockNone:"Klokka er ikke synkronisert. Telefonens klokke brukes som den er.",
  startStudy:"Start tidsstudie", noteOpt:"Notat (valgfritt)",
  manualTitle:"Sett opp manuelt", line:"Linje", direction:"Retning", startStn:"Start", endStn:"Slutt", next:"Neste",
  finish:"Avslutt", finishQ:"Avslutte turen nå?", finishHint:"Det du har logget, blir tatt vare på.", keepLogging:"Fortsett logging", finishTrip:"Avslutt tur",
  at:"Står på", readyAt:"Klar på", nextL:"Mot", dwell:"oppholdstid", run:"kjøretid", waiting:"venter på<br>første avgang",
  depart:"Avgang", arrive:"Ankomst", from:"fra", toAt:"til", undo:"↶ Angre", note:"✎ Notat", progress:(a,b)=>`Stopp <b>${a}</b> av ${b}`,
  noteFor:n=>`Notat for ${n}`, cancel:"Avbryt", saveNote:"Lagre notat", noteSaved:"Notatet er lagret", undone:"Siste trykk er fjernet",
  rtExpect:(lbl,tm)=>`Sanntid ${lbl} <b>${tm}</b>`, rtDep:"avg.", rtArr:"ank.",
  colStation:"Stasjon", colPlan:"Plan", colRt:"Sanntid", colMe:"Målt", colD:"Δ", arrS:"ankomst", depS:"avgang",
  deltaHelp:"Δ = målt minus sanntid. ≈ markerer en sanntidstid som er lik planen og trolig ikke målt.",
  emptyLog:"Ingen trykk ennå. Tidene dine dukker opp her, med siste stopp øverst.",
  arrivedEnd:n=>`Ankommet ${n}. Turen er avsluttet.`,
  result:"Resultat", kMean:"Snittavvik, målt mot sanntid", kMax:"Største avvik mot sanntid", kPlan:n=>`Brukt mot ruteplan (${n} min)`,
  legendPlan:"Plan", legendRt:"Sanntid (Entur)", legendMe:"Målt av deg",
  fNoRt:"Sanntid for denne avgangen var ikke tilgjengelig, så bare dine egne tider vises.",
  fGood:n=>`Sanntiden fulgte målingene dine godt, innenfor ${n} s.`,
  fBad:(n,st)=>`Sanntiden bommet med opptil ${n} s, mest på ${st}.`,
  fPlusPlan:(m,st)=>`Toget brukte <b>${m} min mer</b> enn ruteplanen${st?`, mest på ${st}`:""}.`,
  fMinusPlan:m=>`Toget var <b>${m} min raskere</b> enn ruteplanen.`,
  fCopies:n=>`${n} ${n===1?"sanntidstid var":"sanntidstider var"} lik planen og er holdt utenfor sammenligningen.`,
  rtPending:"Henter de siste sanntidstidene …", rtFetched:tm=>`Sanntid hentet ${tm}`, rtLate:"Sanntid er ikke lenger tilgjengelig for denne avgangen.",
  sendAnalysis:"Send til analyse", sent:"Sendt", notSent:"Ikke sendt", sentOn:d=>`Sendt ${d}`, sendAgain:"Send på nytt",
  noAddress:"Legg inn en analyseadresse under Mer for å sende turer.", share:"Del", newLog:"Ny logg",
  mailIntro:"Data fra Banepuls. Ikke endre teksten mellom markørene.",
  mailOpened:"E-posten er klar. Trykk Send i e-postappen.", mailLong:a=>`For lang for en vanlig e-post. Filene deles i stedet, og ${a} er kopiert: lim inn som mottaker.`,
  downloaded:f=>`Lastet ned ${f}`, shareFallback:"Deling støttes ikke her. Filene er lastet ned i stedet.",
  resume:"↶ Gjenoppta turen", resumed:"Turen er gjenopptatt", legs:n=>`${n} ${n===1?"strekning":"strekninger"}`,
  platformTitle:n=>`Perrong · ${n}`, platformHint:"Trykk Ankomst når et tog stopper og Avgang når det begynner å rulle. Hvert trykk kobles til avgangen i sanntid.",
  toward:n=>`Mot ${n}`, nextDep:"Neste", noneDue:"ingen tog ventet", matchedTo:(l,d,tm)=>`Linje ${l} ${d} · plan ${tm}`, unmatched:"ikke koblet",
  trainsLogged:n=>`${n} ${n===1?"tog":"tog"} logget`, headway:"intervall", endSession:"Avslutt økten", pDwellMedian:"Median opphold", pHeadway:"Median intervall", pTrains:"Tog",
  pingTitle:"Ping", pingPick:"Hvilket tog er du på?", pinged:(l,d)=>`Pinget linje ${l} mot ${d}`, pingRate:"Hvordan går det?", rOnTime:"I rute", rLate:"Forsinket", rFull:"Fullt", rSaved:"Takk!",
  tripsTitle:"Turer", tripsSub:"Lagret bare på denne telefonen", kTrips:"Turer", kLegs:"Strekninger målt", kLines:"Linjer",
  kindStudy:"Tidsstudie", kindPlatform:"Perrong", kindPing:"Ping", noTrips:"Ingen turer ennå. Logg en fra Nå eller Logg.",
  myTrends:"Mine trender", trendLeg:(a,b,m,n,p)=>`${a} → ${b}: median ${m} over ${n} ${n===1?"tur":"turer"}${p?`, ruteplan ${p}`:""}.`,
  trendRt:(v,n)=>`Sanntiden har i snitt vært ${v} s fra målingene dine (${n} ganger).`, trendNone:"Trender dukker opp etter noen tidsstudier.",
  exportAll:"Eksporter alle (JSON)", exportCsv:"Eksporter alle (CSV)", importBtn:"Importer", del:"Slett", delQ:"Slette for godt?", deleted:"Slettet",
  imported:(a,d,b)=>`Importerte ${a}`+(d?`, ${d} fantes fra før`:"")+(b?`, ${b} kunne ikke leses`:""), importBad:"Filen kunne ikke leses. Velg en JSON-fil fra Banepuls eller T-bane tidslogger.",
  sendSelected:"Send alle som ikke er sendt", nothingToSend:"Alt er sendt.",
  moreTitle:"Mer", sData:"Deling av data", sAddr:"Analyseadresse", sAddrD:"Hit sender «Send til analyse» dataene dine. Er tom til du legger inn en eller åpner en invitasjonslenke.",
  sName:"Navnet ditt i sendte data", sNameD:"Valgfritt. La stå tomt for å være anonym.", sRole:"Hvem er du?", sRoleD:"Valgfritt. Følger med dataene du sender.",
  roles:{"":"Ikke oppgitt", sporveien:"Sporveien", ruter:"Ruter", enthusiast:"Entusiast", student:"Student eller forsker", other:"Annet"},
  sMeasure:"Måling", sClock:"Klokkesynk", sClockD:"Sammenligner telefonens klokke med serveren før hver logg", syncNow:"Synk nå",
  sLoc:"Bruk posisjon", sLocD:"Finner nærmeste stasjon. Brukes bare på telefonen.", on:"På", off:"Av",
  sOther:"Annet", sLang:"Språk", sGuide:"Brukerhåndbok", sPrivacy:"Personvern", sPrivacyD:"Ingen konto og ingen sporing. Data forlater telefonen bare når du sender eller deler dem. Sanntid kommer fra Enturs åpne API.",
  sOld:"De opprinnelige appene", sVersion:v=>`Banepuls ${v} · sanntid: Entur`,
  saved:"Lagret",
  sitTitle:"Driftsmeldinger",
  shareTrain:"Del toget", linkCopied:"Lenken er kopiert", trainLoading:"Henter toget …", trainFail:"Fant ikke toget. Lenken kan være gammel: tog kan bare følges samme dag som de går.",
  arrivesAt:n=>`Fremme på ${n}`, arrivedAt:n=>`Kom frem til ${n}`, approx:"ca.", openApp:"Åpne Banepuls", nextStops:"Neste stopp", trainDone:"Dette toget har kjørt ferdig.",
  shareText:(l,d,to)=>`Følg toget mitt: linje ${l} mot ${d}`+(to?`, jeg går av på ${to}`:""),
  sSensor:"Sensorassistanse (beta)", sSensorD:"Akselerometeret foreslår tider for avgang og ankomst. Dine egne trykk beholdes alltid som fasit.",
  sRaw:"Lagre rå sensordata", sRawD:"For kalibrering. Cirka 100 kB per halvtime, følger med i JSON-eksport.",
  sensorOn:"Sensor", sensorStill:"står stille", sensorMoving:"i bevegelse", sensorWait:"venter på data", sensorOff:"ingen tilgang", sensorEnable:"Slå på sensor",
  sensorSuggest:(k,tm)=>`Sensor: ${k} ${tm}`, use:"Bruk", sensorDep:"avgang", sensorArr:"ankomst",
  kSensor:"Sensor mot dine trykk (median)", sensorStats:(m,n,x,mi)=>`Sensoren traff ${n} av trykkene dine: median ${m} s, verst ${x} s. ${mi} trykk uten sensorhendelse.`,
  details:"Detaljer", back:"Tilbake", cancelled:"Innstilt", rtInaccurate:"Usikker prognose", rtLive:"Sanntid", rtPlanOnly:"Bare rute",
  depNo:"Avgangsnr.", date:"Dato", planned:"Planlagt", lineName:"Linje", pattern:"Rute", operator:"Operatør", rtStatus:"Data", occupancy:"Belegg", platform:"Spor",
  onlyAlight:"Bare avstigning", onlyBoard:"Bare påstigning", deltaHelp2:"✓ = faktisk tid er meldt. ≈ = lik planen, trolig ikke målt. Svak = prognose.",
  ttToday:"I dag", ttTomorrow:"I morgen", ttDate:"Dato", ttEarlier:"Tidligere", ttLater:"Senere", ttLoading:"Henter rutetabellen …", ttFail:"Fikk ikke hentet rutetabellen. Sjekk nettet og prøv igjen.",
  ttNone:"Ingen avganger i dette tidsrommet.", ttHint:"Tidene er ruteplanen. Avganger de neste cirka 25 minuttene viser også sanntid: gult og rødt er forsinket, gjennomstreket er innstilt. Nedtonede kolonner har gått. Trykk på et avgangsnummer for detaljer.",
  ttHintPlan:"Tidene er ruteplanen. Trykk på et avgangsnummer for detaljer.",
  sAnalysis:"Analyseverktøy", sAnalysisD:"For den som samler inn data: slå sammen og analyser filer og e-poster fra mange. Kjører i nettleseren, ingenting lastes opp."
}};
