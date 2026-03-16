import { useState, useEffect, useRef } from "react";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@300;400&family=Lora:ital@0;1&display=swap');`;

const defaultRecipe = {
  name: "My Pour Over", coffee: 14, grindSize: 20.0, waterTemp: 93,
  pours: [
    { label: "Bloom",    targetWater: 40,  startTime: 0,  duration: 30, stirMethod: "None" },
    { label: "1st Pour", targetWater: 105, startTime: 45, duration: 45, stirMethod: "Swirl" },
    { label: "2nd Pour", targetWater: 210, startTime: 105, duration: 45, stirMethod: "None" },
  ],
  notes: "", tastingNotes: [], roast: "Light",
  equipment: { brewTool: "", grinder: "", waterSource: "", tds: "", hardness: "", waterNotes: "" },
  bean: { origin: "", variety: "", altitude: "", process: "", roastDate: "", roaster: "", lot: "", descriptors: "", impression: "" },
  sensory: { overall: 0, balance: 0, clarity: 0, body: 0, aroma: 0, acidity: 0, sweetness: 0, bitterness: 0, aftertaste: 0, floral: 0, fruity: 0, teaLike: 0 },
};

const TASTING_OPTIONS = ["Floral","Fruity","Citrus","Berry","Stone Fruit","Nutty","Chocolatey","Caramel","Spicy","Earthy","Bright","Balanced","Smooth","Sweet","Complex"];
const ROASTS = ["Light","Light-Medium","Medium","Medium-Dark","Dark"];
const STIR_METHODS = ["None","Swirl","Stir","Rao Spin","Gentle Tap"];
const WATER_SOURCES = ["Filtered","Bottled","Third Wave Water","RO + Minerals","Tap","Other"];
const SENSORY_FIELDS = [
  ["overall","Overall Score"],["balance","Balance"],["clarity","Clarity"],
  ["body","Body"],["aroma","Aroma"],["acidity","Acidity"],
  ["sweetness","Sweetness"],["bitterness","Bitterness"],["aftertaste","Aftertaste"],
  ["floral","Floral"],["fruity","Fruity"],["teaLike","Tea-like"],
];

