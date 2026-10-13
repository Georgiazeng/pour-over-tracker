// Run with: node test/timemore.test.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { parseSharePage, summariseCurve, extractWorkId } = require("../lib/timemore");

const lines = fs.readFileSync(path.join(__dirname, "fixtures/share-258231.txt"), "utf8").trim().split("\n");

// Variant A: one element per line
const htmlA = `<html><head><script>var x="冲煮数据";</script></head><body>${lines.map(l => `<div>${l}</div>`).join("")}</body></html>`;
// Variant B: values split across spans ("15.2" + "g", "未选择" + "|" + "6.2")
const splitValue = (l) => {
  if (l.includes("|")) return l.split("|").flatMap((x, i) => (i ? ["|", x.trim()] : [x.trim()]));
  const m = l.match(/^([\d.]+) ?(g)$/);                       // "15.2 g" → "15.2", "g"
  if (m) return [m[1], m[2]];
  const d = l.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/); // date and time in separate tags
  if (d) return [d[1], d[2]];
  return [l];
};
const htmlB = "<body>" + lines.map(l => `<p>${splitValue(l).map(s => `<span>${s}</span>`).join("")}</p>`).join("") + "</body>";

for (const [name, html] of [["one-per-line", htmlA], ["split-spans", htmlB]]) {
  const s = parseSharePage(html);
  assert.strictEqual(s.date, "2026-10-13", name);
  assert.strictEqual(s.title, "Buena vista", name);
  assert.ok(s.comment.includes("第一次"), name);
  assert.strictEqual(s.rating, null, name);
  assert.strictEqual(s.dose, 15.2, name);
  assert.strictEqual(s.water, 241.7, name);
  assert.strictEqual(s.yield, 206.5, name);
  assert.strictEqual(s.ratio, 15.9, name);
  assert.strictEqual(s.brewRatio, 13.6, name);
  assert.strictEqual(s.totalTime, 145, name);
  assert.strictEqual(s.grind, 6.2, name);
  assert.strictEqual(s.temp, 92, name);
  assert.strictEqual(s.grinderName, null, name);
  assert.strictEqual(s.bean.origin, "Guatemala Buena Vista", name);
  assert.strictEqual(s.bean.process, "natural", name);
  assert.strictEqual(s.bean.roast, "Light", name);
  console.log(`✓ share parser (${name})`);
}

// Synthetic curve: bloom 44 g over 0–10 s, wait, 2nd pour to 150 g (40–60 s), 3rd to 242 g (75–95 s), drain to 145 s
const triples = [];
for (let ms = 0; ms <= 145400; ms += 100) {
  const t = ms / 1000;
  let w;
  if (t <= 10) w = 4.4 * t;
  else if (t < 40) w = 44;
  else if (t <= 60) w = 44 + (t - 40) * 5.3;
  else if (t < 75) w = 150;
  else if (t <= 95) w = 150 + (t - 75) * 4.6;
  else w = 242;
  const bev = t > 144 ? 206.5 : 0;
  triples.push([ms, bev.toFixed(1), (w + (Math.random() - 0.5) * 0.2).toFixed(1)]);
}
const c = summariseCurve(triples);
assert.strictEqual(c.pourCount, 3);
assert.ok(Math.abs(c.bloomGrams - 44) < 1.5, `bloom ${c.bloomGrams}`);
assert.ok(Math.abs(c.bloomTime - 40) < 1.5, `bloom time ${c.bloomTime}`);
assert.strictEqual(c.yield, 206.5);
assert.ok(Math.abs(c.avgFlow - 4.8) < 0.4, `avg flow ${c.avgFlow}`);
console.log("✓ curve summary", { bloom: c.bloomGrams, bloomTime: c.bloomTime, pours: c.pourCount, avgFlow: c.avgFlow });
console.log(c.brewLog);

assert.strictEqual(extractWorkId("https://bm.timemore.com/v4/share/258231"), "258231");
assert.strictEqual(extractWorkId("258231"), "258231");
assert.strictEqual(extractWorkId("https://example.com/x"), null);
console.log("✓ work ID extraction");

