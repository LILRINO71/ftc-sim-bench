/* ============================================================
   9.  UI
   ============================================================ */
const $=s=>document.querySelector(s);
let CODE=null, CAD=null, MAP={}, FINDINGS=[], activePad=2;
const OPTS={payloadKg:0.180, duty:0.30, trust:"code"};
let IGNORED={};
try{ IGNORED=JSON.parse(localStorage.getItem("ftcbench.ignored")||"{}")||{}; }catch(e){ IGNORED={}; }
function saveIgnored(){ try{ localStorage.setItem("ftcbench.ignored",JSON.stringify(IGNORED)); }catch(e){} }

function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

/* ---------- gamepad ---------- */
const PAD_GEO=[
  {id:"left_bumper", x:78,  y:26, w:62, h:17, r:8,  t:"LB"},
  {id:"right_bumper",x:288, y:26, w:62, h:17, r:8,  t:"RB"},
  {id:"left_trigger",x:82,  y:6,  w:54, h:14, r:7,  t:"LT"},
  {id:"right_trigger",x:292,y:6,  w:54, h:14, r:7,  t:"RT"},
  {id:"y", cx:322, cy:70, r:14, t:"Y"},
  {id:"b", cx:346, cy:94, r:14, t:"B"},
  {id:"a", cx:322, cy:118,r:14, t:"A"},
  {id:"x", cx:298, cy:94, r:14, t:"X"},
  {id:"dpad_up",   x:96, y:82, w:17, h:19, r:3, t:"↑"},
  {id:"dpad_down", x:96, y:117,w:17, h:19, r:3, t:"↓"},
  {id:"dpad_left", x:78, y:100,w:19, h:17, r:3, t:"←"},
  {id:"dpad_right",x:113,y:100,w:19, h:17, r:3, t:"→"},
  {id:"back",  x:176, y:80, w:26, h:13, r:6, t:"BK"},
  {id:"start", x:226, y:80, w:26, h:13, r:6, t:"ST"}
];
const STICKS=[{id:"left", cx:160, cy:141, r:22, ax:"left_stick_x", ay:"left_stick_y", t:"LS"},
              {id:"right",cx:266, cy:141, r:22, ax:"right_stick_x",ay:"right_stick_y",t:"RS"}];