function formatTime(s) {
  if (s == null || s === "") return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2,"0")}` : `${s}s`;
}

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
.ph{display:grid;grid-template-columns:1fr 80px 80px 80px 100px 32px;gap:6px;margin-bottom:6px;align-items:center}
.plbl{font-family:'DM Mono',monospace;font-size:9px;color:#8b6a4a;text-transform:uppercase;letter-spacing:.08em;text-align:center}
.pr{display:grid;grid-template-columns:1fr 80px 80px 80px 100px 32px;gap:6px;align-items:center;margin-bottom:9px}
.pr input{padding:8px 6px;border:1.5px solid #e0d4c4;border-radius:9px;font-family:'Lora',serif;font-size:13px;color:#2c1a0e;background:#faf7f3;outline:none;width:100%;transition:border-color .18s;text-align:center}
.pr input:focus{border-color:#8b5a2b;background:#fff}
.pr select{padding:8px 5px;border:1.5px solid #e0d4c4;border-radius:9px;font-family:'Lora',serif;font-size:12px;color:#2c1a0e;background:#faf7f3;outline:none;width:100%;-webkit-appearance:none;appearance:none}
.db{background:none;border:1.5px solid #e8d4bc;border-radius:8px;width:32px;height:32px;color:#c4a882;cursor:pointer;font-size:15px;transition:all .15s;display:flex;align-items:center;justify-content:center}
.db:hover{border-color:#e07a5f;color:#e07a5f}
.ab{width:100%;padding:10px;border:2px dashed #d4b896;border-radius:12px;background:transparent;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;color:#8b6a4a;cursor:pointer;transition:all .18s;text-transform:uppercase;margin-top:4px}
.ab:hover{border-color:#8b5a2b;color:#8b5a2b}
.tc{display:flex;flex-wrap:wrap;gap:7px}
.chip{padding:6px 12px;border-radius:20px;border:1.5px solid #e0d4c4;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;cursor:pointer;transition:all .15s;background:#faf7f3;color:#8b6a4a;text-transform:uppercase}
.chip.on{background:#2c1a0e;border-color:#2c1a0e;color:#f5efe6}

/* ── BREW TAB: single clock ── */
.brew-clock-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:16px}
.brew-clock-svg{width:260px;height:260px;overflow:visible}
.brew-clock-centre-time{font-family:'Playfair Display',serif;font-size:2rem;fill:#1a0d00;text-anchor:middle;dominant-baseline:middle}
.brew-clock-centre-pour{font-family:'DM Mono',monospace;font-size:11px;fill:#8b5a2b;text-anchor:middle;letter-spacing:.1em;text-transform:uppercase}
.brew-clock-centre-grams{font-family:'DM Mono',monospace;font-size:10px;fill:#c4a882;text-anchor:middle}
.brew-legend{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:14px}
.brew-legend-item{display:flex;align-items:center;gap:5px;font-family:'DM Mono',monospace;font-size:9px;color:#8b6a4a;text-transform:uppercase;letter-spacing:.08em}
.brew-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.brew-status{background:#fffdf9;border-radius:16px;padding:14px 18px;box-shadow:0 2px 12px rgba(44,26,14,.06),0 0 0 1px rgba(212,165,116,.2);margin-bottom:12px;text-align:center}
.brew-status-step{font-family:'Lora',serif;font-size:1.2rem;color:#2c1a0e;margin-bottom:4px}
.brew-status-meta{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a;letter-spacing:.08em}
.brew-actual-inp{display:flex;align-items:center;gap:10px;justify-content:center;margin-top:10px}
.brew-actual-lbl{font-family:'DM Mono',monospace;font-size:9px;color:#8b6a4a;text-transform:uppercase;letter-spacing:.1em}
.brew-actual-field{display:flex;flex-direction:column;align-items:center;gap:3px}
.mini-inp{width:80px;padding:8px 8px;border:1.5px solid #e0d4c4;border-radius:9px;font-family:'DM Mono',monospace;font-size:14px;color:#2c1a0e;background:#faf7f3;outline:none;text-align:center;transition:border-color .18s}
.mini-inp:focus{border-color:#8b5a2b;background:#fff}
.mini-inp.diff{border-color:#e07a5f;color:#e07a5f}
.mini-inp[readonly]{background:#f0ece6;color:#8b6a4a}
.snap-btn{padding:10px 20px;border:2px solid #d4a574;border-radius:12px;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8b5a2b;background:#fff8f0;cursor:pointer;transition:all .15s;white-space:nowrap}
.snap-btn:hover{background:#f5e6d0;border-color:#8b5a2b}
.snap-btn:active{transform:scale(.97)}
.brew-actions{display:flex;flex-direction:column;gap:8px}
.bb{width:100%;padding:15px;border-radius:16px;border:none;cursor:pointer;font-family:'Playfair Display',serif;font-size:1.1rem;font-weight:600;transition:all .2s}
.bb.go{background:#2c1a0e;color:#f5efe6}.bb.go:hover{background:#3d2510;transform:translateY(-1px);box-shadow:0 6px 20px rgba(44,26,14,.25)}
.bb.nx{background:#8b5a2b;color:#fff}.bb.nx:hover{background:#7a4e24}
.bb.snap{background:#5a7a9a;color:#fff}.bb.snap:hover{background:#4a6a8a}
.bb.done-btn{background:#5a8a5a;color:#fff}.bb.done-btn:hover{background:#4a7a4a}
.bb.st{background:#e8ddd0;color:#8b6a4a;padding:11px}.bb.st:hover{background:#ddd0c0}
.brew-drawdown{text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:#8b6a4a;margin-bottom:10px;letter-spacing:.08em}

/* Summary table */
.summary-table{width:100%;border-collapse:collapse}
.summary-table th{font-family:'DM Mono',monospace;font-size:9px;color:#8b6a4a;text-transform:uppercase;letter-spacing:.08em;padding:4px 6px;text-align:center;border-bottom:1px solid #e8ddd0}
.summary-table th:first-child{text-align:left}
.summary-table td{font-family:'DM Mono',monospace;font-size:11px;color:#2c1a0e;padding:6px 6px;text-align:center;border-bottom:1px solid #f5efe6}
.summary-table td:first-child{font-family:'Lora',serif;font-size:12px;text-align:left}
.diff-over{color:#e07a5f}.diff-under{color:#6aab6a}

.brew-plan-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.si{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;border:1.5px solid #e0d4c4;background:#faf7f3}
.snn{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a;min-width:18px}
.si-info{flex:1}.si-name{font-family:'Lora',serif;font-size:14px;color:#2c1a0e}.si-meta{font-family:'DM Mono',monospace;font-size:10px;color:#8b6a4a}
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
`;

