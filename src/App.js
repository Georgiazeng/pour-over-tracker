import { useState, useEffect, useRef } from "react";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@300;400&family=Lora:ital@0;1&display=swap');`;

const defaultRecipe = {
  name: "My Brew",
  coffee: 15, grindSize: 20.0, waterTemp: 93,
  notes: "", tastingNotes: [], roast: "Light",
  equipment: { brewTool: "", grinder: "", waterSource: "", tds: "", hardness: "", waterNotes: "" },
  bean: { origin: "", variety: "", altitude: "", process: "", roastDate: "", roaster: "", lot: "", descriptors: "", impression: "" },
  sensory: { overall: 0, balance: 0, clarity: 0, body: 0, aroma: 0, acidity: 0, sweetness: 0, bitterness: 0, aftertaste: 0, floral: 0, fruity: 0, teaLike: 0 },
  // Timemore brew data
  workId: "", pours: [], totalWater: 0, totalTime: 0, rawPoints: [],
};

const TASTING_OPTIONS = ["Floral","Fruity","Citrus","Berry","Stone Fruit","Nutty","Chocolatey","Caramel","Spicy","Earthy","Bright","Balanced","Smooth","Sweet","Complex"];
const ROASTS = ["Light","Light-Medium","Medium","Medium-Dark","Dark"];
const WATER_SOURCES = ["Filtered","Bottled","Third Wave Water","RO + Minerals","Tap","Other"];
const SENSORY_FIELDS = [
  ["overall","Overall"],["balance","Balance"],["clarity","Clarity"],["body","Body"],
  ["aroma","Aroma"],["acidity","Acidity"],["sweetness","Sweetness"],["bitterness","Bitterness"],
  ["aftertaste","Aftertaste"],["floral","Floral"],["fruity","Fruity"],["teaLike","Tea-like"],
];

function formatTime(s) {
  if (s == null || s === "") return "—";
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(0);
  return m > 0 ? `${m}:${sec.toString().padStart(2,"0")}` : `${s}s`;
}

