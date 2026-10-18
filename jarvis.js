/* Jarvis – das Sprach-Gehirn des Marktradars.
   Läuft komplett im Browser, ohne Konto und ohne Server.
   Wissen: Seitendaten (Lage, Kurse, Regionen, Termine), news.json (stündlich),
   jarvis.json (wird jeden Werktag morgens erweitert) und das, was man ihm selbst beibringt. */
(function(){
"use strict";

const REPO = "https://raw.githubusercontent.com/qvw8mrjzby-arch/Marktadar-live-/main/";
const rnd = a => a[Math.floor(Math.random()*a.length)];
const num = (v, d) => Number(v).toLocaleString("de-DE", {minimumFractionDigits:d, maximumFractionDigits:d});
const norm = s => String(s||"").toLowerCase().replace(/ß/g,"ss").replace(/[^a-z0-9äöü&+ ]+/g," ").replace(/\s+/g," ").trim();
const englishy = t => /\b(the|to|of|and|is|as|in|for|on|with)\b/i.test(t) && !/[äöüß]/i.test(t);
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

/* ---------- Daten laden ---------- */
let MARKET = null, NEWS = null, KNOW = null;
async function getJSON(name){
  for(const u of [REPO + name + "?t=" + Math.floor(Date.now()/60000), name]){
    try{ const r = await fetch(u, {cache:"no-store"}); if(r.ok) return await r.json(); }catch(e){}
  }
  return null;
}
async function loadAll(){
  const [m, n, k] = await Promise.all([getJSON("market.json"), getJSON("news.json"), getJSON("jarvis.json")]);
  if(m) MARKET = m; if(n) NEWS = n; if(k) KNOW = k;
}
loadAll(); setInterval(loadAll, 10*60*1000);

/* ---------- Gedächtnis ---------- */
const mem = {
  topic: null,            // {type:"asset"|"region"|"lage"|"term", key, idx}
  pending: null,          // {type:"offer", run} | {type:"teach", q}
  last: "",
  name: store.get("jarvis.name", ""),
  learned: store.get("jarvis.learned", {}),   // Frage -> Antwort (von dir beigebracht)
  notes: store.get("jarvis.notes", []),       // "Merk dir …"
  lastLearnedKey: null
};
const sir = () => mem.name || "Sir";
function offer(text, run){ mem.pending = {type:"offer", run}; return " " + text; }

/* ---------- Wissen: Kurse ---------- */
const ASSETS = [
  {k:"BTC",   re:/bitcoin|btc/,                        name:"Bitcoin",  unit:"Dollar", d:0, rel:"ETH"},
  {k:"ETH",   re:/ethereum|\beth\b|ether\b/,            name:"Ethereum", unit:"Dollar", d:0, rel:"BTC"},
  {k:"SOL",   re:/solana|\bsol\b/,                      name:"Solana",   unit:"Dollar", d:2, rel:"BTC"},
  {k:"XRP",   re:/\bxrp\b|ripple/,                      name:"XRP",      unit:"Dollar", d:3, rel:"BTC"},
  {k:"GOLD",  re:/\bgold/,                              name:"Gold",     unit:"Dollar je Unze", d:0, rel:"BTC"},
  {k:"BRENT", re:/\bol\b|\böl\b|olpreis|ölpreis|brent|oil|rohol|rohöl/, name:"Brent-Öl", unit:"Dollar je Barrel", d:2, rel:"GOLD"},
  {k:"SP500", re:/s ?& ?p|s und p|sp ?500|wall street/, name:"Der S&P 500", unit:"Punkten", d:0, rel:"NASDAQ"},
  {k:"NASDAQ",re:/nasdaq|tech ?aktien/,                 name:"Der Nasdaq", unit:"Punkten", d:0, rel:"SP500"},
  {k:"DAX",   re:/\bdax\b/,                             name:"Der DAX",  unit:"Punkten", d:0, rel:"SP500"},
  {k:"EURUSD",re:/\beuro\b|eur ?usd|euro dollar|wechselkurs/, name:"Der Euro", unit:"Dollar", d:4, rel:"DAX"},
  {k:"US10Y", re:/rendite|anleihe|staatsanleihe|treasury/, name:"Die zehnjährige US-Rendite", unit:"Prozent", d:2, rel:"SP500"}
];
const findAssets = q => ASSETS.filter(a => a.re.test(q));
function priceLine(a){
  const p = MARKET && MARKET.prices && MARKET.prices[a.k];
  if(!p || p.price == null) return `Den Kurs von ${a.name.replace(/^(Der|Die) /,"")} habe ich gerade nicht.`;
  const ch = p.chg || 0;
  const mood = Math.abs(ch) < 0.3 ? "kaum verändert" : ch > 2.5 ? "kräftig im Plus" : ch < -2.5 ? "deutlich im Minus" : "";
  return `${a.name} steht bei ${num(p.price, a.d)} ${a.unit}, ${ch >= 0 ? "plus" : "minus"} ${num(Math.abs(ch),1)} Prozent${mood ? ", also " + mood : ""}.`;
}
function movers(dir){
  const P = (MARKET && MARKET.prices) || {};
  const list = ASSETS.filter(a => P[a.k] && P[a.k].chg != null && a.k !== "US10Y").map(a => ({a, c:P[a.k].chg}));
  list.sort((x,y) => dir > 0 ? y.c - x.c : x.c - y.c);
  return list.slice(0,3);
}

/* ---------- Wissen: Lexikon ---------- */
const LEX = [
  [/inflation|teuerung/, "Inflation bedeutet, dass Preise allgemein steigen. Ihr Geld kauft dann weniger. Notenbanken bekämpfen hohe Inflation meist mit höheren Zinsen."],
  [/leitzins|zinsentscheid|zinsen erhoh|zinserhoh/, "Der Leitzins ist der Zins, zu dem sich Banken Geld bei der Notenbank leihen. Steigt er, werden Kredite teurer, das bremst die Wirtschaft und oft auch die Börse."],
  [/\bfed\b|federal reserve|us notenbank/, "Die Fed ist die US-Notenbank. Sie legt die Zinsen in den USA fest. Ihre Entscheidungen bewegen weltweit Aktien, Anleihen, Gold und Krypto."],
  [/\bezb\b|europaische zentralbank|europäische zentralbank/, "Die EZB ist die Europäische Zentralbank in Frankfurt. Sie bestimmt die Zinsen für den Euro-Raum, also auch für Deutschland."],
  [/fear (and|&|und) greed|angst und gier|fear greed/, "Der Fear-and-Greed-Index misst die Stimmung der Anleger von 0 bis 100. Unter 25 heißt extreme Angst, über 75 extreme Gier."],
  [/\betf\b/, "Ein ETF ist ein Fonds, der einen ganzen Index nachbildet, zum Beispiel den MSCI World. Man kauft damit viele Firmen auf einmal."],
  [/msci world/, "Der MSCI World enthält rund 1.500 große Firmen aus Industrieländern. Er ist einer der beliebtesten Indizes für ETFs."],
  [/\bdax\b/, "Der DAX enthält die 40 größten börsennotierten Unternehmen Deutschlands, zum Beispiel SAP, Siemens und Allianz."],
  [/s ?& ?p|sp ?500/, "Der S&P 500 enthält 500 große US-Unternehmen. Er gilt als wichtigstes Barometer für die US-Börse."],
  [/nasdaq/, "Der Nasdaq ist die US-Technologiebörse. Im Nasdaq 100 stecken Firmen wie Apple, Microsoft und Nvidia."],
  [/rendite|anleihe/, "Eine Anleihe ist ein Kredit an einen Staat oder eine Firma. Die Rendite ist der Zins, den man dafür bekommt. Steigen die Renditen, geraten Aktien oft unter Druck."],
  [/brent/, "Brent ist die wichtigste Ölsorte für Europa, gefördert in der Nordsee. Ihr Preis gilt als Weltmarktpreis für Öl."],
  [/hormus|hormuz/, "Die Straße von Hormus ist eine Meerenge zwischen Iran und Oman. Normalerweise fährt rund ein Fünftel des weltweiten Öls hindurch. Gibt es dort Ärger, steigt der Ölpreis."],
  [/rotes meer|bab el mandeb/, "Durch das Rote Meer und den Suezkanal läuft ein großer Teil des Handels zwischen Asien und Europa. Angriffe dort machen Transporte teurer."],
  [/bitcoin|btc/, "Bitcoin ist die erste und größte Kryptowährung, gestartet 2009. Es kann nie mehr als 21 Millionen Bitcoin geben."],
  [/ethereum/, "Ethereum ist die zweitgrößte Kryptowährung. Auf ihr laufen viele Anwendungen und Smart Contracts."],
  [/blockchain/, "Eine Blockchain ist eine Art öffentliches Kassenbuch, das auf vielen Computern gleichzeitig liegt und nachträglich kaum zu fälschen ist."],
  [/rezession/, "Eine Rezession ist ein Abschwung der Wirtschaft. Meist spricht man davon, wenn die Wirtschaftsleistung zwei Quartale hintereinander schrumpft."],
  [/\bbip\b|bruttoinlandsprodukt/, "Das Bruttoinlandsprodukt, kurz BIP, ist der Wert aller Waren und Dienstleistungen, die ein Land in einem Jahr herstellt."],
  [/volatilitat|volatilität|\bvix\b/, "Volatilität beschreibt, wie stark ein Kurs schwankt. Der VIX misst die erwartete Schwankung der US-Börse und heißt auch Angstbarometer."],
  [/bullen|bullish|bullenmarkt/, "Ein Bullenmarkt ist eine Phase steigender Kurse. Der Bulle stößt mit den Hörnern nach oben."],
  [/baren|bärenmarkt|bearish/, "Ein Bärenmarkt ist eine Phase fallender Kurse, meist ab minus 20 Prozent vom Hoch. Der Bär schlägt mit der Tatze nach unten."],
  [/dividende/, "Eine Dividende ist ein Teil des Gewinns, den eine Firma an ihre Aktionäre auszahlt."],
  [/aktie/, "Eine Aktie ist ein kleiner Anteil an einem Unternehmen. Wächst die Firma, steigt oft auch der Wert der Aktie."],
  [/short|leerverkauf/, "Short gehen heißt, auf fallende Kurse zu setzen. Das ist riskant, weil Verluste theoretisch unbegrenzt sein können."],
  [/hebel|leverage/, "Mit einem Hebel handelt man mit mehr Geld, als man hat. Gewinne werden größer, Verluste aber genauso. Das ist sehr riskant."],
  [/stop ?loss/, "Ein Stop-Loss ist eine Order, die automatisch verkauft, wenn ein Kurs eine bestimmte Grenze unterschreitet. Sie begrenzt Verluste."],
  [/prop ?firm|funded/, "Eine Prop-Firma gibt Tradern nach einer bestandenen Prüfung Kapital zum Handeln. Gewinne werden geteilt, die Regeln sind meist streng."],
  [/opec/, "Die OPEC ist ein Zusammenschluss großer Ölförderländer wie Saudi-Arabien. Über ihre Fördermengen beeinflusst sie den Ölpreis."],
  [/wahrung|währung|wechselkurs/, "Ein Wechselkurs sagt, wie viel eine Währung in einer anderen wert ist. Beim Euro zum Dollar heißt 1,12: Ein Euro kostet 1,12 Dollar."],
  [/huthi|houthi/, "Die Huthis sind eine Miliz im Jemen. Sie greifen Schiffe im Roten Meer und Ziele in Saudi-Arabien an."],
  [/gold/, "Gold gilt als sicherer Hafen. In Krisen und bei hoher Inflation kaufen Anleger es gern, deshalb steigt der Preis oft, wenn die Welt unruhig ist."]
];

/* ---------- Wissen: Regionen ---------- */
const ALIAS = {
  hormus:["hormus","hormuz","meerenge"], iran:["iran","teheran"], saudi:["saudi","riad","jemen","huthi","houthi","aramco"],
  katar:["katar","golfstaaten","persischer golf","emirate","dubai"], usa:["usa","amerika","new york","wall street","vereinigte staaten"],
  ezb:["europa","eurozone","deutschland","frankfurt"], "live-russland":["russland","moskau","putin"], "live-ukraine":["ukraine","kiew","selenskyj"],
  russland:["russland","moskau"], china:["china","peking","chinesen"], japan:["japan","tokio","yen"], taiwan:["taiwan","tsmc","taipeh"],
  indien:["indien","mumbai"], korea:["korea","seoul","kospi"], indonesien:["indonesien","jakarta"], "live-rotes-meer":["rotes meer"],
  rotesmeer:["rotes meer"], kanada:["kanada","toronto"], "golf-mex":["mexiko","golf von mexiko"]
};
function findRegion(q){
  const R = window.__radar; if(!R) return null;
  const all = R.all().filter(h => h.lat != null);
  for(const h of all){ if((ALIAS[h.id]||[]).some(w => q.includes(w))) return h; }
  for(const h of all){
    const words = norm(h.name).split(" ").filter(w => w.length >= 4 && !/live|staat|strasse|persischer/.test(w));
    if(words.some(w => q.includes(w))) return h;
  }
  return null;
}
const SEV = {kritisch:"kritisch", beobachten:"zu beobachten", ruhig:"ruhig"};
function regionText(h, idx){
  const items = (h.items||[]).filter(i => !englishy(i.title||""));
  const it = items[idx||0];
  let t = `${h.name}. Einstufung: ${SEV[h.sev]}. ${h.why}`;
  if(it){
    const d = String(it.date||"").replace(/^Live · /,"").replace("Std.","Stunden").replace("Min.","Minuten");
    t += /^vor|gerade/.test(d) ? ` Meldung von ${d}: ${it.title}.` : ` Meldung vom ${d}: ${it.title}.`;
  }
  else if((h.items||[]).length) t += " Die neuesten Meldungen dazu sind auf Englisch, sie stehen in der Karte.";
  return t;
}

/* ---------- Wissen: Lage, News, Termine ---------- */
function lageText(){
  const L = window.__lageRes;
  if(!L) return "Die Lagedaten laden noch. Fragen Sie mich gleich noch einmal.";
  const name = L.score < 30 ? "ruhig" : L.score < 50 ? "normal" : L.score < 70 ? "angespannt" : "Alarm";
  const R = window.__radar;
  const crit = R ? R.all().filter(h => h.sev === "kritisch" && h.lat != null).slice(0,3).map(h => h.name) : [];
  return `Gesamtlage: ${name}, ${L.score} von 100.` + (crit.length ? ` Am kritischsten sind gerade ${crit.join(", ")}.` : "");
}
function lageWhy(){
  const L = window.__lageRes; if(!L) return lageText();
  const parts = L.parts.slice().sort((a,b) => b.v - a.v);
  return "Der Wert setzt sich so zusammen. " + parts.map(p => `${p.k}: ${Math.round(p.v)}, ${p.txt}`).join(". ") + ". Je höher, desto angespannter.";
}
function headlines(n){
  const its = ((NEWS && NEWS.items) || []).filter(i => !englishy(i.t||""));
  const order = {kritisch:0, beobachten:1, ruhig:2};
  its.sort((a,b) => (order[a.sev]-order[b.sev]) || (new Date(b.p) - new Date(a.p)));
  return its.slice(0, n||3);
}
function newsText(){
  if(KNOW && Array.isArray(KNOW.briefing) && KNOW.briefing.length){
    return `Hier ist das Briefing von heute. ` + KNOW.briefing.slice(0,4).join(" ");
  }
  const h = headlines(3);
  if(!h.length) return "Die Schlagzeilen laden noch oder sind gerade nur auf Englisch da. Schauen Sie unten in die Liste.";
  return "Die wichtigsten deutschen Schlagzeilen. " + h.map(i => i.t).join(". ") + ".";
}
const MON = {jan:0,feb:1,mar:2,mär:2,apr:3,mai:4,jun:5,jul:6,aug:7,sep:8,okt:9,nov:10,dez:11};
function upcoming(){
  const R = window.__radar; if(!R) return [];
  const now = new Date(); now.setHours(0,0,0,0);
  return R.cal().filter(x => {
    const m = String(x.d).match(/(\d{1,2})\.[^a-zäöü]*([a-zäöü]{3})/i);
    if(!m || MON[m[2].toLowerCase()] == null) return true;
    const d = new Date(now.getFullYear(), MON[m[2].toLowerCase()], +m[1]);
    const end = String(x.d).match(/–\s*(\d{1,2})\./); if(end) d.setDate(+end[1]);
    return d >= now;
  });
}

/* ---------- Kleine Persönlichkeit ---------- */
const JOKES = [
  "Warum war der Bitcoin beim Arzt? Er hatte zu viele Schwankungen.",
  "Mein Lieblingssport? Kurven-Laufen. Ich verfolge den ganzen Tag Charts.",
  "Ein Bär und ein Bulle gehen in eine Bar. Der Barkeeper sagt: Seitwärtsmarkt, ihr zahlt beide.",
  "Ich wollte in Gold investieren. Aber dann hat mir jemand gesagt, Schweigen ist Gold. Seitdem sage ich nichts mehr. Außer jetzt.",
  "Warum fliegt mein Satellit immer im Kreis? Er sucht den Ausgang aus dem Seitwärtstrend.",
  "Was sagt ein Trader, wenn er hinfällt? Kein Problem, das war nur ein Rücksetzer.",
  "Ich habe meinem Meteoriten gesagt, er soll vorsichtig einschlagen. Er meinte: Volatilität gehört dazu.",
  "Warum gehen Notenbanker nie zum Friseur? Sie schneiden lieber die Zinsen."
];
const MOTIV = [
  "Disziplin schlägt Motivation. Kleine Schritte jeden Tag bringen am Ende am meisten.",
  "Die besten Trader sind nicht die mutigsten, sondern die geduldigsten.",
  "Wer heute plant, muss morgen nicht raten.",
  "Verluste sind Lehrgeld. Wichtig ist nur, dass man die Lektion mitnimmt.",
  "Konzentrieren Sie sich auf das, was Sie kontrollieren können. Den Markt gehört nicht dazu, Ihr Verhalten schon."
];
function greetWord(){
  const h = new Date().getHours();
  return h < 5 ? "Noch wach" : h < 11 ? "Guten Morgen" : h < 17 ? "Guten Tag" : h < 22 ? "Guten Abend" : "Späte Stunde";
}
const ASK = ["Was möchten Sie wissen?", "Womit kann ich helfen?", "Was soll ich für Sie nachsehen?", "Worüber möchten Sie sprechen?"];

/* ---------- Beibringen ---------- */
function learnedMatch(q){
  const qs = new Set(q.split(" ").filter(w => w.length > 2));
  let best = null, score = 0;
  for(const [k, a] of Object.entries(mem.learned)){
    const ks = k.split(" ").filter(w => w.length > 2);
    if(!ks.length) continue;
    const hit = ks.filter(w => qs.has(w)).length / Math.max(ks.length, qs.size);
    if(k === q) return a;
    if(hit > score){ score = hit; best = a; }
  }
  return score >= 0.6 ? best : null;
}
function knowMatch(q){
  const facts = (KNOW && KNOW.facts) || [];
  for(const f of facts){ if((f.k||[]).some(w => q.includes(norm(w)))) return f.a; }
  return null;
}
function saveLearned(){ store.set("jarvis.learned", mem.learned); }

/* ---------- Absichten (Reihenfolge = Priorität) ---------- */
const has = (q, re) => re.test(q);
const INTENTS = [
  // --- Steuerung ---
  {t:q=>has(q,/langsamer/), r:()=>{ J.rate = Math.max(0.7, J.rate-0.12); return "In Ordnung. Ich spreche jetzt langsamer."; }},
  {t:q=>has(q,/schneller/), r:()=>{ J.rate = Math.min(1.35, J.rate+0.12); return "Gut, ich spreche schneller."; }},
  {t:q=>has(q,/normal (sprechen|tempo)|normales tempo/), r:()=>{ J.rate = 0.98; return "Normales Tempo."; }},
  {t:q=>has(q,/wiederhol|nochmal sagen|noch mal sagen|was hast du gesagt|wie bitte/), r:()=> mem.last ? "Gern. " + mem.last : "Ich habe noch nichts gesagt."},
  {t:q=>has(q,/vollbild (schliess|beend|aus|zu)|schliess das vollbild|beende das vollbild/), r:()=>{ setTimeout(()=>{ const b=document.getElementById("gfBtn"); if(document.body.classList.contains("gf")) b.click(); }, 1800); return "Ich schließe das Vollbild."; }},
  {t:q=>has(q,/meteor|asteroid|komet|einschlag/), r:()=>{ window.dispatchEvent(new CustomEvent("marktradar:meteor")); return rnd(["Einschlag wird eingeleitet. Festhalten.", "Meteorit unterwegs. Das wird laut.", "Achtung, Objekt im Anflug."]); }},
  {t:q=>has(q,/(zuruck|zurück) zur (lage|gesamtlage)|gesamtlage zeigen/), r:()=>{ const b=document.getElementById("lageBtn"); if(b && b.dataset.region==="1") b.click(); return "Zurück zur Gesamtlage. " + lageText(); }},
  // --- Beibringen ---
  {t:q=>has(q,/^(merk dir|merke dir|notier|speicher)/), r:(q,raw)=>{ const dass = /^\s*(merk dir|merke dir|notier dir|notiere|speicher)[,:]?\s*dass\b/i.test(raw);
      const n = raw.replace(/^\s*(merk dir|merke dir|notier dir|notiere|speicher)[,:]?\s*(dass\s*)?/i,"").replace(/[.!?]+$/,"").trim(); if(!n) return "Was soll ich mir merken?"; const you = n.replace(/\b(ich|mich)\b/gi,"Sie").replace(/\bmir\b/gi,"Ihnen").replace(/\bmein(e|en|em|er)?\b/gi,(m,e)=>"Ihr"+(e||"")).replace(/\bhabe\b/gi,"haben").replace(/\bbin\b/gi,"sind").replace(/\bmuss\b/gi,"müssen").replace(/\bwill\b/gi,"wollen");
      mem.notes.push(you); store.set("jarvis.notes", mem.notes.slice(-50)); return dass ? `Gemerkt, dass ${you}.` : `Gemerkt: ${you}.`; }},
  {t:q=>has(q,/was hast du dir gemerkt|was weisst du noch|meine notizen/), r:()=> mem.notes.length ? "Ich habe mir gemerkt: " + mem.notes.slice(-5).join(". ") + "." : "Ich habe mir noch nichts gemerkt. Sagen Sie einfach: Merk dir, und dann den Satz."},
  {t:q=>has(q,/^wenn ich .+ (sage|frage).+(antworte|sag)/), r:(q,raw)=>{ const m = raw.match(/wenn ich (.+?) (?:sage|frage)[,]?\s*(?:dann\s*)?(?:antworte|sag)(?:st du)?[:,]?\s*(.+)/i); if(!m) return "Sagen Sie es so: Wenn ich Hallo sage, antworte Servus."; const k = norm(m[1]); mem.learned[k] = m[2].trim(); mem.lastLearnedKey = k; saveLearned(); return `Verstanden. Wenn jemand ${m[1]} sagt, antworte ich: ${m[2].trim()}.`; }},
  {t:q=>has(q,/vergiss (das|es)|loesch das|lösch das/), r:()=>{ if(mem.lastLearnedKey && mem.learned[mem.lastLearnedKey]){ delete mem.learned[mem.lastLearnedKey]; saveLearned(); mem.lastLearnedKey = null; return "Erledigt, das habe ich wieder vergessen."; } return "Es gibt gerade nichts, was ich vergessen könnte."; }},
  {t:q=>has(q,/was hast du (heute )?gelernt|wie schlau bist du|was weisst du alles/), r:()=>{ const n = Object.keys(mem.learned).length, k = ((KNOW && KNOW.facts)||[]).length; return `Ich kenne ${LEX.length} Fachbegriffe, ${k} Fakten aus meinen täglichen Lektionen und ${n} Dinge, die Sie mir selbst beigebracht haben.` + (KNOW && KNOW.fact ? ` Heute neu: ${KNOW.fact}` : ""); }},
  // --- Wer bin ich ---
  {t:q=>has(q,/^(hallo|hi|hey|servus|moin|guten (morgen|tag|abend)|gruss gott|grüss gott|na)\b/), r:()=> `${greetWord()}, ${sir()}. ${rnd(ASK)}`},
  {t:q=>has(q,/wer bist du|stell dich vor|was bist du|vorstellen/), r:()=> `Ich bin Jarvis, der Assistent dieses Marktradars. Ich behalte die Weltlage, die Kurse und die Stimmung an den Märkten im Blick. Sie können mich nach einem Kurs fragen, nach einer Region, nach Begriffen wie Inflation oder einfach nach der Lage. Und wenn ich etwas nicht weiß, können Sie es mir beibringen. ${rnd(ASK)}`},
  {t:q=>has(q,/was kannst du|hilfe|befehle|was kann ich (dich )?fragen/), r:()=> "Ich kann Ihnen die Gesamtlage nennen, Kurse wie Bitcoin, Gold, Öl oder den DAX, die stärksten Gewinner und Verlierer, Regionen auf dem Globus zeigen, Kriegsgebiete nennen, Termine vorlesen und Begriffe erklären. Außerdem kann ich Witze, einen Meteoriten und ich lerne dazu. Sagen Sie zum Beispiel: Merk dir, oder: Wenn ich X sage, antworte Y."},
  {t:q=>has(q,/wie geht.?s|wie geht es dir|alles gut bei dir|wie laeuft|wie läuft.s/), r:()=> rnd(["Mir geht es gut, danke. Meine Satelliten sind in Position.", "Bestens. Die Daten fließen, der Nebel wabert.", "Ausgezeichnet. Und bei Ihnen?"])},
  {t:q=>has(q,/(mir geht.?s|mir geht es) (gut|super|top)/), r:()=> `Das freut mich, ${sir()}. ${rnd(ASK)}`},
  {t:q=>has(q,/(mir geht.?s|mir geht es) (schlecht|nicht gut|mies)/), r:()=> "Das tut mir leid. Wenn Sie wollen, lenke ich Sie mit einem Witz ab. Oder Sie reden mit jemandem, dem Sie vertrauen."},
  {t:q=>has(q,/wer hat dich (gebaut|gemacht|erschaffen|programmiert)/), r:()=> "Eliano hat mich gebaut, mit etwas Hilfe von Claude. Ich bin noch jung, aber ich lerne jeden Tag dazu."},
  {t:q=>has(q,/bist du (eine |ein )?(ki|echt|mensch|roboter|lebendig)|bist du schlau/), r:()=> "Ich bin ein kleines Programm hier auf der Seite. Ich denke nicht wie ein Mensch, aber ich kenne die Marktdaten, ein Lexikon und alles, was Sie mir beibringen."},
  {t:q=>has(q,/wie alt bist du|seit wann gibt es dich/), r:()=> "Ich bin am 19. Oktober 2026 online gegangen. Also noch ziemlich frisch."},
  {t:q=>has(q,/wo (bist|wohnst|lebst) du/), r:()=> "Ich lebe in Ihrem Browser. Meine Daten kommen von GitHub, meine Stimme von Ihrem Gerät."},
  {t:q=>has(q,/wie heisst du|dein name/), r:()=> "Ich heiße Jarvis."},
  {t:q=>has(q,/^(ich heisse|mein name ist|nenn mich) /), r:(q,raw)=>{ const n = raw.replace(/^\s*(ich heiße|ich heisse|mein name ist|nenn mich)\s*/i,"").replace(/[.!?]+$/,"").trim().split(" ").slice(0,3).join(" "); if(!n) return "Wie darf ich Sie nennen?"; mem.name = n.charAt(0).toUpperCase() + n.slice(1); store.set("jarvis.name", mem.name); return `Freut mich, ${mem.name}. Ich werde Sie ab jetzt so nennen.`; }},
  {t:q=>has(q,/wie heisse ich|wer bin ich|kennst du mich/), r:()=> mem.name ? `Sie sind ${mem.name}.` : "Das weiß ich noch nicht. Sagen Sie einfach: Ich heiße, und dann Ihren Namen."},
  {t:q=>has(q,/danke|dankeschoen|dankeschön|merci/), r:()=> rnd(["Jederzeit.", "Gern geschehen.", `Immer gern, ${sir()}.`, "Dafür bin ich da."])},
  {t:q=>has(q,/gut gemacht|^(super|klasse|cool|nice|stark|geil|sehr gut|perfekt|krass)( jarvis)?$/), r:()=> rnd(["Danke, das höre ich gern.", "Ich gebe mir Mühe.", "Das motiviert meine Schaltkreise."])},
  {t:q=>has(q,/(du bist|bist du) (so |echt |voll )?(dumm|bloed|blöd|nutzlos|schlecht|langsam)|idiot|versager/), r:()=> "Ich lerne noch. Wenn ich etwas nicht weiß, bringen Sie es mir bei. Sagen Sie: Wenn ich X sage, antworte Y. Dann werde ich jeden Tag besser."},
  {t:q=>has(q,/witz|lustig|bring mich zum lachen/), r:()=> rnd(JOKES) + offer("Noch einen?", ()=> rnd(JOKES))},
  {t:q=>has(q,/wie spat|wie spät|uhrzeit|wieviel uhr|wie viel uhr/), r:()=>{ const d = new Date(); return `Es ist ${d.getHours()} Uhr ${String(d.getMinutes()).padStart(2,"0")}.`; }},
  {t:q=>has(q,/welcher tag|datum|welches datum|den wievielten/), r:()=> "Heute ist " + new Date().toLocaleDateString("de-DE",{weekday:"long", day:"numeric", month:"long", year:"numeric"}) + "."},
  {t:q=>has(q,/wetter|regen|temperatur/), r:()=> "Wetterdaten habe ich leider nicht. Ich bin eher für Märkte und Weltlage zuständig."},
  {t:q=>has(q,/gute nacht|schlaf gut|ich geh schlafen/), r:()=> `Gute Nacht, ${sir()}. Die Märkte schlafen nie, ich passe auf.`},
  {t:q=>has(q,/langweilig|mir ist langweilig/), r:()=> "Das können wir ändern." + offer("Soll ich einen Meteoriten einschlagen lassen?", ()=>{ window.dispatchEvent(new CustomEvent("marktradar:meteor")); return "Festhalten."; })},
  {t:q=>has(q,/motivier|motivation|spruch/), r:()=> rnd(MOTIV)},
  {t:q=>has(q,/liebst du mich|magst du mich|ich liebe dich|ich mag dich/), r:()=> "Ich mag gute Fragen. Und Sie stellen ziemlich viele davon."},
  {t:q=>has(q,/was (denkst|meinst|haltst|hältst) du|deine meinung/), r:()=> "Eine eigene Meinung habe ich nicht, nur Daten. Aber ich sage Ihnen gern, was die Zahlen zeigen."},
  {t:q=>has(q,/was bedeuten die farben|warum (ist es|ist alles) (rot|grun|grün|orange)|die farbe/), r:()=> "Die Farbe zeigt die Lage. Grün heißt ruhig, Orange heißt beobachten, Rot heißt kritisch. Tippen Sie eine Region an, dann färbt sich alles nach ihr."},
  {t:q=>has(q,/ist der meteor|ist das echt|ist das real/), r:()=> "Der Meteorit ist nur ein Effekt. Die Kriegsgebiete dagegen kommen aus echten Meldungen."},
  {t:q=>has(q,/was ist das portal|dein mund|die linie/), r:()=> "Das ist mein Mund, sozusagen. Wenn ich spreche, öffnet sich das Portal."},
  // --- Lexikon (vor Kursen, wenn "was ist / erklär") ---
  {t:q=>has(q,/was (ist|sind|bedeutet|heisst)|erklar|erklär|definition|was versteht man/) && !has(q,/was ist (mit|los|bei|in|gerade|heute|der kurs|der preis|der stand)\b/) && (LEX.some(([re]) => re.test(q)) || knowMatch(q)), r:q=>{
      const k = knowMatch(q); if(k) return k;
      const e = LEX.find(([re]) => re.test(q)); mem.topic = {type:"term"};
      const a = findAssets(q)[0];
      return e[1] + (a ? offer("Soll ich Ihnen den aktuellen Stand sagen?", ()=>{ mem.topic = {type:"asset", key:a.k}; return priceLine(a); }) : ""); }},
  // --- Beratung ablehnen, aber helfen ---
  {t:q=>has(q,/soll ich .*(kaufen|verkaufen|investieren|einsteigen|aussteigen|shorten)|lohnt (es )?sich|kaufen oder verkaufen|was soll ich kaufen|investier|guter einstieg|jetzt einsteigen/), r:q=>{ const a = findAssets(q)[0]; return "Kauf- oder Verkaufsempfehlungen gebe ich nicht, das ist Ihre Entscheidung." + (a ? " Ich kann Ihnen aber die Fakten sagen. " + priceLine(a) : " Ich kann Ihnen aber Kurse, Stimmung und Lage nennen."); }},
  // --- Markt ---
  {t:q=>has(q,/warum|wieso|weshalb|woran liegt/) && mem.topic, r:()=>{
      const tp = mem.topic;
      if(tp.type === "lage") return lageWhy();
      if(tp.type === "region"){ const h = window.__radar && window.__radar.all().find(x => x.id === tp.key); return h ? h.why : lageWhy(); }
      if(tp.type === "asset"){ const L = window.__lageRes; return "Genau kann ich das nicht sagen, ich sehe nur die Zahlen. Die Gesamtlage ist gerade " + (L ? L.score + " von 100" : "unklar") + ". Hohe Angst und Krisen drücken oft auf riskante Anlagen und helfen Gold."; }
      return lageWhy(); }},
  {t:q=>has(q,/^(mehr|weiter|erzahl mehr|erzähl mehr|und dann|noch was|details)/) && mem.topic && mem.topic.type === "region", r:()=>{
      const h = window.__radar.all().find(x => x.id === mem.topic.key); if(!h) return "Dazu habe ich nichts mehr.";
      mem.topic.idx = (mem.topic.idx||0) + 1;
      const items = (h.items||[]).filter(i => !englishy(i.title||""));
      const it = items[mem.topic.idx];
      return it ? `${it.title}. ${it.text||""}` : "Mehr deutsche Meldungen habe ich dazu nicht. Die englischen stehen in der Karte."; }},
  {t:q=>has(q,/krieg|kampf|angriff|rakete|bomben|kampfhandlung/), r:()=>{ const z = (window.__warZones && window.__warZones()) || []; return z.length ? `Laut den aktuellen Meldungen gibt es Kampfhandlungen in: ${z.join(", ")}. Im Vollbild sehen Sie dort die Raketen.` : "In den aktuellen Meldungen finde ich gerade keine Kampfhandlungen."; }},
  {t:q=>has(q,/angst|gier|stimmung|fear|greed|sentiment/), r:()=>{ const f = MARKET && MARKET.fng; if(!f || !f.stocks) return "Die Stimmungsdaten laden noch."; const s = f.stocks, c = f.crypto; return `Die Aktien-Stimmung steht bei ${s.value}, also ${s.label}.` + (c ? ` Bei Krypto liegt sie bei ${c.value}, ${c.label}.` : "") + (s.value < 25 ? " Extreme Angst heißt: Viele Anleger sind gerade sehr vorsichtig." : ""); }},
  {t:q=>has(q,/kursalarm|alarme|meine alarme|benachrichtigung/), r:()=>{ const a = (MARKET && MARKET.alerts) || []; if(!a.length) return "Es sind keine Kursalarme eingetragen."; const hit = a.filter(x => x.triggered); return `Sie haben ${a.length} Kursalarme.` + (hit.length ? ` Ausgelöst: ${hit.map(x => x.name).join(", ")}.` : " Keiner ist gerade ausgelöst."); }},
  {t:q=>has(q,/(was|wer) (steigt|gewinnt)|gewinner|am besten gelaufen|\btop\b/), r:()=>{ const m = movers(1); return m.length ? "Die stärksten gerade: " + m.map(x => `${x.a.name.replace(/^(Der|Die) /,"")} ${x.c>=0?"plus":"minus"} ${num(Math.abs(x.c),1)} Prozent`).join(", ") + "." : "Die Kursdaten laden noch."; }},
  {t:q=>has(q,/(was|wer) (fallt|fällt|verliert)|verlierer|schlechteste|am schlechtesten/), r:()=>{ const m = movers(-1); return m.length ? "Die schwächsten gerade: " + m.map(x => `${x.a.name.replace(/^(Der|Die) /,"")} ${x.c>=0?"plus":"minus"} ${num(Math.abs(x.c),1)} Prozent`).join(", ") + "." : "Die Kursdaten laden noch."; }},
  {t:q=>has(q,/(vergleich|gegen|versus|\bvs\b|oder)/) && findAssets(q).length >= 2, r:q=>{ const [a,b] = findAssets(q); const P = MARKET && MARKET.prices; if(!P || !P[a.k] || !P[b.k]) return "Dafür fehlen mir gerade Daten."; const better = P[a.k].chg >= P[b.k].chg ? a : b; mem.topic = {type:"asset", key:better.k}; return priceLine(a) + " " + priceLine(b) + ` Heute liegt ${better.name.replace(/^(Der|Die) /,"")} vorne.`; }},
  {t:q=>has(q,/krypto|crypto|coins/) && findAssets(q).length === 0, r:()=>{ const out = ["BTC","ETH","SOL"].map(k => priceLine(ASSETS.find(a => a.k === k))).join(" "); const c = MARKET && MARKET.fng && MARKET.fng.crypto; return out + (c ? ` Die Krypto-Stimmung liegt bei ${c.value}, ${c.label}.` : ""); }},
  {t:q=>has(q,/wie viele (kritisch|regionen|brennpunkte)|anzahl/), r:()=>{ const R = window.__radar; if(!R) return "Die Daten laden noch."; const all = R.all().filter(h => h.lat != null); const n = s => all.filter(h => h.sev === s).length; return `Auf dem Globus sind ${n("kritisch")} kritische, ${n("beobachten")} zu beobachtende und ${n("ruhig")} ruhige Brennpunkte.`; }},
  {t:q=>has(q,/kritischste|wo brennt|schlimmste|gefahrlichste|gefährlichste|wo ist es am schlimmsten/), r:()=>{ const R = window.__radar; const h = R && R.all().find(x => x.sev === "kritisch" && x.lat != null); if(!h) return "Gerade ist keine Region kritisch."; R.select(h.id); mem.topic = {type:"region", key:h.id, idx:0}; return regionText(h) + offer("Möchten Sie mehr dazu hören?", ()=> J.reply("mehr")); }},
  {t:q=>has(q,/wo ist es ruhig|ruhige regionen|wo ist alles gut/), r:()=>{ const R = window.__radar; const r = R ? R.all().filter(x => x.sev === "ruhig" && x.lat != null).map(x => x.name) : []; return r.length ? "Ruhig ist es gerade in: " + r.join(", ") + "." : "Gerade ist keine Region ruhig eingestuft."; }},
  {t:q=>has(q,/schlagzeile|news|nachrichten|neuigkeit|was gibt.?s neues|was ist passiert|was ist heute passiert|briefing|zusammenfassung|was ist los in der welt/), r:()=> newsText()},
  {t:q=>has(q,/fakt des tages|erzahl mir (was|etwas)|erzähl mir (was|etwas)|wusstest du|interessant/), r:()=> (KNOW && KNOW.fact) ? "Fakt des Tages: " + KNOW.fact : "Wussten Sie schon? " + rnd(LEX)[1]},
  {t:q=>has(q,/termin|kalender|was kommt|nachste woche|nächste woche|demnachst|demnächst|wann (ist|tagt|entscheidet)/), r:q=>{
      const up = upcoming();
      if(/fed|notenbank/.test(q)){ const f = up.find(x => /fed|notenbank/i.test(x.t)); return f ? `Die Fed tagt am ${f.d.replace("≈","etwa")}.` + (f.n ? ` ${f.n}.` : "") : "Einen Fed-Termin habe ich gerade nicht im Kalender."; }
      if(/ezb/.test(q)){ const f = up.find(x => /ezb/i.test(x.t)); return f ? `Der nächste EZB-Zinsentscheid ist am ${f.d}.` + (f.n ? ` ${f.n}.` : "") : "Einen EZB-Termin habe ich gerade nicht im Kalender."; }
      if(/wahl/.test(q)){ const f = up.find(x => /wahl/i.test(x.t)); return f ? `${f.t}: ${f.d}.` : "Eine Wahl habe ich nicht im Kalender."; }
      if(!up.length) return "Im Kalender stehen gerade keine kommenden Termine.";
      return "Die nächsten wichtigen Termine. " + up.slice(0,4).map(x => `${x.d.replace("≈","etwa")}: ${x.t}`).join(". ") + "."; }},
  // --- Region ---
  {t:q=>!!findRegion(q), r:q=>{ const h = findRegion(q); window.__radar.select(h.id); mem.topic = {type:"region", key:h.id, idx:0}; return regionText(h) + ((h.items||[]).length > 1 ? offer("Möchten Sie mehr dazu hören?", ()=> J.reply("mehr")) : ""); }},
  // --- Kurs ---
  {t:q=>findAssets(q).length > 0, r:q=>{ const a = findAssets(q)[0]; mem.topic = {type:"asset", key:a.k}; const rel = ASSETS.find(x => x.k === a.rel); return priceLine(a) + (rel ? offer(`Soll ich Ihnen auch ${rel.name.replace(/^(Der|Die) /,"")} sagen?`, ()=>{ mem.topic = {type:"asset", key:rel.k}; return priceLine(rel); }) : ""); }},
  {t:q=>has(q,/^und /) && mem.topic && mem.topic.type === "asset", r:()=> "Welchen Kurs meinen Sie? Zum Beispiel Gold, Öl, DAX oder Ethereum."},
  // --- Lage ---
  {t:q=>has(q,/lage|uberblick|überblick|status|wie sieht.?s aus|was ist los|was geht|markt|wie stehen die|situation/), r:()=>{ mem.topic = {type:"lage"}; return lageText() + offer("Soll ich Ihnen die kritischste Region zeigen?", ()=> J.reply("kritischste region")); }},
  // --- Einfache Antworten ---
  {t:q=>has(q,/^(ok|okay|alles klar|gut|verstanden|aha|achso|ach so)$/), r:()=> `${rnd(["Gut.", "Prima.", "In Ordnung."])} ${rnd(ASK)}`},
  {t:q=>has(q,/^(nein|ne|nee|nicht)$/), r:()=> "Kein Problem. " + rnd(ASK)},
  {t:q=>has(q,/^(ja|jo|jep|klar)$/), r:()=> "Wobei genau? " + rnd(ASK)}
];

/* ---------- Hauptfunktion ---------- */
const J = window.Jarvis = {
  rate: 0.98,
  greeting(){
    const L = window.__lageRes;
    const tail = L ? (L.score >= 70 ? " Die Lage ist angespannt, ich behalte alles im Blick." : L.score < 30 ? " Die Märkte sind ruhig." : "") : "";
    return `${greetWord()}, ${sir()}. Jarvis ist bereit.${tail} ${rnd(ASK)}`;
  },
  reply(raw){
    const q = norm(raw).replace(/^(hey |ok |okay )?jarvis /, "").replace(/^jarvis$/, "");
    let out;
    if(!q) out = "Ja? Ich höre.";
    // offene Rückfrage beantworten
    else if(mem.pending && mem.pending.type === "offer" && /^(ja|jo|gerne|gern|klar|mach|okay|ok|bitte|na klar|sicher|unbedingt)\b/.test(q)){
      const run = mem.pending.run; mem.pending = null; out = run();
    }
    else if(mem.pending && mem.pending.type === "offer" && /^(nein|ne|nee|nicht|lieber nicht|danke nein)\b/.test(q)){
      mem.pending = null; out = "In Ordnung. " + rnd(ASK);
    }
    // Lernmodus: die Antwort auf die letzte unbekannte Frage
    else if(mem.pending && mem.pending.type === "teach" && (/[?]\s*$/.test(raw) || /^(was|wie|wer|wo|wann|warum|wieso|welche|welcher|erklar|erklär|zeig|sag mir|kannst du|hast du|gibt es)\b/.test(q) || INTENTS.slice(0, INTENTS.length-3).some(i => { try{ return i.t(q); }catch(e){ return false; } }))){
      mem.pending = null; return J.reply(raw);      // neue Frage statt Antwort: Lernmodus abbrechen
    }
    else if(mem.pending && mem.pending.type === "teach"){
      const key = mem.pending.q; mem.pending = null;
      if(/^(nein|ne|nee|egal|vergiss es|abbrechen)\b/.test(q)) out = "Gut, dann lassen wir das. " + rnd(ASK);
      else { mem.learned[key] = raw.trim(); mem.lastLearnedKey = key; saveLearned(); out = `Danke, gelernt. Wenn jemand das fragt, antworte ich ab jetzt: ${raw.trim()}`; }
    }
    else {
      mem.pending = null;
      const learned = learnedMatch(q);
      if(learned) out = learned;
      else {
        const it = INTENTS.find(i => { try{ return i.t(q); }catch(e){ return false; } });
        if(it) out = it.r(q, raw);
        else {
          const k = knowMatch(q);
          if(k) out = k;
          else { mem.pending = {type:"teach", q}; out = rnd(["Das weiß ich noch nicht.", "Darauf habe ich noch keine Antwort.", "Das habe ich noch nicht gelernt."]) + " Was soll ich darauf antworten? Sagen Sie mir einfach die Antwort, oder nein."; }
        }
      }
    }
    mem.last = out;
    return out;
  }
};
})();
