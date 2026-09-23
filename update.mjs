// Fetches the official USD/MDL rate from the National Bank of Moldova (bnm.md XML)
// and writes rates.json + rates.js. Bumps package.json version when data changed.
import fs from "node:fs";

const START = "2026-01-01";
const FILE = "rates.json";
const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8") || "{}") : {};
const rates = { ...(old.rates || {}) };

const iso = (d) => d.toISOString().slice(0, 10);
const toRo = (s) => s.split("-").reverse().join(".");
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const today = iso(new Date());
const from = Object.keys(rates).length ? addDays(today, -10) : START; // full backfill on first run
const to = addDays(today, 1); // tomorrow's rate is usually published the day before

let changed = false, found = 0, failed = 0;
for (let d = from; d <= to; d = addDays(d, 1)) {
  const url = `https://www.bnm.md/en/official_exchange_rates?get_xml=1&date=${toRo(d)}`;
  let xml = null;
  for (let attempt = 0; attempt < 3 && !xml; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "nbm-usd-mdl-rates (GitHub Actions)" } });
      if (r.ok) xml = await r.text();
    } catch (e) { /* retry */ }
    if (!xml) await sleep(2000);
  }
  if (!xml) { failed++; console.log("no response:", d); continue; }
  const tableDate = (xml.match(/<ValCurs[^>]*Date="([\d.]+)"/) || [])[1];
  if (tableDate !== toRo(d)) continue; // weekend / not published yet: BNM returned another day's table
  const m = xml.match(/<CharCode>USD<\/CharCode>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d.,]+)<\/Value>/);
  if (!m) { console.log("USD not found:", d); continue; }
  const v = Number((Number(m[2].replace(",", ".")) / Number(m[1])).toFixed(4));
  if (!(v > 0)) continue;
  found++;
  if (rates[d] !== v) { rates[d] = v; changed = true; console.log("rate", d, v); }
  await sleep(150);
}

const keys = Object.keys(rates).sort();
if (!keys.length) { console.error("No rates at all — BNM format changed or site unreachable."); process.exit(1); }
if (failed > 0 && found === 0) { console.error("BNM did not respond."); process.exit(1); }

const out = { source: "National Bank of Moldova — official USD/MDL rate (bnm.md XML)", to: keys[keys.length - 1], rates: Object.fromEntries(keys.map((k) => [k, rates[k]])) };
fs.writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
fs.writeFileSync("rates.js", "window.NBM_USD_MDL=" + JSON.stringify(out) + ";\n");

if (changed) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const now = new Date();
  pkg.version = `1.${iso(now).replace(/-/g, "")}.${now.getUTCHours() * 100 + now.getUTCMinutes()}`;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log("new version", pkg.version);
}
console.log(`done: ${keys.length} dates, last ${out.to}, changed=${changed}`);