function boundMap(){
  const b={};
  if(CODE) for(const bd of CODE.bindings) if(bd.pad===activePad){
    (b[bd.btn]=b[bd.btn]||[]).push(bd);
    if(bd.axes) bd.axes.forEach(a=>{ const r=splitPadRef(a); if(r) (b[r.btn]=b[r.btn]||[]).push(bd); });
  }
  return b;
}
function renderPad(){
  const bound=boundMap();
  let s=`<svg class="padsvg" viewBox="0 0 428 194" role="group" aria-label="Virtual FTC gamepad ${activePad}">`;
  s+=`<path class="shell" d="M60 60 Q60 34 92 34 L336 34 Q368 34 368 60 L368 96
      Q368 134 340 152 Q318 166 300 148 L272 120 L156 120 L128 148
      Q110 166 88 152 Q60 134 60 96 Z"/>`;
  s+=`<text class="cap" x="214" y="60">gamepad${activePad}</text>`;
  for(const g of PAD_GEO){
    const bd=bound[g.id];
    const cls="btn"+(bd?" bound":"");
    const aria=bd?`${g.t}: ${describe(bd)}`:`${g.t}: unbound`;
    if(g.cx!==undefined){
      s+=`<circle class="${cls}" data-btn="${g.id}" cx="${g.cx}" cy="${g.cy}" r="${g.r}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title></circle>`;
      s+=`<text class="lbl" x="${g.cx}" y="${g.cy}">${g.t}</text>`;
    }else{
      s+=`<rect class="${cls}" data-btn="${g.id}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${g.r}" tabindex="0" role="button" aria-label="${esc(aria)}"><title>${esc(aria)}</title></rect>`;
      s+=`<text class="lbl" x="${g.x+g.w/2}" y="${g.y+g.h/2}">${g.t}</text>`;
    }
  }
  for(const k of STICKS){
    const bd=bound[k.ax]||bound[k.ay];
    const aria=bd?`${k.t} stick: ${describe(bd)}`:`${k.t} stick: unbound`;
    s+=`<circle class="stickwell${bd?" bound":""}" data-stick="${k.id}" cx="${k.cx}" cy="${k.cy}" r="${k.r}" tabindex="0" role="slider" aria-label="${esc(aria)}"><title>${esc(aria)}</title></circle>`;
    s+=`<circle class="stickknob" data-knob="${k.id}" cx="${k.cx}" cy="${k.cy}" r="7"/>`;
    s+=`<text class="lbl" x="${k.cx}" y="${k.cy+k.r+8}">${k.t}</text>`;
  }
  s+=`</svg>`;
  $("#padwrap").innerHTML=s;

  $("#padwrap").querySelectorAll("[data-btn]").forEach(el=>{
    const b=el.dataset.btn;
    const dn=e=>{ if(e.cancelable) e.preventDefault(); Sim.pad[activePad][b]=true; el.classList.add("down"); };
    const up=()=>{ Sim.pad[activePad][b]=false; el.classList.remove("down"); };
    el.addEventListener("pointerdown",dn);
    el.addEventListener("pointerup",up);
    el.addEventListener("pointerleave",up);
    el.addEventListener("keydown",e=>{ if(e.key===" "||e.key==="Enter") dn(e); });
    el.addEventListener("keyup",e=>{ if(e.key===" "||e.key==="Enter") up(); });
  });
  STICKS.forEach(k=>{
    const well=$(`[data-stick="${k.id}"]`), knob=$(`[data-knob="${k.id}"]`);
    if(!well) return;
    let dragging=false;
    const set=(dx,dy)=>{
      const L=Math.hypot(dx,dy), max=k.r-7;
      if(L>max){ dx*=max/L; dy*=max/L; }
      knob.setAttribute("cx",k.cx+dx); knob.setAttribute("cy",k.cy+dy);
      Sim.pad[activePad][k.ax]= +(dx/max).toFixed(3);
      Sim.pad[activePad][k.ay]= +(dy/max).toFixed(3);   // down is positive, as on a real pad
    };
    const rel=()=>{ dragging=false; knob.setAttribute("cx",k.cx); knob.setAttribute("cy",k.cy);
      Sim.pad[activePad][k.ax]=0; Sim.pad[activePad][k.ay]=0; };
    const toLocal=e=>{
      const svg=$("#padwrap svg"); const r=svg.getBoundingClientRect();
      const sx=428/r.width, sy=194/r.height;
      return [(e.clientX-r.left)*sx-k.cx, (e.clientY-r.top)*sy-k.cy];
    };
    well.addEventListener("pointerdown",e=>{ dragging=true; well.setPointerCapture(e.pointerId);
      const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointermove",e=>{ if(!dragging) return; const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointerup",rel);
    well.addEventListener("pointercancel",rel);
    well.addEventListener("keydown",e=>{
      const s=0.5; let dx=0,dy=0;
      if(e.key==="ArrowLeft")dx=-s; else if(e.key==="ArrowRight")dx=s;
      else if(e.key==="ArrowUp")dy=-s; else if(e.key==="ArrowDown")dy=s; else return;
      e.preventDefault(); set(dx*(k.r-7),dy*(k.r-7));
    });
    well.addEventListener("blur",rel);
  });
  renderBindList();
}
function describe(bds){
  const list=Array.isArray(bds)?bds:[bds];
  const seen={};
  return list.map(b=>{
    const key=b.dev+b.op+b.expr; if(seen[key]) return null; seen[key]=1;
    return b.assign ? `${b.dev} ${b.op} ${b.expr}` : `${b.dev}.${b.op}(${b.expr})`;
  }).filter(Boolean).join("  ·  ");
}
function renderBindList(){
  if(!CODE){ $("#bindlist").innerHTML=""; return; }
  const bs=CODE.bindings.filter(b=>b.pad===activePad);
  if(!bs.length){ $("#bindlist").innerHTML=
    `<div class="bindrow"><span class="bk">—</span><span class="bd" style="color:var(--tx-3)">Nothing on gamepad${activePad} in this OpMode.</span></div>`; return; }
  const byBtn={};
  for(const b of bs) (byBtn[b.btn]=byBtn[b.btn]||[]).push(b);
  $("#bindlist").innerHTML=Object.keys(byBtn).map(btn=>{
    const g=byBtn[btn];
    const label=btn.replace(/^dpad_/,"D-").replace(/left_bumper/,"LB").replace(/right_bumper/,"RB")
                   .replace(/left_trigger/,"LT").replace(/right_trigger/,"RT")
                   .replace(/left_stick_/,"LS ").replace(/right_stick_/,"RS ")
                   .replace(/_/g," ").toUpperCase();
    const analog=g[0].analog;
    return `<div class="bindrow" data-btn="${btn}">
      <span class="bk">${esc(label.slice(0,7))}</span>
      <span class="bd"><b>${esc(describe(g))}</b>
      <span class="edge">${analog?"analog — follows the stick":(g[0].cond?"when "+esc(g[0].cond.trim().slice(0,52)):"while held")}</span></span></div>`;
  }).join("");
}

/* ---------- gauges ---------- */
const ARC_R=34, ARC_A0=Math.PI*0.78, ARC_A1=Math.PI*2.22;
function arcPath(t0,t1){
  const a0=ARC_A0+(ARC_A1-ARC_A0)*t0, a1=ARC_A0+(ARC_A1-ARC_A0)*t1;
  const x0=48+ARC_R*Math.cos(a0), y0=44+ARC_R*Math.sin(a0);
  const x1=48+ARC_R*Math.cos(a1), y1=44+ARC_R*Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${ARC_R} ${ARC_R} 0 ${(a1-a0)>Math.PI?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function buildGauges(){
  if(!CODE){ $("#gauges").innerHTML=""; return; }
  if(!CODE.devices.length){ $("#gauges").innerHTML=`<p class="meta" style="grid-column:1/-1">No devices to show.</p>`; return; }
  $("#gauges").innerHTML=CODE.devices.map(d=>{
    const s=Sim.dev[d.name];
    const isMotor=s&&s.kind==="motor";
    const r=travelRange(CODE,d.name);
    const lo=isMotor?0:(r?r.lo:0), hi=isMotor?1:(r?r.hi:1);
    const spec=s?s.spec:null;
    return `<div class="gauge" data-dev="${esc(d.name)}" data-motor="${isMotor?1:0}">
      <div class="stallflag" style="display:none">STALL</div>
      <svg viewBox="0 0 96 78">
        <path class="g-track" d="${arcPath(0,1)}"/>
        ${isMotor?"":`<path class="g-range" d="${arcPath(lo,hi)}"/>`}
        <path class="g-fill" d="${arcPath(0,0.001)}" data-fill></path>
        <line class="g-cmd" data-cmd x1="48" y1="44" x2="48" y2="12"></line>
        <text x="48" y="46" text-anchor="middle" dominant-baseline="central"
              style="font-family:var(--mono);font-size:15px;font-weight:700;fill:var(--tx)" data-val>0.00</text>
        <text x="48" y="61" text-anchor="middle" style="font-family:var(--mono);font-size:8.5px;fill:var(--tx-3)" data-deg>—</text>
      </svg>
      <div class="gname">${esc(d.name)}</div>
      <div class="gsub">${spec?esc(isMotor?"power":spec.role):"unmapped"}</div>
    </div>`;
  }).join("");
}
function updateGauges(){
  document.querySelectorAll(".gauge").forEach(el=>{
    const s=Sim.dev[el.dataset.dev]; if(!s) return;
    const isMotor=el.dataset.motor==="1";
    const t=isMotor? (s.act+1)/2 : clamp01(s.act);
    const tc=isMotor? (s.cmd+1)/2 : clamp01(s.cmd);
    el.querySelector("[data-fill]").setAttribute("d",arcPath(isMotor?0.5:0,Math.max(0.002,t)));
    const a=ARC_A0+(ARC_A1-ARC_A0)*clamp01(tc);
    const ln=el.querySelector("[data-cmd]");
    ln.setAttribute("x2",(48+ARC_R*1.14*Math.cos(a)).toFixed(2));
    ln.setAttribute("y2",(44+ARC_R*1.14*Math.sin(a)).toFixed(2));
    el.querySelector("[data-val]").textContent = isMotor? s.act.toFixed(2) : s.act.toFixed(2);
    el.querySelector("[data-deg]").textContent = isMotor
      ? ((s.spec.rpm||0)*s.act).toFixed(0)+" rpm"
      : (s.act*s.travelDeg).toFixed(0)+"°";
    el.classList.toggle("stalled",s.stalled);
    el.querySelector(".stallflag").style.display=s.stalled?"block":"none";
  });
}

/* ---------- side elevation (the torque angle) ---------- */
function renderMech(){
  const M=CAD?CAD.mechs:[];
  const byKind=k=>M.filter(m=>m.kind===k)[0]||null;
  const R={lift:byKind("revolute-lift"), yaw:byKind("revolute-yaw"), eff:byKind("effector")};
  const liftDev=R.lift?deviceOn(R.lift.id):null;
  const effDev =R.eff ?deviceOn(R.eff.id ):null;
  const yawDev =R.yaw ?deviceOn(R.yaw.id ):null;
  const aS=liftDev?Sim.dev[liftDev]:null, cS=effDev?Sim.dev[effDev]:null, yS=yawDev?Sim.dev[yawDev]:null;
  if(!R.lift||!aS)
    return `<svg viewBox="0 0 340 150" role="img" aria-label="No lift joint"><rect width="340" height="150" fill="#0E1218"/>
      <text x="170" y="70" text-anchor="middle" style="font-family:var(--mono);font-size:11px;fill:#5C6B7D">no lift joint mapped</text>
      <text x="170" y="88" text-anchor="middle" style="font-family:var(--mono);font-size:9px;fill:#44515F">this view shows the angle a lifting joint works at</text></svg>`;

  const L=leverOf(R.lift)*1000||163;
  const ang=(R.lift.restAngleDeg + (aS.act-aS.restPos)*aS.travelDeg) * Math.PI/180;
  const PX=140, PY=64, ARM=104;
  const ex=PX+Math.cos(ang)*ARM, ey=PY-Math.sin(ang)*ARM;
  const open=cS?(1-clamp01(cS.act))*12+4:8;
  const stall=aS.stalled;
  const degTxt=(ang*180/Math.PI).toFixed(0);
  return `<svg viewBox="0 0 340 170" role="img" aria-label="Side elevation: lift arm at ${degTxt} degrees from horizontal">
    <rect width="340" height="170" fill="#0E1218"/>
    <line x1="0" y1="152" x2="340" y2="152" stroke="#26313F"/>
    <line x1="${PX}" y1="${PY}" x2="325" y2="${PY}" stroke="#2E3A49" stroke-dasharray="3 3"/>
    <text x="327" y="${PY+3}" style="font-family:var(--mono);font-size:8px;fill:#4E5C6D" text-anchor="end">horizontal</text>
    <rect x="${PX-40}" y="126" width="80" height="26" rx="3" fill="#1C242F" stroke="#2F3B4A"/>
    <text x="${PX}" y="142" text-anchor="middle" style="font-family:var(--mono);font-size:8px;fill:#6F7F92">FRAME · fixed</text>
    ${yS?`<text x="328" y="${PY+34}" text-anchor="end" style="font-family:var(--mono);font-size:9px;fill:#8B9BAF">${esc(mlabel(R.yaw))} turret ${((yS.act-yS.restPos)*yS.travelDeg).toFixed(0)}°</text>
    <text x="328" y="${PY+46}" text-anchor="end" style="font-family:var(--mono);font-size:8px;fill:#5C6B7D">swings the whole arm</text>`:""}
    <rect x="${PX-8}" y="${PY}" width="16" height="${126-PY}" fill="#222E3B" stroke="#33414F"/>
    <line x1="${PX}" y1="${PY}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${stall?"#E4574E":"#4D9FFF"}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${PX}" cy="${PY}" r="9" fill="#0E1218" stroke="${stall?"#E4574E":"#4D9FFF"}" stroke-width="3"/>
    <g transform="translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(-ang*180/Math.PI).toFixed(1)})">
      <line x1="0" y1="0" x2="15" y2="${(-open).toFixed(1)}" stroke="#3FB68B" stroke-width="4.5" stroke-linecap="round"/>
      <line x1="0" y1="0" x2="15" y2="${open.toFixed(1)}" stroke="#3FB68B" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="0" cy="0" r="5.5" fill="#0E1218" stroke="#3FB68B" stroke-width="2.5"/>
    </g>
    <text x="12" y="20" style="font-family:var(--mono);font-size:9.5px;fill:#8B9BAF">${L.toFixed(0)} mm lever</text>
    <text x="12" y="34" style="font-family:var(--mono);font-size:9.5px;fill:${Math.abs(+degTxt)<12?"#E0A42E":"#6F7F92"}">${degTxt}° off horizontal</text>
    ${stall?`<rect x="196" y="10" width="132" height="22" rx="3" fill="#2E1715" stroke="#E4574E"/>
      <text x="262" y="25" text-anchor="middle" style="font-family:var(--mono);font-size:9.5px;font-weight:700;fill:#E4574E">STALLED — CAN'T LIFT</text>`:""}
  </svg>`;
}

/* ---------- telemetry ---------- */
function renderDS(){
  if(!CODE) return "";
  let out="";
  const env=Sim.env();
  for(const t of CODE.telemetry){
    if(t.kind==="addLine"){ out+= t.label? `<div class="dsl">${esc(t.label)}</div>` : `<div>&nbsp;</div>`; continue; }
    let v="—";
    const em=/^([A-Za-z_$][\w$]*)\s*\.\s*get(Position|Power)\s*\(\s*\)$/.exec(t.expr);
    if(em&&Sim.dev[em[1]]) v=Sim.dev[em[1]].cmd.toFixed(3);
    else{
      const ast=parseExpr(t.expr);
      if(ast){ const n=evalNode(ast,env); if(isFinite(n)) v=n.toFixed(3); }
    }
    out+=`<div><span class="dsk">${esc(t.label)} :</span> <span class="dsv">${esc(v)}</span></div>`;
  }
  out+=`<div class="dshr">────────────────────────</div>`;
  out+=`<div><span class="dsk">loop</span> <span class="dsv">${Sim.t.toFixed(1)} s @ 50 Hz</span></div>`;
  if(Sim.drivetrain&&Sim.drivetrain.ok)
    out+=`<div><span class="dsk">pose</span> <span class="dsv">x ${Sim.chassis.x.toFixed(2)} m   y ${Sim.chassis.y.toFixed(2)} m   ${(Sim.chassis.h*180/Math.PI).toFixed(0)}°</span></div>`;
  const st=Object.keys(Sim.dev).filter(k=>Sim.dev[k].stalled);
  out+= st.length
    ? `<div><span class="dsk">bench</span> <span style="color:#E4574E">STALL on ${esc(st.join(", "))} — commanded position not reached</span></div>`
    : `<div><span class="dsk">bench</span> <span class="dsv">all actuators tracking command</span></div>`;
  return out;
}

/* ---------- tables ---------- */
function renderTables(){
  const mapT=$("#mapTable");
  if(!CODE.devices.length){ mapT.innerHTML=`<tr><td class="meta">No devices found in this OpMode.</td></tr>`; }
  else mapT.innerHTML=`<tr><th>device</th><th>mechanism</th><th>role</th><th>N·m</th><th>lever</th></tr>`+
    CODE.devices.map(d=>{
      const opts=[`<option value="">— none —</option>`].concat(
        CAD.mechs.map(m=>`<option value="${esc(m.id)}"${MAP[d.name]===m.id?" selected":""}>${esc(mlabel(m))}</option>`)).join("");
      const mech=CAD.mechs.filter(m=>m.id===MAP[d.name])[0]||null;
      const spec=specFor(d,mech,OPTS.trust);
      const roles=["Torque","Speed","Servo","Motor","CR"];
      const ropts=roles.map(r=>`<option value="${r}"${spec.role===r?" selected":""}>${r}</option>`).join("");
      const lever = mech&&mech.kind!=="fixed"&&mech.kind!=="effector"
        ? `<input class="mini" type="number" step="1" min="0" data-lever="${esc(d.name)}" value="${(leverOf(mech)*1000).toFixed(0)}" aria-label="Lever length for ${esc(d.name)} in mm">`
        : `<span style="color:var(--tx-3)">—</span>`;
      return `<tr><td class="mono" title="${esc(d.type+"  ·  "+(d.cfg?'"'+d.cfg+'"':"no config")+"  ·  "+spec.fam+"  ·  from "+spec.src)}">${esc(d.name)}</td>
        <td><select data-dev="${esc(d.name)}" aria-label="Mechanism for ${esc(d.name)}">${opts}</select></td>
        <td><select data-role="${esc(d.name)}" aria-label="Actuator role for ${esc(d.name)}">${ropts}</select></td>
        <td><input class="mini" type="number" step="0.05" min="0" data-nm="${esc(d.name)}"
             value="${(spec.stallNm||0).toFixed(2)}" aria-label="Stall torque for ${esc(d.name)}"></td>
        <td>${lever}</td></tr>`;
    }).join("");
  mapT.querySelectorAll("[data-role]").forEach(s=>s.addEventListener("change",()=>{
    const n=s.dataset.role;
    HW_USER[n]=Object.assign({},HW_USER[n],{role:s.value,
      kind:(s.value==="Motor"?"motor":s.value==="CR"?"crservo":"servo")});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-nm]").forEach(i=>i.addEventListener("change",()=>{
    const v=parseFloat(i.value); const n=i.dataset.nm;
    HW_USER[n]=Object.assign({},HW_USER[n],{stallNm:(isFinite(v)&&v>0)?v:undefined});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("select").forEach(sel=>sel.addEventListener("change",()=>{
    MAP[sel.dataset.dev]=sel.value||null; rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-lever]").forEach(inp=>inp.addEventListener("change",()=>{
    const mech=CAD.mechs.filter(m=>m.id===MAP[inp.dataset.lever])[0];
    if(mech){ const v=parseFloat(inp.value);
      mech.leverOverride = (isFinite(v)&&v>0)? v/1000 : null; mech.inferred=false; rebuild(); saveRig(); }
  }));
  $("#mapPill").textContent=CODE.devices.length+" device"+(CODE.devices.length===1?"":"s");

  const tt=$("#treeTable");
  const srt=CAD.parts.slice().sort((a,b)=>{
    const r=(x)=>x.kind==="servo"||x.kind==="motor"?0:1;
    return r(a)-r(b) || a.name.localeCompare(b.name); });
  tt.innerHTML=`<tr><th>part</th><th style="text-align:right">qty</th><th>id</th></tr>`+
    srt.map(p=>`<tr><td>${esc(p.name)}${(p.kind==="servo"||p.kind==="motor")?' <span class="tag mut">'+p.kind+'</span>':""}</td>
      <td class="num" style="color:var(--tx-3)">${p.n}</td>
      <td class="mono" style="color:var(--tx-3);font-size:10.5px">${esc(p.part||"")}</td></tr>`).join("");
  $("#partPill").textContent=CAD.parts.reduce((s,p)=>s+p.n,0)+" occurrences";
}

/* ============================================================
   THE RIG DOCUMENT
   Detection only seeds this. Once written down it is the model
   everything runs on, it survives reloads, and it can be pasted
   into a repo so next season starts from last season's rig
   instead of from whatever the CAD happened to be guessable.
   ============================================================ */
let HW_USER={};            // per-device spec overrides
function rigKey(){ return "ftcbench.rig."+((CAD&&CAD.name)||"sample"); }
function exportRig(){
  return {
    format:"ftc-sim-bench.rig", version:1,
    cad:(CAD&&CAD.name)||null, opmode:(CODE&&CODE.opmode)||null,
    trust:OPTS.trust, payloadKg:OPTS.payloadKg, duty:OPTS.duty, turretScale:View.turretScale,
    joints:(CAD?CAD.mechs:[]).map(m=>({
      id:m.id, label:m.label||m.id, kind:m.kind, parent:m.parent, dir:m.dir||1,
      pivotMm:m.pivot?m.pivot.map(v=>+(v*1000).toFixed(1)):null,
      axis:m.axis?m.axis.map(v=>+v.toFixed(4)):null,
      leverMm:m.leverOverride!=null?+(m.leverOverride*1000).toFixed(1):null,
      part:m.part||null, manual:!!m.manual, inferred:!!m.inferred })),
    devices:MAP, hardware:HW_USER, ignored:Object.keys(IGNORED)
  };
}
function applyRig(r){
  if(!r||!CAD) return false;
  if(r.trust) OPTS.trust=r.trust;
  if(typeof r.payloadKg==="number") OPTS.payloadKg=r.payloadKg;
  if(typeof r.duty==="number") OPTS.duty=r.duty;
  if(typeof r.turretScale==="number") View.turretScale=r.turretScale;
  const byId={}; CAD.mechs.forEach(m=>byId[m.id]=m);
  for(const j of (r.joints||[])){
    let m=byId[j.id];
    if(!m){
      if(!j.manual && !j.pivotMm) continue;      // a joint from a CAD we no longer have
      m={id:j.id, cluster:[], part:j.part||null, partName:null, hasActuator:false};
      CAD.mechs.push(m); byId[j.id]=m;
    }
    m.label=j.label||m.label||m.id;
    if(j.kind) m.kind=j.kind;
    if(j.parent) m.parent=j.parent;
    m.dir=j.dir||1;
    if(j.pivotMm) m.pivot=j.pivotMm.map(v=>v/1000);
    if(j.axis) m.axis=j.axis;
    m.leverOverride = (j.leverMm!=null)? j.leverMm/1000 : null;
    m.manual=!!j.manual;
    m.inferred=!!j.inferred;
  }
  if(r.devices) MAP=Object.assign({},MAP,r.devices);
  HW_USER=r.hardware||{};
  if(r.ignored){ IGNORED={}; r.ignored.forEach(k=>IGNORED[k]=1); }
  recomputeChain(CAD.mechs);
  return true;
}
function saveRig(){
  try{ localStorage.setItem(rigKey(),JSON.stringify(exportRig())); }catch(e){}
  const ta=$("#rigJson"); if(ta&&document.activeElement!==ta) ta.value=JSON.stringify(exportRig(),null,1);
}
function loadSavedRig(){
  try{ const s=localStorage.getItem(rigKey()); if(!s) return false; return applyRig(JSON.parse(s)); }
  catch(e){ return false; }
}
/* Any part occurrence in the assembly can host a joint, so a mechanism the
   detector never grouped is still one dropdown away. */
function rigSpots(){
  if(!CAD||!CAD.placements) return [];
  const out=[], seen={};
  for(const p of CAD.placements){
    if(!p.child||!p.loc||!p.loc.some(v=>v!==0)) continue;
    const key=p.child+"|"+p.loc.map(v=>v.toFixed(3)).join(",");
    if(seen[key]) continue; seen[key]=1;
    out.push({name:p.child, loc:p.loc, axis:p.axis});
    if(out.length>=400) break;
  }
  out.sort((a,b)=>a.name.localeCompare(b.name));
  return out;
}
function addManualJoint(){
  if(!CAD) return;
  const c=[0,1,2].map(i=>(CAD.bbox.min[i]+CAD.bbox.max[i])/2);
  let n=1; while(CAD.mechs.some(m=>m.id==="joint "+n)) n++;
  CAD.mechs.push({id:"joint "+n, label:"joint "+n, kind:"fixed", parent:"chassis", dir:1,
    axis:[0,0,1], pivot:c, cluster:[], part:null, partName:null,
    hasActuator:false, manual:true, inferred:false, leverOverride:null});
  rigChanged();
}

/* ---------- kinematics: every inference, editable ---------- */
function renderRig(){
  const M=CAD.mechs;
  const t=$("#rigTable");
  if(!M.length){ t.innerHTML=`<tr><td class="meta">No mechanisms found in this CAD.</td></tr>`;
    $("#rigChain").innerHTML=""; $("#rigPill").textContent="none"; return; }
  const spots=rigSpots();
  const spotOpts=spots.map((s,i)=>
    `<option value="${i}">${esc(s.name.slice(0,30))} (${s.loc.map(v=>(v*1000).toFixed(0)).join(",")})</option>`).join("");
  RIG_SPOTS=spots;
  t.innerHTML=`<tr><th>name</th><th>joint</th><th>moves with</th><th>pivot at</th><th>dir</th><th></th></tr>`+
    M.map(m=>{
      const kopts=Object.keys(JOINT_KINDS).map(k=>
        `<option value="${k}"${m.kind===k?" selected":""}>${JOINT_KINDS[k].label}</option>`).join("");
      const popts=[`<option value="chassis"${m.parent==="chassis"?" selected":""}>chassis (frame)</option>`]
        .concat(M.filter(x=>x.id!==m.id).map(x=>
          `<option value="${esc(x.id)}"${m.parent===x.id?" selected":""}>${esc(mlabel(x))}</option>`)).join("");
      const dot=m.inferred?`<span class="guess" title="inferred — confirm or change it"></span>`
                          :`<span class="guess set" title="you set this"></span>`;
      return `<tr class="${m.manual?"manual":""}">
        <td><input class="rigname" data-rigname="${esc(m.id)}" value="${esc(mlabel(m))}" aria-label="Name for ${esc(m.id)}">${dot}</td>
        <td><select data-rigkind="${esc(m.id)}" aria-label="Joint type for ${esc(mlabel(m))}">${kopts}</select></td>
        <td><select data-rigparent="${esc(m.id)}" aria-label="What ${esc(mlabel(m))} moves with">${popts}</select></td>
        <td><select data-rigspot="${esc(m.id)}" aria-label="Pivot location for ${esc(mlabel(m))}">
              <option value="">as measured (${m.pivot?m.pivot.map(v=>(v*1000).toFixed(0)).join(","):"—"})</option>${spotOpts}</select></td>
        <td><button class="dirbtn" data-rigdir="${esc(m.id)}" title="Flip which way this joint travels">${m.dir>0?"+":"−"}</button></td>
        <td>${m.manual?`<button class="rmbtn" data-rigrm="${esc(m.id)}" title="Remove this joint">×</button>`:""}</td>
      </tr>`;
    }).join("");

  $("#rigChain").innerHTML=M.map(m=>{
    const carries=rigCarries(M,m.id);
    const dev=deviceOn(m.id);
    const par=m.parent==="chassis"?"the frame":mlabel(M.filter(x=>x.id===m.parent)[0]||{id:m.parent});
    return `<div class="chainrow">
      <span class="cn">${esc(mlabel(m))}</span> <span class="cj">${JOINT_KINDS[m.kind].label}</span>
      ${dev?` <code>${esc(dev)}</code>`:` <span class="cj">no device</span>`}
      <div class="cc">mounted on ${esc(par)} &mdash; ${carries.length
        ? "swings <b>"+carries.map(c=>esc(mlabel(M.filter(x=>x.id===c)[0]||{id:c}))).join("</b>, <b>")+"</b> with it"
        : "carries nothing further"}</div></div>`;
  }).join("");
  $("#rigPill").textContent=M.length+" joint"+(M.length===1?"":"s");

  t.querySelectorAll("[data-rigkind]").forEach(s=>s.addEventListener("change",()=>{
    const m=byMech(s.dataset.rigkind); if(!m) return;
    m.kind=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigparent]").forEach(s=>s.addEventListener("change",()=>{
    const m=byMech(s.dataset.rigparent); if(!m) return;
    m.parent=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigdir]").forEach(b=>b.addEventListener("click",()=>{
    const m=byMech(b.dataset.rigdir); if(!m) return;
    m.dir=(m.dir>0?-1:1); m.inferred=false; renderRig(); }));
  t.querySelectorAll("[data-rigname]").forEach(i=>i.addEventListener("change",()=>{
    const m=byMech(i.dataset.rigname); if(!m) return;
    m.label=i.value.trim()||m.id; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigspot]").forEach(s=>s.addEventListener("change",()=>{
    const m=byMech(s.dataset.rigspot); if(!m||s.value==="") return;
    const sp=RIG_SPOTS[+s.value]; if(!sp) return;
    m.pivot=sp.loc.slice(); m.axis=sp.axis?sp.axis.slice():m.axis; m.inferred=false;
    rigChanged(); }));
  t.querySelectorAll("[data-rigrm]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.rigrm;
    CAD.mechs=CAD.mechs.filter(x=>x.id!==id);
    CAD.mechs.forEach(x=>{ if(x.parent===id) x.parent="chassis"; });
    for(const k in MAP) if(MAP[k]===id) MAP[k]=null;
    rigChanged(); }));

  const guessed=M.filter(m=>m.inferred).length;
  const gp=$("#guessPill");
  gp.textContent = guessed? guessed+" guessed" : "all confirmed";
  gp.className = "pill"+(guessed?" warnp":" live");
}
let RIG_SPOTS=[];
const byMech = id => CAD? CAD.mechs.filter(m=>m.id===id)[0]||null : null;
function rigChanged(){
  recomputeChain(CAD.mechs);
  View.load(CAD);
  rebuild();
  saveRig();
}

/* ---------- findings, with ignore ---------- */
function renderFindings(){
  const live=FINDINGS.filter(f=>!IGNORED[f.key]);
  const hidden=FINDINGS.filter(f=>IGNORED[f.key]);
  const cnt={fail:0,warn:0,pass:0,info:0};
  live.forEach(f=>cnt[f.sev]++);
  $("#score").innerHTML=
    `<div class="s-fail"><div class="k">${cnt.fail}</div><div class="l">won't work</div></div>
     <div class="s-warn"><div class="k">${cnt.warn}</div><div class="l">risky</div></div>
     <div class="s-pass"><div class="k">${cnt.pass}</div><div class="l">checks out</div></div>`;
  const p=$("#verdictPill");
  p.textContent = cnt.fail? cnt.fail+" blocking" : (cnt.warn? "runs with risk":"clear");
  const col = cnt.fail? "var(--fail)" : (cnt.warn?"var(--warn)":"var(--pass)");
  p.style.color=col; p.style.borderColor=col;

  const SEVL={fail:"WON'T WORK",warn:"RISKY",pass:"OK",info:"NOTE"};
  $("#findings").innerHTML= live.length? live.map(f=>
    `<div class="finding ${f.sev}">
      <div class="fhead"><span class="fsev">${SEVL[f.sev]}</span><span class="ftitle">${f.title}</span>
        <button class="fignore" data-ig="${esc(f.key)}" title="Hide this finding — it stays hidden next time too">Ignore</button></div>
      <div class="fbody">${f.body}</div>
      ${f.math?`<div class="fmath">${esc(f.math)}</div>`:""}
      ${f.fix?`<div class="ffix"><b>Fix</b>${f.fix}</div>`:""}
    </div>`).join("")
    : `<p class="meta" style="padding:14px 13px">Nothing to report${hidden.length?" — "+hidden.length+" finding"+(hidden.length>1?"s":"")+" ignored":""}.</p>`;

  $("#ignoredWrap").innerHTML = hidden.length
    ? `<div class="ignored-head"><h3>Ignored · ${hidden.length}</h3><span class="spacer" style="margin-left:auto"></span>
         <button id="clearIgnored" style="padding:2px 8px;font-size:11px">Restore all</button></div>`+
      hidden.map(f=>`<div class="ign-row"><span class="t">${f.title.replace(/<[^>]+>/g,"")}</span>
         <button data-unig="${esc(f.key)}" style="padding:2px 8px;font-size:11px">Restore</button></div>`).join("")
    : "";

  document.querySelectorAll("[data-ig]").forEach(b=>b.addEventListener("click",()=>{
    IGNORED[b.dataset.ig]=1; saveIgnored(); renderFindings(); }));
  document.querySelectorAll("[data-unig]").forEach(b=>b.addEventListener("click",()=>{
    delete IGNORED[b.dataset.unig]; saveIgnored(); renderFindings(); }));
  const ci=$("#clearIgnored");
  if(ci) ci.addEventListener("click",()=>{ IGNORED={}; saveIgnored(); renderFindings(); });
}

/* ---------- orchestration ---------- */
function rebuild(){
  FINDINGS=analyze(CODE,CAD,MAP,OPTS);
  renderFindings(); renderTables(); renderRig();
  Sim.reset(CODE,CAD,MAP,OPTS);
  buildGauges(); renderPad();
  const COL={"revolute-yaw":"#E0A42E","revolute-lift":"#4D9FFF","effector":"#3FB68B",
             "linear":"#8C9EFF","fixed":"#8899AA"};
  $("#vpLegend").innerHTML=
    `<span><i style="background:#8093A8"></i>frame · fixed</span>`+
    CAD.mechs.map(m=>{
      const n=rigCarries(CAD.mechs,m.id).length;
      return `<span><i style="background:${COL[m.kind]||"#8899AA"}"></i>${esc(mlabel(m))} · ${JOINT_KINDS[m.kind].label}${n?" +"+n:""}</span>`;
    }).join("")+
    (Sim.drivetrain&&Sim.drivetrain.ok?`<span><i style="background:#C3CEDB"></i>drive base · ${Sim.drivetrain.style}</span>`:"");
}
function loadCode(src,label){
  $("#srcbox").value=src;
  try{ CODE=parseJava(src); }
  catch(e){ $("#codeStatus").textContent="couldn't parse: "+e.message;
            $("#codeDrop").classList.remove("ok"); $("#codeDrop").classList.add("bad"); return; }
  $("#codeDrop").classList.remove("bad"); $("#codeDrop").classList.add("ok");
  $("#codeStatus").textContent=label+(CODE.opmode?'  ·  "'+CODE.opmode+'"':"");
  MAP=autoMap(CODE.devices,CAD.mechs);
  rebuild();
}
function loadCAD(cad,label,cls){
  CAD=cad;
  $("#cadStatus").textContent=label;
  $("#cadDrop").className="drop "+(cls||"ok");
  $("#vpTitle").textContent=(cad.name||label)+"  ·  "+cad.mechs.length+" mechanism"+(cad.mechs.length===1?"":"s");
  const b=cad.bbox, mm=v=>(v*1000).toFixed(0);
  $("#vpDims").textContent=`${mm(b.max[0]-b.min[0])} × ${mm(b.max[1]-b.min[1])} × ${mm(b.max[2]-b.min[2])} mm`;
  $("#geoPill").textContent=(cad.points?cad.points.length.toLocaleString():"0")+" pts";
  $("#unitPill").textContent=cad.units==="METRE"?"m → mm":"mm";
  if(CODE) MAP=autoMap(CODE.devices,CAD.mechs);
  const restored=loadSavedRig();          // your edits for this CAD come back
  View.load(cad);
  if(CODE) rebuild();
  if(restored) $("#cadStatus").textContent=label+"  ·  rig restored";
}

/* ---------- intake ---------- */
function wireDrop(dropEl,inputEl,handler){
  const open=()=>inputEl.click();
  dropEl.addEventListener("click",e=>{ if(e.target!==inputEl) open(); });
  dropEl.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();open();} });
  ["dragenter","dragover"].forEach(ev=>dropEl.addEventListener(ev,e=>{e.preventDefault();dropEl.classList.add("armed");}));
  ["dragleave","drop"].forEach(ev=>dropEl.addEventListener(ev,e=>{e.preventDefault();dropEl.classList.remove("armed");}));
  dropEl.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) handler(f); });
  inputEl.addEventListener("change",e=>{ const f=e.target.files[0]; if(f) handler(f); inputEl.value=""; });
}
function takeCAD(file){
  $("#cadStatus").textContent="reading "+file.name+" …";
  const r=new FileReader();
  r.onerror=()=>{ $("#cadStatus").textContent="couldn't read "+file.name; };
  r.onload=()=>{
    const mb=(r.result.length/1048576).toFixed(1);
    $("#cadStatus").textContent="parsing "+mb+" MB …";
    setTimeout(()=>{
      try{
        const cad=parseSTEP(r.result,msg=>{$("#cadStatus").textContent=msg;});
        cad.name=file.name;
        if(!cad.mechs.length)
          loadCAD(cad, file.name+" — geometry loaded, no actuators recognized", "bad");
        else
          loadCAD(cad, file.name+"  ·  "+mb+" MB  ·  "+cad.mechs.length+" mechanisms", "ok");
      }catch(err){
        $("#cadStatus").textContent="couldn't parse this STEP — "+err.message;
        $("#cadDrop").className="drop bad";
      }
    },30);
  };
  r.readAsText(file);
}
function takeCode(file){
  const r=new FileReader();
  r.onerror=()=>{ $("#codeStatus").textContent="couldn't read "+file.name; };
  r.onload=()=>loadCode(r.result,file.name);
  r.readAsText(file);
}

