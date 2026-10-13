// ── Timemore import ───────────────────────────────────────────────────────────
// Everything that knows about Timemore's page layout lives in this file, so a
// redesign on their side only needs fixing here.
//
// Sources (no auth needed):
//   Share page  https://bm.timemore.com/v4/share/<id>            server-rendered HTML
//   Curve       https://bm.timemore.com/api/v3/work/<id>/data     [ms, beverage_g, scale_g] every 100 ms

const { segmentPours } = require("./segmentPours");

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
const OTHER_LABELS = ["磨豆机", "智能壶", "滤杯", "滤纸", "水质", "咖啡粉状态"];

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
    temp: num(kettle.value),
    kettleName: kettle.name,
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
  return summariseCurve(triples);
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

  return {
    workId: id,
    link: shareUrl(id),
    date: share?.date || null,
    title: share?.title || null,
    comment: share?.comment || null,
    rating: share?.rating ?? null,
    timemoreBean: share?.bean || null,
    dose: share?.dose ?? null,
    water: curve?.totalWater ?? share?.water ?? null,
    yield: share?.yield ?? curve?.yield ?? null,
    totalTime: share?.totalTime ?? curve?.totalTime ?? null,
    grind: share?.grind ?? null,
    temp: share?.temp ?? null,
    timemoreEquipment: share
      ? { grinder: share.grinderName, kettle: share.kettleName, dripper: share.dripperName }
      : null,
    bloomGrams: curve?.bloomGrams ?? null,
    bloomTime: curve?.bloomTime ?? null,
    pourCount: curve?.pourCount ?? null,
    avgFlow: curve?.avgFlow ?? null,
    brewLog: curve?.brewLog || "",
    pours: curve?.pours || [],
    rawPoints: curve?.rawPoints || [],
    warnings,
  };
}

module.exports = { extractWorkId, parseSharePage, summariseCurve, formatBrewLog, importWork, shareUrl, htmlToLines };