// ── Weight Chart ──────────────────────────────────────────────────────────────
function WeightChart({ rawPoints, pours }) {
  if (!rawPoints || rawPoints.length === 0) return null;

  const W = 680, H = 220, PAD = { top: 16, right: 20, bottom: 36, left: 44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxMs = rawPoints[rawPoints.length - 1][0];
  const maxW = Math.max(...rawPoints.map(p => p[1])) * 1.05;

  const xScale = ms => (ms / maxMs) * chartW;
  const yScale = w => chartH - (w / maxW) * chartH;

  // Build SVG path
  const pathD = rawPoints.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${xScale(p[0]).toFixed(1)} ${yScale(p[1]).toFixed(1)}`
  ).join(" ");

  // X axis ticks every 30s
  const tickInterval = 30;
  const maxSec = maxMs / 1000;
  const ticks = [];
  for (let t = 0; t <= maxSec; t += tickInterval) ticks.push(t);

  const POUR_COLORS = ["#c4843a","#8b5a2b","#5a3a1a","#a07040","#7a5030"];

  return (
    <div style={{overflowX:"auto",marginBottom:4}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",maxWidth:W,display:"block"}}>
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {/* Pour band backgrounds */}
          {pours.map((p, i) => (
            <rect key={i}
              x={xScale(p.startSec * 1000).toFixed(1)}
              y={0} height={chartH}
              width={Math.max(1, xScale((p.endSec - p.startSec) * 1000)).toFixed(1)}
              fill={POUR_COLORS[i % POUR_COLORS.length]}
              opacity={0.08}/>
          ))}

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1={0} x2={chartW} y1={(f * chartH).toFixed(1)} y2={(f * chartH).toFixed(1)}
              stroke="#e8ddd0" strokeWidth={1} strokeDasharray={f === 1 || f === 0 ? "0" : "3,3"}/>
          ))}

          {/* Weight trace */}
          <path d={pathD} fill="none" stroke="#8b5a2b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>

          {/* Pour vertical markers */}
          {pours.map((p, i) => (
            <g key={i}>
              <line x1={xScale(p.startSec * 1000).toFixed(1)} x2={xScale(p.startSec * 1000).toFixed(1)}
                y1={0} y2={chartH} stroke={POUR_COLORS[i % POUR_COLORS.length]} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.7}/>
              <text x={xScale(p.startSec * 1000) + 3} y={12}
                style={{fontFamily:"'DM Mono',monospace",fontSize:9,fill:POUR_COLORS[i % POUR_COLORS.length]}}>
                {p.label}
              </text>
            </g>
          ))}

          {/* X axis */}
          <line x1={0} x2={chartW} y1={chartH} y2={chartH} stroke="#c4a882" strokeWidth={1}/>
          {ticks.map(t => (
            <g key={t}>
              <line x1={xScale(t * 1000).toFixed(1)} x2={xScale(t * 1000).toFixed(1)}
                y1={chartH} y2={chartH + 4} stroke="#c4a882" strokeWidth={1}/>
              <text x={xScale(t * 1000).toFixed(1)} y={chartH + 14}
                style={{fontFamily:"'DM Mono',monospace",fontSize:9,fill:"#8b6a4a",textAnchor:"middle"}}>
                {formatTime(t)}
              </text>
            </g>
          ))}

          {/* Y axis */}
          <line x1={0} x2={0} y1={0} y2={chartH} stroke="#c4a882" strokeWidth={1}/>
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <text key={f} x={-5} y={yScale(f * maxW) + 3}
              style={{fontFamily:"'DM Mono',monospace",fontSize:9,fill:"#8b6a4a",textAnchor:"end"}}>
              {Math.round(f * maxW)}
            </text>
          ))}

          {/* Axis labels */}
          <text x={chartW / 2} y={chartH + 30}
            style={{fontFamily:"'DM Mono',monospace",fontSize:9,fill:"#8b6a4a",textAnchor:"middle",letterSpacing:".1em",textTransform:"uppercase"}}>
            Time
          </text>
          <text transform={`translate(-34,${chartH/2}) rotate(-90)`}
            style={{fontFamily:"'DM Mono',monospace",fontSize:9,fill:"#8b6a4a",textAnchor:"middle",letterSpacing:".1em"}}>
            Weight (g)
          </text>
        </g>
      </svg>
    </div>
  );
}

// ── Score Slider ──────────────────────────────────────────────────────────────
function ScoreSlider({ label, value, onChange }) {
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"#8b6a4a"}}>{label}</span>
        <span style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:"#2c1a0e"}}>{value||"—"}</span>
      </div>
      <div style={{position:"relative",height:6,borderRadius:3,background:"#e8ddd0"}}>
        <div style={{position:"absolute",left:0,top:0,height:"100%",borderRadius:3,background:"linear-gradient(90deg,#d4a574,#8b5a2b)",width:`${(value/10)*100}%`,transition:"width .15s"}}/>
        <input type="range" min={0} max={10} step={1} value={value} onChange={e=>onChange(Number(e.target.value))}
          style={{position:"absolute",inset:0,width:"100%",opacity:0,cursor:"pointer",height:"100%"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#c4a882"}}>0</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#c4a882"}}>10</span>
      </div>
    </div>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const css = `
${FONTS}
*{box-sizing:border-box;margin:0;padding:0}
.app{min-height:100vh;background:#f5efe6;font-family:'Lora',serif;color:#2c1a0e;position:relative;overflow-x:hidden}
.grain{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.35;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E")}
.ring{position:fixed;border-radius:50%;pointer-events:none;border:1px solid rgba(139,90,43,.07)}
.r1{width:560px;height:560px;top:-180px;right:-140px}.r2{width:380px;height:380px;bottom:-140px;left:-90px}
.wrap{max-width:760px;margin:0 auto;padding:28px 18px 72px;position:relative;z-index:1}
.hdr{text-align:center;margin-bottom:32px}
.eyebrow{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.25em;color:#8b5a2b;text-transform:uppercase;margin-bottom:8px}
h1{font-family:'Playfair Display',serif;font-size:2.3rem;font-weight:400;color:#1a0d00;line-height:1.1}
h1 em{font-style:italic;color:#8b5a2b}
.ni{font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:600;color:#1a0d00;background:transparent;border:none;border-bottom:2px solid #d4a574;text-align:center;width:100%;outline:none;padding:4px 8px;margin-bottom:4px;transition:border-color .2s}
.ni:focus{border-color:#8b5a2b}.ni::placeholder{color:#c4a882}
.tabs{display:flex;gap:3px;background:#e8ddd0;border-radius:12px;padding:4px;margin-bottom:26px}
.tab{flex:1;padding:8px 2px;border:none;background:transparent;border-radius:9px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.04em;color:#8b6a4a;cursor:pointer;transition:all .18s;text-transform:uppercase;white-space:nowrap}
.tab.on{background:#fff;color:#2c1a0e;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.card{background:#fffdf9;border-radius:20px;padding:20px;box-shadow:0 2px 20px rgba(44,26,14,.06),0 0 0 1px rgba(212,165,116,.2);margin-bottom:14px}
.ct{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8b5a2b;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
.ct-btn{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:5px 11px;border-radius:8px;border:1.5px solid #b8d0f0;background:#e8f0fd;color:#2e75d4;cursor:pointer;transition:all .15s}
.ct-btn:hover{background:#dce8fb}.ct-btn:disabled{opacity:.5;cursor:default}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:11px}
.f label{display:block;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.15em;color:#8b6a4a;text-transform:uppercase;margin-bottom:5px}
.f input,.f select{width:100%;padding:9px 11px;border:1.5px solid #e0d4c4;border-radius:10px;font-family:'Lora',serif;font-size:15px;color:#2c1a0e;background:#faf7f3;outline:none;transition:border-color .18s;-webkit-appearance:none;appearance:none}
.f input:focus,.f select:focus{border-color:#8b5a2b;background:#fff}
.f textarea{width:100%;padding:10px 12px;border:1.5px solid #e0d4c4;border-radius:10px;font-family:'Lora',serif;font-size:14px;color:#2c1a0e;background:#faf7f3;outline:none;resize:vertical;min-height:80px;transition:border-color .18s}
.f textarea:focus{border-color:#8b5a2b}
.stats{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.stat{flex:1;min-width:60px;background:linear-gradient(135deg,#f0e8dc,#e8ddd0);border-radius:14px;padding:12px 8px;text-align:center}
.sv{font-family:'Playfair Display',serif;font-size:1.1rem;color:#2c1a0e}
.sl{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.12em;color:#8b6a4a;text-transform:uppercase;margin-top:2px}
.tc{display:flex;flex-wrap:wrap;gap:7px}
.chip{padding:6px 12px;border-radius:20px;border:1.5px solid #e0d4c4;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;cursor:pointer;transition:all .15s;background:#faf7f3;color:#8b6a4a;text-transform:uppercase}
.chip.on{background:#2c1a0e;border-color:#2c1a0e;color:#f5efe6}
.ar{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
.ab2{flex:1;min-width:80px;padding:12px;border-radius:12px;border:1.5px solid #e0d4c4;background:#faf7f3;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#2c1a0e;cursor:pointer;transition:all .18s;text-align:center}
.ab2:hover{border-color:#8b5a2b;background:#fff}
.ab2.pri{background:#2c1a0e;color:#f5efe6;border-color:#2c1a0e}.ab2.pri:hover{background:#3d2510}
.ab2.notion{background:#2e75d4;color:#fff;border-color:#2e75d4}.ab2.notion:hover{background:#1a5fb4}
.ab2.notion:disabled{background:#a0b8d8;border-color:#a0b8d8;cursor:not-allowed}
.ab2.export{background:#5a8a5a;color:#fff;border-color:#5a8a5a}.ab2.export:hover{background:#4a7a4a}
.ab2.clr{background:#faf0ee;color:#c04a2e;border-color:#e8c4bc}.ab2.clr:hover{background:#f5e0da;border-color:#c04a2e}
.saved-l{display:flex;flex-direction:column;gap:9px}
.saved-i{display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:14px;border:1.5px solid #e0d4c4;background:#faf7f3;cursor:pointer;transition:all .18s}
.saved-i:hover{border-color:#8b5a2b;background:#fff}
.saved-n{font-family:'Lora',serif;font-size:15px;color:#2c1a0e;flex:1}
.saved-m{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a}
.saved-d{background:none;border:none;color:#c4a882;cursor:pointer;font-size:15px;padding:4px;transition:color .15s}
.saved-d:hover{color:#e07a5f}
.notif{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#2c1a0e;color:#f5efe6;padding:10px 22px;border-radius:20px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;opacity:0;transition:opacity .3s;pointer-events:none;z-index:100;white-space:nowrap}
.notif.show{opacity:1}.notif.err{background:#c0392b}.notif.ok{background:#27ae60}
.empty{text-align:center;padding:36px 20px;color:#c4a882;font-family:'Lora',serif;font-style:italic}
.divider{height:1px;background:linear-gradient(90deg,transparent,#e0d4c4,transparent);margin:16px 0}
.notion-banner{background:linear-gradient(135deg,#e8f0fd,#dce8fb);border:1.5px solid #b8d0f0;border-radius:14px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:flex-start;gap:12px}
.notion-dot{width:10px;height:10px;border-radius:50%;background:#2e75d4;flex-shrink:0;margin-top:2px}
.notion-txt{font-family:'DM Mono',monospace;font-size:10px;color:#1a3a6a;letter-spacing:.06em;line-height:1.7}
.notion-picker{border:1.5px solid #b8d0f0;border-radius:12px;overflow:hidden;margin-bottom:16px}
.notion-picker-hdr{background:#e8f0fd;padding:8px 12px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:#2e75d4}
.notion-item{padding:10px 14px;cursor:pointer;transition:all .15s;border-bottom:1px solid #f0f5ff}
.notion-item:last-child{border-bottom:none}
.notion-item:hover{background:#f0f5ff}
.notion-item.selected{background:#e8f0fd}
.notion-item-name{font-family:'Lora',serif;font-size:14px;color:#2c1a0e}
.notion-item-meta{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a;margin-top:2px}

/* ── Brew / Timemore tab ── */
.wid-input-row{display:flex;gap:10px;align-items:flex-end;margin-bottom:0}
.wid-input-row .f{flex:1;margin-bottom:0}
.fetch-btn{padding:10px 18px;border-radius:10px;border:none;background:#2c1a0e;color:#f5efe6;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .18s;white-space:nowrap;align-self:flex-end}
.fetch-btn:hover{background:#3d2510}.fetch-btn:disabled{background:#c4a882;cursor:not-allowed}
.pour-table{width:100%;border-collapse:collapse}
.pour-table th{font-family:'DM Mono',monospace;font-size:9px;color:#8b6a4a;text-transform:uppercase;letter-spacing:.08em;padding:5px 8px;text-align:center;border-bottom:1.5px solid #e8ddd0}
.pour-table th:first-child{text-align:left}
.pour-table td{font-family:'DM Mono',monospace;font-size:11px;color:#2c1a0e;padding:7px 8px;text-align:center;border-bottom:1px solid #f5efe6}
.pour-table td:first-child{font-family:'Lora',serif;font-size:12px;text-align:left;font-weight:600}
.pour-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.06em;text-transform:uppercase}
.status-banner{border-radius:12px;padding:11px 14px;margin-bottom:12px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.06em}
.status-banner.loading{background:#fdf5e8;border:1.5px solid #e8c87a;color:#7a5a0a}
.status-banner.success{background:#edf8ed;border:1.5px solid #7ac87a;color:#1a5a1a}
.status-banner.error{background:#fdf0ee;border:1.5px solid #e8a0a0;color:#7a1a1a}
.brew-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
@media(max-width:480px){.brew-summary-grid{grid-template-columns:1fr 1fr}.g4{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1fr 1fr}}
`;

export default function BrewTracker() {
  const [recipe, setRecipe] = useState(defaultRecipe);
  const [savedRecipes, setSavedRecipes] = useState([]);
  const [tab, setTab] = useState("brew");
  const [notionBeans, setNotionBeans] = useState([]);
  const [notionEquipment, setNotionEquipment] = useState([]);
  const [fetchingBeans, setFetchingBeans] = useState(false);
  const [fetchingEquip, setFetchingEquip] = useState(false);
  const [selectedBeanId, setSelectedBeanId] = useState(null);
  const [selectedEquipId, setSelectedEquipId] = useState(null);
  const [showSaved, setShowSaved] = useState(false);
  const [notif, setNotif] = useState({ msg: "", type: "" });
  const [syncing, setSyncing] = useState(false);

  // Timemore fetch state
  const [workIdInput, setWorkIdInput] = useState("");
  const [fetchingTimemore, setFetchingTimemore] = useState(false);
  const [timemoreStatus, setTimemoreStatus] = useState(null); // {type:'loading'|'success'|'error', msg}

  useEffect(() => {
    try { const r = localStorage.getItem("brew-tracker-recipes"); if (r) setSavedRecipes(JSON.parse(r)); } catch {}
  }, []);

  const notify = (msg, type = "") => { setNotif({ msg, type }); setTimeout(() => setNotif({ msg:"", type:"" }), 3200); };

  // ── Timemore fetch ─────────────────────────────────────────────────────────
  const fetchTimemore = async () => {
    const wid = workIdInput.trim();
    if (!wid || !/^\d+$/.test(wid)) { notify("Enter a numeric Work ID", "err"); return; }
    setFetchingTimemore(true);
    setTimemoreStatus({ type: "loading", msg: `Fetching work ${wid}…` });
    try {
      const res = await fetch(`/timemore/${wid}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setTimemoreStatus({ type: "error", msg: data.error || "Fetch failed" });
        notify("Timemore fetch failed", "err");
        return;
      }
      setRecipe(r => ({
        ...r,
        workId: wid,
        pours: data.pours,
        totalWater: data.totalWater,
        totalTime: data.totalTime,
        rawPoints: data.rawPoints,
        // Auto-set name if still default
        name: r.name === "My Brew" ? `Brew #${wid}` : r.name,
      }));
      setTimemoreStatus({
        type: "success",
        msg: `Loaded — ${data.pours.length} pours · ${data.totalWater}g · ${formatTime(data.totalTime)}`,
      });
      notify(`Work ${wid} loaded`, "ok");
    } catch (err) {
      setTimemoreStatus({ type: "error", msg: "Cannot reach server" });
      notify("Cannot reach server", "err");
    }
    setFetchingTimemore(false);
  };

  // ── Notion ─────────────────────────────────────────────────────────────────
  const fetchNotionBeans = async () => {
    setFetchingBeans(true);
    try { const res = await fetch("/notion-beans"); const data = await res.json(); if (data.items) setNotionBeans(data.items); else notify("Could not load beans","err"); }
    catch { notify("Cannot reach server","err"); }
    setFetchingBeans(false);
  };

  const fetchNotionEquipment = async () => {
    setFetchingEquip(true);
    try { const res = await fetch("/notion-equipment"); const data = await res.json(); if (data.items) setNotionEquipment(data.items); else notify("Could not load equipment","err"); }
    catch { notify("Cannot reach server","err"); }
    setFetchingEquip(false);
  };

  const applyNotionBean = (item) => {
    setSelectedBeanId(item.id);
    setRecipe(r => ({ ...r, roast: item.roastLevel||r.roast, bean: { ...r.bean, origin:item.origin||"", variety:item.variety||"", altitude:item.altitude||"", process:item.process||"", roastDate:item.roastDate||"", roaster:item.roaster||"", descriptors:item.notes||"", _notionId:item.id } }));
    notify(`Loaded: ${item.name}`);
  };

  const applyNotionEquip = (item) => {
    setSelectedEquipId(item.id);
    const isBrewer = /brewer/i.test(item.type), isGrinder = /grinder/i.test(item.type);
    setRecipe(r => ({ ...r, equipment: { ...r.equipment, ...(isBrewer?{brewTool:item.name,_brewerNotionId:item.id}:{}), ...(isGrinder?{grinder:item.name,_grinderNotionId:item.id}:{}) } }));
    notify(`Loaded: ${item.name}`);
  };

  // ── State helpers ──────────────────────────────────────────────────────────
  const up = (f,v) => setRecipe(r=>({...r,[f]:v}));
  const upEquip = (f,v) => setRecipe(r=>({...r,equipment:{...r.equipment,[f]:v}}));
  const upBean = (f,v) => setRecipe(r=>({...r,bean:{...r.bean,[f]:v}}));
  const upSensory = (f,v) => setRecipe(r=>({...r,sensory:{...r.sensory,[f]:v}}));
  const toggleTaste = (t) => setRecipe(r=>({...r,tastingNotes:r.tastingNotes.includes(t)?r.tastingNotes.filter(n=>n!==t):[...r.tastingNotes,t]}));

  const clearNotes = () => setRecipe(r=>({...r, notes:"", tastingNotes:[], sensory:Object.fromEntries(Object.keys(r.sensory).map(k=>[k,0]))}));
  const clearBean = () => setRecipe(r=>({...r, roast:"Light", bean:{origin:"",variety:"",altitude:"",process:"",roastDate:"",roaster:"",lot:"",descriptors:"",impression:""}}));
  const clearEquipment = () => setRecipe(r=>({...r, equipment:{brewTool:"",grinder:"",waterSource:"",tds:"",hardness:"",waterNotes:""}}));
  const clearBrewData = () => { setRecipe(r=>({...r, workId:"", pours:[], totalWater:0, totalTime:0, rawPoints:[]})); setWorkIdInput(""); setTimemoreStatus(null); };

  const saveRecipe = () => {
    const rec={...recipe,id:recipe.id||Date.now()};
    const upd=[rec,...savedRecipes.filter(r=>r.id!==rec.id)].slice(0,30);
    setSavedRecipes(upd); setRecipe(rec);
    try{localStorage.setItem("brew-tracker-recipes",JSON.stringify(upd));}catch{}
    notify("Saved!");
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(savedRecipes,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `brew-log-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url); notify("Exported!");
  };

  const loadRecipe = (r) => { setRecipe(r); setShowSaved(false); setTab("brew"); notify(`Loaded "${r.name}"`); };
  const deleteRecipe = (id) => { const u=savedRecipes.filter(r=>r.id!==id); setSavedRecipes(u); try{localStorage.setItem("brew-tracker-recipes",JSON.stringify(u));}catch{}; };

  const syncToNotion = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(recipe)});
      const data = await res.json();
      if (data.success) notify(`✓ Synced — ${data.sessionId}`,"ok"); else notify(`Notion: ${data.error}`,"err");
    } catch { notify("Cannot reach server","err"); }
    setSyncing(false);
  };

  const ratio = recipe.coffee > 0 && recipe.totalWater > 0 ? (recipe.totalWater / recipe.coffee).toFixed(1) : "—";
  const POUR_COLORS = ["#c4843a","#8b5a2b","#5a3a1a","#a07040","#7a5030"];

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="grain"/><div className="ring r1"/><div className="ring r2"/>
        <div className="wrap">
          <div className="hdr">
            <div className="eyebrow">Brew Journal</div>
            <h1>Coffee <em>Tracker</em></h1>
          </div>
          <input className="ni" value={recipe.name} onChange={e=>up("name",e.target.value)} placeholder="Session name…"/>
          <div style={{height:18}}/>

          <div className="tabs">
            {[["brew","☕ Brew"],["params","⚗️ Params"],["equipment","🔧 Equip"],["bean","🌱 Bean"],["notes","📓 Notes"]].map(([k,l])=>(
              <button key={k} className={`tab ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {/* ── BREW TAB ── */}
          {tab==="brew"&&<>
            {/* Work ID fetch */}
            <div className="card">
              <div className="ct"><span>Timemore Work ID</span></div>
              <div className="wid-input-row">
                <div className="f">
                  <label>Work ID</label>
                  <input type="text" inputMode="numeric" value={workIdInput}
                    onChange={e=>setWorkIdInput(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&fetchTimemore()}
                    placeholder="e.g. 218583"/>
                </div>
                <button className="fetch-btn" onClick={fetchTimemore} disabled={fetchingTimemore}>
                  {fetchingTimemore?"Loading…":"Fetch →"}
                </button>
              </div>
              <p style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#c4a882",marginTop:8,letterSpacing:".06em"}}>
                Find the Work ID in your Timemore app share link: bm.timemore.com/v4/share/<strong>XXXXXX</strong>
              </p>
            </div>

            {timemoreStatus&&(
              <div className={`status-banner ${timemoreStatus.type}`}>{timemoreStatus.msg}</div>
            )}

            {/* Pour chart */}
            {recipe.rawPoints?.length > 0 && (
              <div className="card">
                <div className="ct">
                  <span>Weight Trace</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#8b6a4a"}}>Work #{recipe.workId}</span>
                </div>
                <WeightChart rawPoints={recipe.rawPoints} pours={recipe.pours}/>
              </div>
            )}

            {/* Brew summary stats */}
            {recipe.pours?.length > 0 && <>
              <div className="brew-summary-grid">
                {[
                  [recipe.pours.length, "Pours"],
                  [`${recipe.totalWater}g`, "Total Water"],
                  [`1:${ratio}`, "Ratio"],
                  [formatTime(recipe.totalTime), "Brew Time"],
                ].map(([v,l])=>(
                  <div className="stat" key={l}><div className="sv">{v}</div><div className="sl">{l}</div></div>
                ))}
              </div>

              {/* Pour summary table */}
              <div className="card">
                <div className="ct"><span>Pour Breakdown</span></div>
                <div style={{overflowX:"auto"}}>
                  <table className="pour-table">
                    <thead>
                      <tr>
                        <th>Stage</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Duration</th>
                        <th>Volume</th>
                        <th>Cumul.</th>
                        <th>Avg Speed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.pours.map((p, i) => (
                        <tr key={i}>
                          <td>
                            <span className="pour-badge" style={{background:POUR_COLORS[i%POUR_COLORS.length]+"22",color:POUR_COLORS[i%POUR_COLORS.length]}}>
                              {p.label}
                            </span>
                          </td>
                          <td>{formatTime(p.startSec)}</td>
                          <td>{formatTime(p.endSec)}</td>
                          <td>{p.durationSec}s</td>
                          <td>{p.volume}g</td>
                          <td>{p.cumulativeWater}g</td>
                          <td>{p.avgSpeedGps} g/s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ar">
                <button className="ab2 clr" onClick={clearBrewData}>✕ Clear Brew</button>
                <button className="ab2 pri" onClick={saveRecipe}>Save Session</button>
                <button className="ab2 notion" onClick={syncToNotion} disabled={syncing}>{syncing?"Syncing…":"⬆ Sync to Notion"}</button>
              </div>
            </>}

            {recipe.pours?.length === 0 && !timemoreStatus && (
              <div className="empty">Enter a Work ID and tap Fetch to load your brew data</div>
            )}

            {/* Saved sessions */}
            <div style={{marginTop:14}}>
              <button className="ab2" onClick={()=>setShowSaved(s=>!s)} style={{width:"100%"}}>
                📂 {showSaved?"Hide":"Browse"} Saved Sessions ({savedRecipes.length})
              </button>
            </div>
            {showSaved&&<div className="card" style={{marginTop:10}}>
              <div className="ct"><span>Saved Sessions</span><button className="ct-btn" onClick={exportJSON}>⬇ Export</button></div>
              {savedRecipes.length===0?<div className="empty">No saved sessions yet</div>:(
                <div className="saved-l">
                  {savedRecipes.map(r=>(
                    <div className="saved-i" key={r.id} onClick={()=>loadRecipe(r)}>
                      <div style={{flex:1}}>
                        <div className="saved-n">{r.name}</div>
                        <div className="saved-m">
                          {[r.coffee&&`${r.coffee}g`, r.totalWater&&`→${r.totalWater}g`, r.pours?.length&&`${r.pours.length} pours`, r.workId&&`#${r.workId}`].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <button className="saved-d" onClick={e=>{e.stopPropagation();deleteRecipe(r.id);}}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </div>}
          </>}

          {/* ── PARAMS TAB ── */}
          {tab==="params"&&<>
            <div className="stats">
              {[[`${recipe.coffee}g`,"Coffee"],[`${recipe.totalWater||"?"}g`,"Water"],[`1:${ratio}`,"Ratio"],[`${recipe.waterTemp}°C`,"Temp"],[`${recipe.grindSize}`,"Grind"]].map(([v,l])=>(
                <div className="stat" key={l}><div className="sv">{v}</div><div className="sl">{l}</div></div>
              ))}
            </div>
            <div className="card">
              <div className="ct"><span>Brew Parameters</span></div>
              <div className="g4" style={{marginBottom:0}}>
                <div className="f"><label>Coffee (g)</label><input type="number" value={recipe.coffee} onChange={e=>up("coffee",Number(e.target.value))}/></div>
                <div className="f"><label>Temp (°C)</label><input type="number" value={recipe.waterTemp} onChange={e=>up("waterTemp",Number(e.target.value))}/></div>
                <div className="f"><label>Grind Size</label><input type="number" step="0.1" min="1" max="50" value={recipe.grindSize} onChange={e=>up("grindSize",parseFloat(parseFloat(e.target.value).toFixed(1)))}/></div>
                <div className="f"><label>Roast</label><select value={recipe.roast} onChange={e=>up("roast",e.target.value)}>{ROASTS.map(r=><option key={r}>{r}</option>)}</select></div>
              </div>
            </div>
            <div className="ar">
              <button className="ab2 clr" onClick={()=>{setRecipe({...defaultRecipe,id:undefined});notify("Cleared!");}}>✕ Clear</button>
              <button className="ab2 pri" onClick={saveRecipe}>Save</button>
            </div>
          </>}

          {/* ── EQUIPMENT TAB ── */}
          {tab==="equipment"&&<>
            <div className="card">
              <div className="ct"><span>From Notion</span><button className="ct-btn" onClick={fetchNotionEquipment} disabled={fetchingEquip}>{fetchingEquip?"Loading…":"⬇ Load Equipment"}</button></div>
              {notionEquipment.length>0&&<div className="notion-picker">
                <div className="notion-picker-hdr">Select to pre-fill — still editable after</div>
                {notionEquipment.map(item=>(
                  <div key={item.id} className={`notion-item ${selectedEquipId===item.id?"selected":""}`} onClick={()=>applyNotionEquip(item)}>
                    <div className="notion-item-name">{item.name}</div>
                    <div className="notion-item-meta">{[item.type,item.model,item.brand].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>}
              {notionEquipment.length===0&&<p style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#c4a882",marginBottom:4}}>Load from Notion to pre-fill, or type below.</p>}
            </div>
            <div className="card">
              <div className="ct"><span>Brew Setup</span></div>
              <div className="g2" style={{marginBottom:14}}>
                <div className="f"><label>Brew Tool</label><input type="text" value={recipe.equipment?.brewTool||""} onChange={e=>upEquip("brewTool",e.target.value)} placeholder="V60, Chemex…"/></div>
                <div className="f"><label>Grinder</label><input type="text" value={recipe.equipment?.grinder||""} onChange={e=>upEquip("grinder",e.target.value)} placeholder="Comandante…"/></div>
              </div>
              <div className="f"><label>Water Source</label>
                <select value={recipe.equipment?.waterSource||""} onChange={e=>upEquip("waterSource",e.target.value)}>
                  <option value="">Select…</option>{WATER_SOURCES.map(w=><option key={w}>{w}</option>)}
                </select>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Water Details</span></div>
              <div className="g3">
                <div className="f"><label>TDS (ppm)</label><input type="number" value={recipe.equipment?.tds||""} onChange={e=>upEquip("tds",e.target.value)} placeholder="150"/></div>
                <div className="f"><label>Hardness</label><input type="text" value={recipe.equipment?.hardness||""} onChange={e=>upEquip("hardness",e.target.value)} placeholder="Soft / Medium…"/></div>
                <div className="f"><label>Notes</label><input type="text" value={recipe.equipment?.waterNotes||""} onChange={e=>upEquip("waterNotes",e.target.value)} placeholder="Volvic blend…"/></div>
              </div>
            </div>
            <div className="ar"><button className="ab2 clr" onClick={clearEquipment}>✕ Clear</button><button className="ab2 pri" onClick={saveRecipe}>Save Equipment</button></div>
          </>}

          {/* ── BEAN TAB ── */}
          {tab==="bean"&&<>
            <div className="card">
              <div className="ct"><span>Current Beans</span><button className="ct-btn" onClick={fetchNotionBeans} disabled={fetchingBeans}>{fetchingBeans?"Loading…":"⬇ Load Beans"}</button></div>
              {notionBeans.length>0&&<div className="notion-picker">
                <div className="notion-picker-hdr">Showing beans with Status = Using</div>
                {notionBeans.map(item=>(
                  <div key={item.id} className={`notion-item ${selectedBeanId===item.id?"selected":""}`} onClick={()=>applyNotionBean(item)}>
                    <div className="notion-item-name">{item.name}</div>
                    <div className="notion-item-meta">{[item.origin,item.variety,item.roastLevel,item.roaster].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>}
              {notionBeans.length===0&&<p style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#c4a882",marginBottom:4}}>Load to show beans marked "Using" in Notion, or type below.</p>}
            </div>
            <div className="card">
              <div className="ct"><span>Coffee Bean</span></div>
              <div className="g2" style={{marginBottom:13}}>
                <div className="f"><label>Origin / Farm</label><input type="text" value={recipe.bean?.origin||""} onChange={e=>upBean("origin",e.target.value)} placeholder="Ethiopia, Yirgacheffe…"/></div>
                <div className="f"><label>Variety</label><input type="text" value={recipe.bean?.variety||""} onChange={e=>upBean("variety",e.target.value)} placeholder="Heirloom, Gesha…"/></div>
              </div>
              <div className="g3">
                <div className="f"><label>Altitude (masl)</label><input type="number" value={recipe.bean?.altitude||""} onChange={e=>upBean("altitude",e.target.value)} placeholder="1800"/></div>
                <div className="f"><label>Process</label><input type="text" value={recipe.bean?.process||""} onChange={e=>upBean("process",e.target.value)} placeholder="Washed, Natural…"/></div>
                <div className="f"><label>Roast Date</label><input type="date" value={recipe.bean?.roastDate||""} onChange={e=>upBean("roastDate",e.target.value)}/></div>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Roaster Info</span></div>
              <div className="g2">
                <div className="f"><label>Roaster</label><input type="text" value={recipe.bean?.roaster||""} onChange={e=>upBean("roaster",e.target.value)} placeholder="Square Mile, Onyx…"/></div>
                <div className="f"><label>Lot / Batch</label><input type="text" value={recipe.bean?.lot||""} onChange={e=>upBean("lot",e.target.value)} placeholder="Lot #123…"/></div>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Tasting Notes</span></div>
              <div className="f" style={{marginBottom:10}}><label>Roaster's Notes</label><input type="text" value={recipe.bean?.descriptors||""} onChange={e=>upBean("descriptors",e.target.value)} placeholder="Jasmine, peach, brown sugar…"/></div>
              <div className="f"><label>Your First Impression</label><textarea value={recipe.bean?.impression||""} onChange={e=>upBean("impression",e.target.value)} placeholder="What do you smell, taste, feel?…"/></div>
            </div>
            <div className="ar"><button className="ab2 clr" onClick={clearBean}>✕ Clear</button><button className="ab2 pri" onClick={saveRecipe}>Save Bean Info</button></div>
          </>}

          {/* ── NOTES TAB ── */}
          {tab==="notes"&&<>
            <div className="card">
              <div className="ct"><span>Tasting Notes</span></div>
              <div className="tc">{TASTING_OPTIONS.map(t=><button key={t} className={`chip ${recipe.tastingNotes.includes(t)?"on":""}`} onClick={()=>toggleTaste(t)}>{t}</button>)}</div>
            </div>
            <div className="card">
              <div className="ct"><span>Sensory Evaluation</span></div>
              <div className="g3">
                <div>{SENSORY_FIELDS.slice(0,4).map(([k,l])=><ScoreSlider key={k} label={l} value={recipe.sensory?.[k]||0} onChange={v=>upSensory(k,v)}/>)}</div>
                <div>{SENSORY_FIELDS.slice(4,8).map(([k,l])=><ScoreSlider key={k} label={l} value={recipe.sensory?.[k]||0} onChange={v=>upSensory(k,v)}/>)}</div>
                <div>{SENSORY_FIELDS.slice(8).map(([k,l])=><ScoreSlider key={k} label={l} value={recipe.sensory?.[k]||0} onChange={v=>upSensory(k,v)}/>)}</div>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Brew Notes</span></div>
              <div className="f"><textarea value={recipe.notes} onChange={e=>up("notes",e.target.value)} placeholder="How did it taste? What would you change?…"/></div>
            </div>
            {recipe.tastingNotes.length>0&&<div className="card">
              <div className="ct"><span>Flavour Profile</span></div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {recipe.tastingNotes.map(t=><span key={t} style={{background:"#2c1a0e",color:"#f5efe6",borderRadius:20,padding:"5px 12px",fontFamily:"'DM Mono',monospace",fontSize:10,textTransform:"uppercase"}}>{t}</span>)}
              </div>
            </div>}
            <div className="notion-banner">
              <div className="notion-dot"/>
              <div className="notion-txt"><strong>Sync to Notion</strong> saves the full session including Timemore pour data.<br/>Fetch your brew from Timemore first, then fill in bean &amp; sensory details.</div>
            </div>
            <div className="ar">
              <button className="ab2 clr" onClick={clearNotes}>✕ Clear Notes</button>
              <button className="ab2 pri" onClick={saveRecipe}>Save</button>
              <button className="ab2 notion" onClick={syncToNotion} disabled={syncing}>{syncing?"Syncing…":"⬆ Sync to Notion"}</button>
            </div>
          </>}
        </div>
        <div className={`notif ${notif.msg?"show":""} ${notif.type}`}>{notif.msg}</div>
      </div>
    </>
  );
}
