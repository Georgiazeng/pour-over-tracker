const express = require("express");
const cors = require("cors");
require("dotenv").config();

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the built React app
app.use(express.static(path.join(__dirname, 'build')));

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

function headers() {
  return { "Authorization": `Bearer ${process.env.NOTION_SECRET}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
}

function textVal(prop) { return prop?.rich_text?.[0]?.plain_text || prop?.title?.[0]?.plain_text || ""; }
function selectVal(prop) { return prop?.select?.name || ""; }
function multiVal(prop) { return (prop?.multi_select||[]).map(s=>s.name).join(", "); }
function numVal(prop) { return prop?.number ?? ""; }
function dateVal(prop) { return prop?.date?.start || ""; }

// ── GET /timemore/:workId ─────────────────────────────────────────────────────
// Proxy to Timemore API to avoid CORS issues from the browser
app.get("/timemore/:workId", async (req, res) => {
  try {
    const { workId } = req.params;
    if (!/^\d+$/.test(workId)) return res.status(400).json({ error: "Invalid work ID" });

    const r = await fetch(`https://bm.timemore.com/api/v3/work/${workId}/data`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
    });

    if (!r.ok) return res.status(r.status).json({ error: `Timemore API returned ${r.status}` });

    const raw = await r.json();
    if (raw.status !== "success") return res.status(400).json({ error: "Timemore API error", detail: raw });

    // Parse the data field — it's a stringified JSON array of [time_ms, flow_rate, cumulative_weight]
    let triples;
    try {
      triples = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data;
    } catch {
      return res.status(400).json({ error: "Could not parse Timemore data field" });
    }

    // Segment pours from the weight trace
    const segments = segmentPours(triples);

    res.json({
      workId,
      brew_type: raw.brew_type,
      weight_unit: raw.weight_unit,
      totalWater: segments.totalWater,
      totalTime: segments.totalTime,
      pours: segments.pours,
      rawPoints: triples.map(t => [Number(t[0]), parseFloat(t[2])]), // [ms, weight]
    });
  } catch (err) {
    console.error("Timemore proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Pour segmentation algorithm ───────────────────────────────────────────────
function segmentPours(triples) {
  // triples: [[time_ms, flow_rate_str, cumulative_weight_str], ...]
  const points = triples.map(t => ({
    ms: Number(t[0]),
    w: parseFloat(t[2])
  }));

  if (points.length === 0) {
    return { pours: [], totalWater: 0, totalTime: 0 };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: Smooth out large transient spikes
  // ────────────────────────────────────────────────────────────────────────────
  const smoothed = points.map((p, i) => {
    if (i === 0 || i >= points.length - 2) return p;

    const prev = points[i - 1].w;
    const next1 = points[i + 1].w;
    const delta = p.w - prev;
    const recovery = next1 - p.w;

    // If there is a large spike that immediately reverses,
    // replace it with an interpolated value.
    if (
      Math.abs(delta) > 5 &&
      Math.sign(recovery) === -Math.sign(delta)
    ) {
      return {
        ms: p.ms,
        w: (prev + next1) / 2
      };
    }

    return p;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2: Parameters
  // ────────────────────────────────────────────────────────────────────────────

  // Look ahead this far to decide whether weight is actually increasing.
  const WINDOW_MS = 500;

  // Minimum cumulative increase over WINDOW_MS to count as active pouring.
  const POUR_THRESHOLD = 0.3;

  // Small scale fluctuations below this are treated as noise.
  const NOISE_TOLERANCE = 0.2;

  // A plateau must last this long before it is considered a real
  // separation between pours.
  const PLATEAU_MIN_DURATION_MS = 2000;

  // Short interruptions during an otherwise continuous pour are tolerated.
  const JITTER_GAP_MS = 1500;

  // ────────────────────────────────────────────────────────────────────────────
  // Step 3: Identify "rising" windows
  // ────────────────────────────────────────────────────────────────────────────
  const rising = smoothed.map((p, i) => {
    const tEnd = p.ms + WINDOW_MS;

    const future = smoothed.filter(
      q => q.ms > p.ms && q.ms <= tEnd
    );

    if (future.length === 0) return false;

    const maxAhead = Math.max(...future.map(q => q.w));

    // Only count meaningful increases.
    // ±0.1–0.2g scale fluctuations do not count as pouring.
    return (maxAhead - p.w) > POUR_THRESHOLD;
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4: Merge short gaps caused by scale noise
  // ────────────────────────────────────────────────────────────────────────────
  const merged = [...rising];

  for (let i = 1; i < smoothed.length - 1; i++) {
    if (!merged[i]) {
      const gapEnd = smoothed.findIndex(
        (p, j) => j > i && merged[j]
      );

      if (gapEnd !== -1) {
        const gapDuration =
          smoothed[gapEnd].ms - smoothed[i - 1].ms;

        if (gapDuration < JITTER_GAP_MS) {
          for (let k = i; k < gapEnd; k++) {
            merged[k] = true;
          }
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 5: Extract pour segments
  // ────────────────────────────────────────────────────────────────────────────
  const segments = [];

  let inPour = false;
  let pourStart = 0;

  for (let i = 0; i < smoothed.length; i++) {
    // Start of a pour
    if (merged[i] && !inPour) {
      inPour = true;
      pourStart = i;
      continue;
    }

    // Potential end of a pour
    if (!merged[i] && inPour) {
      const plateauStart = smoothed[i].ms;

      const nextRising = smoothed.findIndex(
        (p, j) => j > i && merged[j]
      );

      const plateauEnd =
        nextRising !== -1
          ? smoothed[nextRising].ms
          : smoothed[smoothed.length - 1].ms;

      const plateauDuration =
        plateauEnd - plateauStart;

      if (
        plateauDuration >= PLATEAU_MIN_DURATION_MS ||
        nextRising === -1
      ) {
        // ─────────────────────────────────────────────────────────────────────
        // IMPORTANT:
        //
        // Do not automatically use i - 1 as the pour endpoint.
        //
        // The scale can fluctuate:
        //
        //   32.3
        //   32.4
        //   32.5  <- actual end of pouring
        //   32.4
        //   32.5
        //   32.4
        //
        // The final points are scale noise, not additional pouring.
        //
        // Find the highest meaningful weight reached before the plateau.
        // ─────────────────────────────────────────────────────────────────────

        let endIdx = i - 1;
        let maxWeight = smoothed[endIdx].w;

        for (let j = i - 1; j >= pourStart; j--) {
          const weight = smoothed[j].w;

          // If this point is meaningfully higher, use it as the endpoint.
          if (weight > maxWeight + NOISE_TOLERANCE) {
            maxWeight = weight;
            endIdx = j;
          }
        }

        // More robustly, find the LAST point that is within the noise
        // tolerance of the maximum weight reached during the pour.
        //
        // This prevents a tiny 0.1–0.2g fluctuation from moving the endpoint.
        const stableMaxWeight = maxWeight;

        for (let j = i - 1; j >= pourStart; j--) {
          if (
            stableMaxWeight - smoothed[j].w <= NOISE_TOLERANCE
          ) {
            endIdx = j;
          } else {
            break;
          }
        }

        segments.push({
          startIdx: pourStart,
          endIdx
        });

        inPour = false;
      }
    }
  }

  // Close final pour
  if (inPour) {
    let endIdx = smoothed.length - 1;

    // Find maximum weight during final pour.
    let maxWeight = smoothed[endIdx].w;

    for (let j = endIdx - 1; j >= pourStart; j--) {
      if (smoothed[j].w > maxWeight) {
        maxWeight = smoothed[j].w;
        endIdx = j;
      }
    }

    // Move endpoint backward through insignificant fluctuations.
    for (let j = endIdx - 1; j >= pourStart; j--) {
      if (
        maxWeight - smoothed[j].w <= NOISE_TOLERANCE
      ) {
        endIdx = j;
      } else {
        break;
      }
    }

    segments.push({
      startIdx: pourStart,
      endIdx
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 6: Build pour objects
  // ────────────────────────────────────────────────────────────────────────────
  const pourLabels = [
    "Bloom",
    "2nd Pour",
    "3rd Pour",
    "4th Pour",
    "5th Pour"
  ];

  const pours = segments.map((seg, idx) => {
    const startPt = smoothed[seg.startIdx];
    const endPt = smoothed[seg.endIdx];

    // Previous stable endpoint.
    const prevEnd =
      idx > 0
        ? smoothed[segments[idx - 1].endIdx].w
        : 0;

    const volume =
      Math.round(
        (endPt.w - prevEnd) * 10
      ) / 10;

    const startSec =
      Math.round(startPt.ms / 100) / 10;

    const endSec =
      Math.round(endPt.ms / 100) / 10;

    const durationSec =
      Math.round(
        (endPt.ms - startPt.ms) / 100
      ) / 10;

    const avgSpeed =
      durationSec > 0
        ? Math.round(
            (volume / durationSec) * 10
          ) / 10
        : 0;

    return {
      label: pourLabels[idx] || `Pour ${idx + 1}`,
      startSec,
      endSec,
      durationSec,
      volume,
      cumulativeWater:
        Math.round(endPt.w * 10) / 10,
      avgSpeedGps: avgSpeed
    };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step 7: Overall brew information
  // ────────────────────────────────────────────────────────────────────────────
  const totalTime =
    smoothed.length > 0
      ? Math.round(
          smoothed[smoothed.length - 1].ms / 100
        ) / 10
      : 0;

  const totalWater =
    smoothed.length > 0
      ? Math.round(
          smoothed[smoothed.length - 1].w * 10
        ) / 10
      : 0;

  return {
    pours,
    totalWater,
    totalTime
  };
}



// ── GET /notion-beans ─────────────────────────────────────────────────────────
// Filtered to Status = "Using"
app.get("/notion-beans", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BEANS_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_BEANS_DB not set in .env" });
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        page_size: 50,
        filter: { property: "Status", status: { equals: "Using" } },
      })
    });
    const data = await r.json();
    if (data.object === "error") return res.status(400).json({ error: data.message });
    const items = data.results.map(p => ({
      id: p.id,
      name: textVal(p.properties["Bean Name"]),
      origin: textVal(p.properties["Origin"]),
      variety: multiVal(p.properties["Varietal"]),
      process: selectVal(p.properties["Process"]),
      altitude: numVal(p.properties["Altitude (m)"]),
      roastLevel: selectVal(p.properties["Roast Level"]),
      roaster: textVal(p.properties["Roaster"]),
      roastDate: dateVal(p.properties["Roast Date"]),
      notes: textVal(p.properties["Notes"]),
    })).filter(i => i.name);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /notion-equipment ─────────────────────────────────────────────────────
app.get("/notion-equipment", async (req, res) => {
  try {
    const dbId = process.env.NOTION_EQUIPMENT_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_EQUIPMENT_DB not set in .env" });
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ page_size: 50 }) });
    const data = await r.json();
    if (data.object === "error") return res.status(400).json({ error: data.message });
    const items = data.results.map(p => ({
      id: p.id,
      name: textVal(p.properties["Equipment Name"]),
      type: selectVal(p.properties["Type"]),
      brand: textVal(p.properties["Brand"]),
      model: textVal(p.properties["Model"]),
    })).filter(i => i.name);
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helper: find or create page ───────────────────────────────────────────────
async function findOrCreate(dbId, titleProp, titleValue, extraProps = {}) {
  const searchRes = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ filter: { property: titleProp, title: { equals: titleValue } } }),
  });
  const searchData = await searchRes.json();
  if (searchData.results?.length > 0) return searchData.results[0].id;
  const createRes = await fetch(`${NOTION_API}/pages`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties: { [titleProp]: { title: [{ text: { content: titleValue } }] }, ...extraProps } }),
  });
  return (await createRes.json()).id;
}

// ── POST /sync ────────────────────────────────────────────────────────────────
app.post("/sync", async (req, res) => {
  try {
    const recipe = req.body;
    const { NOTION_BEANS_DB, NOTION_EQUIPMENT_DB, NOTION_BREW_SESSIONS_DB, NOTION_SENSORY_DB } = process.env;
    if (!NOTION_BREW_SESSIONS_DB) return res.status(400).json({ error: "NOTION_BREW_SESSIONS_DB not set in .env" });

    // Build Brew Log from detected Timemore pours
    const pours = recipe.pours || [];
    const brewLog = pours.map((p, i) => {
      return `${p.label} | @${p.startSec}s → ${p.endSec}s | ${p.durationSec}s | ${p.volume}g | ${p.avgSpeedGps}g/s | cumul: ${p.cumulativeWater}g`;
    }).join("\n");

    const totalWater = pours.length > 0 ? pours[pours.length - 1].cumulativeWater : 0;
    const totalTime = recipe.totalTime || null;
    const notesText = recipe.notes || "";

    // ── Beans ──────────────────────────────────────────────────────────────────
    let beanPageId = recipe.bean?._notionId || null;
    if (!beanPageId && NOTION_BEANS_DB && recipe.bean?.origin) {
      const beanName = [recipe.bean.roaster, recipe.bean.origin, recipe.bean.variety].filter(Boolean).join(" – ") || "Unknown Bean";
      beanPageId = await findOrCreate(NOTION_BEANS_DB, "Bean Name", beanName, {
        ...(recipe.bean.origin    && { "Origin":       { rich_text: [{ text: { content: recipe.bean.origin } }] } }),
        ...(recipe.bean.variety   && { "Varietal":     { multi_select: recipe.bean.variety.split(",").map(v=>({ name: v.trim() })) } }),
        ...(recipe.bean.process   && { "Process":      { select: { name: recipe.bean.process } } }),
        ...(recipe.bean.altitude  && { "Altitude (m)": { number: Number(recipe.bean.altitude) } }),
        ...(recipe.roast          && { "Roast Level":  { select: { name: recipe.roast } } }),
        ...(recipe.bean.roaster   && { "Roaster":      { rich_text: [{ text: { content: recipe.bean.roaster } }] } }),
        ...(recipe.bean.roastDate && { "Roast Date":   { date: { start: recipe.bean.roastDate } } }),
        ...(recipe.bean.descriptors && { "Notes":      { rich_text: [{ text: { content: recipe.bean.descriptors } }] } }),
      });
    }

    // ── Equipment ──────────────────────────────────────────────────────────────
    let equipPageId = recipe.equipment?._brewerNotionId || null;
    if (!equipPageId && NOTION_EQUIPMENT_DB && recipe.equipment?.brewTool) {
      equipPageId = await findOrCreate(NOTION_EQUIPMENT_DB, "Equipment Name", recipe.equipment.brewTool, {
        "Type": { select: { name: "Brewer" } },
      });
    }

    // ── Brew Session ───────────────────────────────────────────────────────────
    const sessionId = `BREW-${Date.now()}`;
    const sessionRes = await fetch(`${NOTION_API}/pages`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        parent: { database_id: NOTION_BREW_SESSIONS_DB },
        properties: {
          "Session ID":       { title: [{ text: { content: sessionId } }] },
          "Date":             { date: { start: new Date().toISOString().split("T")[0] } },
          ...(beanPageId  && { "Bean":      { relation: [{ id: beanPageId }] } }),
          ...(equipPageId && { "Equipment": { relation: [{ id: equipPageId }] } }),
          ...(recipe.equipment?.brewTool && { "Brew Method": { select: { name: recipe.equipment.brewTool } } }),

          "Dose (g)":         { number: Number(recipe.coffee) || 0 },
          "Water (g)":        { number: totalWater },
          "Grind Setting":    { number: Number(recipe.grindSize) || 0 },
          "Temperature (°C)": { number: Number(recipe.waterTemp) || 0 },
          ...(totalTime   && { "Total Time (s)": { number: totalTime } }),
          ...(recipe.workId && { "Timemore Work ID": { rich_text: [{ text: { content: String(recipe.workId) } }] } }),

          ...(recipe.equipment?.waterSource && { "Water Source": { select: { name: recipe.equipment.waterSource } } }),
          ...(recipe.equipment?.tds         && { "Water TDS":    { number: Number(recipe.equipment.tds) } }),

          ...(recipe.sensory?.overall && { "Overall Score": { number: recipe.sensory.overall } }),
          ...(recipe.sensory?.balance && { "Balance":       { number: recipe.sensory.balance } }),
          ...(recipe.sensory?.clarity && { "Clarity":       { number: recipe.sensory.clarity } }),
          ...(recipe.sensory?.body    && { "Body":          { number: recipe.sensory.body } }),
          ...(notesText && { "Session Notes": { rich_text: [{ text: { content: notesText.slice(0, 2000) } }] } }),
          "Brew Log": { rich_text: [{ text: { content: brewLog.slice(0, 2000) } }] },
        },
      }),
    });
    const sessionData = await sessionRes.json();
    if (sessionData.object === "error") return res.status(400).json({ error: sessionData.message });

    // ── Sensory Evaluation ─────────────────────────────────────────────────────
    if (NOTION_SENSORY_DB) {
      await fetch(`${NOTION_API}/pages`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          parent: { database_id: NOTION_SENSORY_DB },
          properties: {
            "Evaluation ID": { title: [{ text: { content: `SENSORY-${Date.now()}` } }] },
            "Brew Session":  { relation: [{ id: sessionData.id }] },
            ...(recipe.tastingNotes?.length && { "Descriptors":  { multi_select: recipe.tastingNotes.map(n => ({ name: n })) } }),
            ...(recipe.sensory?.aroma      && { "Aroma":        { number: recipe.sensory.aroma } }),
            ...(recipe.sensory?.acidity    && { "Acidity":      { number: recipe.sensory.acidity } }),
            ...(recipe.sensory?.sweetness  && { "Sweetness":    { number: recipe.sensory.sweetness } }),
            ...(recipe.sensory?.bitterness && { "Bitterness":   { number: recipe.sensory.bitterness } }),
            ...(recipe.sensory?.aftertaste && { "Aftertaste":   { number: recipe.sensory.aftertaste } }),
            ...(recipe.sensory?.floral     && { "Floral":       { number: recipe.sensory.floral } }),
            ...(recipe.sensory?.fruity     && { "Fruity":       { number: recipe.sensory.fruity } }),
            ...(recipe.sensory?.teaLike    && { "Tea-like":     { number: recipe.sensory.teaLike } }),
            ...(recipe.notes && { "Tasting Notes": { rich_text: [{ text: { content: recipe.notes.slice(0,2000) } }] } }),
          },
        }),
      });
    }

    res.json({ success: true, sessionId, notionPageId: sessionData.id, message: `Synced as ${sessionId}` });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get("/health", (_, res) => res.json({ ok: true }));

// Catch-all: serve React for any non-API route
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Brew tracker server running on http://localhost:${PORT}`));
