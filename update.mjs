// Official USD/MDL rate of the National Bank of Moldova.
// Primary source: bnm.md XML. Fallback (when bnm.md does not answer GitHub's servers):
// AllRates-Today mirror of the same NBM data (checked: 258 dates, 0 differences).
// Writes rates.json + rates.js and bumps package.json version when data changed.
import fs from "node:fs";

const START = "2026-01-01";
const FILE = "rates.json";
const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8") || "{}") : {};
const rates = { ...(old.rates || {}) };

const iso = (d) => d.toISOString().slice(0, 10);
const toRo = (s) => s.split("-").reverse().join(".");
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (nbm-usd-mdl-rates; GitHub Actions)" } });
    return r.ok ? await r.text() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

const today = iso(new Date());
const from = Object.keys(rates).length ? addDays(today, -10) : START;
const to = addDays(today, 3);
let changed = false, bnmOk = 0, bnmFail = 0;
const set = (d, v, src) => { v = Number(Number(v).toFixed(4)); if (!(v > 0)) return; if (rates[d] !== v) { rates[d] = v; changed = true; console.log(src, d, v); } };

// 1) bnm.md
for (let d = from; d <= to; d = addDays(d, 1)) {
  let xml = await get(`https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${toRo(d)}`);
  if (!xml) { await sleep(1500); xml = await get(`https://www.bnm.md/ro/official_exchange_rates?get_xml=1&date=${toRo(d)}`); }
  if (!xml) { bnmFail++; console.log("bnm.md no response:", d); if (bnmOk === 0 && bnmFail >= 3) { console.log("bnm.md unreachable, switching to fallback"); break; } continue; }
  bnmOk++;
  const tableDate = (xml.match(/<ValCurs[^>]*Date="([\d.]+)"/) || [])[1];
  if (tableDate !== toRo(d)) continue;
  const m = xml.match(/<CharCode>USD<\/CharCode>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d.,]+)<\/Value>/);
  if (m) set(d, Number(m[2].replace(",", ".")) / Number(m[1]), "bnm");
  await sleep(200);
}

// 2) fallback mirror (only fills dates bnm.md did not give us)
let mirrorOk = false;
if (bnmFail > 0) {
  for (const year of [...new Set([from.slice(0, 4), to.slice(0, 4)])]) {
    const csv = await get(`https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/nbm/history/${year}.csv`);
    if (!csv) { console.log("mirror no response for", year); continue; }
    mirrorOk = true;
    for (const line of csv.split("\n")) {
      const [d, base, quote, , value] = line.trim().split(",");
      if (base === "USD" && quote === "MDL" && d >= from && rates[d] == null) set(d, value, "mirror");
    }
  }
}

const keys = Object.keys(rates).sort();
if (!keys.length) { console.error("No rates at all."); process.exit(1); }
if (bnmOk === 0 && !mirrorOk) { console.error("Neither bnm.md nor the mirror responded."); process.exit(1); }

const out = { source: "National Bank of Moldova — official USD/MDL rate", to: keys[keys.length - 1], rates: Object.fromEntries(keys.map((k) => [k, rates[k]])) };
fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
fs.writeFileSync("rates.js", "window.NBM_USD_MDL=" + JSON.stringify(out) + ";\n");
if (changed) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const now = new Date();
  pkg.version = `1.${iso(now).replace(/-/g, "")}.${now.getUTCHours() * 100 + now.getUTCMinutes()}`;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log("new version", pkg.version);
}
console.log(`done: ${keys.length} dates, last ${out.to}, changed=${changed}, bnm ok/fail=${bnmOk}/${bnmFail}, mirror=${mirrorOk}`);
