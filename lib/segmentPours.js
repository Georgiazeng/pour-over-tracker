// ── Pour segmentation ─────────────────────────────────────────────────────────
// Input: Timemore curve triples [[time_ms, beverage_weight, scale_weight], ...]
//   Column 1 is the beverage (yield) weight, which stays 0 until the brew ends.
//   Column 2 is the cumulative water on the scale — pours are split from this.
//
// The physical rule everything rests on: during a brew the water on the scale
// never goes DOWN (apart from tiny evaporation drift). So
//   1. a rise that falls back within BUMP_MAX_MS is a bump (leaning on the
//      dripper, moving the kettle) and is capped to the level it returns to;
//   2. a running maximum then removes every dip;
//   3. pours are stretches where this cleaned curve is rising, with short
//      pauses (< MERGE_GAP_MS) kept inside one pour;
//   4. "pours" that add less than MIN_POUR_G are noise and are dropped.
//
// Real bumps this handles (see test/timemore.test.js):
//   258231 @79 s  180 → 338 → 180 g
//   253216 @88 s  dip to 168 g, then up to 354 g, back to 186 g
//   253216 @128 s up to 562 g for 2.2 s
//   253317 @128 s up to 258 g for 0.7 s

const BUMP_MAX_MS = 3000;   // longest bump we expect to see
const BUMP_TOLERANCE = 0.5; // g above the return level before a point counts as bump
const RISE_WINDOW = 5;      // samples (0.5 s at 100 ms) used to judge "rising"
const RISE_MIN_G = 0.5;     // g gained over RISE_WINDOW to count as pouring
const MERGE_GAP_MS = 2000;  // pauses shorter than this stay within one pour
const EDGE_TOLERANCE = 0.3; // g: how close to a plateau counts as "on" it
const MIN_POUR_G = 2;       // smaller "pours" are dropped as noise

const LABELS = ["Bloom", "2nd Pour", "3rd Pour", "4th Pour", "5th Pour", "6th Pour"];
const r1 = (n) => Math.round(n * 10) / 10;

function cleanCurve(points) {
  const n = points.length;

  // 1. Cap bumps: each point may not exceed the lowest weight seen over the
  //    next BUMP_MAX_MS (+ tolerance). While pouring the future is higher,
  //    so real pours are untouched. A sliding-window minimum keeps this O(n).
  const capped = new Array(n);
  const deque = []; // indices with increasing weights
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < n && points[j].ms - points[i].ms <= BUMP_MAX_MS) {
      while (deque.length && points[deque[deque.length - 1]].w >= points[j].w) deque.pop();
      deque.push(j);
      j++;
    }
    while (deque[0] < i) deque.shift();
    const futureMin = points[deque[0]].w;
    capped[i] = points[i].w > futureMin + BUMP_TOLERANCE ? futureMin : points[i].w;
  }

  // 2. Running maximum removes dips (and slow evaporation drift).
  const clean = new Array(n);
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    max = Math.max(max, capped[i]);
    clean[i] = { ms: points[i].ms, w: max };
  }
  return clean;
}

function segmentPours(triples) {
  const points = (triples || [])
    .map((t) => ({ ms: Number(t[0]), w: parseFloat(t[2]) }))
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.w));
  if (points.length === 0) return { pours: [], totalWater: 0, totalTime: 0 };

  const clean = cleanCurve(points);
  const n = clean.length;

  // 3. Rising runs
  const runs = [];
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    const ahead = clean[Math.min(i + RISE_WINDOW, n - 1)].w;
    const rising = ahead - clean[i].w > RISE_MIN_G;
    if (rising && runStart < 0) runStart = i;
    if (!rising && runStart >= 0) { runs.push([runStart, Math.min(i + RISE_WINDOW, n - 1)]); runStart = -1; }
  }
  if (runStart >= 0) runs.push([runStart, n - 1]);

  // Merge runs separated by short pauses
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && clean[run[0]].ms - clean[last[1]].ms < MERGE_GAP_MS) last[1] = Math.max(last[1], run[1]);
    else merged.push([...run]);
  }

  // Tighten each run to where weight actually leaves / reaches its plateaus
  const segments = merged.map(([a, b]) => {
    const base = clean[a].w;
    const top = clean[b].w;
    let start = a;
    while (start < b && clean[start + 1].w <= base + EDGE_TOLERANCE) start++;
    let end = start;
    while (end < b && clean[end].w < top - EDGE_TOLERANCE) end++;
    return { start, end, base, top };
  });

  // 4. Drop noise, then build pours
  const real = segments.filter((s) => s.top - s.base >= MIN_POUR_G);
  const pours = real.map((s, idx) => {
    const startSec = r1(clean[s.start].ms / 1000);
    const endSec = r1(clean[s.end].ms / 1000);
    const durationSec = r1(endSec - startSec);
    const volume = r1(s.top - s.base);
    return {
      label: LABELS[idx] || `Pour ${idx + 1}`,
      startSec,
      endSec,
      durationSec,
      volume,
      cumulativeWater: r1(s.top),
      avgSpeedGps: durationSec > 0 ? r1(volume / durationSec) : 0,
    };
  });

  return {
    pours,
    totalWater: r1(clean[n - 1].w),
    totalTime: r1(clean[n - 1].ms / 1000),
  };
}

module.exports = { segmentPours, cleanCurve };
