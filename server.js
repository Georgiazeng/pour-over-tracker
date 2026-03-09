const express = require("express");
const cors = require("cors");
require("dotenv").config();

const path = require('path');

// Serve the built React app
app.use(express.static(path.join(__dirname, 'build')));

// Catch-all: serve React for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/notion') && !req.path.startsWith('/sync')) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  }
});

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

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

    // Use actual pours if available, otherwise fall back to target
    const pours = recipe.actualPours?.length ? recipe.actualPours.map((a, i) => ({
      label: recipe.pours[i]?.label || `Pour ${i+1}`,
      water: a.water ?? recipe.pours[i]?.water ?? 0,
      duration: (a.pourStartTime != null && a.pourStopTime != null) ? a.pourStopTime - a.pourStartTime : recipe.pours[i]?.duration ?? 0,
      pourStartTime: a.pourStartTime,
      pourStopTime: a.pourStopTime,
      stirMethod: recipe.pours[i]?.stirMethod,
    })) : recipe.pours;

    const totalWater = pours.reduce((a, p) => a + Number(p.water), 0);
    const totalTime = pours.reduce((a, p) => a + Number(p.duration), 0);
    const bloom = pours[0] || {}, pour2 = pours[1] || {}, pour3 = pours[2] || {};
    const stirMethods = pours.map(p => p.stirMethod).filter(s => s && s !== "None");
    const agitation = stirMethods.length === 0 ? "Low" : stirMethods.some(s => ["Stir","Rao Spin"].includes(s)) ? "High" : "Medium";

    // Build pour timing notes
    const timingNotes = recipe.actualPours?.length ? recipe.actualPours.map((a, i) => {
      const label = recipe.pours[i]?.label || `Pour ${i+1}`;
      const dur = (a.pourStartTime != null && a.pourStopTime != null) ? a.pourStopTime - a.pourStartTime : null;
      const speed = dur && dur > 0 ? (a.water / dur).toFixed(1) : null;
      return `${label}: ${a.water}ml | start ${a.pourStartTime ?? "?"}s | stop ${a.pourStopTime ?? "?"}s${speed ? ` | ${speed} ml/s` : ""}`;
    }).join("\n") : null;

    // Beans
    let beanPageId = recipe.bean?._notionId || null;
    if (!beanPageId && NOTION_BEANS_DB && recipe.bean?.origin) {
      const beanName = [recipe.bean.roaster, recipe.bean.origin, recipe.bean.variety].filter(Boolean).join(" – ") || "Unknown Bean";
      beanPageId = await findOrCreate(NOTION_BEANS_DB, "Bean Name", beanName, {
        ...(recipe.bean.origin && { "Origin": { rich_text: [{ text: { content: recipe.bean.origin } }] } }),
        ...(recipe.bean.variety && { "Varietal": { multi_select: [{ name: recipe.bean.variety }] } }),
        ...(recipe.bean.process && { "Process": { select: { name: recipe.bean.process } } }),
        ...(recipe.bean.altitude && { "Altitude (m)": { number: Number(recipe.bean.altitude) } }),
        ...(recipe.roast && { "Roast Level": { select: { name: recipe.roast } } }),
        ...(recipe.bean.roaster && { "Roaster": { rich_text: [{ text: { content: recipe.bean.roaster } }] } }),
        ...(recipe.bean.roastDate && { "Roast Date": { date: { start: recipe.bean.roastDate } } }),
      });
    }

    // Equipment
    let equipPageId = recipe.equipment?._brewerNotionId || null;
    if (!equipPageId && NOTION_EQUIPMENT_DB && recipe.equipment?.brewTool) {
      const equipName = recipe.equipment.brewToolCustom || recipe.equipment.brewTool;
      equipPageId = await findOrCreate(NOTION_EQUIPMENT_DB, "Equipment Name", equipName, { "Type": { select: { name: "Brewer" } } });
    }

    // Brew Session — use actual data
    const sessionId = `BREW-${Date.now()}`;
    const notesText = [recipe.notes, timingNotes ? `\n--- Actual pour log ---\n${timingNotes}` : ""].filter(Boolean).join("\n");

    const sessionRes = await fetch(`${NOTION_API}/pages`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        parent: { database_id: NOTION_BREW_SESSIONS_DB },
        properties: {
          "Session ID": { title: [{ text: { content: sessionId } }] },
          "Date": { date: { start: new Date().toISOString().split("T")[0] } },
          "Brew Method": { select: { name: recipe.equipment?.brewTool || "Pour Over" } },
          "Dose (g)": { number: Number(recipe.coffee) || 0 },
          "Water (g)": { number: totalWater },
          "Grind Setting": { number: Number(recipe.grindSize) || 0 },
          "Temperature (°C)": { number: Number(recipe.waterTemp) || 0 },
          "Total Time (s)": { number: totalTime },
          "Agitation Level": { select: { name: agitation } },
          ...(bloom.water && { "Bloom Water (g)": { number: Number(bloom.water) } }),
          ...(bloom.duration && { "Bloom Time (s)": { number: Number(bloom.duration) } }),
          ...(pour2.water && { "Pour 2 (g)": { number: Number(pour2.water) } }),
          ...(pour3.water && { "Pour 3 (g)": { number: Number(pour3.water) } }),
          ...(recipe.equipment?.waterSource && { "Water Source": { select: { name: recipe.equipment.waterSource } } }),
          ...(recipe.equipment?.tds && { "Water TDS": { number: Number(recipe.equipment.tds) } }),
          ...(notesText && { "Session Notes": { rich_text: [{ text: { content: notesText.slice(0, 2000) } }] } }),
          ...(recipe.sensory?.overall && { "Overall Score": { number: recipe.sensory.overall } }),
          ...(recipe.sensory?.balance && { "Balance": { number: recipe.sensory.balance } }),
          ...(recipe.sensory?.clarity && { "Clarity": { number: recipe.sensory.clarity } }),
          ...(recipe.sensory?.body && { "Body": { number: recipe.sensory.body } }),
          ...(beanPageId && { "Bean": { relation: [{ id: beanPageId }] } }),
          ...(equipPageId && { "Equipment": { relation: [{ id: equipPageId }] } }),
        },
      }),
    });
    const sessionData = await sessionRes.json();
    if (sessionData.object === "error") return res.status(400).json({ error: sessionData.message });

    // Sensory
    if (NOTION_SENSORY_DB && recipe.tastingNotes?.length > 0) {
      await fetch(`${NOTION_API}/pages`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          parent: { database_id: NOTION_SENSORY_DB },
          properties: {
            "Evaluation ID": { title: [{ text: { content: `SENSORY-${Date.now()}` } }] },
            "Brew Session": { relation: [{ id: sessionData.id }] },
            "Descriptors": { multi_select: recipe.tastingNotes.map(n => ({ name: n })) },
            ...(recipe.sensory?.aroma && { "Aroma": { number: recipe.sensory.aroma } }),
            ...(recipe.sensory?.acidity && { "Acidity": { number: recipe.sensory.acidity } }),
            ...(recipe.sensory?.sweetness && { "Sweetness": { number: recipe.sensory.sweetness } }),
            ...(recipe.sensory?.bitterness && { "Bitterness": { number: recipe.sensory.bitterness } }),
            ...(recipe.sensory?.aftertaste && { "Aftertaste": { number: recipe.sensory.aftertaste } }),
            ...(recipe.notes && { "Tasting Notes": { rich_text: [{ text: { content: recipe.notes } }] } }),
          },
        }),
      });
    }

    res.json({ success: true, sessionId, notionPageId: sessionData.id, message: `Synced as ${sessionId}` });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get("/health", (_, res) => res.json({ ok: true }));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Notion proxy running on http://localhost:${PORT}`));