/* ---------- keyboard ---------- */
/* A/B/X/Y stay on the face buttons, so the sticks take the IJKL cluster
   rather than WASD — otherwise A would mean two things at once. */
const KEYMAP={KeyA:"a",KeyB:"b",KeyX:"x",KeyY:"y",KeyQ:"left_bumper",KeyE:"right_bumper",
  ArrowUp:"dpad_up",ArrowDown:"dpad_down",ArrowLeft:"dpad_left",ArrowRight:"dpad_right"};
const STICKKEYS={KeyI:["left_stick_y",-1],KeyK:["left_stick_y",1],
                 KeyJ:["left_stick_x",-1],KeyL:["left_stick_x",1],
                 KeyU:["right_stick_x",-1],KeyO:["right_stick_x",1]};
const typing=e=>{ const t=e.target.tagName;
  return t==="TEXTAREA"||t==="INPUT"||t==="SELECT"||(e.target.dataset&&e.target.dataset.stick); };
function knobTo(pad,axis,v){
  for(const k of STICKS){
    if(k.ax!==axis&&k.ay!==axis) continue;
    const knob=document.querySelector(`[data-knob="${k.id}"]`); if(!knob) continue;
    const max=k.r-7;
    if(k.ax===axis) knob.setAttribute("cx",k.cx+v*max);
    else knob.setAttribute("cy",k.cy+v*max);
  }
}
addEventListener("keydown",e=>{
  if(typing(e)) return;
  const sk=STICKKEYS[e.code];
  if(sk){ e.preventDefault(); Sim.pad[activePad][sk[0]]=sk[1]; knobTo(activePad,sk[0],sk[1]); return; }
  const b=KEYMAP[e.code]; if(!b) return;
  e.preventDefault(); Sim.pad[activePad][b]=true;
  const el=document.querySelector(`[data-btn="${b}"]`); if(el) el.classList.add("down");
});
addEventListener("keyup",e=>{
  if(typing(e)) return;
  const sk=STICKKEYS[e.code];
  if(sk){ Sim.pad[activePad][sk[0]]=0; knobTo(activePad,sk[0],0); return; }
  const b=KEYMAP[e.code]; if(!b) return;
  Sim.pad[activePad][b]=false;
  const el=document.querySelector(`[data-btn="${b}"]`); if(el) el.classList.remove("down");
});

