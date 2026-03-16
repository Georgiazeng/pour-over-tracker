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

// ── GET /notion-beans ────────────────────────────────────────────────────────
app.get("/notion-beans", async (req, res) => {
  try {
    const dbId = process.env.NOTION_BEANS_DB;
    if (!dbId) return res.status(400).json({ error: "NOTION_BEANS_DB not set in .env" });
    const r = await fetch(`${NOTION_API}/databases/${dbId}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ page_size: 50 }) });
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

// ── GET /notion-equipment ────────────────────────────────────────────────────
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

// ── Helper: find or create page ──────────────────────────────────────────────
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

// ── POST /sync ───────────────────────────────────────────────────────────────
app.post("/sync", async (req, res) => {
  try {
    const recipe = req.body;
    const { NOTION_BEANS_DB, NOTION_EQUIPMENT_DB, NOTION_BREW_SESSIONS_DB, NOTION_SENSORY_DB } = process.env;
    if (!NOTION_BREW_SESSIONS_DB) return res.status(400).json({ error: "NOTION_BREW_SESSIONS_DB not set in .env" });

    // Resolve actual vs target pours
    const actualPours = recipe.actualPours?.length ? recipe.actualPours : null;
    const totalWater = recipe.pours[recipe.pours.length - 1]?.targetWater ?? 0;
    const totalTime = recipe.brewEndTime ?? null; // full brew end time incl. drawdown

    // Build Brew Log — one line per pour: name | flow | start | stop | speed | actual water
    const brewLog = recipe.pours.map((p, i) => {
      const ap = actualPours?.[i];
      const label = p.label;
      const flow = p.flowStyle || "—";
      const startT = ap?.pourStartTime ?? p.startTime ?? "?";
      const stopT = ap?.pourStopTime ?? "?";
      const actualWater = ap?.water ?? p.targetWater;
      const prevWater = i > 0 ? (actualPours?.[i-1]?.water ?? recipe.pours[i-1]?.targetWater ?? 0) : 0;
      const incremental = actualWater - prevWater;
      const dur = (ap?.pourStartTime != null && ap?.pourStopTime != null) ? ap.pourStopTime - ap.pourStartTime : null;
      const speed = dur && dur > 0 ? (incremental / dur).toFixed(1) : "?";
      return `${label} | ${flow} | @${startT}s → ${stopT}s | ${speed}ml/s | ${actualWater}ml`;
    }).join("\n");

    // Session Notes = free text notes only (brew log goes to Brew Log column)
    const notesText = recipe.notes || "";

    // ── Beans ─────────────────────────────────────────────────────────────────
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

    // ── Equipment ─────────────────────────────────────────────────────────────
    let equipPageId = recipe.equipment?._brewerNotionId || null;
    if (!equipPageId && NOTION_EQUIPMENT_DB && recipe.equipment?.brewTool) {
      equipPageId = await findOrCreate(NOTION_EQUIPMENT_DB, "Equipment Name", recipe.equipment.brewTool, {
        "Type": { select: { name: "Brewer" } },
      });
    }

    // ── Brew Session ──────────────────────────────────────────────────────────
    const sessionId = `BREW-${Date.now()}`;
    const sessionRes = await fetch(`${NOTION_API}/pages`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        parent: { database_id: NOTION_BREW_SESSIONS_DB },
        properties: {
          // Identification
          "Session ID":       { title: [{ text: { content: sessionId } }] },
          "Date":             { date: { start: new Date().toISOString().split("T")[0] } },
          ...(beanPageId  && { "Bean":      { relation: [{ id: beanPageId }] } }),
          ...(equipPageId && { "Equipment": { relation: [{ id: equipPageId }] } }),
          ...(recipe.equipment?.brewTool && { "Brew Method": { select: { name: recipe.equipment.brewTool } } }),

          // Recipe parameters
          "Dose (g)":         { number: Number(recipe.coffee) || 0 },
          "Water (g)":        { number: totalWater },
          "Grind Setting":    { number: Number(recipe.grindSize) || 0 },
          "Temperature (°C)": { number: Number(recipe.waterTemp) || 0 },
          ...(totalTime   && { "Total Time (s)": { number: totalTime } }),

          // Environment
          ...(recipe.equipment?.waterSource && { "Water Source": { select: { name: recipe.equipment.waterSource } } }),
          ...(recipe.equipment?.tds         && { "Water TDS":    { number: Number(recipe.equipment.tds) } }),

          // Outcome
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

    // ── Sensory Evaluation ────────────────────────────────────────────────────
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
app.listen(PORT, () => console.log(`✅ Notion proxy running on http://localhost:${PORT}`));