// ── Regression: real bump from brew 258231 (180 → 338 → 180 g in ~1 s) ──────
{
  const spike = { 78600: 181.4, 78700: 191.3, 78800: 193.9, 78900: 196.3, 79000: 195.7, 79100: 200.2,
    79200: 258.8, 79300: 317.7, 79400: 338.6, 79500: 293.9, 79600: 192.9, 79700: 182.6, 79800: 180.2 };
  const t2 = [];
  for (let ms = 0; ms <= 145400; ms += 100) {
    const t = ms / 1000;
    let w;
    if (t <= 8.4) w = (55.6 / 8.4) * t;
    else if (t < 32.4) w = 55.6;
    else if (t <= 48.9) w = 55.6 + (t - 32.4) * (124.8 / 16.5);
    else if (ms in spike) w = spike[ms];
    else if (t < 82.8) w = t < 78.6 ? 180.3 : 180.1;
    else if (t <= 91.1) w = 180.1 + (t - 82.8) * (62 / 8.3);
    else w = 242.1;
    t2.push([ms, t > 144 ? "206.5" : "0.0", w.toFixed(1)]);
  }
  const r = summariseCurve(t2);
  assert.strictEqual(r.pourCount, 3, `pours ${r.pourCount}:\n${r.brewLog}`);
  assert.ok(r.pours.every((p) => p.volume > 0 && p.avgSpeedGps < 15), r.brewLog);
  assert.ok(Math.abs(r.pours[2].startSec - 82.8) < 1, `3rd pour start ${r.pours[2].startSec}`);
  assert.ok(Math.abs(r.pours[2].volume - 62) < 2, `3rd pour volume ${r.pours[2].volume}`);
  console.log("✓ bump at 79 s ignored\n" + r.brewLog);
}

// ── Regression: HTML comment must not leak into the brew comment ──────────────
{
  const html = htmlA.replace("<div>自我评价</div>", "<!-- <div>#未选择</div> --><div>自我评价</div>");
  const s = parseSharePage(html);
  assert.strictEqual(s.comment, "怎么就是冲不出第一次的那个感觉了 好奇怪！！");
  console.log("✓ HTML comments stripped");
}

// ── Real brews 253216 and 253317 (shared 13 Oct 2026) ─────────────────────────
// Key points come from the 500 ms samples; every bump uses the exact 100 ms values.
function curve(keypoints, overlay, endMs) {
  const out = [];
  for (let ms = 0; ms <= endMs; ms += 100) {
    let w;
    if (ms in overlay) w = overlay[ms];
    else {
      let k = 0;
      while (k < keypoints.length - 1 && keypoints[k + 1][0] <= ms) k++;
      const [m0, w0] = keypoints[k], [m1, w1] = keypoints[Math.min(k + 1, keypoints.length - 1)];
      w = m1 > m0 ? w0 + ((w1 - w0) * (ms - m0)) / (m1 - m0) : w0;
    }
    out.push([ms, "0.0", w.toFixed(1)]);
  }
  return out;
}
const series = (startMs, values) => Object.fromEntries(values.map((v, i) => [startMs + i * 100, v]));

