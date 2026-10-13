import { useState, useEffect, useCallback, useRef } from "react";
import jsQR from "jsqr";
import { css, WeightChart, ScoreSlider, formatTime } from "./LegacyTracker";

// ── Constants ─────────────────────────────────────────────────────────────────
const ISSUES = ["Sour", "Bitter", "Thin", "Flat", "Astringent", "Muddy"];
const PROCESSES = ["Washed", "Natural", "Honey", "Anaerobic Washed", "Anaerobic Natural", "Washed Therm Shock", "Yeast Inoculated Double Fermentation", "Anaerobic Slow Dried"];
const ROAST_LEVELS = ["Light", "Light-Medium", "Medium Light", "Medium", "Dark", "Decaf"];
// Espresso has no water amount; the yield in the cup is required instead
const requiredFor = (method) => [
  ["beanId", "Bean"], ["brewerId", method === "Espresso" ? "Machine" : "Brewer"], ["grinderId", "Grinder"],
  ["grind", "Grind"], ["temp", "Temp"], ["plannedRatio", "Planned ratio"],
  ["dose", "Dose"], method === "Espresso" ? ["yield", "Yield"] : ["water", "Water"],
];
const isEspresso = (it) => it?.data?.method === "Espresso";
const LAST_EQUIP_KEY = "pot:lastEquipment";

// ── Helpers ───────────────────────────────────────────────────────────────────
const blank = (v) => v === "" || v == null;
const round1 = (n) => Math.round(n * 10) / 10;

function readLastEquipment() {
  try { return JSON.parse(localStorage.getItem(LAST_EQUIP_KEY) || "{}"); } catch { return {}; }
}
function writeLastEquipment(v) {
  try { localStorage.setItem(LAST_EQUIP_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

// Pulls a work ID out of a bare number or any Timemore share/work URL
function extractWorkId(text) {
  const s = String(text || "").trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(?:share|work)\/(\d+)/);
  return m ? m[1] : null;
}

// Decodes a QR code from an image file in the browser
async function decodeQrFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not open image"));
      i.src = url;
    });
    // Smaller sizes first: on Timemore's JPEG exports, compression noise stops
    // jsQR at full size while ~400–600px decodes reliably (tested on a real export).
    for (const maxSide of [600, 400, 900, 1400]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
      if (code?.data) return code.data;
    }
    throw new Error("No QR code found in this image");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Simple word-overlap score for suggesting a bean from Timemore's bean text
function suggestBean(timemoreBean, beans) {
  if (!timemoreBean || !beans.length) return null;
  const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 2));
  const target = words(`${timemoreBean.name} ${timemoreBean.origin}`);
  if (!target.size) return null;
  let best = null, bestScore = 0;
  for (const b of beans) {
    const cand = words(`${b.name} ${b.origin} ${b.roaster}`);
    let score = 0;
    target.forEach((w) => { if (cand.has(w)) score++; });
    if (b.status === "Using") score += 0.5;
    if (score > bestScore) { best = b; bestScore = score; }
  }
  return bestScore >= 1 ? best : null;
}

const matchOption = (value, options) =>
  options.find((o) => o.toLowerCase() === String(value || "").toLowerCase()) || "";

