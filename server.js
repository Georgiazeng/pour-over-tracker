const express = require("express");
const cors = require("cors");
require("dotenv").config();

const path = require('path');
const { segmentPours } = require("./lib/segmentPours");
const { importWork, extractWorkId } = require("./lib/timemore");

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

    // Parse the data field — it's a stringified JSON array of [time_ms, beverage_weight, scale_weight]
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

// ── GET /notion-beans ─────────────────────────────────────────────────────────
// Filtered to Status = "Using"
app.get("/notion-beans", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BEANS_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_BEANS_DB not set in .env" });
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        page_size: 100,
        // ?all=1 returns every bean (Using first); default keeps the old "Using only" behaviour
        ...(req.query.all ? {} : { filter: { property: "Status", status: { equals: "Using" } } }),
        sorts: [{ timestamp: "created_time", direction: "descending" }],
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
      status: p.properties["Status"]?.status?.name || "",
    })).filter(i => i.name);
    const rank = { Using: 0, Unopen: 1 };
    items.sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2));
    res.json({ items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /notion-equipment ─────────────────────────────────────────────────────
app.get("/notion-equipment", async (req, res) => {
  try {
    const dbId = process.env.NOTION_EQUIPMENT_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_EQUIPMENT_DB not set in .env" });
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ page_size: 100 }) });
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


// ══ Timemore import flow ═════════════════════════════════════════════════════
const rt = (s) => (s ? [{ text: { content: String(s).slice(0, 2000) } }] : []);
const numProp = (v) => ({ number: v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v) });