{
  const bump1 = series(87500, [185.3, 184.9, 186.3, 186.3, 186.4, 186.6, 186.6, 185.1, 176, 171.4, 168.5, 171.5, 187.3, 218, 303.4, 335.6, 353.7, 232.5, 196.5, 186.8, 186.5, 186.4, 186.5]);
  const bump2 = series(128100, [281, 292.3, 290.7, 283.5, 283.7, 285.2, 292.8, 300.4, 309.7, 347.2, 351.6, 403.9, 426.6, 501.7, 510.2, 553.7, 562.1, 444.3, 474.7, 271.2, 256.1, 251, 251.7, 250.8, 250.2, 249.9, 250.1, 249.9, 250.3, 250.2, 251.2, 251.1, 251, 250.9, 250.7]);
  const blip = { 121000: 251.5 };
  const kp = [[0, 0.9], [7500, 54.8], [37000, 54.7], [52300, 186.9], [87400, 186.7], [93500, 186.6], [100700, 251.1], [162000, 250.6]];
  const r = summariseCurve(curve(kp, { ...bump1, ...bump2, ...blip }, 162000));
  assert.strictEqual(r.pourCount, 3, `253216 pours ${r.pourCount}:\n${r.brewLog}`);
  assert.ok(Math.abs(r.pours[0].volume - 54) < 1.5 && Math.abs(r.pours[1].volume - 132) < 1.5 && Math.abs(r.pours[2].volume - 64.4) < 1.5, r.brewLog);
  assert.ok(Math.abs(r.pours[2].startSec - 93.5) < 0.6, r.brewLog);
  console.log("✓ 253216: two bumps ignored\n" + r.brewLog);
}
{
  const bump = series(127800, [245.2, 257, 257.9, 257.1, 256.3, 245.4, 241.7, 240.8]);
  const kp = [[0, 0.8], [7300, 49.9], [38600, 49.7], [45600, 97], [75200, 96.7], [97300, 241.2], [138500, 240.7]];
  const r = summariseCurve(curve(kp, bump, 138500));
  assert.strictEqual(r.pourCount, 3, `253317 pours ${r.pourCount}:\n${r.brewLog}`);
  assert.ok(Math.abs(r.pours[1].volume - 47.3) < 1.5 && Math.abs(r.pours[2].volume - 144.5) < 1.5, r.brewLog);
  console.log("✓ 253317: blip at 128 s ignored\n" + r.brewLog);
}

// ── Espresso shot 256735 (Timemore brew_type "italian") ──────────────────────
{
  const { summariseEspresso } = require("../lib/timemore");
  const lines = fs.readFileSync(path.join(__dirname, "fixtures/share-256735-espresso.txt"), "utf8").trim().split("\n");
  const s = parseSharePage(`<body>${lines.map((l) => `<div>${l}</div>`).join("")}</body>`);
  assert.strictEqual(s.method, "Espresso");
  assert.strictEqual(s.dose, 18);
  assert.strictEqual(s.yield, 44.6);
  assert.strictEqual(s.brewRatio, 2.5);
  assert.strictEqual(s.water, null);
  assert.strictEqual(s.totalTime, 53);
  assert.strictEqual(s.grind, 25, "grind must not swallow the machine line");
  assert.strictEqual(s.temp, 93);
  assert.strictEqual(s.comment, "过细了");
  console.log("✓ espresso share page");

  // Cup weight once per second from the real shot (column 1), including the cup bump at 49–51 s
  const perSec = [3.1, 4.3, 5.4, 6.4, 7.1, 7.5, 7.8, 8.2, 8.5, 8.9, 9.3, 9.7, 10.2, 10.7, 11.2, 11.7, 12.4, 13, 13.8, 14.5,
    15.4, 16.2, 17, 18, 18.9, 19.9, 20.9, 21.9, 23, 24, 25.1, 26.2, 27.3, 28.4, 29.5, 30.6, 31.8, 32.9, 34, 35.1,
    36.2, 37.3, 38.5, 39.6, 40.6, 41.7, 42.5, 43.1, 43.8, 44.2, 43.4, 43.5, 44.6, 44.6];
  const triples = [];
  for (let ms = 0; ms <= 53700; ms += 100) {
    const k = Math.min(Math.floor(ms / 1000), perSec.length - 2);
    const f = ms / 1000 - k;
    const w = ms >= 50000 && ms < 52000 ? perSec[Math.floor(ms / 1000)] : perSec[k] + (perSec[k + 1] - perSec[k]) * f;
    triples.push([ms, w.toFixed(1), "0.0"]);
  }
  const e = summariseEspresso(triples);
  assert.strictEqual(e.yield, 44.6);
  assert.ok(e.peakFlow >= 1 && e.peakFlow <= 1.3, `peak ${e.peakFlow}`);
  assert.ok(e.avgFlow > 0.8 && e.avgFlow < 0.95, `avg ${e.avgFlow}`);
  assert.ok(e.flowEnd > 50 && e.flowEnd <= 53, `flow end ${e.flowEnd}`);
  console.log("✓ espresso flow", { avg: e.avgFlow, peak: e.peakFlow, end: e.flowEnd });
  console.log(e.brewLog);
}
