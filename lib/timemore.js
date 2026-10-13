// ── Timemore import ───────────────────────────────────────────────────────────
// Everything that knows about Timemore's page layout lives in this file, so a
// redesign on their side only needs fixing here.
//
// Sources (no auth needed):
//   Share page  https://bm.timemore.com/v4/share/<id>            server-rendered HTML
//   Curve       https://bm.timemore.com/api/v3/work/<id>/data     [ms, beverage_g, scale_g] every 100 ms

const { segmentPours, cleanCurve } = require("./segmentPours");

const BASE = "https://bm.timemore.com";
const UNSET = "未选择"; // Timemore's "not selected"

const shareUrl = (id) => `${BASE}/v4/share/${id}`;

// Accepts a bare ID or any URL containing /share/<id> or /work/<id>
function extractWorkId(input) {
  const s = String(input || "").trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(?:share|work)\/(\d+)/);
  return m ? m[1] : null;
}

// ── HTML → ordered text lines ─────────────────────────────────────────────────
function htmlToLines(html) {
  const text = String(html)
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return text.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const num = (s) => {
  const m = String(s ?? "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const isUnset = (s) => !s || s === UNSET || /^-+$/.test(s);
const clean = (s) => (isUnset(s) ? null : s);

// Labels in the "冲煮数据" (brew data) block come AFTER their value: "15.2 g" then "粉重"
const BREW_LABELS = ["时间", "粉重", "注水量", "粉水比", "粉液比", "萃取量"];
// Labels in the "其他数据" (other data) block come BEFORE their value: "磨豆机" then "未选择 | 6.2"
// Pour-over: grinder, smart kettle, dripper, filter. Espresso: machine, basket, WDT tool, distributor, tamper.
const OTHER_LABELS = ["磨豆机", "智能壶", "滤杯", "滤纸", "咖啡机", "粉碗", "布粉针", "布粉器", "压粉锤", "水质", "咖啡粉状态"];

function parseSharePage(html) {
  const lines = htmlToLines(html);
  const warnings = [];
  const at = (label, from = 0) => lines.indexOf(label, from);

  // Date, e.g. "2026-10-13 17:22:59"
  const dateLine = lines.find((l) => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(l));
  const date = dateLine ? dateLine.slice(0, 10) : null;

  // Title + comment: the lines between the date (and its like/comment counters) and "自我评价"
  let title = null, comment = null;
  const dateIdx = dateLine ? lines.indexOf(dateLine) : -1;
  const ratingIdx = at("自我评价");
  if (dateIdx >= 0 && ratingIdx > dateIdx) {
    const between = lines
      .slice(dateIdx + 1, ratingIdx)
      .filter((l) => !/^\d+$/.test(l) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(l)); // counters, split-off time
    title = between[0] || null;
    comment = between.slice(1).join("\n") || null;
  }

  // Self rating — "未选择" when not given
  let rating = null;
  if (ratingIdx >= 0) rating = num(clean(lines[ratingIdx + 1]));

  // Bean block: lines between "咖啡豆" and "海拔"
  const bean = { name: null, origin: null, process: null, roast: null, raw: null };
  const beanIdx = at("咖啡豆");
  const altIdx = lines.findIndex((l, i) => i > beanIdx && l.startsWith("海拔"));
  if (beanIdx >= 0) {
    const block = lines.slice(beanIdx + 1, altIdx > beanIdx ? altIdx : beanIdx + 5).filter((l) => !isUnset(l));
    const roastRe = /light|medium|dark|浅|中|深/i;
    const processRe = /natural|washed|honey|anaerobic|wash|carbonic|infused|ferment|decaf|日晒|水洗|蜜|厌氧|发酵/i;
    bean.name = block[0] || null;
    const rest = block.slice(1);
    bean.roast = rest.find((l) => roastRe.test(l) && l.length < 20) || null;
    bean.process = rest.find((l) => l !== bean.roast && processRe.test(l)) || null;
    bean.origin = rest.find((l) => l !== bean.roast && l !== bean.process) || null;
    bean.raw = block.join(" · ") || null;
  } else {
    warnings.push("Bean block not found on the share page");
  }

  // Brew data block: value then label
  const brewIdx = at("冲煮数据");
  const otherIdx = at("其他数据");
  const brew = {};
  if (brewIdx >= 0) {
    const end = otherIdx > brewIdx ? otherIdx : lines.length;
    let chunk = [];
    for (let i = brewIdx + 1; i < end; i++) {
      if (BREW_LABELS.includes(lines[i])) {
        brew[lines[i]] = chunk.join(" ");
        chunk = [];
      } else {
        chunk.push(lines[i]);
      }
    }
  } else {
    warnings.push("Brew data block (冲煮数据) not found on the share page");
  }

  // Other data block: label then value ("name | setting")
  const other = {};
  if (otherIdx >= 0) {
    let current = null, chunk = [];
    const flush = () => { if (current) other[current] = chunk.join(" "); };
    for (let i = otherIdx + 1; i < lines.length; i++) {
      if (OTHER_LABELS.includes(lines[i])) { flush(); current = lines[i]; chunk = []; }
      else if (current) chunk.push(lines[i]);
    }
    flush();
  }
  const splitPipe = (s) => {
    if (!s) return { name: null, value: null };
    const [a, ...b] = s.split("|").map((x) => x.trim());
    return b.length ? { name: clean(a), value: clean(b.join("|")) } : { name: null, value: clean(a) };
  };

  const toSec = (s) => {
    const m = String(s || "").match(/(\d+):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : num(s);
  };
  const ratioOf = (s) => {
    const m = String(s || "").match(/1\s*:\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };

  const grinder = splitPipe(other["磨豆机"]);
  const kettle = splitPipe(other["智能壶"]);
  const dripper = splitPipe(other["滤杯"]);
  // Espresso machine reads "name | 93° | pressure"
  const machineParts = (other["咖啡机"] || "").split("|").map((x) => clean(x.trim()));
  const isEspresso = "咖啡机" in other || ("萃取量" in brew && !("注水量" in brew));

  return {
    date,
    title,
    comment,
    rating,
    bean,
    dose: num(brew["粉重"]),
    water: num(brew["注水量"]),
    yield: num(brew["萃取量"]),
    ratio: ratioOf(brew["粉水比"]),
    brewRatio: ratioOf(brew["粉液比"]),
    totalTime: toSec(brew["时间"]),
    grind: num(grinder.value),
    grinderName: grinder.name,
    method: isEspresso ? "Espresso" : "Pour Over",
    temp: isEspresso ? num(machineParts[1]) : num(kettle.value),
    kettleName: kettle.name,
    machineName: machineParts[0] || null,
    pressure: num(machineParts[2]),
    basketName: clean(other["粉碗"]),
    dripperName: dripper.name,
    filter: clean(other["滤纸"]),
    waterQuality: clean(other["水质"]),
    warnings,
  };
}

// ── Network ───────────────────────────────────────────────────────────────────
const UA = { "User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" };

async function fetchShare(id) {
  const r = await fetch(shareUrl(id), { headers: UA });
  if (!r.ok) throw new Error(`Share page returned ${r.status}`);
  return parseSharePage(await r.text());
}

async function fetchCurve(id) {
  const r = await fetch(`${BASE}/api/v3/work/${id}/data`, { headers: { ...UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Curve API returned ${r.status}`);
  const raw = await r.json();
  if (raw.status !== "success") throw new Error("Curve API did not return success");
  const triples = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data;
  // Timemore calls espresso "italian"; pour-over is "hand"
  return raw.brew_type === "italian" ? summariseEspresso(triples) : summariseCurve(triples);
}

// Espresso: the curve is the weight in the cup (column 1). There are no pours,
// so we describe the flow instead: average, peak, and a 10-second profile.
function summariseEspresso(triples) {
  const raw = triples.map((t) => ({ ms: Number(t[0]), w: parseFloat(t[1]) }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.w));
  if (!raw.length) return { method: "Espresso", rawPoints: [], pours: [] };
  const clean = cleanCurve(raw); // removes cup bumps/dips, as for pour-over
  const n = clean.length;
  const finalW = clean[n - 1].w;
  const r1 = (x) => Math.round(x * 10) / 10;

  // First drip: first point with ≥ 1 g; flow end: when the cup reaches its final weight
  const firstIdx = Math.max(0, clean.findIndex((p) => p.w >= 1));
  let endIdx = n - 1;
  while (endIdx > firstIdx && clean[endIdx - 1].w >= finalW - 0.3) endIdx--;
  const firstDrip = clean[firstIdx].ms / 1000;
  const flowEnd = clean[endIdx].ms / 1000;
  const flowSecs = flowEnd - firstDrip;

  // Peak flow over a 2 s window
  let peak = 0;
  for (let i = 0, j = 0; i < n; i++) {
    while (j < n && clean[j].ms - clean[i].ms < 2000) j++;
    if (j >= n) break;
    peak = Math.max(peak, (clean[j].w - clean[i].w) / ((clean[j].ms - clean[i].ms) / 1000));
  }

  // 10-second flow profile up to the end of flow
  const at = (sec) => {
    const k = clean.findIndex((p) => p.ms >= sec * 1000);
    return k < 0 ? finalW : clean[k].w;
  };
  const steps = [];
  for (let t = 0; t < flowEnd; t += 10) {
    const t2 = Math.min(t + 10, flowEnd);
    if (t2 - t < 2) break;
    steps.push(`${t}–${Math.round(t2)}s ${r1((at(t2) - at(t)) / (t2 - t))}`);
  }

  return {
    method: "Espresso",
    pours: [],
    totalTime: r1(clean[n - 1].ms / 1000),
    yield: r1(finalW),
    firstDrip: r1(firstDrip),
    flowEnd: r1(flowEnd),
    avgFlow: flowSecs > 0 ? r1(finalW / flowSecs) : null,
    peakFlow: r1(peak),
    brewLog: `Flow (g/s): ${steps.join(" · ")}\nFirst drip @${r1(firstDrip)}s · flow stopped @${r1(flowEnd)}s · peak ${r1(peak)} g/s`,
    rawPoints: raw.map((p) => [p.ms, p.w]),
  };
}

// Turns the raw curve into pours plus the numbers stored in Notion
function summariseCurve(triples) {
  const seg = segmentPours(triples);
  const pours = seg.pours;
  const pourSecs = pours.reduce((a, p) => a + p.durationSec, 0);
  const pourGrams = pours.reduce((a, p) => a + p.volume, 0);
  const finalYield = triples.length ? parseFloat(triples[triples.length - 1][1]) || null : null;
  const bloom = pours[0] || null;
  // Bloom time = from start of the first pour to start of the second
  const bloomTime = bloom ? Math.round(((pours[1]?.startSec ?? seg.totalTime) - bloom.startSec) * 10) / 10 : null;

  return {
    pours,
    method: "Pour Over",
    totalTime: seg.totalTime,
    totalWater: seg.totalWater,
    yield: finalYield,
    bloomGrams: bloom ? bloom.volume : null,
    bloomTime,
    pourCount: pours.length,
    avgFlow: pourSecs > 0 ? Math.round((pourGrams / pourSecs) * 10) / 10 : null,
    brewLog: formatBrewLog(pours),
    rawPoints: triples.map((t) => [Number(t[0]), parseFloat(t[2])]),
  };
}

function formatBrewLog(pours) {
  return pours
    .map((p) => `${p.label} | @${p.startSec}s → ${p.endSec}s | ${p.avgSpeedGps} g/s | ${p.volume} g`)
    .join("\n");
}

// Share page + curve, merged. Curve numbers win for water/time; share page for the rest.
async function importWork(id) {
  const [shareRes, curveRes] = await Promise.allSettled([fetchShare(id), fetchCurve(id)]);
  const warnings = [];
  const share = shareRes.status === "fulfilled" ? shareRes.value : null;
  const curve = curveRes.status === "fulfilled" ? curveRes.value : null;
  if (!share) warnings.push(`Share page: ${shareRes.reason?.message}`);
  if (!curve) warnings.push(`Curve: ${curveRes.reason?.message}`);
  if (share?.warnings) warnings.push(...share.warnings);
  if (!share && !curve) throw new Error(warnings.join("; "));

  const method = curve?.method || share?.method || "Pour Over";
  const espresso = method === "Espresso";
  return {
    workId: id,
    method,
    link: shareUrl(id),
    date: share?.date || null,
    title: share?.title || null,
    comment: share?.comment || null,
    rating: share?.rating ?? null,
    timemoreBean: share?.bean || null,
    dose: share?.dose ?? null,
    water: espresso ? null : curve?.totalWater ?? share?.water ?? null,
    yield: share?.yield ?? curve?.yield ?? null,
    totalTime: share?.totalTime ?? curve?.totalTime ?? null,
    grind: share?.grind ?? null,
    temp: share?.temp ?? null,
    timemoreEquipment: share
      ? { grinder: share.grinderName, kettle: share.kettleName, dripper: share.dripperName, machine: share.machineName, basket: share.basketName }
      : null,
    bloomGrams: curve?.bloomGrams ?? null,
    bloomTime: curve?.bloomTime ?? null,
    pourCount: curve?.pourCount ?? null,
    avgFlow: curve?.avgFlow ?? null,
    peakFlow: curve?.peakFlow ?? null,
    firstDrip: curve?.firstDrip ?? null,
    flowEnd: curve?.flowEnd ?? null,
    brewLog: curve?.brewLog || "",
    pours: curve?.pours || [],
    rawPoints: curve?.rawPoints || [],
    warnings,
  };
}

module.exports = { extractWorkId, parseSharePage, summariseCurve, summariseEspresso, formatBrewLog, importWork, shareUrl, htmlToLines };