async function notion(pathname, body, method = "POST") {
  const r = await fetch(`${NOTION_API}${pathname}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (data.object === "error") throw new Error(data.message);
  return data;
}

// GET /timemore/import/:id — share page + curve for one brew (id may be a share URL)
app.get("/timemore/import/:id", async (req, res) => {
  const id = extractWorkId(req.params.id);
  if (!id) return res.status(400).json({ error: "Not a Timemore work ID or share link" });
  try {
    res.json(await importWork(id));
  } catch (err) {
    console.error("Timemore import error:", err);
    res.status(502).json({ error: err.message, workId: id });
  }
});

// GET /brews/existing?ids=1,2,3 — which Timemore IDs are already in the Brews DB
app.get("/brews/existing", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BREWS_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_BREWS_DB not set" });
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) return res.json({ existing: {} });
    const data = await notion(`/databases/${dbId}/query`, {
      page_size: 100,
      filter: { or: ids.map((id) => ({ property: "Timemore ID", rich_text: { equals: id } })) },
    });
    const existing = {};
    for (const p of data.results) existing[textVal(p.properties["Timemore ID"])] = p.url;
    res.json({ existing });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /notion-beans — create a bean from the review card
app.post("/notion-beans", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BEANS_DB;
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Bean name is required" });
    const page = await notion("/pages", {
      parent: { database_id: dbId },
      properties: {
        "Bean Name": { title: rt(b.name) },
        "Status": { status: { name: "Using" } },
        ...(b.roaster && { "Roaster": { rich_text: rt(b.roaster) } }),
        ...(b.origin && { "Origin": { rich_text: rt(b.origin) } }),
        ...(b.process && { "Process": { select: { name: b.process } } }),
        ...(b.roastLevel && { "Roast Level": { select: { name: b.roastLevel } } }),
        ...(b.roastDate && { "Roast Date": { date: { start: b.roastDate } } }),
      },
    });
    res.json({ item: { id: page.id, name: b.name, roaster: b.roaster || "", origin: b.origin || "", process: b.process || "", roastLevel: b.roastLevel || "", status: "Using" } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /notion-equipment — create equipment from the review card
app.post("/notion-equipment", async (req, res) => {
  try {
    const dbId = process.env.NOTION_EQUIPMENT_DB;
    const e = req.body || {};
    if (!e.name || !e.type) return res.status(400).json({ error: "Name and type are required" });
    const page = await notion("/pages", {
      parent: { database_id: dbId },
      properties: {
        "Equipment Name": { title: rt(e.name) },
        "Type": { select: { name: e.type } },
        ...(e.brand && { "Brand": { rich_text: rt(e.brand) } }),
        ...(e.model && { "Model": { rich_text: rt(e.model) } }),
      },
    });
    res.json({ item: { id: page.id, name: e.name, type: e.type, brand: e.brand || "", model: e.model || "" } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /brews — save one reviewed brew to the Brews DB
app.post("/brews", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BREWS_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_BREWS_DB not set" });
    const b = req.body || {};
    const espresso = b.method === "Espresso";
    // Espresso has no water amount; yield is what matters instead
    const missing = ["beanId", "brewerId", "grinderId", "grind", "temp", "plannedRatio", "dose", espresso ? "yield" : "water"]
      .filter((k) => b[k] === "" || b[k] == null);
    if (missing.length) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

    // Guard against double-saving the same Timemore brew
    if (b.workId) {
      const dup = await notion(`/databases/${dbId}/query`, { filter: { property: "Timemore ID", rich_text: { equals: String(b.workId) } } });
      if (dup.results.length) return res.status(409).json({ error: "Already imported", url: dup.results[0].url });
    }

    const title = [b.date ? new Date(b.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null, b.beanName]
      .filter(Boolean).join(" · ") || `Brew ${b.workId || ""}`.trim();
    const hasTasting = [b.rating, b.acidity, b.sweetness, b.bitterness, b.aroma].some((v) => v !== "" && v != null);

    const page = await notion("/pages", {
      parent: { database_id: dbId },
      properties: {
        "Brew": { title: rt(title) },
        ...(b.date && { "Date": { date: { start: b.date } } }),
        "Status": { select: { name: hasTasting ? "Tasted" : "Imported" } },
        "Method": { select: { name: espresso ? "Espresso" : "Pour Over" } },
        ...(b.workId && { "Timemore ID": { rich_text: rt(b.workId) } }),
        ...(b.link && { "Timemore Link": { url: b.link } }),
        "Bean": { relation: [{ id: b.beanId }] },
        "Brewer": { relation: [{ id: b.brewerId }] },
        "Grinder": { relation: [{ id: b.grinderId }] },
        ...(b.timemoreBean && { "Timemore Bean": { rich_text: rt(b.timemoreBean) } }),
        "Dose (g)": numProp(b.dose),
        "Water (g)": numProp(b.water),
        "Yield (g)": numProp(b.yield),
        "Planned Ratio": numProp(b.plannedRatio),
        "Grind": numProp(b.grind),
        "Temp (°C)": numProp(b.temp),
        "Total Time (s)": numProp(b.totalTime),
        "Bloom (g)": numProp(b.bloomGrams),
        "Bloom Time (s)": numProp(b.bloomTime),
        "Pours": numProp(b.pourCount),
        "Avg Flow (g/s)": numProp(b.avgFlow),
        "Peak Flow (g/s)": numProp(b.peakFlow),
        ...(b.brewLog && { "Brew Log": { rich_text: rt(b.brewLog) } }),
        "Rating": numProp(b.rating),
        "Acidity": numProp(b.acidity),
        "Sweetness": numProp(b.sweetness),
        "Bitterness": numProp(b.bitterness),
        "Aroma": numProp(b.aroma),
        ...(b.issues?.length && { "Issues": { multi_select: b.issues.map((name) => ({ name })) } }),
        ...(b.notes && { "Notes": { rich_text: rt(b.notes) } }),
      },
    });
    res.json({ success: true, url: page.url, id: page.id });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get("/health", (_, res) => res.json({ ok: true }));

// Catch-all: serve React for any non-API route
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Brew tracker server running on http://localhost:${PORT}`));
