import React, { useEffect, useMemo, useRef, useState } from "react";

/* -------------------- Safe ID (works in all browsers) -------------------- */
const genId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : (Math.random().toString(36).slice(2) + "-" + Date.now().toString(36));

/* ----------------------------- Config & Keys ----------------------------- */
const STAGES = ["Prospect", "Qualified", "LOA", "Contracted", "Customer"];
const SUPPLIERS = [
  "EDF", "E.ON Next", "Octopus", "British Gas", "SSE/OVO",
  "ScottishPower", "TotalEnergies", "Utilita", "Other",
];
const STORAGE_KEY = "crm-records-v7";
const TRASH_KEY   = "crm-trash-v1";
const DNC_KEY     = "crm-dnc-v1";
const USERS_KEY   = "crm-users-v1";
const SESSION_KEY = "crm-session-v1";

/* ------------------------------- CSV Schema ------------------------------ */
const CSV_HEADERS = [
  "company","contact","phone","email",
  "meterType","mpanTop","mpanCore","mprn",
  "supplier","unitRatePPKWh","standingChargePPD","ced",
  "annualUsageKWh","stage","notes",
  "nextCallDate","nextCallTime","nextCallNotes",
];

/* -------------------------------- Helpers -------------------------------- */
function emptyRecord(ownerId = null) {
  return {
    id: genId(),
    ownerId,
    company: "", contact: "", phone: "", email: "",
    meterType: "Electric", mpanTop: "", mpanCore: "", mprn: "",
    supplier: "", unitRatePPKWh: "", standingChargePPD: "", ced: "",
    annualUsageKWh: "", stage: "Prospect", notes: "",
    nextCallDate: "", nextCallTime: "", nextCallNotes: "",
    createdAt: new Date().toISOString(),
  };
}
const loadJSON = (key, fallback) => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
};
const saveJSON = (key, val) => localStorage.setItem(key, JSON.stringify(val));
function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [hh="00", mm="00"] = (timeStr||"00:00").split(":");
  const d = new Date(dateStr); d.setHours(+hh, +mm, 0, 0); return d;
}
const isOverdue = (d,t) => { const x=combineDateTime(d,t); return x ? x.getTime() < Date.now() : false; };
function isToday(dateStr) {
  if (!dateStr) return false;
  const a = new Date(dateStr), b = new Date();
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
const normPhone = (s="") => s.replace(/\D/g,"");

/* ---------- CED normaliser (converts dots to slashes on import) ---------- */
function normalizeCED(input) {
  if (!input) return "";
  let s = String(input).trim().replace(/\./g, "/");
  // DD/MM/YYYY or DD-MM-YYYY -> YYYY-MM-DD
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = String(2000 + parseInt(yy, 10));
    return `${yy.padStart(4,"0")}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }
  // YYYY/MM/DD or YYYY-MM-DD -> YYYY-MM-DD
  m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) {
    const [, yy, mm, dd] = m;
    return `${yy}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
  }
  return s;
}

/* -------------------------------- CSV utils ------------------------------ */
function safeCSV(v){ const s=String(v??""); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function recordsToCSV(records){
  const header = CSV_HEADERS.join(","); 
  const body = records.map(r=>{
    const base = Object.fromEntries(CSV_HEADERS.map(h=>[h, r[h]]));
    return CSV_HEADERS.map(h=>safeCSV(base[h])).join(",");
  }).join("\n");
  return header + "\n" + body;
}
function splitCSVLine(row){
  const cells=[]; let cur="", inQ=false;
  for(let i=0;i<row.length;i++){ const ch=row[i];
    if(ch===`"`){ if(inQ && row[i+1]==='"'){cur+=`"`; i++;} else inQ=!inQ; }
    else if(ch==="," && !inQ){ cells.push(cur); cur=""; }
    else cur+=ch;
  } cells.push(cur); return cells;
}
function parseCSV(text){
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  if(!lines.length) return [];
  const header = splitCSVLine(lines[0]).map(h=>h.trim());
  const rows = lines.slice(1), out=[];
  for(const row of rows){
    const cells = splitCSVLine(row);
    const map = Object.fromEntries(header.map((h,i)=>[h, cells[i] ?? ""]));
    const rec = { ...emptyRecord(null) };
    for(const k of CSV_HEADERS) if(k in map) rec[k]=map[k];
    if(!rec.meterType) rec.meterType="Electric";
    if(!rec.stage) rec.stage="Prospect";
    rec.ced = normalizeCED(rec.ced);
    out.push(rec);
  }
  return out;
}

/* --------------------------- Users & Login (demo) ------------------------ */
function makeUser({name, email, role="agent", pin="1234", active=true}) {
  return { id: genId(), name, email, role, pin: String(pin), active, createdAt: new Date().toISOString() };
}
function LoginScreen({ users, onCreateFirstAdmin, onLogin }) {
  const [email, setEmail] = useState(users[0]?.email ?? "");
  const [pin, setPin] = useState("");
  const [creating] = useState(users.length === 0);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPin, setNewPin] = useState("");

  if (creating) {
    return (
      <div style={styles.centerBox}>
        <h2>Create first admin</h2>
        <p>This is a local demo. Choose a PIN (4–6 digits). You can add staff later.</p>
        <div style={{ display:"grid", gap:8, maxWidth:320 }}>
          <input placeholder="Full name" value={newName} onChange={e=>setNewName(e.target.value)} />
          <input placeholder="Email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} />
          <input placeholder="PIN (4–6 digits)" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,"").slice(0,6))} />
          <button onClick={()=>onCreateFirstAdmin({name:newName, email:newEmail, pin:newPin || "1234"})}>Create admin</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.centerBox}>
      <h2>Sign in</h2>
      <div style={{ display:"grid", gap:8, maxWidth:320 }}>
        <select value={email} onChange={e=>setEmail(e.target.value)}>
          {users.filter(u=>u.active).map(u=>(
            <option key={u.id} value={u.email}>{u.name} — {u.email}</option>
          ))}
        </select>
        <input
          placeholder="PIN"
          type="password"
          value={pin}
          onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))}
        />
        <button onClick={()=>onLogin(email, pin)}>Login</button>
        <div style={{ color:"#666", fontSize:12 }}>Demo-only auth (local). Use the Users panel to manage staff.</div>
      </div>
    </div>
  );
}

