#!/usr/bin/env python3
"""Holt Finanz-Schlagzeilen aus freien RSS-Feeds und schreibt news.json fuer das Marktradar.

Nur Standardbibliothek. Laeuft stuendlich per GitHub Actions.
"""
import html, json, re, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (Marktradar; +https://github.com)"
MAX_AGE_H = 36
MAX_ITEMS = 90

def gnews(q, lang="de"):
    if lang == "de":
        return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "de", "gl": "DE", "ceid": "DE:de"})
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})

FEEDS = [
    ("Tagesschau", "https://www.tagesschau.de/wirtschaft/index~rss2.xml"),
    ("n-tv", "https://www.n-tv.de/wirtschaft/rss"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("CNBC Markets", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("OilPrice", "https://oilprice.com/rss/main"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Google News", gnews("Börse OR Ölpreis OR Leitzins OR DAX when:1d")),
    ("Google News", gnews("stock market OR oil prices OR treasury yields OR Fed when:1d", "en")),
    ("Google News", gnews("Strait of Hormuz OR Iran oil OR Red Sea shipping when:1d", "en")),
]

# Orte: Reihenfolge = Prioritaet (spezifisch vor allgemein)
LOCS = [
    ("hormus", "Straße von Hormus", 26.57, 56.25, "OMN", [r"hormu[sz]"]),
    ("rotes-meer", "Rotes Meer", 15.5, 41.5, "YEM", [r"red sea", r"rote[sn]? meer", r"houthi", r"huthi", r"bab el-mandeb", r"jemen", r"yemen"]),
    ("katar", "Katar", 25.35, 51.18, "QAT", [r"qatar", r"katar"]),
    ("saudi", "Saudi-Arabien", 24.71, 46.68, "SAU", [r"saudi", r"aramco", r"riyadh", r"riad"]),
    ("vae", "Vereinigte Arabische Emirate", 24.45, 54.38, "ARE", [r"\buae\b", r"emirate", r"dubai", r"abu dhabi"]),
    ("irak", "Irak", 33.31, 44.36, "IRQ", [r"\biraq", r"\birak"]),
    ("israel", "Israel / Gaza", 31.77, 35.21, "ISR", [r"israel", r"gaza", r"hezbollah", r"hisbollah", r"lebanon", r"libanon"]),
    ("iran", "Iran", 35.69, 51.39, "IRN", [r"\biran", r"tehran", r"teheran", r"irgc", r"revolutionary guard", r"revolutionsgarde"]),
    ("opec", "OPEC", 48.21, 16.37, "AUT", [r"\bopec"]),
    ("ukraine", "Ukraine", 50.45, 30.52, "UKR", [r"ukrain", r"kyiv", r"kiew", r"zelensk", r"selensk"]),
    ("russland", "Russland", 55.76, 37.62, "RUS", [r"russia", r"russland", r"russisch", r"kremlin", r"kreml", r"putin", r"moscow", r"moskau", r"gazprom", r"rosneft"]),
    ("taiwan", "Taiwan", 25.03, 121.56, "TWN", [r"taiwan", r"tsmc", r"taipei"]),
    ("china", "China", 39.9, 116.4, "CHN", [r"china", r"chinese", r"chinesisch", r"beijing", r"peking", r"\bxi\b", r"yuan", r"hang seng", r"hong kong", r"hongkong", r"shanghai"]),
    ("japan", "Japan", 35.68, 139.69, "JPN", [r"japan", r"\byen\b", r"nikkei", r"bank of japan", r"\bboj\b", r"tokyo", r"tokio"]),
    ("korea", "Südkorea", 37.57, 126.98, "KOR", [r"south korea", r"südkorea", r"kospi", r"samsung", r"seoul"]),
    ("indien", "Indien", 19.08, 72.88, "IND", [r"\bindia", r"\bindien", r"nifty", r"sensex", r"rupee", r"rupie", r"mumbai", r"\bmodi\b"]),
    ("tuerkei", "Türkei", 41.01, 28.98, "TUR", [r"turkey", r"türkei", r"turkish", r"türkisch", r"\blira\b", r"erdogan"]),
    ("ezb", "Eurozone / EZB", 50.11, 8.68, "DEU", [r"\becb\b", r"\bezb\b", r"lagarde", r"eurozone", r"euro zone", r"euroraum", r"europäische zentralbank", r"european central bank"]),
    ("deutschland", "Deutschland", 52.52, 13.4, "DEU", [r"\bdax\b", r"germany", r"deutschland", r"german\b", r"deutsche[nmr]? ", r"bundesbank", r"berlin", r"merz\b", r"volkswagen", r"\bvw\b", r"siemens", r"bmw", r"mercedes", r"rheinmetall", r"\bsap\b"]),
    ("frankreich", "Frankreich", 48.86, 2.35, "FRA", [r"france", r"frankreich", r"french", r"französisch", r"cac 40", r"macron", r"paris"]),
    ("uk", "Großbritannien", 51.51, -0.13, "GBR", [r"\buk\b", r"britain", r"british", r"britisch", r"großbritannien", r"bank of england", r"\bboe\b", r"ftse", r"london", r"pound", r"pfund", r"sterling"]),
    ("schweiz", "Schweiz", 46.95, 7.45, "CHE", [r"switzerland", r"schweiz", r"swiss", r"\bsnb\b", r"franken\b"]),
    ("kanada", "Kanada", 43.65, -79.38, "CAN", [r"canada", r"kanada", r"canadian", r"kanadisch", r"toronto", r"ottawa"]),
    ("mexiko", "Mexiko", 19.43, -99.13, "MEX", [r"mexico", r"mexiko", r"peso\b"]),
    ("venezuela", "Venezuela", 10.48, -66.9, "VEN", [r"venezuela"]),
    ("brasilien", "Brasilien", -23.55, -46.63, "BRA", [r"brazil", r"brasilien", r"petrobras", r"\breal\b"]),
    ("argentinien", "Argentinien", -34.6, -58.38, "ARG", [r"argentin", r"milei"]),
    ("nigeria", "Nigeria", 9.08, 7.4, "NGA", [r"nigeria"]),
    ("suedafrika", "Südafrika", -26.2, 28.05, "ZAF", [r"south africa", r"südafrika", r"\brand\b"]),
    ("australien", "Australien", -33.87, 151.21, "AUS", [r"australia", r"australien", r"\brba\b", r"asx"]),
    ("golf-mexiko", "Golf von Mexiko", 26.5, -90.5, "", [r"gulf of mexico", r"golf von mexiko", r"hurricane", r"hurrikan"]),
    ("usa", "USA", 40.71, -74.0, "USA", [r"wall street", r"s&p", r"s&amp;p", r"nasdaq", r"\bdow\b", r"\bfed\b", r"federal reserve", r"powell", r"warsh", r"treasur", r"us-", r"\bu\.s\.", r"\bus\b", r"\busa\b", r"america", r"amerika", r"trump", r"white house", r"weißes haus", r"washington", r"nvidia", r"apple", r"microsoft", r"tesla", r"amazon", r"jpmorgan", r"goldman"]),
]
LOC_RX = [(k, n, la, lo, iso, re.compile("|".join(p), re.I)) for k, n, la, lo, iso, p in LOCS]

SEV_CRIT = re.compile("|".join([
    r"attack", r"angriff", r"angegriffen", r"\bwar\b", r"krieg", r"airstrike", r"luftangriff", r"missile", r"rakete", r"drohne", r"\bdrone",
    r"explosion", r"explod", r"crash", r"absturz", r"einbruch", r"bricht ein", r"plunge", r"plummet", r"collapse", r"kollaps",
    r"tanker", r"blockade", r"blockiert", r"invasion", r"emergency", r"notstand", r"liquidat", r"\bhack", r"bankrupt", r"insolvenz",
    r"pleite", r"tumble", r"sell-?off", r"ausverkauf", r"panic", r"panik", r"crisis", r"krise", r"default",
    r"highest since", r"höchste[rns]? (?:stand )?seit", r"lowest since", r"tiefste[rns]? (?:stand )?seit",
]), re.I)
SEV_WATCH = re.compile("|".join([
    r"sanction", r"sanktion", r"tariff", r"\bzoll", r"zölle", r"inflation", r"rate hike", r"rate cut", r"zinserhöhung", r"zinssenkung",
    r"leitzins", r"\bzinsen", r"yield", r"rendite", r"\bfed\b", r"\becb\b", r"\bezb\b", r"\bopec", r"warn", r"risk", r"risiko",
    r"\bfalls?\b", r"fällt", r"fallen", r"drops?\b", r"slides?\b", r"sinkt", r"verliert", r"volatil", r"tension", r"spannung",
    r"election", r"\bwahl", r"deadline", r"\bfrist", r"downgrade", r"herabgestuft", r"recession", r"rezession", r"jobs report", r"arbeitsmarkt",
    r"seized", r"beschlagnahm", r"record high", r"rekordhoch", r"rekordtief", r"surge", r"soar", r"steigt", r"springt", r"jump", r"rall(?:y|ies)",
]), re.I)

MARKETS = [
    ("oel", r"\boil\b|\böl|ölpreis|brent|\bwti\b|crude|opec|\blng\b|erdgas|natural gas|tanker|refiner|raffiner|energy|energie|benzin|diesel|gasoline"),
    ("krypto", r"bitcoin|\bbtc\b|crypto|krypto|ethereum|\bether\b|\beth\b|\bxrp\b|solana|stablecoin|coinbase|binance|blockchain"),
    ("rohstoffe", r"\bgold\b|silver|silber|copper|kupfer|wheat|weizen|metal|metall|rohstoff|commodit|lithium|platin"),
    ("anleihen", r"bond|anleihe|treasur|yield|rendite|\bzins|interest rate|\brates?\b|\bfed\b|federal reserve|\becb\b|\bezb\b|leitzins|notenbank|zentralbank|central bank|bank of japan|bank of england"),
    ("waehrung", r"dollar|\beuro\b|\byen\b|currency|währung|forex|devisen|\bfx\b|pound|pfund|franken|yuan|rupee|rupie|\blira\b|peso"),
    ("aktien", r"stock|aktie|\bdax\b|s&p|nasdaq|\bdow\b|shares|index|indizes|earnings|quartal|börse|wall street|nikkei|ftse|cac 40|hang seng|kospi|sensex|nifty|ipo|börsengang|kurs"),
]
MKT_RX = [(k, re.compile(p, re.I)) for k, p in MARKETS]

NOISE = re.compile(r"WpHG|EQS-|DGAP|Stimmrechtsmitteilung|Directors.? Dealings|Veröffentlichung gemäß|Korrektur einer Veröffentlichung|Erwerb eigener Aktien|Aktienrückkauf.{0,20}Meldung|Sponsored|Anzeige|Horoskop", re.I)
TAG_RX = re.compile(r"<[^>]+>")

def clean(s, limit=None):
    s = html.unescape(TAG_RX.sub(" ", html.unescape(s or "")))
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + " …"
    return s

def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except Exception:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)

def local(tag):
    return tag.rsplit("}", 1)[-1]

def child_text(el, *names):
    for c in el:
        if local(c.tag) in names and (c.text or "").strip():
            return c.text
    return ""

def parse_feed(data, default_source):
    out = []
    root = ET.fromstring(data)
    items = [e for e in root.iter() if local(e.tag) in ("item", "entry")]
    for it in items:
        title = clean(child_text(it, "title"))
        link = ""
        for c in it:
            if local(c.tag) == "link":
                link = (c.get("href") or c.text or "").strip()
                if link:
                    break
        date = parse_date(child_text(it, "pubDate", "published", "updated", "date"))
        desc = clean(child_text(it, "description", "summary", "encoded"), 240)
        src = clean(child_text(it, "source")) or default_source
        if default_source == "Google News" and " - " in title:
            title, src2 = title.rsplit(" - ", 1)
            src = src2.strip() or src
            desc = ""  # Google-Beschreibungen sind nur Linklisten
        if not title or not link:
            continue
        out.append({"t": title, "u": link, "s": src, "d": date, "x": desc})
    return out

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def classify(item):
    text = item["t"] + " " + item["x"]
    loc = None
    for field in (item["t"], item["x"]):  # erst Titel, dann Beschreibung
        for k, n, la, lo, iso, rx in LOC_RX:
            if field and rx.search(field):
                loc = k
                break
        if loc:
            break
    if SEV_CRIT.search(item["t"]):
        sev = "kritisch"
    elif SEV_WATCH.search(item["t"]):
        sev = "beobachten"
    else:
        sev = "ruhig"
    mk = [k for k, rx in MKT_RX if rx.search(text)]
    return loc, sev, mk

def norm(t):
    t = re.sub(r"\s+[-–|]\s+[^-–|]{2,40}$", "", t)
    return re.sub(r"[^a-z0-9äöüß]+", " ", t.lower()).strip()[:90]

def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=MAX_AGE_H)
    raw, ok, failed = [], 0, []
    for name, url in FEEDS:
        try:
            raw.extend(parse_feed(fetch(url), name))
            ok += 1
        except Exception as e:
            failed.append(f"{name}: {type(e).__name__}")
    seen, items = set(), []
    for it in sorted(raw, key=lambda i: i["d"] or now - timedelta(days=99), reverse=True):
        if it["d"] and it["d"] < cutoff:
            continue
        key = norm(it["t"])
        if not key or key in seen:
            continue
        seen.add(key)
        if NOISE.search(it["t"]):
            continue  # Pflichtmitteilungen, Werbung
        loc, sev, mk = classify(it)
        if not mk and sev == "ruhig":
            continue  # nicht marktrelevant
        items.append({
            "t": it["t"], "u": it["u"], "s": it["s"], "x": it["x"],
            "p": (it["d"] or now).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sev": sev, "m": mk or ["aktien"], "loc": loc,
        })
        if len(items) >= MAX_ITEMS:
            break
    if not items and ok == 0:
        print("Keine Feeds erreichbar, news.json bleibt unverändert.", failed, file=sys.stderr)
        sys.exit(0)
    locs = {k: {"name": n, "lat": la, "lon": lo, "iso": iso} for k, n, la, lo, iso, _ in LOC_RX}
    out = {"updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "feeds_ok": ok, "feeds_failed": failed, "locs": locs, "items": items}
    with open("news.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(items)} Schlagzeilen aus {ok}/{len(FEEDS)} Feeds. Fehler: {failed}")

if __name__ == "__main__":
    main()