export default function PourOverTracker() {
  const [recipe, setRecipe] = useState(defaultRecipe);
  const [savedRecipes, setSavedRecipes] = useState([]);
  const [tab, setTab] = useState("recipe");
  const [brewing, setBrewing] = useState(false);
  const [timers, setTimers] = useState([]);
  const [activeStep, setActiveStep] = useState(-1);
  const [totalTimer, setTotalTimer] = useState(0);
  const [actualPours, setActualPours] = useState([]);
  const [lastActualPours, setLastActualPours] = useState([]);
  const [brewDone, setBrewDone] = useState(false);
  const [snapMarks, setSnapMarks] = useState([]); // [{time, type: 'snap'|'start'}]
  const [brewEndTime, setBrewEndTime] = useState(null);
  const [notionBeans, setNotionBeans] = useState([]);
  const [notionEquipment, setNotionEquipment] = useState([]);
  const [fetchingBeans, setFetchingBeans] = useState(false);
  const [fetchingEquip, setFetchingEquip] = useState(false);
  const [selectedBeanId, setSelectedBeanId] = useState(null);
  const [selectedEquipId, setSelectedEquipId] = useState(null);
  const [showSaved, setShowSaved] = useState(false);
  const [notif, setNotif] = useState({ msg: "", type: "" });
  const [syncing, setSyncing] = useState(false);
  const iv = useRef(null);

  useEffect(() => {
    try { const r = localStorage.getItem("pour-over-recipes"); if (r) setSavedRecipes(JSON.parse(r)); } catch {}
  }, []);

  const notify = (msg, type = "") => { setNotif({ msg, type }); setTimeout(() => setNotif({ msg:"", type:"" }), 3200); };

  const fetchNotionBeans = async () => {
    setFetchingBeans(true);
    try { const res = await fetch("/notion-beans"); const data = await res.json(); if (data.items) setNotionBeans(data.items); else notify("Could not load beans","err"); }
    catch { notify("Cannot reach server.js on :3001","err"); }
    setFetchingBeans(false);
  };

  const fetchNotionEquipment = async () => {
    setFetchingEquip(true);
    try { const res = await fetch("/notion-equipment"); const data = await res.json(); if (data.items) setNotionEquipment(data.items); else notify("Could not load equipment","err"); }
    catch { notify("Cannot reach server.js on :3001","err"); }
    setFetchingEquip(false);
  };

  const applyNotionBean = (item) => {
    setSelectedBeanId(item.id);
    setRecipe(r => ({ ...r, roast: item.roastLevel||r.roast, bean: { ...r.bean, origin:item.origin||"", variety:item.variety||"", altitude:item.altitude||"", process:item.process||"", roastDate:item.roastDate||"", roaster:item.roaster||"", descriptors:item.notes||"", _notionId:item.id } }));
    notify(`Loaded: ${item.name} — still editable`);
  };

  const applyNotionEquip = (item) => {
    setSelectedEquipId(item.id);
    const isBrewer = /brewer/i.test(item.type), isGrinder = /grinder/i.test(item.type);
    setRecipe(r => ({ ...r, equipment: { ...r.equipment, ...(isBrewer?{brewTool:item.name,_brewerNotionId:item.id}:{}), ...(isGrinder?{grinder:item.name,_grinderNotionId:item.id}:{}) } }));
    notify(`Loaded: ${item.name} — still editable`);
  };

  const startBrew = () => {
    setBrewing(true); setActiveStep(0); setTotalTimer(0); setBrewDone(false);
    setSnapMarks([]);
    setActualPours(recipe.pours.map((p,i) => ({ water: p.targetWater, pourStartTime: i===0?0:null, pourStopTime: null })));
    setTimers(recipe.pours.map((_,i) => ({ elapsed:0, running:i===0, done:false })));
  };

  const stopBrew = () => { setBrewing(false); setActiveStep(-1); setTotalTimer(0); setTimers([]); setBrewDone(false); setSnapMarks([]); clearInterval(iv.current); };

  const handleSnap = () => {
    const i = activeStep;
    setActualPours(prev => { const u=[...prev]; u[i]={...u[i],pourStopTime:totalTimer}; return u; });
    setSnapMarks(prev => [...prev, {time: totalTimer, type: 'snap'}]);
  };

  const handleContinue = () => {
    const next = activeStep + 1;
    const snapped = actualPours.map((a,i) => i===activeStep && a.pourStopTime==null ? {...a,pourStopTime:totalTimer} : a);
    if (next < recipe.pours.length) {
      snapped[next] = {...snapped[next], pourStartTime: totalTimer};
      setSnapMarks(prev => [...prev, {time: totalTimer, type: 'start'}]);
    }
    setActualPours(snapped);
    if (next >= recipe.pours.length) {
      setLastActualPours(snapped); setBrewDone(true); setBrewEndTime(totalTimer);
      setBrewing(false); clearInterval(iv.current);
      notify("☕ Brew complete! Clock still running for drawdown.");
      return;
    }
    setActiveStep(next);
    setTimers(prev => prev.map((t,i) => i===activeStep?{...t,running:false,done:true}:i===next?{...t,running:true}:t));
  };

  const finishDrawdown = () => {
    setBrewEndTime(totalTimer);
    setLastActualPours(actualPours);
    stopBrew();
    notify("Brew recorded!");
  };

  const snapStop = (i) => setActualPours(prev => { const u=[...prev]; u[i]={...u[i],pourStopTime:totalTimer}; return u; });
  const updateActual = (i, field, val) => setActualPours(prev => { const u=[...prev]; u[i]={...u[i],[field]:val===""?null:Number(val)}; return u; });

  useEffect(() => {
    if (!brewing && !brewDone) { clearInterval(iv.current); return; }
    iv.current = setInterval(() => { setTotalTimer(t=>t+1); }, 1000);
    return () => clearInterval(iv.current);
  }, [brewing, brewDone]);

  const up = (f,v) => setRecipe(r=>({...r,[f]:v}));
  const upEquip = (f,v) => setRecipe(r=>({...r,equipment:{...r.equipment,[f]:v}}));
  const upBean = (f,v) => setRecipe(r=>({...r,bean:{...r.bean,[f]:v}}));
  const upSensory = (f,v) => setRecipe(r=>({...r,sensory:{...r.sensory,[f]:v}}));

  const clearNotes = () => setRecipe(r=>({...r, notes:"", tastingNotes:[], sensory:Object.fromEntries(Object.keys(r.sensory).map(k=>[k,0]))}));
  const clearBean = () => setRecipe(r=>({...r, roast:"Light", bean:{origin:"",variety:"",altitude:"",process:"",roastDate:"",roaster:"",lot:"",descriptors:"",impression:""}}));
  const clearEquipment = () => setRecipe(r=>({...r, equipment:{brewTool:"",grinder:"",waterSource:"",tds:"",hardness:"",waterNotes:""}}));
  const clearRecipe = () => { setRecipe({...defaultRecipe, id:undefined}); setLastActualPours([]); notify("Cleared!"); };
  const upPour = (i,f,v) => { const p=[...recipe.pours]; p[i]={...p[i],[f]:(f==="targetWater"||f==="duration"||f==="startTime")?Number(v):v}; setRecipe(r=>({...r,pours:p})); };
  const addPour = () => { const l=recipe.pours[recipe.pours.length-1]; setRecipe(r=>({...r,pours:[...r.pours,{label:`Pour ${r.pours.length}`,targetWater:l?l.targetWater+60:60,startTime:l?l.startTime+l.duration:0,duration:45,stirMethod:"None"}]})); };
  const remPour = (i) => setRecipe(r=>({...r,pours:r.pours.filter((_,idx)=>idx!==i)}));
  const toggleTaste = (t) => setRecipe(r=>({...r,tastingNotes:r.tastingNotes.includes(t)?r.tastingNotes.filter(n=>n!==t):[...r.tastingNotes,t]}));

  const totalWater = recipe.pours.length ? recipe.pours[recipe.pours.length-1].targetWater : 0;
  const ratio = recipe.coffee > 0 ? (totalWater/recipe.coffee).toFixed(1) : "—";

  // waterPoured = actual ml added during this pour (cumulative scale reading minus previous)
  const getWaterPoured = (i, pours) => {
    const cur = pours[i];
    if (cur?.water == null) return null;
    const prev = pours[i - 1];
    return prev?.water != null ? cur.water - prev.water : cur.water;
  };

  const getPourSpeed = (i, pours) => {
    const ap = pours[i];
    if (ap?.pourStartTime == null || ap?.pourStopTime == null) return null;
    const d = ap.pourStopTime - ap.pourStartTime;
    const w = getWaterPoured(i, pours);
    return (d > 0 && w != null && w > 0) ? (w / d).toFixed(1) : null;
  };

  const getPause = (i, pours) => {
    const c = pours[i], n = pours[i + 1];
    if (!c || c.pourStopTime == null || !n || n.pourStartTime == null) return null;
    return n.pourStartTime - c.pourStopTime;
  };

  const saveRecipe = () => {
    const rec={...recipe,id:recipe.id||Date.now()};
    const upd=[rec,...savedRecipes.filter(r=>r.id!==rec.id)].slice(0,20);
    setSavedRecipes(upd); setRecipe(rec);
    try{localStorage.setItem("pour-over-recipes",JSON.stringify(upd));}catch{}
    notify("Recipe saved!");
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(savedRecipes,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");// eslint-disable-line no-unused-vars
    a.href = url;
    a.download = `pour-over-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Exported!");
  };

  const loadRecipe = (r) => { setRecipe(r); setShowSaved(false); setTab("recipe"); notify(`Loaded "${r.name}"`); };
  const deleteRecipe = (id) => { const u=savedRecipes.filter(r=>r.id!==id); setSavedRecipes(u); try{localStorage.setItem("pour-over-recipes",JSON.stringify(u));}catch{}; };

  const syncToNotion = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...recipe,actualPours:actualPours.length>0?actualPours:lastActualPours.length>0?lastActualPours:null,brewEndTime})});
      const data = await res.json();
      if (data.success) notify(`✓ Synced — ${data.sessionId}`,"ok"); else notify(`Notion: ${data.error}`,"err");
    } catch { notify("Cannot reach server.js on :3001","err"); }
    setSyncing(false);
  };

  const activePour = recipe.pours[activeStep];

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="grain"/><div className="ring r1"/><div className="ring r2"/>
        <div className="wrap">
          <div className="hdr">
            <div className="eyebrow">Manual Brew Journal</div>
            <h1>Pour <em>Over</em><br/>Recipe Tracker</h1>
          </div>
          <input className="ni" value={recipe.name} onChange={e=>up("name",e.target.value)} placeholder="Recipe name…"/>
          <div style={{height:18}}/>
          <div className="tabs">
            {[["recipe","⚗️ Recipe"],["equipment","🔧 Equip"],["bean","🌱 Bean"],["brew","☕ Brew"],["notes","📓 Notes"]].map(([k,l])=>(
              <button key={k} className={`tab ${tab===k?"on":""}`} onClick={()=>{setTab(k);if(k!=="brew")stopBrew();}}>{l}</button>
            ))}
          </div>

          {/* ── RECIPE ── */}
          {tab==="recipe"&&<>
            <div className="stats">
              {[[`${recipe.coffee}g`,"Coffee"],[`${totalWater}ml`,"Total"],[`1:${ratio}`,"Ratio"],[`${recipe.waterTemp}°C`,"Temp"],[`${recipe.grindSize}`,"Grind"]].map(([v,l])=>(
                <div className="stat" key={l}><div className="sv">{v}</div><div className="sl">{l}</div></div>
              ))}
            </div>
            <div className="card">
              <div className="ct"><span>Parameters</span></div>
              <div className="g4" style={{marginBottom:13}}>
                <div className="f"><label>Coffee (g)</label><input type="number" value={recipe.coffee} onChange={e=>up("coffee",Number(e.target.value))}/></div>
                <div className="f"><label>Temp (°C)</label><input type="number" value={recipe.waterTemp} onChange={e=>up("waterTemp",Number(e.target.value))}/></div>
                <div className="f"><label>Grind Size</label><input type="number" step="0.1" min="1" max="50" value={recipe.grindSize} onChange={e=>up("grindSize",parseFloat(parseFloat(e.target.value).toFixed(1)))}/></div>
                <div className="f"><label>Roast</label><select value={recipe.roast} onChange={e=>up("roast",e.target.value)}>{ROASTS.map(r=><option key={r}>{r}</option>)}</select></div>
              </div>
            </div>
            <div className="card">
              <div className="ct"><span>Pour Stages</span></div>
              <div className="ph">
                <div className="plbl" style={{textAlign:"left"}}>Stage</div>
                <div className="plbl">Scale ml</div>
                <div className="plbl">Start (s)</div>
                <div className="plbl">Duration (s)</div>
                <div className="plbl">Stir</div>
                <div/>
              </div>
              {recipe.pours.map((p,i)=>(
                <div className="pr" key={i}>
                  <input value={p.label} onChange={e=>upPour(i,"label",e.target.value)} style={{textAlign:"left"}}/>
                  <input type="number" value={p.targetWater} onChange={e=>upPour(i,"targetWater",e.target.value)}/>
                  <input type="number" value={p.startTime} onChange={e=>upPour(i,"startTime",e.target.value)}/>
                  <input type="number" value={p.duration} onChange={e=>upPour(i,"duration",e.target.value)}/>
                  <select value={p.stirMethod||"None"} onChange={e=>upPour(i,"stirMethod",e.target.value)}>{STIR_METHODS.map(s=><option key={s}>{s}</option>)}</select>
                  <button className="db" onClick={()=>remPour(i)}>×</button>
                </div>
              ))}
              <button className="ab" onClick={addPour}>+ Add Pour</button>
            </div>
            <div className="ar">
              <button className="ab2" onClick={()=>setShowSaved(s=>!s)}>📂 Saved</button>
              <button className="ab2" onClick={()=>{setRecipe({...defaultRecipe,id:undefined});notify("New recipe!");}}>+ New</button>
              <button className="ab2 export" onClick={exportJSON}>⬇ Export</button>
              <button className="ab2 clr" onClick={clearRecipe}>✕ Clear</button>
              <button className="ab2 pri" onClick={saveRecipe}>Save</button>
            </div>
            {showSaved&&<div className="card" style={{marginTop:14}}>
              <div className="ct"><span>Saved Recipes</span></div>
              {savedRecipes.length===0?<div className="empty">No saved recipes yet</div>:(
                <div className="saved-l">
                  {savedRecipes.map(r=>(
                    <div className="saved-i" key={r.id} onClick={()=>loadRecipe(r)}>
                      <div style={{flex:1}}><div className="saved-n">{r.name}</div><div className="saved-m">{r.coffee}g · Grind {r.grindSize} · {r.roast}</div></div>
                      <button className="saved-d" onClick={e=>{e.stopPropagation();deleteRecipe(r.id);}}>🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </div>}
          </>}

          {/* ── EQUIPMENT ── */}
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
                <div className="f"><label>Brew Tool</label><input type="text" value={recipe.equipment?.brewTool||""} onChange={e=>upEquip("brewTool",e.target.value)} placeholder="e.g. V60, Chemex…"/></div>
                <div className="f"><label>Grinder</label><input type="text" value={recipe.equipment?.grinder||""} onChange={e=>upEquip("grinder",e.target.value)} placeholder="e.g. Comandante…"/></div>
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

          {/* ── BEAN ── */}
          {tab==="bean"&&<>
            <div className="card">
              <div className="ct"><span>From Notion</span><button className="ct-btn" onClick={fetchNotionBeans} disabled={fetchingBeans}>{fetchingBeans?"Loading…":"⬇ Load Beans"}</button></div>
              {notionBeans.length>0&&<div className="notion-picker">
                <div className="notion-picker-hdr">Select to pre-fill — still editable after</div>
                {notionBeans.map(item=>(
                  <div key={item.id} className={`notion-item ${selectedBeanId===item.id?"selected":""}`} onClick={()=>applyNotionBean(item)}>
                    <div className="notion-item-name">{item.name}</div>
                    <div className="notion-item-meta">{[item.origin,item.variety,item.roastLevel,item.roaster].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </div>}
              {notionBeans.length===0&&<p style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#c4a882",marginBottom:4}}>Load from Notion to pre-fill, or type below.</p>}
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

          {/* ── BREW ── */}
          {tab==="brew"&&<>
            {(!brewing && !brewDone)?<>
              <div className="card">
                <div className="ct"><span>Brew Plan — {recipe.name}</span></div>
                <div className="brew-plan-list">
                  {recipe.pours.map((p,i)=>(
                    <div className="si" key={i}>
                      <div className="snn">{i+1}</div>
                      <div className="si-info">
                        <div className="si-name">{p.label}</div>
                        <div className="si-meta">→{p.targetWater}ml · @{formatTime(p.startTime)} · {formatTime(p.duration)} · {p.stirMethod||"No stir"}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{textAlign:"center",fontFamily:"'DM Mono',monospace",fontSize:11,color:"#8b6a4a"}}>Total: {totalWater}ml</div>
              </div>

              {lastActualPours.length>0&&<div className="card">
                <div className="ct"><span>Last Brew — Actual vs Target</span></div>
                <table className="summary-table">
                  <thead><tr><th>Pour</th><th>Target</th><th>Actual</th><th>Δ</th><th>Speed</th><th>Pause →</th></tr></thead>
                  <tbody>
                    {recipe.pours.map((p,i)=>{
                      const prevTarget = i>0 ? recipe.pours[i-1].targetWater : 0;
                      const pourTarget = p.targetWater - prevTarget;
                      const pourActual = getWaterPoured(i, lastActualPours);
                      const diff = pourActual != null ? pourActual - pourTarget : null;
                      const speed = getPourSpeed(i, lastActualPours);
                      const pause = getPause(i, lastActualPours);
                      return(
                        <tr key={i}>
                          <td>{p.label}</td>
                          <td>{pourTarget}ml</td>
                          <td>{pourActual!=null?`${pourActual}ml`:"—"}</td>
                          <td className={diff>0?"diff-over":diff<0?"diff-under":""}>{diff!=null?(diff>0?`+${diff}`:diff)+"ml":"—"}</td>
                          <td>{speed?`${speed}ml/s`:"—"}</td>
                          <td>{pause!=null?`${pause}s`:i<recipe.pours.length-1?"—":"end"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}

              <button className="bb go" onClick={startBrew}>Start Brewing ☕</button>

            </>:<>
              {/* ── SINGLE CLOCK BREW UI ── */}
              {(()=>{
                const POUR_COLORS = ["#c4843a","#8b5a2b","#5a3a1a","#a07040","#7a5030"];
                const totalBrewTime = Math.max(...recipe.pours.map(p=>p.startTime+p.duration), 1);
                const cx=130, cy=130, r=110, stroke=14;
                const circ = 2*Math.PI*r;
                const toAngle = (s) => (s/totalBrewTime)*360 - 90;
                const polarToXY = (angle, radius) => {
                  const rad = (angle * Math.PI)/180;
                  return { x: cx + radius*Math.cos(rad), y: cy + radius*Math.sin(rad) };
                };
                const arcPath = (startS, endS, color) => {
                  const a1 = toAngle(startS), a2 = toAngle(endS);
                  const p1 = polarToXY(a1, r), p2 = polarToXY(a2, r);
                  const large = (endS - startS)/totalBrewTime > 0.5 ? 1 : 0;
                  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
                };
                const markerLine = (timeS, color, width=3) => {
                  const angle = toAngle(timeS);
                  const inner = polarToXY(angle, r - stroke - 4);
                  const outer = polarToXY(angle, r + stroke + 4);
                  return <line key={timeS+color} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={color} strokeWidth={width} strokeLinecap="round"/>;
                };

                const elapsed = totalTimer;
                const progressAngle = Math.min(elapsed/totalBrewTime, 1)*360;
                const activePour = brewDone ? null : recipe.pours[activeStep];
                const ap = brewDone ? null : (actualPours[activeStep]||{});
                const hasSnapped = ap && ap.pourStopTime != null;
                const prevTarget = activeStep > 0 ? recipe.pours[activeStep-1].targetWater : 0;
                const pourTarget = activePour ? activePour.targetWater - prevTarget : 0;
                const pourActual = getWaterPoured(activeStep, actualPours);
                const hasDiff = pourActual != null && pourActual !== pourTarget;

                return <>
                  <div className="brew-clock-wrap">
                    <svg className="brew-clock-svg" viewBox="0 0 260 260">
                      {/* Background ring */}
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0ebe3" strokeWidth={stroke}/>

                      {/* Pour target zones */}
                      {recipe.pours.map((p,i)=>(
                        <path key={i} d={arcPath(p.startTime, p.startTime+p.duration, POUR_COLORS[i%POUR_COLORS.length])}
                          fill="none" stroke={POUR_COLORS[i%POUR_COLORS.length]} strokeWidth={stroke} opacity={0.25} strokeLinecap="butt"/>
                      ))}

                      {/* Elapsed progress arc */}
                      {elapsed>0&&(()=>{
                        const endAngle = toAngle(Math.min(elapsed, totalBrewTime));
                        const startPt = polarToXY(-90, r);
                        const endPt = polarToXY(endAngle, r);
                        const large = elapsed/totalBrewTime > 0.5 ? 1 : 0;
                        const activeColor = brewDone ? "#6aab6a" : (POUR_COLORS[activeStep%POUR_COLORS.length]||"#8b5a2b");
                        return <path d={`M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${large} 1 ${endPt.x} ${endPt.y}`}
                          fill="none" stroke={activeColor} strokeWidth={stroke} strokeLinecap="round" opacity={0.85}/>;
                      })()}

                      {/* Pour start tick marks */}
                      {recipe.pours.map((p,i)=>i>0&&(()=>{
                        const angle = toAngle(p.startTime);
                        const inner = polarToXY(angle, r-stroke/2-2);
                        const outer = polarToXY(angle, r+stroke/2+2);
                        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                          stroke="#fff" strokeWidth={2.5} strokeLinecap="round"/>;
                      })())}

                      {/* Snap marks (grey) and continue marks (red) */}
                      {snapMarks.map((m,i)=>markerLine(m.time, m.type==='snap'?'#9aadba':'#e07a5f', 4))}

                      {/* 12 o'clock dot */}
                      <circle cx={cx} cy={cy-r} r={4} fill="#c4a882"/>

                      {/* Centre face */}
                      <circle cx={cx} cy={cy} r={r-stroke-6} fill="#fffdf9"/>

                      {/* Elapsed time */}
                      <text x={cx} y={brewDone?cy-18:cy-8} className="brew-clock-centre-time">{formatTime(elapsed)}</text>

                      {/* Pour name */}
                      {!brewDone&&activePour&&<>
                        <text x={cx} y={cy+18} className="brew-clock-centre-pour">{activePour.label}</text>
                        <text x={cx} y={cy+34} className="brew-clock-centre-grams">+{pourTarget}ml → {activePour.targetWater}ml</text>
                      </>}
                      {brewDone&&<>
                        <text x={cx} y={cy+14} className="brew-clock-centre-pour">Drawdown</text>
                        <text x={cx} y={cy+30} className="brew-clock-centre-grams">tap done when empty</text>
                      </>}
                    </svg>

                    {/* Legend */}
                    <div className="brew-legend">
                      {recipe.pours.map((p,i)=>(
                        <div key={i} className="brew-legend-item">
                          <div className="brew-legend-dot" style={{background:POUR_COLORS[i%POUR_COLORS.length]}}/>
                          {p.label} {p.targetWater}ml
                        </div>
                      ))}
                      <div className="brew-legend-item"><div className="brew-legend-dot" style={{background:"#9aadba"}}/> Stop</div>
                      <div className="brew-legend-item"><div className="brew-legend-dot" style={{background:"#e07a5f"}}/> Next start</div>
                    </div>
                  </div>

                  {/* Status + actual input */}
                  {!brewDone&&activePour&&<div className="brew-status">
                    <div className="brew-status-step">▶ {activePour.label}</div>
                    <div className="brew-status-meta">target: +{pourTarget}ml · start @{formatTime(activePour.startTime)} · dur {formatTime(activePour.duration)}</div>
                    <div className="brew-actual-inp">
                      <div className="brew-actual-field">
                        <div className="brew-actual-lbl">Scale (ml)</div>
                        <input className={`mini-inp${hasDiff?" diff":""}`} type="number"
                          value={ap.water??activePour.targetWater}
                          onChange={e=>{ const u=[...actualPours]; u[activeStep]={...u[activeStep],water:e.target.value===""?null:Number(e.target.value)}; setActualPours(u); }}/>
                      </div>
                    </div>
                  </div>}

                  {/* Drawdown summary */}
                  {brewDone&&<>
                    <div className="brew-drawdown">⏱ drawdown in progress…</div>
                    <div className="card">
                      <div className="ct"><span>Brew Summary</span></div>
                      <table className="summary-table">
                        <thead><tr><th>Pour</th><th>Target</th><th>Actual</th><th>Δ</th><th>Speed</th><th>Pause →</th></tr></thead>
                        <tbody>
                          {recipe.pours.map((p,i)=>{
                            const prev = i>0?recipe.pours[i-1].targetWater:0;
                            const pt = p.targetWater-prev;
                            const pa = getWaterPoured(i, lastActualPours);
                            const diff = pa!=null?pa-pt:null;
                            const speed = getPourSpeed(i, lastActualPours);
                            const pause = getPause(i, lastActualPours);
                            return <tr key={i}>
                              <td>{p.label}</td><td>{pt}ml</td>
                              <td>{pa!=null?`${pa}ml`:"—"}</td>
                              <td className={diff>0?"diff-over":diff<0?"diff-under":""}>{diff!=null?(diff>0?`+${diff}`:diff)+"ml":"—"}</td>
                              <td>{speed?`${speed}ml/s`:"—"}</td>
                              <td>{pause!=null?`${pause}s`:i<recipe.pours.length-1?"—":"end"}</td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>}

                  {/* Action buttons */}
                  <div className="brew-actions">
                    {!brewDone&&<>
                      {!hasSnapped
                        ? <button className="bb snap" onClick={handleSnap}>⏱ Snap Stop</button>
                        : <button className="bb nx" onClick={handleContinue}>
                            {activeStep<recipe.pours.length-1?`Continue → ${recipe.pours[activeStep+1]?.label}`:"Finish Pour ✓"}
                          </button>
                      }
                    </>}
                    {brewDone&&<button className="bb done-btn" onClick={finishDrawdown}>✓ Done — Record Brew</button>}
                    <button className="bb st" onClick={stopBrew}>Abandon</button>
                  </div>
                </>;
              })()}
            </>}
          </>}

          {/* ── NOTES ── */}
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
              <div className="notion-txt"><strong>Sync to Notion</strong> sends actual brew data to all 4 databases.<br/>Requires <code>node server.js</code> running on port 3001.</div>
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