/* ================================== APP ================================== */
export default function App(){
  /* Users + session */
  const [users, setUsers] = useState(()=> loadJSON(USERS_KEY, []));
  const [session, setSession] = useState(()=> loadJSON(SESSION_KEY, null)); // { userId }
  const currentUser = users.find(u=>u.id === session?.userId) || null;
  const isAdmin = !!currentUser && currentUser.role === "admin";

  /* Data */
  const [records, setRecords] = useState(() => {
    const r = loadJSON(STORAGE_KEY, []);
    return r.map(x => ({ ownerId: null, ...x }));
  });
  const [trash,   setTrash]   = useState(() => loadJSON(TRASH_KEY,   []));
  const [dnc,     setDnc]     = useState(() => loadJSON(DNC_KEY,     []));
  const dncSet = useMemo(()=> new Set((dnc||[]).map(normPhone)), [dnc]);

  /* UI */
  const [modalId, setModalId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [promoteTo, setPromoteTo] = useState(STAGES[0]);

  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [ownerFilter, setOwnerFilter] = useState("All"); // admins only

  const [sortKey, setSortKey] = useState("nextcall"); // default: Next Call
  const [sortDir, setSortDir] = useState("asc");

  const [hideDNC, setHideDNC] = useState(true);
  const [showBin, setShowBin] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("Not interested");
  const [deleteAddDNC, setDeleteAddDNC] = useState(true);

  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [showUsers, setShowUsers] = useState(false);

  const fileRef = useRef(null);

  /* NEW: “Assign to” for imports + bulk assign */
  const [importOwnerId, setImportOwnerId] = useState("");
  useEffect(() => {
    if (currentUser && !importOwnerId) setImportOwnerId(currentUser.id);
  }, [currentUser, importOwnerId]);

  /* Persist */
  useEffect(()=> saveJSON(STORAGE_KEY, records), [records]);
  useEffect(()=> saveJSON(TRASH_KEY,   trash),   [trash]);
  useEffect(()=> saveJSON(DNC_KEY,     dnc),     [dnc]);
  useEffect(()=> saveJSON(USERS_KEY,   users),   [users]);
  useEffect(()=> saveJSON(SESSION_KEY, session), [session]);

  /* Duplicate phones (highlight) */
  const duplicatePhones = useMemo(()=>{
    const counts = new Map();
    for(const r of records){
      const p = normPhone(r.phone);
      if(!p) continue;
      counts.set(p, (counts.get(p)||0)+1);
    }
    const dups = new Set();
    for(const [p,c] of counts) if(c>1) dups.add(p);
    return dups;
  }, [records]);

  /* Helpers */
  const activeUsers = users.filter(u=>u.active);
  const userById = (id)=> users.find(u=>u.id===id) || null;

  /* Filter + Sort (respect roles) */
  const filtered = useMemo(()=>{
    if (!currentUser) return [];
    const q = query.toLowerCase().trim();

    let list = records.filter(r=>{
      if (!isAdmin) {
        if (r.ownerId && r.ownerId !== currentUser.id) return false;
        if (!r.ownerId) return false;
      } else {
        if (ownerFilter !== "All" && r.ownerId !== ownerFilter) return false;
      }
      if(hideDNC && dncSet.has(normPhone(r.phone))) return false;

      const match = !q || [r.company, r.contact, r.phone, r.email, r.supplier, r.mpanCore, r.mprn]
        .join(" ").toLowerCase().includes(q);
      const stageOK = stageFilter==="All" || r.stage===stageFilter;
      return match && stageOK;
    });

    if (sortKey === "ced") {
      list = [...list].sort((a,b)=>{
        const at = a.ced ? new Date(a.ced).getTime() : Number.POSITIVE_INFINITY;
        const bt = b.ced ? new Date(b.ced).getTime() : Number.POSITIVE_INFINITY;
        return sortDir==="asc" ? at - bt : bt - at;
      });
    } else {
      list = [...list].sort((a,b)=>{
        const at = combineDateTime(a.nextCallDate, a.nextCallTime);
        const bt = combineDateTime(b.nextCallDate, b.nextCallTime);
        const ai = at ? at.getTime() : Number.POSITIVE_INFINITY;
        const bi = bt ? bt.getTime() : Number.POSITIVE_INFINITY;
        return sortDir==="asc" ? ai - bi : bi - ai;
      });
    }
    return list;
  }, [records, query, stageFilter, sortKey, sortDir, dncSet, hideDNC, currentUser, isAdmin, ownerFilter]);

  /* Reminders (scroll after 10) */
  const dueOrOverdue = useMemo(()=>{
    if (!currentUser) return [];
    return records
      .filter(r=>{
        if (!isAdmin) { if (r.ownerId !== currentUser.id) return false; }
        else { if (ownerFilter !== "All" && r.ownerId !== ownerFilter) return false; }
        if(hideDNC && dncSet.has(normPhone(r.phone))) return false;
        return r.nextCallDate && (isToday(r.nextCallDate) || isOverdue(r.nextCallDate, r.nextCallTime));
      })
      .sort((a,b)=>{
        const ad = combineDateTime(a.nextCallDate, a.nextCallTime)?.getTime() ?? 0;
        const bd = combineDateTime(b.nextCallDate, b.nextCallTime)?.getTime() ?? 0;
        return ad - bd;
      });
  }, [records, hideDNC, dncSet, currentUser, isAdmin, ownerFilter]);

  /* CRUD */
  function upsert(rec){
    setRecords(prev=>{
      const i = prev.findIndex(x=>x.id===rec.id);
      if(i===-1) return [rec, ...prev];
      const copy=[...prev]; copy[i]=rec; return copy;
    });
  }
  function addNew(){
    if (!currentUser) return;
    const r = emptyRecord(currentUser.id);
    setRecords(prev=>[r, ...prev]);
    openModal(r.id);
  }
  function openModal(id){
    const rec = records.find(r=>r.id===id); if(!rec) return;
    setModalId(id); setDraft({...rec}); setNoteDraft(""); setPromoteTo(rec.stage);
  }
  function reallyCloseModal(){ setModalId(null); setDraft(null); setNoteDraft(""); setShowClosePrompt(false); }
  function hasUnsavedChanges(){
    if (!draft) return false;
    const original = records.find(r=>r.id===draft.id) || {};
    const keys = [
      "ownerId","company","contact","phone","email","meterType","mpanTop","mpanCore","mprn",
      "supplier","unitRatePPKWh","standingChargePPD","ced",
      "annualUsageKWh","stage","notes","nextCallDate","nextCallTime","nextCallNotes"
    ];
    for (const k of keys){
      if (String(draft[k] ?? "") !== String(original[k] ?? "")) return true;
    }
    if ((noteDraft || "").trim()) return true;
    return false;
  }
  function attemptCloseModal(){
    if (hasUnsavedChanges()) { setShowClosePrompt(true); }
    else { reallyCloseModal(); }
  }
  function setDraftField(field, value){ setDraft(d=>({...d, [field]: value})); }
  function saveDraft(){
    if(!draft) return;
    if (!draft.nextCallDate) {
      const ok = window.confirm("No call back date selected. Continue saving without scheduling?");
      if (!ok) return;
    }
    let updated = {...draft};
    const add = (noteDraft||"").trim();
    if(add){
      const d=new Date(), yyyy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,"0"),
            dd=String(d.getDate()).padStart(2,"0"), hh=String(d.getHours()).padStart(2,"0"),
            mn=String(d.getMinutes()).padStart(2,"0");
      const stamp = `[${yyyy}-${mm}-${dd} ${hh}:${mn}] `;
      updated.notes = `${stamp}${add}\n${updated.notes||""}`;
    }
    upsert(updated);
    reallyCloseModal();
  }
  function applyPromote(){
    if(!draft) return;
    const from = draft.stage, to = promoteTo;
    const ok = window.confirm(`Are you sure you want to promote this record from "${from}" to "${to}"?`);
    if(!ok) return;
    setDraftField("stage", to);
  }

  /* Delete (admin only) */
  function openDelete(rec){
    if (!isAdmin) return;
    setDeleteTarget(rec);
    setDeleteReason("Not interested");
    setDeleteAddDNC(true);
  }
  function confirmDelete(){
    if(!deleteTarget) return;
    const rec = deleteTarget;
    const item = { ...rec, deletedAt: new Date().toISOString(), deleteReason };
    setTrash(prev=>[item, ...prev]);
    if (deleteAddDNC && rec.phone){
      const p = normPhone(rec.phone);
      if (p && !dncSet.has(p)) setDnc(prev=>[...prev, p]);
    }
    setRecords(prev=> prev.filter(r=>r.id!==rec.id));
    closeDelete();
  }
  function closeDelete(){ setDeleteTarget(null); }
  function restoreFromTrash(id){
    const item = trash.find(t=>t.id===id); if(!item) return;
    const { deletedAt, deleteReason, ...rest } = item;
    setRecords(prev=>[rest, ...prev]);
    setTrash(prev=> prev.filter(t=>t.id!==id));
  }
  function deleteForever(id){
    if(!window.confirm("Delete this record permanently? This cannot be undone.")) return;
    setTrash(prev=> prev.filter(t=>t.id!==id));
  }

  /* CSV (admin only) — NOW WITH OWNER ASSIGNMENT */
  function onExportCSV(){
    const csv = recordsToCSV(records);
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cardinal-crm-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function onDownloadTemplate(){
    const blob = new Blob([CSV_HEADERS.join(",")+"\n"], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="crm_template.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function onImportCSV(file){
    const reader = new FileReader();
    reader.onload = (e)=>{
      const text = String(e.target?.result || "");
      const rows = parseCSV(text);
      if (!rows.length) { alert("No rows found in CSV."); return; }
      const ownerId = importOwnerId || null; // assign to selected user (or unassigned)
      const withOwner = rows.map(r => ({ ...r, ownerId }));
      setRecords(prev => [ ...withOwner, ...prev ]);
      const msg = ownerId ? ` to ${userById(ownerId)?.name || "selected user"}` : " (unassigned)";
      alert(`Imported ${withOwner.length} record(s)${msg}.`);
    };
    reader.readAsText(file);
  }

  /* NEW: bulk assign all visible rows to selected user (or No User) */
  function bulkAssignVisibleToSelected(){
    if (!isAdmin) return;
    const ownerId = importOwnerId || null;
    const targetName = ownerId ? (userById(ownerId)?.name || "selected user") : "No User";
    const ids = new Set(filtered.map(r=>r.id));
    if (ids.size === 0) { alert("No visible rows to assign."); return; }
    if (!window.confirm(`Assign ${ids.size} visible record(s) to ${targetName}?`)) return;
    setRecords(prev => prev.map(r => ids.has(r.id) ? { ...r, ownerId } : r));
  }

  /* Sort toggles */
  function toggleSortCed(){ if (sortKey!=="ced"){ setSortKey("ced"); setSortDir("asc"); } else { setSortDir(d=>d==="asc"?"desc":"asc"); } }
  function toggleSortNext(){ if (sortKey!=="nextcall"){ setSortKey("nextcall"); setSortDir("asc"); } else { setSortDir(d=>d==="asc"?"desc":"asc"); } }

  /* Cell clamp helper */
  function Cell({ children, title, maxCh = 30, style }){
    return (
      <span
        title={title ?? String(children ?? "")}
        style={{
          maxWidth: `${maxCh}ch`,
          display: "inline-block",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          verticalAlign: "top",
          ...style,
        }}
      >{children}</span>
    );
  }

  /* Snooze */
  function snooze(rec, minutes=60){
    const base = combineDateTime(rec.nextCallDate, rec.nextCallTime) || new Date();
    const d = new Date(base.getTime() + minutes*60000);
    const yyyy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0"),
          hh=String(d.getHours()).padStart(2,"0"), mn=String(d.getMinutes()).padStart(2,"0");
    upsert({...rec, nextCallDate:`${yyyy}-${mm}-${dd}`, nextCallTime:`${hh}:${mn}`});
  }

  /* ---------- Login gate ---------- */
  if (!currentUser) {
    const handleCreateFirstAdmin = ({name, email, pin})=>{
      const admin = makeUser({name, email, role:"admin", pin});
      setUsers([admin]);
      setSession({ userId: admin.id });
    };
    const handleLogin = (email, pin)=>{
      const u = users.find(x=>x.email===email && x.active);
      if (!u) { alert("User not found or inactive"); return; }
      if (String(pin) !== String(u.pin)) { alert("Wrong PIN"); return; }
      setSession({ userId: u.id });
    };
    return <LoginScreen users={users} onCreateFirstAdmin={handleCreateFirstAdmin} onLogin={handleLogin} />;
  }

  /* --------------------------------- UI ---------------------------------- */
  return (
    <div style={{ padding: 20, fontFamily: "system-ui, Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Cardinal Energy — Lightweight CRM</h1>
          <div style={{ fontSize:12, color:"#666" }}>
            Signed in as <strong>{currentUser.name}</strong> — {currentUser.role.toUpperCase()}
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {isAdmin && <button onClick={()=>setShowUsers(true)}>Users</button>}
          <button onClick={()=>setSession(null)}>Logout</button>
        </div>
      </div>

      <p style={{ marginTop:8 }}>Default order: Next Call (overdue first, then due). Click CED/Next Call headers to change sorting.</p>

      {/* Reminders (scroll after 10) */}
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <strong>Due / Overdue Reminders</strong>
        {dueOrOverdue.length===0 ? (
          <div style={{ color:"#666", marginTop:6 }}>No reminders due.</div>
        ) : (
          <div style={{
            maxHeight: dueOrOverdue.length > 10 ? 240 : "none",
            overflowY: dueOrOverdue.length > 10 ? "auto" : "visible",
            marginTop: 8
          }}>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {dueOrOverdue.map(r=>{
                const overdue = isOverdue(r.nextCallDate, r.nextCallTime);
                const label = [
                  r.company || "(no company)",
                  r.contact ? `— ${r.contact}` : "",
                  r.nextCallDate ? `— ${r.nextCallDate}${r.nextCallTime ? " " + r.nextCallTime : ""}` : "",
                ].join(" ");
                return (
                  <li key={`rem-${r.id}`} style={{ marginBottom:6 }}>
                    <span style={{ color: overdue ? "#c00" : "#333", fontWeight: overdue ? 700 : 500 }}>{label}</span>
                    {r.nextCallNotes ? <span style={{ color:"#666" }}> — {r.nextCallNotes}</span> : null}
                    <span style={{ marginLeft: 8 }}>
                      <button onClick={()=>openModal(r.id)}>Open</button>{" "}
                      <button onClick={()=>snooze(r,60)}>Snooze 1h</button>{" "}
                      <button onClick={()=>snooze(r,24*60)}>Snooze 1 day</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:12, flexWrap:"wrap" }}>
        <button onClick={addNew}>+ New Record</button>
        <input placeholder="Search…" value={query} onChange={e=>setQuery(e.target.value)} style={{ padding:"6px 8px" }}/>
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)}>
          <option>All</option>{STAGES.map(s=><option key={s}>{s}</option>)}
        </select>

        {isAdmin && (
          <>
            <select value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)} title="Filter by assignee">
              <option value="All">All assignees</option>
              {activeUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" checked={hideDNC} onChange={e=>setHideDNC(e.target.checked)}/> Hide DNC
            </label>

            <button onClick={()=>setShowBin(true)}>Bin ({trash.length})</button>
            <button onClick={onDownloadTemplate}>CSV Template</button>
            <button onClick={onExportCSV}>Export CSV</button>

            {/* NEW controls: Assign to + Import + Bulk assign */}
            <label style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
              <span>Assign to:</span>
              <select value={importOwnerId} onChange={e=>setImportOwnerId(e.target.value)}>
                <option value="">No User</option>
                {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>

            <input
              ref={fileRef} type="file" accept=".csv" style={{ display:"none" }}
              onChange={e=>{ const f=e.target.files?.[0]; if(f) onImportCSV(f); if(fileRef.current) fileRef.current.value=""; }}
            />
            <button onClick={()=>fileRef.current?.click()}>Import CSV</button>

            <button onClick={bulkAssignVisibleToSelected}>Assign visible → selected</button>
          </>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX:"auto", marginTop:12 }}>
        <table border="1" cellPadding="6" style={{ width:"100%", minWidth: isAdmin ? 1200 : 1100 }}>
          <thead>
            <tr>
              <th>View</th>
              <th>Stage</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Email</th>
              {isAdmin && <th>Owner</th>}
              <th>Meter Type</th>
              <th>MPAN (Core) / MPRN</th>
              <th>Supplier</th>
              <th style={{ cursor:"pointer" }} onClick={toggleSortCed}>
                CED {sortKey==="ced" ? (sortDir==="asc" ? "▲" : "▼") : "↕"}
              </th>
              <th style={{ cursor:"pointer" }} onClick={toggleSortNext}>
                Next Call {sortKey==="nextcall" ? (sortDir==="asc" ? "▲" : "▼") : "↕"}
              </th>
              {isAdmin && <th>Delete</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r=>{
              const nextLabel = r.nextCallDate ? `${r.nextCallDate}${r.nextCallTime ? " " + r.nextCallTime : ""}` : "";
              const phoneNorm = normPhone(r.phone);
              const isDup = phoneNorm && duplicatePhones.has(phoneNorm);
              const phoneStyle = isDup ? { color:"#c00", fontWeight:700 } : undefined;
              return (
                <tr key={r.id} title={dncSet.has(phoneNorm) ? "Do Not Call" : ""} style={dncSet.has(phoneNorm) ? { opacity:0.55 } : undefined}>
                  <td><button onClick={()=>openModal(r.id)}>View</button></td>
                  <td><Cell>{r.stage}</Cell></td>
                  <td><Cell>{r.company}</Cell></td>
                  <td><Cell>{r.contact}</Cell></td>
                  <td><Cell style={phoneStyle}>{r.phone}</Cell></td>
                  {/* clamp email & supplier to 20 chars */}
                  <td><Cell maxCh={20}>{r.email}</Cell></td>
                  {isAdmin && <td><Cell>{userById(r.ownerId)?.name || ""}</Cell></td>}
                  <td><Cell>{r.meterType}</Cell></td>
                  <td><Cell>{r.meterType==="Electric" ? r.mpanCore : r.mprn}</Cell></td>
                  <td><Cell maxCh={20}>{r.supplier}</Cell></td>
                  <td><Cell>{r.ced}</Cell></td>
                  <td><Cell>{nextLabel}</Cell></td>
                  {isAdmin && <td><button onClick={()=>openDelete(r)}>Delete</button></td>}
                </tr>
              );
            })}
            {filtered.length===0 && (
              <tr><td colSpan={isAdmin ? 13 : 11} align="center">No records yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* View/Edit Modal */}
      {draft && (
        <div style={styles.backdrop}>
          <div style={styles.modal} onClick={(e)=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h3 style={{ margin:0 }}>View / Edit: {draft.company || "New Record"}</h3>
              <button onClick={attemptCloseModal}>✕</button>
            </div>

            {/* Promote */}
            <div style={{ marginTop:10, padding:10, background:"#f7f7f7", borderRadius:6 }}>
              <strong>Promote to:</strong>{" "}
              <select value={promoteTo} onChange={e=>setPromoteTo(e.target.value)}>
                {STAGES.map(s=><option key={s}>{s}</option>)}
              </select>{" "}
              <button onClick={applyPromote}>Apply</button>
              <span style={{ marginLeft:10, color:"#666" }}>Current stage: {draft.stage}</span>
            </div>

            {/* Basic */}
            <Row>
              <Field label="Company"><input value={draft.company} onChange={e=>setDraftField("company", e.target.value)}/></Field>
              <Field label="Contact"><input value={draft.contact} onChange={e=>setDraftField("contact", e.target.value)}/></Field>
            </Row>
            <Row>
              <Field label="Phone"><input value={draft.phone} onChange={e=>setDraftField("phone", e.target.value)}/></Field>
              <Field label="Email"><input value={draft.email} onChange={e=>setDraftField("email", e.target.value)}/></Field>
            </Row>

            {/* Owner (admin) */}
            {isAdmin && (
              <Row>
                <Field label="Owner">
                  <select value={draft.ownerId || ""} onChange={e=>setDraftField("ownerId", e.target.value || null)}>
                    <option value="">— Unassigned —</option>
                    {activeUsers.map(u=><option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
                  </select>
                </Field>
              </Row>
            )}

            {/* --- Call Reminder moved up here --- */}
            <h4 style={{ marginTop:12 }}>Call Reminder</h4>
            <Row>
              <Field label="Next Call Date"><input type="date" value={draft.nextCallDate} onChange={e=>setDraftField("nextCallDate", e.target.value)}/></Field>
              <Field label="Next Call Time"><input type="time" step="900" value={draft.nextCallTime} onChange={e=>setDraftField("nextCallTime", e.target.value)}/></Field>
              <Field label="Reminder Notes"><input placeholder="e.g. callback tomorrow, confirm LOA" value={draft.nextCallNotes} onChange={e=>setDraftField("nextCallNotes", e.target.value)}/></Field>
            </Row>

            {/* Meter */}
            <h4 style={{ marginTop:12 }}>Meter</h4>
            <Row>
              <Field label="Meter Type">
                <select value={draft.meterType} onChange={e=>setDraftField("meterType", e.target.value)}>
                  <option>Electric</option><option>Gas</option>
                </select>
              </Field>
              {draft.meterType==="Electric" ? (
                <>
                  <Field label="MPAN (Top Line)">
                    <input placeholder="e.g. 01 801 123" value={draft.mpanTop} onChange={e=>setDraftField("mpanTop", e.target.value)}/>
                  </Field>
                  <Field label="MPAN (Core)">
                    <input
                      placeholder="13-digit core"
                      value={draft.mpanCore}
                      onChange={(e)=> setDraftField("mpanCore", e.target.value.replace(/\D/g,"").slice(0,13))}
                    />
                  </Field>
                </>
              ) : (
                <Field label="MPRN (Gas)">
                  <input placeholder="e.g. 1500010000000" value={draft.mprn} onChange={e=>setDraftField("mprn", e.target.value)}/>
                </Field>
              )}
            </Row>

            {/* Rates & Supplier */}
            <h4 style={{ marginTop:12 }}>Rates & Supplier</h4>
            <Row>
              <Field label="Supplier">
                <select value={draft.supplier} onChange={e=>setDraftField("supplier", e.target.value)}>
                  <option value="">-- Select --</option>
                  {SUPPLIERS.map(s=><option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Rate (p/kWh)">
                <input type="number" step="0.001" placeholder="e.g. 28.500"
                       value={draft.unitRatePPKWh} onChange={e=>setDraftField("unitRatePPKWh", e.target.value)}/>
              </Field>
              <Field label="Standing Charge (p/day)">
                <input type="number" step="0.001" placeholder="e.g. 45.000"
                       value={draft.standingChargePPD} onChange={e=>setDraftField("standingChargePPD", e.target.value)}/>
              </Field>
              <Field label="CED (Contract End Date)">
                <input type="date" value={draft.ced} onChange={e=>setDraftField("ced", e.target.value)}/>
              </Field>
            </Row>

            {/* Annual Usage ABOVE Notes */}
            <Row>
              <Field label="Annual Usage (kWh)">
                <input type="number" value={draft.annualUsageKWh} onChange={e=>setDraftField("annualUsageKWh", e.target.value)}/>
              </Field>
            </Row>

            {/* Notes */}
            <h4 style={{ marginTop:12 }}>Notes</h4>
            <Row>
              <Field label="Notes Log (most recent at top)" full>
                <textarea rows={6} readOnly value={draft.notes} style={{ width:"100%", background:"#fafafa" }}/>
              </Field>
            </Row>
            <Row>
              <Field label="Add New Note (timestamped on Save)" full>
                <textarea rows={9} value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} style={{ width:"100%" }}/>
              </Field>
            </Row>

            {/* Actions */}
            <div style={{ display:"flex", gap:8, justifyContent:"space-between", marginTop:12 }}>
              {isAdmin ? (
                <button onClick={()=>openDelete(draft)} style={{ background:"#fbe9e7", border:"1px solid #e53935" }}>Delete</button>
              ) : <span />}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={saveDraft}>Save</button>
                <button onClick={attemptCloseModal}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes prompt */}
      {showClosePrompt && (
        <div style={styles.backdrop} onClick={()=>setShowClosePrompt(false)}>
          <div style={styles.smallModal} onClick={(e)=>e.stopPropagation()}>
            <h3 style={{ marginTop:0 }}>Unsaved changes</h3>
            <p>You have unsaved changes. Do you want to save before closing?</p>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
              <button onClick={()=>setShowClosePrompt(false)}>Cancel</button>
              <button onClick={reallyCloseModal}>Discard</button>
              <button onClick={saveDraft}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && isAdmin && (
        <div style={styles.backdrop} onClick={closeDelete}>
          <div style={styles.smallModal} onClick={(e)=>e.stopPropagation()}>
            <h3 style={{ marginTop:0 }}>Delete “{deleteTarget.company || deleteTarget.contact || deleteTarget.phone || "record"}”</h3>
            <p>
              {deleteTarget.stage==="Prospect"
                ? "Choose a reason before deleting. You can also add the phone to a Do Not Call list."
                : "Are you sure you want to delete this record? (You can restore it later from Bin.)"}
            </p>

            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:12, color:"#555", marginBottom:4 }}>Reason</div>
              <select value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} style={{ width:"100%" }}>
                <option>Not interested</option>
                <option>Dead line</option>
                <option>Business closed</option>
                <option>Moved premises</option>
                <option>Duplicate lead</option>
                <option>Wrong contact</option>
              </select>
            </div>

            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={deleteAddDNC} onChange={e=>setDeleteAddDNC(e.target.checked)}/>
              Add phone to Do Not Call
            </label>

            <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:16 }}>
              <button onClick={closeDelete}>Cancel</button>
              <button onClick={confirmDelete} style={{ background:"#fbe9e7", border:"1px solid #e53935" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Recycle Bin (admin) */}
      {showBin && isAdmin && (
        <div style={styles.backdrop} onClick={()=>setShowBin(false)}>
          <div style={styles.binModal} onClick={(e)=>e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h3 style={{ margin:0 }}>Recycle Bin</h3>
              <button onClick={()=>setShowBin(false)}>✕</button>
            </div>
            {trash.length===0 ? (
              <div style={{ color:"#666", marginTop:8 }}>Bin is empty.</div>
            ) : (
              <div style={{ overflowX:"auto", marginTop:10 }}>
                <table border="1" cellPadding="6" style={{ width:"100%", minWidth:900 }}>
                  <thead>
                    <tr>
                      <th>Deleted</th>
                      <th>Stage</th>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Phone</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trash.map(t=>(
                      <tr key={t.id}>
                        <td><Cell>{t.deletedAt}</Cell></td>
                        <td><Cell>{t.stage}</Cell></td>
                        <td><Cell>{t.company}</Cell></td>
                        <td><Cell>{t.contact}</Cell></td>
                        <td><Cell>{t.phone}</Cell></td>
                        <td><Cell>{t.deleteReason}</Cell></td>
                        <td>
                          <button onClick={()=>restoreFromTrash(t.id)}>Restore</button>{" "}
                          <button onClick={()=>deleteForever(t.id)} style={{ background:"#fbe9e7", border:"1px solid #e53935" }}>Delete forever</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Users (Admin only) */}
      {showUsers && isAdmin && (
        <UsersModal
          users={users}
          setUsers={setUsers}
          onClose={()=>setShowUsers(false)}
          records={records}
          setRecords={setRecords}
        />
      )}
    </div>
  );
}

/* --------------------------- Users Management ---------------------------- */
function UsersModal({ users, setUsers, onClose, records, setRecords }) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin]     = useState("");
  const [role, setRole]   = useState("agent");
  const [editingId, setEditingId] = useState(null);

  const activeUsers = users.filter(u=>u.active);
  const assignable  = users.filter(u=>u.active);

  function addUser() {
    if (!name || !email) { alert("Name and email required"); return; }
    const u = makeUser({name, email, pin: pin || "1234", role});
    setUsers(prev=>[...prev, u]);
    setName(""); setEmail(""); setPin(""); setRole("agent");
  }
  function saveEdit() {
    if (!editingId) return;
    setUsers(prev => prev.map(u => u.id===editingId ? {...u, name, email, role, pin: pin || u.pin} : u));
    setEditingId(null); setName(""); setEmail(""); setPin(""); setRole("agent");
  }
  function startEdit(u){
    setEditingId(u.id); setName(u.name); setEmail(u.email); setPin(""); setRole(u.role);
  }
  function deactivate(u){
    if (!window.confirm(`Deactivate ${u.name}? They won't be able to log in.`)) return;
    const others = assignable.filter(x=>x.id!==u.id);
    if (others.length) {
      const reass = window.confirm("Reassign their records to another active user?");
      if (reass) {
        const target = prompt(`Enter the email of the new owner (${others.map(o=>o.email).join(", ")})`);
        const to = users.find(x=>x.email===target && x.active);
        if (to) setRecords(prev=> prev.map(r=> r.ownerId===u.id ? {...r, ownerId: to.id} : r));
      }
    }
    setUsers(prev => prev.map(x=> x.id===u.id ? {...x, active:false} : x));
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.binModal} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h3 style={{ margin:0 }}>Users & Roles</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div style={{ marginTop:10, display:"grid", gap:8 }}>
          <div style={{ fontWeight:600 }}>Add / Edit User</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
            <input placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} />
            <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input placeholder="PIN (4–6 digits)" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} />
            <select value={role} onChange={e=>setRole(e.target.value)}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            {editingId
              ? <button onClick={saveEdit}>Save changes</button>
              : <button onClick={addUser}>Add user</button>}
            {editingId && (
              <button
                onClick={()=>{ setEditingId(null); setName(""); setEmail(""); setPin(""); setRole("agent"); }}
                style={{ marginLeft:8 }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop:16 }}>
          <table border="1" cellPadding="6" style={{ width:"100%", minWidth:900 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.active ? "Yes" : "No"}</td>
                  <td>{new Date(u.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={()=>startEdit(u)}>Edit</button>{" "}
                    {u.active && (
                      <button
                        onClick={()=>deactivate(u)}
                        style={{ background:"#fff3cd", border:"1px solid #f0ad4e" }}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} align="center">No users</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop:10, fontSize:12, color:"#666" }}>
          Note: This is a local demo. For real authentication & permissions, use a backend (e.g., Supabase/Firebase/Auth0).
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- UI tiny bits ------------------------------ */
function Row({ children }){
  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:"repeat(4, minmax(0, 1fr))",
      gap:12, alignItems:"end", marginTop:8
    }}>{children}</div>
  );
}
function Field({ label, children, full }){
  return (
    <label style={{ display:"block", gridColumn: full ? "1 / -1" : "auto" }}>
      <div style={{ fontSize:12, color:"#555", marginBottom:4 }}>{label}</div>
      {children}
    </label>
  );
}
const styles = {
  centerBox: {
    minHeight: "100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12
  },
  backdrop: {
    position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
    display:"flex", alignItems:"center", justifyContent:"center",
    padding:16, zIndex:50,
  },
  modal: {
    width:"min(1000px, 96vw)", maxHeight:"90vh", overflowY:"auto",
    background:"#fff", borderRadius:10, padding:16,
    boxShadow:"0 10px 30px rgba(0,0,0,0.25)",
  },
  smallModal: {
    width:"min(520px, 96vw)", background:"#fff", borderRadius:10, padding:16,
    boxShadow:"0 10px 30px rgba(0,0,0,0.25)",
  },
  binModal: {
    width:"min(1100px, 96vw)", maxHeight:"90vh", overflowY:"auto",
    background:"#fff", borderRadius:10, padding:16,
    boxShadow:"0 10px 30px rgba(0,0,0,0.25)",
  },
};