/* ---------- real USB pad ---------- */
const HW_ORDER=["a","b","x","y","left_bumper","right_bumper","left_trigger","right_trigger",
  "back","start","left_stick_button","right_stick_button","dpad_up","dpad_down","dpad_left","dpad_right"];
let hwWas=null;
function pollHW(){
  const gps=navigator.getGamepads?navigator.getGamepads():[];
  let live=false;
  for(let i=0;i<gps.length&&i<2;i++){
    const g=gps[i]; if(!g) continue; live=true;
    const pad=i+1;
    g.buttons.forEach((b,j)=>{ const n=HW_ORDER[j]; if(!n) return;
      Sim.pad[pad][n]=b.pressed;
      if(pad===activePad){ const el=document.querySelector(`[data-btn="${n}"]`);
        if(el) el.classList.toggle("down",b.pressed); } });
    const dz=v=>Math.abs(v)<0.08?0:v;
    if(g.axes.length>=4){
      Sim.pad[pad].left_stick_x=dz(g.axes[0]); Sim.pad[pad].left_stick_y=dz(g.axes[1]);
      Sim.pad[pad].right_stick_x=dz(g.axes[2]); Sim.pad[pad].right_stick_y=dz(g.axes[3]);
    }
  }
  if(live!==hwWas){ hwWas=live;
    const p=$("#hwPad"); p.textContent=live?"USB pad live":"no USB pad"; p.className="pill"+(live?" live":""); }
}