function initialForm(data, lastEquip) {
  return {
    date: data.date || new Date().toISOString().slice(0, 10),
    dose: data.dose ?? "",
    water: data.water ?? "",
    yield: data.yield ?? "",
    totalTime: data.totalTime ?? "",
    grind: data.grind ?? "",
    temp: data.temp ?? "",
    plannedRatio: "",
    beanId: "",
    brewerId: (lastEquip[data.method] || (data.method === "Espresso" ? {} : lastEquip)).brewerId || "",
    grinderId: (lastEquip[data.method] || (data.method === "Espresso" ? {} : lastEquip)).grinderId || "",
    rating: data.rating ?? 0,
    acidity: 0, sweetness: 0, bitterness: 0, aroma: 0,
    issues: [],
    notes: data.comment || "",
  };
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function ImportView({ onOpenLegacy }) {
  const [items, setItems] = useState([]); // one per Timemore brew
  const [beans, setBeans] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [libError, setLibError] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [notif, setNotif] = useState({ msg: "", type: "" });
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const notify = useCallback((msg, type = "") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif({ msg: "", type: "" }), 3000);
  }, []);

  const patch = useCallback((key, changes) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...(typeof changes === "function" ? changes(it) : changes) } : it)));
  }, []);

  // Load Beans + Equipment once
  useEffect(() => {
    Promise.all([
      fetch("/notion-beans?all=1").then((r) => r.json()),
      fetch("/notion-equipment").then((r) => r.json()),
    ])
      .then(([b, e]) => {
        if (b.error || e.error) setLibError(b.error || e.error);
        setBeans(b.items || []);
        setEquipment(e.items || []);
      })
      .catch((err) => setLibError(err.message));
  }, []);

  // Fetch Timemore data for brews that have an ID and aren't loaded yet
  const loadBrew = useCallback(async (key, workId) => {
    patch(key, { status: "loading" });
    try {
      const r = await fetch(`/timemore/import/${workId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Import failed (${r.status})`);
      patch(key, { status: "ready", data, form: initialForm(data, readLastEquipment()) });
    } catch (err) {
      patch(key, { status: "error", error: err.message });
    }
  }, [patch]);

  // Adds work IDs (deduped against this batch and against Notion)
  const addWorkIds = useCallback(async (entries) => {
    // entries: [{ key, workId?, fileName?, error? }]
    const known = new Set(itemsRef.current.map((p) => p.workId).filter(Boolean));
    const marked = entries.map((e) => {
      if (e.error) return { ...e, status: "error" };
      if (known.has(e.workId)) return { ...e, status: "skipped", error: "Already in this batch" };
      known.add(e.workId);
      return { ...e, status: "queued" };
    });
    itemsRef.current = [...itemsRef.current, ...marked];
    setItems((prev) => [...prev, ...marked]);
    const queued = marked.filter((e) => e.status === "queued");

    const ids = queued.map((e) => e.workId);
    let existing = {};
    if (ids.length) {
      try {
        const r = await fetch(`/brews/existing?ids=${ids.join(",")}`);
        const d = await r.json();
        existing = d.existing || {};
      } catch { /* if the check fails, the save route still blocks duplicates */ }
    }

    for (const e of queued) {
      if (existing[e.workId]) patch(e.key, { status: "duplicate", notionUrl: existing[e.workId] });
    }
    // Load the rest, three at a time
    const queue = queued.filter((e) => !existing[e.workId]);
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        await loadBrew(e.key, e.workId);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }, [patch, loadBrew]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    const entries = await Promise.all(files.map(async (file, i) => {
      const key = `${Date.now()}-${i}-${file.name}`;
      try {
        const text = await decodeQrFile(file);
        const workId = extractWorkId(text);
        if (!workId) return { key, fileName: file.name, error: `QR isn't a Timemore share link: ${text.slice(0, 60)}` };
        return { key, fileName: file.name, workId };
      } catch (err) {
        return { key, fileName: file.name, error: err.message };
      }
    }));
    addWorkIds(entries);
  };

  const handleLinks = () => {
    const parts = linkInput.split(/[\s,]+/).filter(Boolean);
    const entries = parts.map((p, i) => {
      const workId = extractWorkId(p);
      return { key: `${Date.now()}-link-${i}`, fileName: p, ...(workId ? { workId } : { error: "Not a Timemore link or ID" }) };
    });
    if (entries.length) addWorkIds(entries);
    setLinkInput("");
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const missingFor = (it) => (it.form ? requiredFor(it.data?.method).filter(([k]) => blank(it.form[k])).map(([, l]) => l) : []);

  const saveOne = async (it) => {
    const missing = missingFor(it);
    if (missing.length) { patch(it.key, { showMissing: true }); notify(`Needs: ${missing.join(", ")}`, "err"); return false; }
    const bean = beans.find((b) => b.id === it.form.beanId);
    patch(it.key, { status: "saving", error: "" });
    const f = it.form, d = it.data;
    const tb = d.timemoreBean;
    try {
      const r = await fetch("/brews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          // Sliders use 0 for "not scored"
          rating: f.rating || null, acidity: f.acidity || null, sweetness: f.sweetness || null,
          bitterness: f.bitterness || null, aroma: f.aroma || null,
          beanName: bean?.name,
          workId: d.workId, link: d.link,
          timemoreBean: tb ? [tb.name, tb.origin, tb.process, tb.roast].filter(Boolean).join(" · ") : "",
          method: d.method,
          bloomGrams: d.bloomGrams, bloomTime: d.bloomTime, pourCount: d.pourCount, avgFlow: d.avgFlow, peakFlow: d.peakFlow,
          brewLog: d.brewLog,
        }),
      });
      const res = await r.json();
      if (r.status === 409) { patch(it.key, { status: "duplicate", notionUrl: res.url }); return true; }
      if (!r.ok) throw new Error(res.error || "Save failed");
      writeLastEquipment({ ...readLastEquipment(), [d.method || "Pour Over"]: { brewerId: f.brewerId, grinderId: f.grinderId } });
      patch(it.key, { status: "saved", notionUrl: res.url });
      return true;
    } catch (err) {
      patch(it.key, { status: "ready", error: err.message });
      return false;
    }
  };

  const saveAll = async () => {
    const ready = items.filter((it) => it.status === "ready");
    let ok = 0;
    for (const it of ready) if (await saveOne(it)) ok++;
    notify(`Saved ${ok} of ${ready.length}`, ok === ready.length ? "ok" : "err");
  };

  const readyCount = items.filter((it) => it.status === "ready").length;
  const savedCount = items.filter((it) => it.status === "saved").length;

  return (
    <>
      <style>{css + importCss}</style>
      <div className="app">
        <div className="grain" /><div className="ring r1" /><div className="ring r2" />
        <div className="wrap">
          <div className="hdr">
            <div className="eyebrow">Timemore → Notion</div>
            <h1>Brew <em>Import</em></h1>
          </div>

          {libError && <div className="status-banner error">Couldn't load Beans/Equipment from Notion: {libError}</div>}

          {/* Upload */}
          <div className="card">
            <div className="ct"><span>Add brews</span>{items.length > 0 && <button className="ct-btn" onClick={() => setItems([])}>Clear list</button>}</div>
            <label
              className={`drop ${dragOver ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            >
              <input type="file" accept="image/*" multiple onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              <span className="drop-big">Upload Timemore QR images</span>
              <span className="drop-small">Select several at once · duplicates are skipped</span>
            </label>
            <div className="wid-input-row" style={{ marginTop: 12 }}>
              <div className="f">
                <label>Or paste share links / IDs</label>
                <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLinks()} placeholder="https://bm.timemore.com/v4/share/…" />
              </div>
              <button className="fetch-btn" onClick={handleLinks} disabled={!linkInput.trim()}>Add</button>
            </div>
          </div>

          {items.length === 0 && <div className="empty">Upload QR codes exported from the Timemore app to start.</div>}

          {items.map((it) => (
            <BrewCard
              key={it.key}
              it={it}
              beans={beans}
              equipment={equipment}
              missing={missingFor(it)}
              onForm={(changes) => patch(it.key, (cur) => ({ form: { ...cur.form, ...changes } }))}
              onSave={() => saveOne(it)}
              onRetry={() => loadBrew(it.key, it.workId)}
              onRemove={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
              onBeanCreated={(b) => { setBeans((prev) => [b, ...prev]); patch(it.key, (cur) => ({ form: { ...cur.form, beanId: b.id } })); }}
              onEquipmentCreated={(e, field) => { setEquipment((prev) => [e, ...prev]); patch(it.key, (cur) => ({ form: { ...cur.form, [field]: e.id } })); }}
              notify={notify}
            />
          ))}

          {items.length > 0 && (
            <div className="ar">
              <button className="ab2 notion" onClick={saveAll} disabled={readyCount === 0}>
                Save {readyCount || ""} to Notion
              </button>
            </div>
          )}
          {savedCount > 0 && <p className="hint" style={{ textAlign: "center", marginTop: 10 }}>{savedCount} saved this session</p>}

          <p className="hint" style={{ textAlign: "center", marginTop: 36 }}>
            <button className="linkbtn" onClick={onOpenLegacy}>Open the old manual tracker</button>
          </p>
        </div>
        <div className={`notif ${notif.msg ? "show" : ""} ${notif.type}`}>{notif.msg}</div>
      </div>
    </>
  );
}

// ── One brew ──────────────────────────────────────────────────────────────────
function BrewCard({ it, beans, equipment, missing, onForm, onSave, onRetry, onRemove, onBeanCreated, onEquipmentCreated, notify }) {
  const [showPours, setShowPours] = useState(false);
  const [showTasting, setShowTasting] = useState(false);
  const [newBean, setNewBean] = useState(false);
  const [newEquip, setNewEquip] = useState(null); // "brewerId" | "grinderId"

  const head = (
    <div className="ct">
      <span>
        {it.data?.method && <span className={`method ${isEspresso(it) ? "esp" : ""}`}>{it.data.method}</span>}
        {it.data?.date || "…"}{it.data?.title ? ` · ${it.data.title}` : ""}
      </span>
      <span className="ct-right">
        {it.workId && <span className="wid">#{it.workId}</span>}
        {it.status !== "saving" && <button className="x" onClick={onRemove} aria-label="Remove">×</button>}
      </span>
    </div>
  );

  if (it.status !== "ready" && it.status !== "saving" && it.status !== "saved") {
    const msg = {
      queued: "Waiting…", loading: "Fetching from Timemore…",
      duplicate: "Already in Notion — skipped", skipped: it.error, error: it.error,
    }[it.status];
    const cls = it.status === "error" ? "error" : it.status === "duplicate" || it.status === "skipped" ? "success" : "loading";
    return (
      <div className="card">
        {head}
        {it.fileName && <p className="hint" style={{ marginBottom: 8 }}>{it.fileName}</p>}
        <div className={`status-banner ${cls}`} style={{ marginBottom: 0 }}>
          {msg}
          {it.notionUrl && <> · <a href={it.notionUrl} target="_blank" rel="noreferrer">open</a></>}
          {it.status === "error" && it.workId && <> · <button className="linkbtn" onClick={onRetry}>retry</button></>}
        </div>
      </div>
    );
  }

  const d = it.data, f = it.form;
  const saved = it.status === "saved";
  const need = (k) => it.showMissing && blank(f[k]);
  const actualRatio = f.dose > 0 && f.water > 0 ? round1(f.water / f.dose) : null;
  const brewRatio = f.dose > 0 && f.yield > 0 ? round1(f.yield / f.dose) : null;
  const tb = d.timemoreBean;
  const suggestion = !f.beanId ? suggestBean(tb, beans) : null;
  const espresso = isEspresso(it);
  const brewerType = espresso ? "Espresso Machine" : "Brewer";
  const brewerLabel = espresso ? "Machine" : "Brewer";
  const brewers = equipment.filter((e) => e.type === brewerType);
  const grinders = equipment.filter((e) => e.type === "Grinder");
  const num = (k) => (e) => onForm({ [k]: e.target.value === "" ? "" : Number(e.target.value) });

  return (
    <div className={`card ${saved ? "saved-card" : ""}`}>
      {head}

      {saved ? (
        <div className="status-banner success" style={{ marginBottom: 0 }}>
          Saved · <a href={it.notionUrl} target="_blank" rel="noreferrer">open in Notion</a>
        </div>
      ) : (
        <>
          {d.warnings?.length > 0 && <div className="status-banner loading">{d.warnings.join(" · ")}</div>}

          <div className="brew-summary-grid">
            <div className="stat"><div className="sv">{f.dose || "—"}g</div><div className="sl">Dose</div></div>
            {espresso ? (
              <>
                <div className="stat"><div className="sv">{f.yield || "—"}g</div><div className="sl">Yield</div></div>
                <div className="stat"><div className="sv">{brewRatio ? `1:${brewRatio}` : "—"}</div><div className="sl">Ratio</div></div>
              </>
            ) : (
              <>
                <div className="stat"><div className="sv">{f.water || "—"}g</div><div className="sl">Water</div></div>
                <div className="stat"><div className="sv">{actualRatio ? `1:${actualRatio}` : "—"}</div><div className="sl">Actual ratio</div></div>
              </>
            )}
            <div className="stat"><div className="sv">{formatTime(f.totalTime)}</div><div className="sl">Time</div></div>
          </div>

          {espresso && d.rawPoints?.length > 0 && (
            <>
              <button className="linkbtn" onClick={() => setShowPours((v) => !v)}>
                {showPours ? "Hide" : "Show"} shot curve · avg {d.avgFlow} g/s · peak {d.peakFlow} g/s
              </button>
              {showPours && (
                <div style={{ marginTop: 10 }}>
                  <WeightChart rawPoints={d.rawPoints} pours={[]} />
                  <p className="hint" style={{ whiteSpace: "pre-line" }}>{d.brewLog}</p>
                </div>
              )}
            </>
          )}
          {!espresso && d.pours?.length > 0 && (
            <>
              <button className="linkbtn" onClick={() => setShowPours((v) => !v)}>
                {showPours ? "Hide" : "Show"} curve · {d.pourCount} pours · bloom {d.bloomGrams}g / {d.bloomTime}s · avg {d.avgFlow} g/s
              </button>
              {showPours && (
                <div style={{ marginTop: 10 }}>
                  <WeightChart rawPoints={d.rawPoints} pours={d.pours} />
                  <table className="pour-table">
                    <thead><tr><th>Pour</th><th>Start</th><th>End</th><th>g</th><th>g/s</th></tr></thead>
                    <tbody>{d.pours.map((p) => (
                      <tr key={p.label}><td>{p.label}</td><td>{p.startSec}s</td><td>{p.endSec}s</td><td>{p.volume}</td><td>{p.avgSpeedGps}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div className="divider" />

          {/* Bean */}
          <div className={`f ${need("beanId") ? "need" : ""}`}>
            <label>Bean *</label>
            {tb?.name && <p className="tm-hint">Timemore: {[tb.name, tb.origin, tb.process, tb.roast].filter(Boolean).join(" · ")}</p>}
            <select value={f.beanId} onChange={(e) => onForm({ beanId: e.target.value })}>
              <option value="">Select a bean…</option>
              {["Using", "Unopen", "Finished", ""].map((st) => {
                const group = beans.filter((b) => (b.status || "") === st);
                return group.length ? (
                  <optgroup key={st || "other"} label={st || "Other"}>
                    {group.map((b) => <option key={b.id} value={b.id}>{b.name}{b.roaster ? ` — ${b.roaster}` : ""}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
            <div className="row-actions">
              {suggestion && <button className="chip" onClick={() => onForm({ beanId: suggestion.id })}>Use “{suggestion.name}”?</button>}
              <button className="linkbtn" onClick={() => setNewBean((v) => !v)}>{newBean ? "Cancel new bean" : "+ New bean"}</button>
            </div>
            {newBean && <NewBeanForm timemoreBean={tb} notify={notify} onCreated={(b) => { onBeanCreated(b); setNewBean(false); }} />}
          </div>

          {/* Equipment */}
          <div className="g2" style={{ marginTop: 14 }}>
            {[["brewerId", brewerLabel, brewers], ["grinderId", "Grinder", grinders]].map(([field, label, list]) => (
              <div key={field} className={`f ${need(field) ? "need" : ""}`}>
                <label>{label} *</label>
                <select value={f[field]} onChange={(e) => onForm({ [field]: e.target.value })}>
                  <option value="">Select…</option>
                  {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button className="linkbtn" onClick={() => setNewEquip(newEquip === field ? null : field)}>
                  {newEquip === field ? "Cancel" : `+ New ${label.toLowerCase()}`}
                </button>
              </div>
            ))}
          </div>
          {newEquip && (
            <NewEquipmentForm
              type={newEquip === "brewerId" ? brewerType : "Grinder"}
              notify={notify}
              onCreated={(e) => { onEquipmentCreated(e, newEquip); setNewEquip(null); }}
            />
          )}

          {/* Recipe numbers */}
          <div className="g3" style={{ marginTop: 14 }}>
            <div className={`f ${need("grind") ? "need" : ""}`}><label>Grind *</label><input type="number" step="0.1" inputMode="decimal" value={f.grind} onChange={num("grind")} /></div>
            <div className={`f ${need("temp") ? "need" : ""}`}><label>Temp °C *</label><input type="number" inputMode="decimal" value={f.temp} onChange={num("temp")} /></div>
            <div className={`f ${need("plannedRatio") ? "need" : ""}`}><label>{espresso ? "Planned 1:x yield *" : "Planned 1:x *"}</label><input type="number" step="0.1" inputMode="decimal" placeholder={espresso ? brewRatio || "2" : actualRatio || "16"} value={f.plannedRatio} onChange={num("plannedRatio")} /></div>
            <div className={`f ${need("dose") ? "need" : ""}`}><label>Dose g *</label><input type="number" step="0.1" inputMode="decimal" value={f.dose} onChange={num("dose")} /></div>
            {!espresso && <div className={`f ${need("water") ? "need" : ""}`}><label>Water g *</label><input type="number" step="0.1" inputMode="decimal" value={f.water} onChange={num("water")} /></div>}
            <div className={`f ${need("yield") ? "need" : ""}`}><label>{espresso ? "Yield g *" : "Yield g"}</label><input type="number" step="0.1" inputMode="decimal" value={f.yield} onChange={num("yield")} /></div>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            {espresso
              ? <>Ratio {brewRatio ? `1:${brewRatio}` : "—"} · {formatTime(f.totalTime)} · Date</>
              : <>Actual {actualRatio ? `1:${actualRatio}` : "—"} · Brew ratio {brewRatio ? `1:${brewRatio}` : "—"} · Date</>}
            <input className="inline-date" type="date" value={f.date} onChange={(e) => onForm({ date: e.target.value })} />
          </p>

          {/* Tasting (optional) */}
          <div className="divider" />
          <button className="linkbtn" onClick={() => setShowTasting((v) => !v)}>
            {showTasting ? "Hide tasting" : "Add tasting now (optional)"}
          </button>
          {showTasting && (
            <div style={{ marginTop: 12 }}>
              {[["rating", "Rating"], ["acidity", "Acidity"], ["sweetness", "Sweetness"], ["bitterness", "Bitterness"], ["aroma", "Aroma"]].map(([k, l]) => (
                <ScoreSlider key={k} label={l} value={f[k]} onChange={(v) => onForm({ [k]: v })} />
              ))}
              <div className="tc" style={{ marginBottom: 12 }}>
                {ISSUES.map((i) => (
                  <button key={i} className={`chip ${f.issues.includes(i) ? "on" : ""}`}
                    onClick={() => onForm({ issues: f.issues.includes(i) ? f.issues.filter((x) => x !== i) : [...f.issues, i] })}>{i}</button>
                ))}
              </div>
            </div>
          )}
          <div className="f" style={{ marginTop: 10 }}>
            <label>Notes</label>
            <textarea value={f.notes} onChange={(e) => onForm({ notes: e.target.value })} placeholder="First impressions…" />
          </div>

          {it.error && <div className="status-banner error" style={{ marginTop: 12 }}>{it.error}</div>}
          {it.showMissing && missing.length > 0 && <p className="need-msg">Still needed: {missing.join(", ")}</p>}

          <div className="ar">
            <button className="ab2 pri" onClick={onSave} disabled={it.status === "saving"}>
              {it.status === "saving" ? "Saving…" : "Save this brew"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── New bean ──────────────────────────────────────────────────────────────────
function NewBeanForm({ timemoreBean, onCreated, notify }) {
  const tb = timemoreBean || {};
  const [b, setB] = useState({
    name: tb.name || "",
    roaster: "",
    origin: tb.origin || "",
    process: matchOption(tb.process, PROCESSES) || tb.process || "",
    roastLevel: matchOption(tb.roast, ROAST_LEVELS),
    roastDate: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setB((prev) => ({ ...prev, [k]: e.target.value }));

  const create = async () => {
    if (!b.name.trim()) return notify("Bean name is required", "err");
    setBusy(true);
    try {
      const r = await fetch("/notion-beans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      notify("Bean added to Notion", "ok");
      onCreated(d.item);
    } catch (err) { notify(err.message, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="subform">
      <div className="g2">
        <div className="f"><label>Name *</label><input value={b.name} onChange={set("name")} /></div>
        <div className="f"><label>Roaster</label><input value={b.roaster} onChange={set("roaster")} /></div>
        <div className="f"><label>Origin</label><input value={b.origin} onChange={set("origin")} /></div>
        <div className="f"><label>Process</label>
          <input list="process-options" value={b.process} onChange={set("process")} />
          <datalist id="process-options">{PROCESSES.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="f"><label>Roast level</label>
          <select value={b.roastLevel} onChange={set("roastLevel")}>
            <option value="">—</option>{ROAST_LEVELS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="f"><label>Roast date</label><input type="date" value={b.roastDate} onChange={set("roastDate")} /></div>
      </div>
      <button className="ab2 pri" style={{ marginTop: 12, width: "100%" }} onClick={create} disabled={busy}>{busy ? "Adding…" : "Add bean to Notion"}</button>
    </div>
  );
}

// ── New equipment ─────────────────────────────────────────────────────────────
function NewEquipmentForm({ type, onCreated, notify }) {
  const [e, setE] = useState({ name: "", brand: "", model: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => setE((prev) => ({ ...prev, [k]: ev.target.value }));

  const create = async () => {
    if (!e.name.trim()) return notify("Name is required", "err");
    setBusy(true);
    try {
      const r = await fetch("/notion-equipment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...e, type }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      notify(`${type} added to Notion`, "ok");
      onCreated(d.item);
    } catch (err) { notify(err.message, "err"); } finally { setBusy(false); }
  };

  return (
    <div className="subform">
      <div className="g3">
        <div className="f"><label>{type} name *</label><input value={e.name} onChange={set("name")} /></div>
        <div className="f"><label>Brand</label><input value={e.brand} onChange={set("brand")} /></div>
        <div className="f"><label>Model</label><input value={e.model} onChange={set("model")} /></div>
      </div>
      <button className="ab2 pri" style={{ marginTop: 12, width: "100%" }} onClick={create} disabled={busy}>{busy ? "Adding…" : `Add ${type.toLowerCase()} to Notion`}</button>
    </div>
  );
}

// ── Extra styles for the import view ──────────────────────────────────────────
const importCss = `
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:26px 16px;border:2px dashed #d4a574;border-radius:16px;background:#faf7f3;cursor:pointer;transition:all .18s;text-align:center}
.drop.over,.drop:hover{border-color:#8b5a2b;background:#fff}
.drop input{display:none}
.drop-big{font-family:'Playfair Display',serif;font-size:1.1rem;color:#2c1a0e}
.drop-small{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.06em;color:#8b6a4a}
.hint{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a;letter-spacing:.04em}
.tm-hint{font-family:'DM Mono',monospace;font-size:10px;color:#2e75d4;background:#e8f0fd;border-radius:8px;padding:6px 9px;margin-bottom:6px}
.linkbtn{background:none;border:none;padding:4px 0;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.06em;color:#8b5a2b;text-decoration:underline;cursor:pointer}
.row-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px}
.ct-right{display:flex;align-items:center;gap:8px}
.wid{font-family:'DM Mono',monospace;font-size:9px;color:#c4a882;text-transform:none;letter-spacing:.04em}
.x{background:none;border:none;color:#c4a882;font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
.x:hover{color:#c04a2e}
.f.need input,.f.need select{border-color:#e07a5f;background:#fdf0ee}
.f.need label{color:#c04a2e}
.need-msg{font-family:'DM Mono',monospace;font-size:10px;color:#c04a2e;margin-top:10px}
.subform{border:1.5px solid #e8ddd0;border-radius:14px;padding:14px;margin-top:10px;background:#faf7f3}
.inline-date{margin-left:6px;font-family:'DM Mono',monospace;font-size:10px;border:1px solid #e0d4c4;border-radius:6px;padding:2px 4px;background:#faf7f3;color:#2c1a0e}
.saved-card{opacity:.75}
.ab2:disabled{opacity:.5;cursor:not-allowed}
.status-banner a{color:inherit}
.method{display:inline-block;margin-right:8px;padding:2px 7px;border-radius:6px;background:#efe3d3;color:#8b5a2b;font-size:9px;letter-spacing:.08em}
.method.esp{background:#f6dcd4;color:#a0412a}
.notif{white-space:normal;max-width:90vw;text-align:center}
`;
