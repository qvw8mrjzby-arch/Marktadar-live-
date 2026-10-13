#!/usr/bin/env python3
"""Marktdaten, Fear & Greed und Push-Alarme fuer das Marktradar.

Laeuft nach scripts/news.py in GitHub Actions. Nur Standardbibliothek.
- schreibt market.json (Kurse, Fear & Greed, Alarmstatus) fuer die Seite
- schickt Push-Nachrichten ueber ntfy.sh, wenn NTFY_TOPIC gesetzt ist:
  * neue rote Schlagzeilen (aus news.json)
  * Kursalarme aus alerts.json (einmal beim Ueberschreiten, neu scharf nach Ruecklauf)
- merkt sich den Zustand in alerts_state.json
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
PAGE = "https://qvw8mrjzby-arch.github.io/Marktadar-live-/"
NOW = datetime.now(timezone.utc)

# Symbol -> Anzeige und Quelle
SYMBOLS = {
    "BTC":   {"name": "Bitcoin",   "unit": "$", "cg": "bitcoin"},
    "ETH":   {"name": "Ethereum",  "unit": "$", "cg": "ethereum"},
    "SOL":   {"name": "Solana",    "unit": "$", "cg": "solana"},
    "XRP":   {"name": "XRP",       "unit": "$", "cg": "ripple"},
    "GOLD":  {"name": "Gold",      "unit": "$", "yf": "GC=F"},
    "BRENT": {"name": "Brent-Öl",  "unit": "$", "yf": "BZ=F"},
    "SP500": {"name": "S&P 500",   "unit": "",  "yf": "^GSPC"},
    "NASDAQ":{"name": "Nasdaq",    "unit": "",  "yf": "^IXIC"},
    "DAX":   {"name": "DAX",       "unit": "",  "yf": "^GDAXI"},
    "EURUSD":{"name": "EUR/USD",   "unit": "",  "yf": "EURUSD=X"},
    "US10Y": {"name": "US-Rendite 10J", "unit": "%", "yf": "^TNX"},
}


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def fmt(v, unit=""):
    if v is None:
        return "–"
    dec = 2 if unit == "%" else (4 if abs(v) < 10 else (2 if abs(v) < 1000 else 0))
    s = f"{v:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} {unit}".strip() if unit and unit != "%" else (s + " %" if unit == "%" else s)


# ---------- Kurse ----------
def fetch_prices():
    prices, errors = {}, []
    ids = ",".join(v["cg"] for v in SYMBOLS.values() if "cg" in v)
    try:
        d = get_json(f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd&include_24hr_change=true")
        for k, v in SYMBOLS.items():
            if "cg" in v and v["cg"] in d:
                prices[k] = {"price": d[v["cg"]].get("usd"), "chg": d[v["cg"]].get("usd_24h_change")}
    except Exception as e:
        errors.append(f"CoinGecko: {type(e).__name__}")
    for k, v in SYMBOLS.items():
        if "yf" not in v:
            continue
        try:
            d = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(v['yf'])}?range=5d&interval=1d")
            meta = d["chart"]["result"][0]["meta"]
            price = meta.get("regularMarketPrice")
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            chg = (price / prev - 1) * 100 if price and prev else None
            prices[k] = {"price": price, "chg": chg}
        except Exception as e:
            errors.append(f"{v['name']}: {type(e).__name__}")
    return prices, errors


# ---------- Fear & Greed ----------
def label_de(v):
    if v is None:
        return ""
    if v < 25: return "Extreme Angst"
    if v < 45: return "Angst"
    if v <= 55: return "Neutral"
    if v <= 75: return "Gier"
    return "Extreme Gier"


def fetch_fng():
    out = {}
    try:
        d = get_json("https://api.alternative.me/fng/?limit=30")
        hist = [int(x["value"]) for x in d["data"]][::-1]
        out["crypto"] = {"value": hist[-1], "label": label_de(hist[-1]), "history": hist, "source": "alternative.me"}
    except Exception as e:
        out["crypto_error"] = type(e).__name__
    try:
        d = get_json("https://production.dataviz.cnn.io/index/fearandgreed/graphdata")
        fg = d["fear_and_greed"]
        v = round(float(fg["score"]))
        hist = [round(float(p["y"])) for p in d.get("fear_and_greed_historical", {}).get("data", [])][-30:]
        out["stocks"] = {"value": v, "label": label_de(v), "history": hist or [v], "source": "CNN"}
    except Exception as e:
        out["stocks_error"] = type(e).__name__
    return out


# ---------- Push ----------
def is_quiet():
    # 23–7 Uhr deutscher Zeit: leise zustellen (UTC+1/+2 grob ueber Monat)
    offset = 2 if 3 < NOW.month < 11 else 1
    h = (NOW + timedelta(hours=offset)).hour
    return h >= 23 or h < 7


def push(title, message, priority=4, tags=None, click=PAGE):
    if not TOPIC:
        print("Kein NTFY_TOPIC gesetzt, Push übersprungen:", title)
        return False
    if is_quiet():
        priority = min(priority, 2)
    body = json.dumps({"topic": TOPIC, "title": title, "message": message, "priority": priority,
                       "tags": tags or [], "click": click}).encode("utf-8")
    req = urllib.request.Request("https://ntfy.sh/", data=body, headers={"Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print("Push fehlgeschlagen:", e, file=sys.stderr)
        return False


def norm(t):
    t = re.sub(r"\s+[-–|]\s+[^-–|]{2,40}$", "", t or "")
    return re.sub(r"[^a-z0-9äöüß]+", " ", t.lower()).strip()[:90]


def main():
    state = load("alerts_state.json", {})
    first_run = not state
    rules = load("alerts.json", {"kurse": [], "news": {}})
    news = load("news.json", {"items": []})

    prices, price_errors = fetch_prices()
    fng = fetch_fng()

    # --- Kursalarme ---
    armed = state.get("armed", {})
    alert_status = []
    for r in rules.get("kurse", []):
        sym = r.get("symbol")
        if sym not in SYMBOLS:
            continue
        rid = f"{sym}:{'below' if 'below' in r else 'above'}:{r.get('below', r.get('above'))}"
        p = (prices.get(sym) or {}).get("price")
        level = r.get("below", r.get("above"))
        below = "below" in r
        hit = p is not None and ((p < level) if below else (p > level))
        rearm = p is not None and ((p > level * 1.01) if below else (p < level * 0.99))
        was_armed = armed.get(rid, True)
        info = SYMBOLS[sym]
        if hit and was_armed:
            if not first_run:
                word = "unter" if below else "über"
                push(f"{info['name']} {word} {fmt(level, info['unit'])}",
                     f"Aktuell {fmt(p, info['unit'])}. Dein Kursalarm im Marktradar hat ausgelöst.",
                     priority=4, tags=["chart_with_downwards_trend" if below else "chart_with_upwards_trend"])
            armed[rid] = False
        elif rearm:
            armed[rid] = True
        alert_status.append({"symbol": sym, "name": info["name"], "dir": "below" if below else "above",
                             "level": level, "price": p, "unit": info["unit"],
                             "triggered": not armed.get(rid, True)})
    state["armed"] = armed

    # --- Nachrichtenalarme ---
    nrules = rules.get("news", {})
    seen = set(state.get("seen_news", []))
    sent = 0
    fresh = []
    cutoff = NOW - timedelta(hours=2)
    for it in news.get("items", []):
        key = norm(it.get("t"))
        if not key or key in seen:
            continue
        seen.add(key)
        if it.get("sev") != "kritisch":
            continue
        try:
            pub = datetime.fromisoformat(it["p"].replace("Z", "+00:00"))
        except Exception:
            pub = NOW
        if pub < cutoff:
            continue
        fresh.append(it)
    if nrules.get("rot", True) and fresh and not first_run:
        locs = news.get("locs", {})
        for it in fresh[: nrules.get("max_pro_lauf", 3)]:
            where = locs.get(it.get("loc") or "", {}).get("name")
            push(("Rote Meldung" + (f": {where}" if where else "")), f"{it['t']} ({it['s']})",
                 priority=4, tags=["rotating_light"], click=it.get("u") or PAGE)
            sent += 1
        rest = len(fresh) - sent
        if rest > 0:
            push("Marktradar", f"{rest} weitere rote Meldungen in der letzten Stunde.", priority=3, tags=["globe_with_meridians"])
    state["seen_news"] = list(seen)[-600:]

    # --- Testnachricht nach dem Einrichten ---
    if TOPIC and not state.get("welcome_sent"):
        if push("Marktradar ist verbunden", "Ab jetzt bekommst du hier rote Meldungen und deine Kursalarme.", priority=3, tags=["white_check_mark"]):
            state["welcome_sent"] = True

    save("alerts_state.json", state)
    save("market.json", {
        "updated": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prices": prices, "price_errors": price_errors,
        "fng": fng, "alerts": alert_status,
        "push_active": bool(TOPIC),
    })
    print(f"Kurse: {len(prices)} · Fehler: {price_errors} · F&G: {list(k for k in fng if not k.endswith('_error'))} · "
          f"neue rote Meldungen: {len(fresh)} · Pushes: {sent} · Erstlauf: {first_run}")


if __name__ == "__main__":
    main()