/* ---------- main loop ---------- */
let last=performance.now(), acc=0, slowAcc=0;
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  pollHW();
  acc+=dt;
  let guard=0;
  while(acc>=0.02 && guard++<8){ Sim.tick(0.02); acc-=0.02; }
  if(acc>0.5) acc=0;
  updateGauges();
  View.update();
  slowAcc+=dt;
  if(slowAcc>=0.05){ slowAcc=0;
    $("#mech").innerHTML=renderMech();
    $("#dsPanel").innerHTML=renderDS();
    const anyDown=Object.keys(Sim.pad[activePad]).some(k=>Sim.pad[activePad][k]);
    $("#tickPill").textContent=anyDown?"commanding":"holding";
    document.querySelectorAll(".bindrow").forEach(r=>{
      const k=r.dataset.btn; r.classList.toggle("active",!!Sim.pad[activePad][k]); });
  }
  View.render();
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
(function boot(){
  View.init($("#viewport"));
  const sample=JSON.parse(JSON.stringify(SAMPLE_CAD));
  sample.points=synthGeometry();
  classifyMechs(sample.mechs);
  loadCAD(sample,"sample: fulll.step (measured)","ok");
  loadCode(SAMPLE_JAVA,"WORKSHOPCODE.java");

  wireDrop($("#cadDrop"),$("#cadFile"),takeCAD);
  wireDrop($("#codeDrop"),$("#codeFile"),takeCode);
  $("#reparse").addEventListener("click",()=>loadCode($("#srcbox").value,"pasted source"));
  $("#resetSample").addEventListener("click",()=>loadCode(SAMPLE_JAVA,"WORKSHOPCODE.java"));
  $("#loadDrive").addEventListener("click",()=>loadCode(DRIVE_JAVA,"MecanumTeleOp.java"));
  $("#viewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    [].forEach.call($("#viewSeg").children,x=>x.classList.toggle("on",x===b));
    View.setView(b.dataset.v); });
  $("#padSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    activePad=+b.dataset.pad;
    [].forEach.call($("#padSeg").children,x=>x.classList.toggle("on",x===b));
    renderPad(); });
  $("#trustSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    OPTS.trust=b.dataset.trust;
    [].forEach.call($("#trustSeg").children,x=>x.classList.toggle("on",x===b));
    $("#trustNote").textContent = OPTS.trust==="code"
      ? "Servo/motor type comes from your declarations and comments. The CAD is used for geometry only."
      : "Servo/motor type comes from the part numbers in the STEP assembly.";
    rebuild(); saveRig(); });
  $("#turretSlider").addEventListener("input",e=>{
    View.turretScale=+e.target.value/100; $("#turretVal").textContent=e.target.value+" %";
    View.load(CAD); });
  $("#addJoint").addEventListener("click",addManualJoint);
  $("#rigCopy").addEventListener("click",()=>{
    const txt=JSON.stringify(exportRig(),null,1);
    $("#rigJson").value=txt;
    const done=ok=>{ const b=$("#rigCopy"); b.textContent=ok?"Copied":"Select & copy";
      setTimeout(()=>{b.textContent="Copy";},1400); };
    if(navigator.clipboard&&navigator.clipboard.writeText)
      navigator.clipboard.writeText(txt).then(()=>done(true),()=>{ $("#rigJson").select(); done(false); });
    else { $("#rigJson").select(); done(false); }
  });
  $("#rigApply").addEventListener("click",()=>{
    try{
      const r=JSON.parse($("#rigJson").value);
      if(r.format!=="ftc-sim-bench.rig") throw new Error("not a rig document");
      applyRig(r); View.load(CAD); rebuild(); saveRig();
      $("#rigApply").textContent="Applied"; setTimeout(()=>{$("#rigApply").textContent="Apply";},1400);
    }catch(err){
      $("#rigApply").textContent="Bad JSON"; setTimeout(()=>{$("#rigApply").textContent="Apply";},1800);
    }
  });
  $("#rigReset").addEventListener("click",()=>{
    try{ localStorage.removeItem(rigKey()); }catch(e){}
    HW_USER={};
    for(const m of CAD.mechs){ m.kind=m.hasActuator?null:"fixed"; m.leverOverride=null; m.label=null; }
    CAD.mechs=CAD.mechs.filter(m=>!m.manual);
    classifyMechs(CAD.mechs);
    if(CODE) MAP=autoMap(CODE.devices,CAD.mechs);
    rigChanged();
  });
  $("#massSlider").addEventListener("input",e=>{
    OPTS.payloadKg=+e.target.value/1000; $("#massVal").textContent=e.target.value+" g";
    FINDINGS=analyze(CODE,CAD,MAP,OPTS); renderFindings(); Sim.opts=OPTS; saveRig(); });
  $("#dutySlider").addEventListener("input",e=>{
    OPTS.duty=+e.target.value/100; $("#dutyVal").textContent=e.target.value+" %";
    FINDINGS=analyze(CODE,CAD,MAP,OPTS); renderFindings(); Sim.opts=OPTS; saveRig(); });

  requestAnimationFrame(frame);
})();
