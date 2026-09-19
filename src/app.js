/* ============================================================
   9.  UI
   ============================================================ */
const $=s=>document.querySelector(s);
const $$=s=>Array.prototype.slice.call(document.querySelectorAll(s));
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
const store={
  get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:v; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

let CODE=null, CAD=null, MAP={}, FINDINGS=[], activePad=2;
const OPTS={payloadKg:0.180, duty:0.30, trust:"code", robotConfig:null, front:"+x"};
let IGNORED={};
try{ IGNORED=JSON.parse(store.get("ftcbench.ignored","{}"))||{}; }catch(e){ IGNORED={}; }
function saveIgnored(){ store.set("ftcbench.ignored",JSON.stringify(IGNORED)); }
let LIBRARY=[], CURRENT_ID=null;
let ROBOT_CFG_NAME=null;
let CONFIG_OVR={};                 // live-edited config variables, like FTC Dashboard
let RIG_DEVICES={};                // device → mechanism, remembered across OpModes

/* ============================================================
   TABS
   ============================================================ */
function initTabs(){
  $$(".tabs").forEach(nav=>{
    nav.addEventListener("click",e=>{ const b=e.target.closest("button[data-tab]"); if(b) selectTab(nav,b.dataset.tab); });
    nav.addEventListener("keydown",e=>{
      if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft") return;
      const tabs=[].slice.call(nav.querySelectorAll("button[data-tab]"));
      const i=tabs.indexOf(document.activeElement); if(i<0) return;
      const n=tabs[(i+(e.key==="ArrowRight"?1:tabs.length-1))%tabs.length];
      n.focus(); selectTab(nav,n.dataset.tab); e.preventDefault();
    });
    const saved=store.get("ftcbench.tab."+nav.dataset.tabs,null);
    if(saved&&nav.querySelector(`button[data-tab="${saved}"]`)) selectTab(nav,saved);
  });
}
function selectTab(nav,tab){
  nav.querySelectorAll("button[data-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===tab)));
  nav.parentElement.querySelectorAll(".pane").forEach(p=>{ p.hidden=p.dataset.pane!==tab; });
  store.set("ftcbench.tab."+nav.dataset.tabs,tab);
  if(tab==="graph") Graph.draw();
  if(tab==="compare") renderCompare();
  if(tab==="shot"){ ShotUI.dirty=true; ShotUI.t=0; renderShotSetup(); }
}
const paneVisible=name=>{ const p=document.querySelector(`.pane[data-pane="${name}"]`); return p&&!p.hidden; };

/* ============================================================
   OPMODE LIBRARY
   ============================================================ */
function entry(id){ return LIBRARY.filter(e=>e.id===id)[0]||null; }
function parseEntry(e){
  try{ e.code=parseJava(e.source); e.error=null; }
  catch(err){ e.code=null; e.error=err.message; }
  return e;
}
function initLibrary(){
  LIBRARY=[
    {id:"sample-claw", file:"WORKSHOPCODE.java", source:SAMPLE_JAVA, builtin:true},
    {id:"sample-mecanum", file:"MecanumTeleOp.java", source:DRIVE_JAVA, builtin:true},
    {id:"sample-auto", file:"TimedDriveAuto.java", source:AUTO_JAVA, builtin:true},
    {id:"sample-shooter", file:"ShooterTeleOp.java", source:SHOOTER_JAVA, builtin:true}
  ];
  try{
    const saved=JSON.parse(store.get("ftcbench.library","[]"))||[];
    for(const s of saved) if(s&&s.id&&s.source) LIBRARY.push({id:s.id, file:s.file||"OpMode.java", source:s.source, builtin:false});
  }catch(e){}
  LIBRARY.forEach(parseEntry);
}
function saveLibrary(){
  store.set("ftcbench.library",JSON.stringify(LIBRARY.filter(e=>!e.builtin).map(e=>({id:e.id,file:e.file,source:e.source}))));
}
const opName=e=> e.code&&e.code.opmode ? e.code.opmode : e.file.replace(/\.java$/,"");
const opKind=e=> e.code&&e.code.kind==="Autonomous" ? "Auto" : "TeleOp";

function renderOpList(){
  $("#opList").innerHTML=LIBRARY.map(e=>`
    <div class="oprow${e.id===CURRENT_ID?" on":""}" data-op="${esc(e.id)}" tabindex="0" role="button" aria-pressed="${e.id===CURRENT_ID}">
      <span class="kind${opKind(e)==="Auto"?" auto":""}">${opKind(e)}</span>
      <div><div class="on-name">${esc(opName(e))}</div><div class="on-file">${esc(e.file)}${e.builtin?" · sample":""}</div></div>
      ${e.builtin?"<span></span>":`<button class="rm" data-oprm="${esc(e.id)}" title="Remove ${esc(e.file)}" aria-label="Remove ${esc(e.file)}">×</button>`}
    </div>`).join("");
  $$("#opList [data-op]").forEach(r=>{
    const go=()=>{ if(r.dataset.op!==CURRENT_ID) selectOpMode(r.dataset.op); };
    r.addEventListener("click",e=>{ if(!e.target.closest("[data-oprm]")) go(); });
    r.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
  $$("#opList [data-oprm]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.oprm;
    LIBRARY=LIBRARY.filter(e=>e.id!==id); saveLibrary();
    if(id===CURRENT_ID) selectOpMode(LIBRARY[0].id); else { renderOpList(); renderOpSelect(); renderCompareSelects(); }
  }));
}
function renderOpSelect(){
  const group=(k,label)=>{
    const items=LIBRARY.filter(e=>opKind(e)===k);
    return items.length?`<optgroup label="${label}">`+items.map(e=>
      `<option value="${esc(e.id)}"${e.id===CURRENT_ID?" selected":""}>${esc(opName(e))}</option>`).join("")+`</optgroup>`:"";
  };
  $("#opSelect").innerHTML=group("TeleOp","TeleOp")+group("Auto","Autonomous");
  const e=entry(CURRENT_ID);
  const k=$("#opKind"); k.textContent=e?opKind(e):"—"; k.className="kind"+(e&&opKind(e)==="Auto"?" auto":"");
}

function selectOpMode(id){
  const e=entry(id); if(!e) return;
  if(Sim.phase==="running") Sim.stop();
  CURRENT_ID=id; store.set("ftcbench.current",id);
  $("#srcbox").value=e.source; $("#srcName").textContent=e.file;
  CONFIG_OVR={};
  if(!e.code){
    CODE=null;
    $("#coverage").innerHTML=`<p class="cov-ok">Couldn't read this file: ${esc(e.error||"unknown error")}</p>`;
    renderOpList(); renderOpSelect(); return;
  }
  CODE=e.code;
  MAP=autoMap(CODE.devices,CAD.mechs);
  applyDeviceMemory();
  analyzeAll();
  Sim.load(CODE,CAD,MAP,withPose());
  applyConfigOverrides(); Sim.init(); applyConfigOverrides();    // like a DS: selected and INIT'd, waiting for START
  Shots.adopt(CODE); ShotUI.dirty=true; renderShotSetup();
  buildGauges(); renderPad(); Graph.reset(); renderConfigVars(); renderLegend3D();
  renderOpList(); renderOpSelect(); renderCompareSelects(); updateDS();
}
function addOpModeFromText(file,text){
  const existing=LIBRARY.filter(x=>!x.builtin&&x.file===file)[0];
  const e=existing||{id:"u"+Date.now().toString(36)+Math.random().toString(36).slice(2,6), file, builtin:false};
  e.source=text; parseEntry(e);
  if(!existing) LIBRARY.push(e);
  saveLibrary(); selectOpMode(e.id);
}

/* ============================================================
   DRIVER STATION
   ============================================================ */
const PERIOD={TeleOp:120, Autonomous:30};
function withPose(){ OPTS.startPose=Object.assign({x:0,y:0,h:0},Sim.chassis||{}); return OPTS; }
function applyConfigOverrides(){ for(const k in CONFIG_OVR) Sim.vars[k]=CONFIG_OVR[k]; }
function dsInit(){
  if(!CODE||Sim.phase==="running") return;
  Field.reset(); Shots.reset(); ShotUI.dirty=true;       // a fresh match: HIVEs as staged
  Sim.load(CODE,CAD,MAP,withPose());
  applyConfigOverrides(); Sim.init(); applyConfigOverrides();
  buildGauges(); Graph.reset(); updateDS();
}
function dsStart(){
  if(!CODE) return;
  if(Sim.phase!=="init") dsInit();
  Sim.start(); updateDS();
}
function dsStop(){ Sim.stop(); updateDS(); }
function updateDS(){
  const ph=Sim.phase;
  const bi=$("#btnInit"), bs=$("#btnStart"), bx=$("#btnStop");
  bi.disabled=!(ph==="loaded"||ph==="stopped");
  bs.disabled=ph!=="init";
  bx.disabled=!(ph==="init"||ph==="running");
  bi.classList.toggle("next",!bi.disabled);
  bs.classList.toggle("next",!bs.disabled);
  bx.classList.toggle("live",ph==="running");
  const P={loaded:["Ready — press INIT",""],init:["INIT — waiting for START","accentp"],
           running:["Running","live"],stopped:["Stopped",""],empty:["No OpMode",""]}[ph]||["—",""];
  const pill=$("#phasePill"); pill.textContent=P[0]; pill.className="pill "+P[1];
  const hint=$("#vpHint");
  if(!CODE){ hint.hidden=true; }
  else if(ph==="init"){ hint.hidden=false; hint.innerHTML=`Press START to run “${esc(CODE.opmode||"OpMode")}”<small>INIT already ran everything before waitForStart()</small>`; }
  else if(ph==="loaded"||ph==="stopped"){ hint.hidden=false; hint.innerHTML=`Press INIT<small>${ph==="stopped"?"then START to run it again":"to run the setup code"}</small>`; }
  else hint.hidden=true;
  updateClock();
}
const clockText=s=>{ s=Math.max(0,s); return Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0"); };
function updateClock(){
  const kind=CODE&&CODE.kind==="Autonomous"?"Autonomous":"TeleOp";
  const P=PERIOD[kind], practice=$("#practice").checked;
  const t=(Sim.phase==="running"||Sim.phase==="stopped")?Sim.t:0;
  const c=$("#dsClock");
  if(practice){ c.textContent=clockText(t); $("#dsBar").style.width="0"; c.classList.remove("low"); return; }
  const rem=P-t;
  c.textContent=clockText(Math.ceil(rem-1e-6));
  $("#dsBar").style.width=Math.min(100,t/P*100).toFixed(1)+"%";
  c.classList.toggle("low",Sim.phase==="running"&&rem<=10);
  if(Sim.phase==="running"&&rem<=0) dsStop();          // the match period ended
}

/* ============================================================
   GAMEPAD
   ============================================================ */
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
const STICKS=[{id:"left", cx:160, cy:141, r:22, ax:"left_stick_x", ay:"left_stick_y", t:"LS", btn:"left_stick_button"},
              {id:"right",cx:266, cy:141, r:22, ax:"right_stick_x",ay:"right_stick_y",t:"RS", btn:"right_stick_button"}];

function boundMap(){
  const b={};
  if(CODE) for(const bd of CODE.bindings) if(bd.pad===activePad){
    (b[bd.btn]=b[bd.btn]||[]).push(bd);
    if(bd.axes) bd.axes.forEach(a=>{ const r=splitPadRef(a); if(r) (b[r.btn]=b[r.btn]||[]).push(bd); });
  }
  return b;
}
function actionText(b){
  if(b.assign) return `${b.dev} ${b.op} ${b.expr}`;
  if(b.sleep) return `sleep(${b.expr})`;
  return `${b.dev}.${b.op}(${b.expr})`;
}
function describe(bds){
  const list=Array.isArray(bds)?bds:[bds]; const seen={};
  return list.map(b=>{ const t=actionText(b); if(seen[t]) return null; seen[t]=1; return t; }).filter(Boolean).join("  ·  ");
}
function renderPad(){
  const bound=boundMap();
  let s=`<svg class="padsvg" viewBox="0 0 428 194" role="group" aria-label="Virtual FTC gamepad ${activePad}">`;
  s+=`<path class="shell" d="M60 60 Q60 34 92 34 L336 34 Q368 34 368 60 L368 96 Q368 134 340 152 Q318 166 300 148 L272 120 L156 120 L128 148 Q110 166 88 152 Q60 134 60 96 Z"/>`;
  s+=`<text class="cap" x="214" y="60">gamepad${activePad}</text>`;
  for(const g of PAD_GEO){
    const bd=bound[g.id], cls="btn"+(bd?" bound":"");
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
    const bd=bound[k.ax]||bound[k.ay]||bound[k.btn];
    const aria=bd?`${k.t} stick: ${describe(bd)}`:`${k.t} stick: unbound`;
    s+=`<circle class="stickwell${bd?" bound":""}" data-stick="${k.id}" cx="${k.cx}" cy="${k.cy}" r="${k.r}" tabindex="0" role="slider" aria-label="${esc(aria)}"><title>${esc(aria)}</title></circle>`;
    s+=`<circle class="stickknob" data-knob="${k.id}" cx="${k.cx}" cy="${k.cy}" r="7"/>`;
    s+=`<text class="lbl" x="${k.cx}" y="${k.cy+k.r+8}">${k.t}</text>`;
  }
  s+=`</svg>`;
  $("#padwrap").innerHTML=s;

  $$("#padwrap [data-btn]").forEach(el=>{
    const b=el.dataset.btn;
    const dn=e=>{ if(e.cancelable) e.preventDefault(); Sim.pad[activePad][b]=true; el.classList.add("down"); };
    const up=()=>{ Sim.pad[activePad][b]=false; el.classList.remove("down"); };
    el.addEventListener("pointerdown",dn); el.addEventListener("pointerup",up); el.addEventListener("pointerleave",up);
    el.addEventListener("keydown",e=>{ if(e.key===" "||e.key==="Enter") dn(e); });
    el.addEventListener("keyup",e=>{ if(e.key===" "||e.key==="Enter") up(); });
  });
  STICKS.forEach(k=>{
    const well=$(`[data-stick="${k.id}"]`), knob=$(`[data-knob="${k.id}"]`); if(!well) return;
    let dragging=false;
    const set=(dx,dy)=>{
      const L=Math.hypot(dx,dy), max=k.r-7;
      if(L>max){ dx*=max/L; dy*=max/L; }
      knob.setAttribute("cx",k.cx+dx); knob.setAttribute("cy",k.cy+dy);
      Sim.pad[activePad][k.ax]=+(dx/max).toFixed(3);
      Sim.pad[activePad][k.ay]=+(dy/max).toFixed(3);   // down is positive, as on a real pad
    };
    const rel=()=>{ dragging=false; knob.setAttribute("cx",k.cx); knob.setAttribute("cy",k.cy);
      Sim.pad[activePad][k.ax]=0; Sim.pad[activePad][k.ay]=0; };
    const toLocal=e=>{ const r=$("#padwrap svg").getBoundingClientRect();
      return [(e.clientX-r.left)*428/r.width-k.cx, (e.clientY-r.top)*194/r.height-k.cy]; };
    well.addEventListener("pointerdown",e=>{ dragging=true; well.setPointerCapture(e.pointerId); const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointermove",e=>{ if(!dragging) return; const p=toLocal(e); set(p[0],p[1]); });
    well.addEventListener("pointerup",rel); well.addEventListener("pointercancel",rel);
    well.addEventListener("keydown",e=>{
      const v=0.5; let dx=0,dy=0;
      if(e.key==="ArrowLeft")dx=-v; else if(e.key==="ArrowRight")dx=v; else if(e.key==="ArrowUp")dy=-v; else if(e.key==="ArrowDown")dy=v; else return;
      e.preventDefault(); set(dx*(k.r-7),dy*(k.r-7));
    });
    well.addEventListener("blur",rel);
  });
  renderBindList();
}
const CONTROL_LABEL=btn=>btn.replace(/^dpad_/,"D-").replace(/left_bumper/,"LB").replace(/right_bumper/,"RB")
  .replace(/left_trigger/,"LT").replace(/right_trigger/,"RT").replace(/left_stick_button/,"LS BTN").replace(/right_stick_button/,"RS BTN")
  .replace(/left_stick_/,"LS ").replace(/right_stick_/,"RS ").replace(/_/g," ").toUpperCase();
function renderBindList(){
  if(!CODE){ $("#bindlist").innerHTML=""; return; }
  const bs=CODE.bindings.filter(b=>b.pad===activePad);
  if(!bs.length){ $("#bindlist").innerHTML=`<div class="bindrow"><span class="bk">—</span><span class="bd"><span class="edge">Nothing on gamepad${activePad} in this OpMode.</span></span></div>`; return; }
  const byBtn={}; for(const b of bs) (byBtn[b.btn]=byBtn[b.btn]||[]).push(b);
  $("#bindlist").innerHTML=Object.keys(byBtn).sort((x,y)=>{
      const i=CONTROL_ORDER.indexOf(x), j=CONTROL_ORDER.indexOf(y); return (i<0?99:i)-(j<0?99:j); })
    .map(btn=>{
      const g=byBtn[btn];
      return `<div class="bindrow" data-btn="${btn}">
        <span class="bk">${esc(CONTROL_LABEL(btn).slice(0,7))}</span>
        <span class="bd">${esc(describe(g))}
        <span class="edge">${g[0].analog?"analog — follows the stick":(g[0].cond?"when "+esc(g[0].cond.trim().slice(0,52)):"while held")}</span></span></div>`;
    }).join("");
}

/* ============================================================
   ACTUATOR GAUGES
   ============================================================ */
const ARC_R=34, ARC_A0=Math.PI*0.78, ARC_A1=Math.PI*2.22;
function arcPath(t0,t1){
  const a0=ARC_A0+(ARC_A1-ARC_A0)*t0, a1=ARC_A0+(ARC_A1-ARC_A0)*t1;
  const x0=48+ARC_R*Math.cos(a0), y0=44+ARC_R*Math.sin(a0), x1=48+ARC_R*Math.cos(a1), y1=44+ARC_R*Math.sin(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${ARC_R} ${ARC_R} 0 ${(a1-a0)>Math.PI?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function buildGauges(){
  if(!CODE){ $("#gauges").innerHTML=""; return; }
  const acts=CODE.devices.filter(d=>Sim.dev[d.name]&&/Servo|DcMotor/i.test(d.type||""));
  if(!acts.length){ $("#gauges").innerHTML=`<p class="hint" style="grid-column:1/-1">No servos or motors in this OpMode.</p>`; return; }
  $("#gauges").innerHTML=acts.map(d=>{
    const s=Sim.dev[d.name], isMotor=s.kind==="motor", r=travelRange(CODE,d.name);
    const lo=r?r.lo:0, hi=r?r.hi:1;
    return `<div class="gauge" data-dev="${esc(d.name)}" data-motor="${isMotor?1:0}">
      <div class="stallflag" hidden>STALL</div>
      <svg viewBox="0 0 96 74" aria-hidden="true">
        <path class="g-track" d="${arcPath(0,1)}"/>
        ${isMotor?"":`<path class="g-range" d="${arcPath(lo,hi)}"/>`}
        <path class="g-fill" d="${arcPath(0,0.001)}" data-fill></path>
        <line class="g-cmd" data-cmd x1="48" y1="44" x2="48" y2="12"></line>
        <text x="48" y="45" text-anchor="middle" dominant-baseline="central" style="font-family:var(--mono);font-size:14px;font-weight:700;fill:var(--tx)" data-val>0.00</text>
        <text x="48" y="60" text-anchor="middle" style="font-family:var(--mono);font-size:8.5px;fill:var(--tx-3)" data-deg>—</text>
      </svg>
      <div class="gname" title="${esc(d.name)}">${esc(d.name)}</div>
      <div class="gsub">${esc(isMotor?(s.mode==="rtp"?"to position":"power"):(s.spec.role||"servo"))}</div>
    </div>`;
  }).join("");
}
function updateGauges(){
  $$(".gauge").forEach(el=>{
    const s=Sim.dev[el.dataset.dev]; if(!s) return;
    const isMotor=el.dataset.motor==="1";
    const t=isMotor?(s.act+1)/2:clamp01(s.act), tc=isMotor?(s.cmd+1)/2:clamp01(s.cmd);
    el.querySelector("[data-fill]").setAttribute("d",arcPath(isMotor?0.5:0,Math.max(0.002,t)));
    const a=ARC_A0+(ARC_A1-ARC_A0)*clamp01(tc), ln=el.querySelector("[data-cmd]");
    ln.setAttribute("x2",(48+ARC_R*1.14*Math.cos(a)).toFixed(2));
    ln.setAttribute("y2",(44+ARC_R*1.14*Math.sin(a)).toFixed(2));
    el.querySelector("[data-val]").textContent=s.act.toFixed(2);
    el.querySelector("[data-deg]").textContent=isMotor?Math.round(s.ticks)+" ticks":(s.act*s.travelDeg).toFixed(0)+"°";
    el.classList.toggle("stalled",s.stalled);
    el.querySelector(".stallflag").hidden=!s.stalled;
  });
}

/* ============================================================
   TORQUE ANGLE (picture-in-picture)
   ============================================================ */
function liftState(){
  const M=CAD?CAD.mechs:[];
  const byKind=k=>M.filter(m=>m.kind===k)[0]||null;
  const R={lift:byKind("revolute-lift"), yaw:byKind("revolute-yaw"), eff:byKind("effector")};
  const dev=m=>m?deviceOn(m.id):null;
  return {R, aS:Sim.dev[dev(R.lift)]||null, cS:Sim.dev[dev(R.eff)]||null, yS:Sim.dev[dev(R.yaw)]||null};
}
function renderMech(){
  const {R,aS,cS}=liftState();
  if(!R.lift||!aS) return null;
  const L=leverOf(R.lift)*1000||163;
  const ang=(R.lift.restAngleDeg+(aS.act-aS.restPos)*aS.travelDeg)*Math.PI/180;
  const PX=96, PY=60, ARM=92, ex=PX+Math.cos(ang)*ARM, ey=PY-Math.sin(ang)*ARM;
  const open=cS?(1-clamp01(cS.act))*11+4:8, stall=aS.stalled, deg=Math.round(ang*180/Math.PI);
  const col=stall?"#E4574E":"#4D9FFF";
  return {deg, svg:`<svg viewBox="0 0 250 150" role="img" aria-label="Side elevation: lift arm at ${deg} degrees from horizontal">
    <line x1="0" y1="136" x2="250" y2="136" stroke="#26313F"/>
    <line x1="${PX}" y1="${PY}" x2="244" y2="${PY}" stroke="#2E3A49" stroke-dasharray="3 3"/>
    <text x="244" y="${PY-4}" text-anchor="end" style="font-family:var(--mono);font-size:8px;fill:#4E5C6D">horizontal</text>
    <rect x="${PX-34}" y="112" width="68" height="24" rx="3" fill="#1C242F" stroke="#2F3B4A"/>
    <text x="${PX}" y="127" text-anchor="middle" style="font-family:var(--mono);font-size:7.5px;fill:#6F7F92">FRAME</text>
    <rect x="${PX-7}" y="${PY}" width="14" height="${112-PY}" fill="#222E3B" stroke="#33414F"/>
    <line x1="${PX}" y1="${PY}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${col}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="${PX}" cy="${PY}" r="8" fill="#0E1218" stroke="${col}" stroke-width="3"/>
    <g transform="translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${(-ang*180/Math.PI).toFixed(1)})">
      <line x1="0" y1="0" x2="13" y2="${(-open).toFixed(1)}" stroke="#3FB68B" stroke-width="4" stroke-linecap="round"/>
      <line x1="0" y1="0" x2="13" y2="${open.toFixed(1)}" stroke="#3FB68B" stroke-width="4" stroke-linecap="round"/>
      <circle r="5" fill="#0E1218" stroke="#3FB68B" stroke-width="2.2"/>
    </g>
    <text x="8" y="16" style="font-family:var(--mono);font-size:9px;fill:#8B9BAF">${L.toFixed(0)} mm lever</text>
    ${stall?`<text x="8" y="30" style="font-family:var(--mono);font-size:9px;font-weight:700;fill:#E4574E">STALLED — can't lift</text>`:""}
  </svg>`};
}

/* ============================================================
   TELEMETRY (Driver Station panel)
   ============================================================ */
function telemetryValue(t,env){
  const s=String(t.expr||"").trim();
  if(/^".*"$/.test(s)) return s.slice(1,-1);
  const em=/^([A-Za-z_$][\w$]*)\s*\.\s*get(Position|Power)\s*\(\s*\)$/.exec(s);
  if(em&&Sim.dev[em[1]]) return Sim.dev[em[1]].cmd;
  const ast=parseExpr(s); if(!ast) return null;
  const n=evalNode(ast,env);
  return (typeof n==="number"&&isFinite(n))?n:null;
}
const fmtNum=v=>typeof v!=="number"?String(v):(Math.abs(v)>=100||Number.isInteger(v)?String(Math.round(v*100)/100):v.toFixed(3));
function renderDS(){
  if(!CODE) return `<div class="dsk">No OpMode loaded.</div>`;
  const env=Sim.env(); let out="";
  if(Sim.phase==="loaded"||Sim.phase==="stopped")
    out+=`<div class="dsk">${Sim.phase==="stopped"?"OpMode stopped.":"Press INIT to start."}</div>`;
  for(const t of CODE.telemetry){
    if(t.kind==="addLine"){ out+=t.label?`<div class="dsl">${esc(t.label)}</div>`:`<div>&nbsp;</div>`; continue; }
    const v=telemetryValue(t,env);
    out+=`<div><span class="dsk">${esc(t.label)} :</span> <span class="dsv">${v==null?"—":esc(fmtNum(v))}</span></div>`;
  }
  out+=`<div class="dshr">────────────────────</div>`;
  if(Sim.drivetrain&&Sim.drivetrain.ok)
    out+=`<div><span class="dsk">pose</span> <span class="dsv">${poseText(Sim.chassis)}</span></div>`;
  if(Sim.sleptMs&&CODE.hasLoop) out+=`<div><span class="dsk">bench</span> <span class="dsbad">sleep() blocked the loop for ${Math.round(Sim.sleptMs)} ms so far</span></div>`;
  const st=Object.keys(Sim.dev).filter(k=>Sim.dev[k].stalled);
  out+=st.length?`<div><span class="dsk">bench</span> <span class="dsbad">stalled: ${esc(st.join(", "))}</span></div>`
               :`<div><span class="dsk">bench</span> <span class="dsv">actuators tracking command</span></div>`;
  if(!CODE.hasLoop&&CODE.auto&&CODE.auto.length&&Sim.phase==="running")
    out+=`<div><span class="dsk">auto</span> <span class="dsv">${Sim.autoDone?"sequence finished":"step "+Math.min(Sim.pc+1,CODE.auto.length)+" of "+CODE.auto.length}</span></div>`;
  return out;
}

/* ============================================================
   HARDWARE MAP & ASSEMBLY
   ============================================================ */
function renderTables(){
  const mapT=$("#mapTable");
  if(!CODE.devices.length) mapT.innerHTML=`<tr><td class="dim">No devices found in this OpMode.</td></tr>`;
  else mapT.innerHTML=`<tr><th>device</th><th>mechanism</th><th>role</th><th>N·m</th><th>lever</th></tr>`+
    CODE.devices.map(d=>{
      const mech=CAD.mechs.filter(m=>m.id===MAP[d.name])[0]||null;
      const opts=[`<option value="">— none —</option>`].concat(CAD.mechs.map(m=>
        `<option value="${esc(m.id)}"${MAP[d.name]===m.id?" selected":""}>${esc(mlabel(m))}</option>`)).join("");
      const actuator=/Servo|DcMotor/i.test(d.type||"");
      const spec=specFor(d,mech,OPTS.trust);
      const ropts=["Torque","Speed","Servo","Motor","CR"].map(r=>`<option value="${r}"${spec.role===r?" selected":""}>${r}</option>`).join("");
      const lever=mech&&mech.kind!=="fixed"&&mech.kind!=="effector"
        ? `<input class="mini" type="number" step="1" min="0" data-lever="${esc(d.name)}" value="${(leverOf(mech)*1000).toFixed(0)}" aria-label="Lever length for ${esc(d.name)} in mm">`
        : `<span class="dim">—</span>`;
      return `<tr><td class="mono" title="${esc(d.type+" · "+(d.cfg?'"'+d.cfg+'"':"no config name")+" · "+spec.fam+" · from "+spec.src)}">${esc(d.name)}</td>
        <td><select data-dev="${esc(d.name)}" aria-label="Mechanism for ${esc(d.name)}">${opts}</select></td>
        <td>${actuator?`<select data-role="${esc(d.name)}" aria-label="Actuator role for ${esc(d.name)}">${ropts}</select>`:`<span class="dim mono">${esc(d.type)}</span>`}</td>
        <td>${actuator?`<input class="mini" type="number" step="0.05" min="0" data-nm="${esc(d.name)}" value="${(spec.stallNm||0).toFixed(2)}" aria-label="Stall torque for ${esc(d.name)}">`:""}</td>
        <td>${lever}</td></tr>`;
    }).join("");
  mapT.querySelectorAll("[data-role]").forEach(s=>s.addEventListener("change",()=>{
    const n=s.dataset.role;
    HW_USER[n]=Object.assign({},HW_USER[n],{role:s.value, kind:(s.value==="Motor"?"motor":s.value==="CR"?"crservo":"servo")});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-nm]").forEach(i=>i.addEventListener("change",()=>{
    const v=parseFloat(i.value), n=i.dataset.nm;
    HW_USER[n]=Object.assign({},HW_USER[n],{stallNm:(isFinite(v)&&v>0)?v:undefined});
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("select[data-dev]").forEach(sel=>sel.addEventListener("change",()=>{
    MAP[sel.dataset.dev]=sel.value||null; RIG_DEVICES[sel.dataset.dev]=sel.value||null;
    rebuild(); saveRig(); }));
  mapT.querySelectorAll("[data-lever]").forEach(inp=>inp.addEventListener("change",()=>{
    const mech=CAD.mechs.filter(m=>m.id===MAP[inp.dataset.lever])[0]; if(!mech) return;
    const v=parseFloat(inp.value);
    mech.leverOverride=(isFinite(v)&&v>0)?v/1000:null; mech.inferred=false; rebuild(); saveRig(); }));
  $("#mapPill").textContent=CODE.devices.length+" device"+(CODE.devices.length===1?"":"s");

  const srt=CAD.parts.slice().sort((a,b)=>{ const r=x=>x.kind==="servo"||x.kind==="motor"?0:1; return r(a)-r(b)||a.name.localeCompare(b.name); });
  $("#treeTable").innerHTML=`<tr><th>part</th><th style="text-align:right">qty</th><th>id</th></tr>`+
    srt.map(p=>`<tr><td>${esc(p.name)}${(p.kind==="servo"||p.kind==="motor")?' <span class="tag mut">'+p.kind+'</span>':""}</td>
      <td class="num dim">${p.n}</td><td class="mono dim" style="font-size:10.5px">${esc(p.part||"")}</td></tr>`).join("");
  $("#partPill").textContent=CAD.parts.reduce((s,p)=>s+p.n,0)+" occurrences";
}

/* ============================================================
   THE RIG DOCUMENT
   Detection only seeds this. Once written down it is the model
   everything runs on, it survives reloads, and it can be pasted
   into a repo so next season starts from last season's rig.
   ============================================================ */
let HW_USER={};            // per-device spec overrides
function rigKey(){ return "ftcbench.rig."+((CAD&&CAD.name)||"sample"); }
function exportRig(){
  return {
    format:"ftc-sim-bench.rig", version:1,
    cad:(CAD&&CAD.name)||null, opmode:(CODE&&CODE.opmode)||null,
    trust:OPTS.trust, payloadKg:OPTS.payloadKg, duty:OPTS.duty, turretScale:View.turretScale,
    front:OPTS.front, shot:Shots.cfg||null,
    joints:(CAD?CAD.mechs:[]).map(m=>({
      id:m.id, label:m.label||m.id, kind:m.kind, parent:m.parent, dir:m.dir||1,
      pivotMm:m.pivot?m.pivot.map(v=>+(v*1000).toFixed(1)):null,
      axis:m.axis?m.axis.map(v=>+v.toFixed(4)):null,
      leverMm:m.leverOverride!=null?+(m.leverOverride*1000).toFixed(1):null,
      part:m.part||null, manual:!!m.manual, inferred:!!m.inferred })),
    devices:Object.assign({},RIG_DEVICES,MAP), hardware:HW_USER, ignored:Object.keys(IGNORED)
  };
}
function applyRig(r){
  if(!r||!CAD) return false;
  if(r.trust) OPTS.trust=r.trust;
  if(typeof r.payloadKg==="number") OPTS.payloadKg=r.payloadKg;
  if(typeof r.duty==="number") OPTS.duty=r.duty;
  if(typeof r.turretScale==="number") View.turretScale=r.turretScale;
  if(r.front&&FRONTS[r.front]!==undefined) OPTS.front=r.front;
  if(r.shot&&typeof r.shot==="object") Shots.cfg=Object.assign(Shots.defaults(),r.shot);
  const byId={}; CAD.mechs.forEach(m=>byId[m.id]=m);
  for(const j of (r.joints||[])){
    let m=byId[j.id];
    if(!m){
      if(!j.manual&&!j.pivotMm) continue;
      m={id:j.id, cluster:[], part:j.part||null, partName:null, hasActuator:false};
      CAD.mechs.push(m); byId[j.id]=m;
    }
    m.label=j.label||m.label||m.id;
    if(j.kind) m.kind=j.kind;
    if(j.parent) m.parent=j.parent;
    m.dir=j.dir||1;
    if(j.pivotMm) m.pivot=j.pivotMm.map(v=>v/1000);
    if(j.axis) m.axis=j.axis;
    m.leverOverride=(j.leverMm!=null)?j.leverMm/1000:null;
    m.manual=!!j.manual; m.inferred=!!j.inferred;
  }
  RIG_DEVICES=Object.assign({},r.devices||{});
  HW_USER=r.hardware||{};
  if(r.ignored){ IGNORED={}; r.ignored.forEach(k=>IGNORED[k]=1); }
  recomputeChain(CAD.mechs);
  syncOptionControls();
  return true;
}
function applyDeviceMemory(){
  if(!CODE) return;
  const ids={}; CAD.mechs.forEach(m=>ids[m.id]=1);
  for(const d of CODE.devices) if(Object.prototype.hasOwnProperty.call(RIG_DEVICES,d.name)){
    const v=RIG_DEVICES[d.name]; if(v===null||ids[v]) MAP[d.name]=v;
  }
}
function saveRig(){
  store.set(rigKey(),JSON.stringify(exportRig()));
  const ta=$("#rigJson"); if(ta&&document.activeElement!==ta) ta.value=JSON.stringify(exportRig(),null,1);
}
function loadSavedRig(){
  try{ const s=store.get(rigKey(),null); if(!s) return false; return applyRig(JSON.parse(s)); }catch(e){ return false; }
}
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
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
function addManualJoint(){
  if(!CAD) return;
  const c=[0,1,2].map(i=>(CAD.bbox.min[i]+CAD.bbox.max[i])/2);
  let n=1; while(CAD.mechs.some(m=>m.id==="joint "+n)) n++;
  CAD.mechs.push({id:"joint "+n, label:"joint "+n, kind:"fixed", parent:"chassis", dir:1, axis:[0,0,1], pivot:c,
    cluster:[], part:null, partName:null, hasActuator:false, manual:true, inferred:false, leverOverride:null});
  rigChanged();
}
let RIG_SPOTS=[];
const byMech=id=>CAD?CAD.mechs.filter(m=>m.id===id)[0]||null:null;
function renderRig(){
  const M=CAD.mechs, t=$("#rigTable");
  if(!M.length){ t.innerHTML=`<tr><td class="dim">No mechanisms found in this CAD. Add one with + Joint.</td></tr>`;
    $("#rigChain").innerHTML=""; $("#rigPill").textContent="none"; $("#rigCount").textContent=""; $("#guessPill").textContent="—"; return; }
  RIG_SPOTS=rigSpots();
  const spotOpts=RIG_SPOTS.map((s,i)=>`<option value="${i}">${esc(s.name.slice(0,30))} (${s.loc.map(v=>(v*1000).toFixed(0)).join(",")})</option>`).join("");
  t.innerHTML=`<tr><th>name</th><th>joint</th><th>moves with</th><th>pivot at</th><th>dir</th><th></th></tr>`+
    M.map(m=>{
      const kopts=Object.keys(JOINT_KINDS).map(k=>`<option value="${k}"${m.kind===k?" selected":""}>${JOINT_KINDS[k].label}</option>`).join("");
      const popts=[`<option value="chassis"${m.parent==="chassis"?" selected":""}>chassis (frame)</option>`]
        .concat(M.filter(x=>x.id!==m.id).map(x=>`<option value="${esc(x.id)}"${m.parent===x.id?" selected":""}>${esc(mlabel(x))}</option>`)).join("");
      const dot=m.inferred?`<span class="guess" title="inferred — confirm or change it"></span>`:`<span class="guess set" title="you set this"></span>`;
      return `<tr class="${m.manual?"manual":""}">
        <td><input class="rigname" data-rigname="${esc(m.id)}" value="${esc(mlabel(m))}" aria-label="Name for ${esc(m.id)}">${dot}</td>
        <td><select data-rigkind="${esc(m.id)}" aria-label="Joint type for ${esc(mlabel(m))}">${kopts}</select></td>
        <td><select data-rigparent="${esc(m.id)}" aria-label="What ${esc(mlabel(m))} moves with">${popts}</select></td>
        <td><select data-rigspot="${esc(m.id)}" aria-label="Pivot location for ${esc(mlabel(m))}">
          <option value="">as measured (${m.pivot?m.pivot.map(v=>(v*1000).toFixed(0)).join(","):"—"})</option>${spotOpts}</select></td>
        <td><button class="dirbtn" data-rigdir="${esc(m.id)}" title="Flip which way this joint travels">${m.dir>0?"+":"−"}</button></td>
        <td>${m.manual?`<button class="rmbtn" data-rigrm="${esc(m.id)}" title="Remove this joint">×</button>`:""}</td></tr>`;
    }).join("");
  $("#rigChain").innerHTML=M.map(m=>{
    const carries=rigCarries(M,m.id), dev=deviceOn(m.id);
    const par=m.parent==="chassis"?"the frame":mlabel(M.filter(x=>x.id===m.parent)[0]||{id:m.parent});
    return `<div class="chainrow"><span class="cn">${esc(mlabel(m))}</span> <span class="cj">${JOINT_KINDS[m.kind].label}</span>
      ${dev?` <code>${esc(dev)}</code>`:` <span class="cj">no device</span>`}
      <div class="cc">mounted on ${esc(par)} — ${carries.length?"swings <b>"+carries.map(c=>esc(mlabel(M.filter(x=>x.id===c)[0]||{id:c}))).join("</b>, <b>")+"</b> with it":"carries nothing further"}</div></div>`;
  }).join("");
  $("#rigPill").textContent=M.length+" joint"+(M.length===1?"":"s");
  t.querySelectorAll("[data-rigkind]").forEach(s=>s.addEventListener("change",()=>{ const m=byMech(s.dataset.rigkind); if(!m) return; m.kind=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigparent]").forEach(s=>s.addEventListener("change",()=>{ const m=byMech(s.dataset.rigparent); if(!m) return; m.parent=s.value; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigdir]").forEach(b=>b.addEventListener("click",()=>{ const m=byMech(b.dataset.rigdir); if(!m) return; m.dir=(m.dir>0?-1:1); m.inferred=false; renderRig(); saveRig(); }));
  t.querySelectorAll("[data-rigname]").forEach(i=>i.addEventListener("change",()=>{ const m=byMech(i.dataset.rigname); if(!m) return; m.label=i.value.trim()||m.id; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigspot]").forEach(s=>s.addEventListener("change",()=>{
    const m=byMech(s.dataset.rigspot), sp=RIG_SPOTS[+s.value]; if(!m||s.value===""||!sp) return;
    m.pivot=sp.loc.slice(); m.axis=sp.axis?sp.axis.slice():m.axis; m.inferred=false; rigChanged(); }));
  t.querySelectorAll("[data-rigrm]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.rigrm;
    CAD.mechs=CAD.mechs.filter(x=>x.id!==id);
    CAD.mechs.forEach(x=>{ if(x.parent===id) x.parent="chassis"; });
    for(const k in MAP) if(MAP[k]===id){ MAP[k]=null; RIG_DEVICES[k]=null; }
    rigChanged(); }));
  const guessed=M.filter(m=>m.inferred).length, gp=$("#guessPill");
  gp.textContent=guessed?guessed+" guessed":"all confirmed"; gp.className="pill"+(guessed?" warnp":" live");
  const rc=$("#rigCount"); rc.textContent=guessed?String(guessed):""; rc.className="count"+(guessed?" warn":"");
}
function rigChanged(){ recomputeChain(CAD.mechs); View.load(CAD); rebuild(); saveRig(); }

/* ============================================================
   CHECKS (findings, with ignore)
   ============================================================ */
function renderFindings(){
  const live=FINDINGS.filter(f=>!IGNORED[f.key]), hidden=FINDINGS.filter(f=>IGNORED[f.key]);
  const cnt={fail:0,warn:0,pass:0,info:0}; live.forEach(f=>cnt[f.sev]++);
  $("#score").innerHTML=`<div class="s-fail"><div class="k">${cnt.fail}</div><div class="l">won't work</div></div>
     <div class="s-warn"><div class="k">${cnt.warn}</div><div class="l">risky</div></div>
     <div class="s-pass"><div class="k">${cnt.pass}</div><div class="l">checks out</div></div>`;
  const cc=$("#checkCount");
  cc.textContent=cnt.fail?String(cnt.fail):(cnt.warn?String(cnt.warn):"");
  cc.className="count"+(cnt.fail?" fail":cnt.warn?" warn":"");
  const SEVL={fail:"WON'T WORK",warn:"RISKY",pass:"OK",info:"NOTE"};
  $("#findings").innerHTML=live.length?live.map(f=>`<div class="finding ${f.sev}">
      <div class="fhead"><span class="fsev">${SEVL[f.sev]}</span><span class="ftitle">${f.title}</span>
        <button class="fignore" data-ig="${esc(f.key)}" title="Hide this finding — it stays hidden next time too">Ignore</button></div>
      <div class="fbody">${f.body}</div>
      ${f.math?`<div class="fmath">${esc(f.math)}</div>`:""}
      ${f.fix?`<div class="ffix"><b>Fix</b>${f.fix}</div>`:""}</div>`).join("")
    :`<p class="cmp-note">Nothing to report${hidden.length?" — "+hidden.length+" finding"+(hidden.length>1?"s":"")+" ignored":""}.</p>`;
  $("#ignoredWrap").innerHTML=hidden.length
    ?`<div class="ignored-head"><h4>Ignored · ${hidden.length}</h4><span class="spacer"></span><button class="btn-sm" id="clearIgnored">Restore all</button></div>`+
      hidden.map(f=>`<div class="ign-row"><span class="t">${esc(f.title.replace(/<[^>]+>/g,""))}</span><button class="btn-sm" data-unig="${esc(f.key)}">Restore</button></div>`).join(""):"";
  $$("[data-ig]").forEach(b=>b.addEventListener("click",()=>{ IGNORED[b.dataset.ig]=1; saveIgnored(); renderFindings(); saveRig(); }));
  $$("[data-unig]").forEach(b=>b.addEventListener("click",()=>{ delete IGNORED[b.dataset.unig]; saveIgnored(); renderFindings(); saveRig(); }));
  const ci=$("#clearIgnored"); if(ci) ci.addEventListener("click",()=>{ IGNORED={}; saveIgnored(); renderFindings(); saveRig(); });
}

/* ============================================================
   COVERAGE — what the bench actually runs
   ============================================================ */
function renderCoverage(){
  if(!CODE){ $("#coverage").innerHTML=""; return; }
  const cov=coverage(CODE), pill=$("#covPill");
  pill.textContent=cov.understood+" / "+cov.total+" statements";
  pill.className="pill"+(cov.skipped.length?" warnp":" live");
  const mode=CODE.hasLoop?"TeleOp loop":(CODE.auto&&CODE.auto.length?"autonomous sequence of "+CODE.auto.length+" steps":"no loop found");
  if(!cov.skipped.length){
    $("#coverage").innerHTML=`<p class="cov-ok"><b>Everything</b> in this OpMode runs on the bench — ${esc(mode)}.</p>`;
    return;
  }
  $("#coverage").innerHTML=`<p class="cov-ok" style="margin:0 0 6px">Runs as a ${esc(mode)}. These lines are skipped, not guessed at:</p>`+
    cov.skipped.map(s=>`<div class="cov-row"><span class="ln">line ${s.line||"?"}</span><span class="tx">${esc(String(s.text).slice(0,90))}</span><span class="why">${esc(s.why)}</span></div>`).join("");
}

/* ============================================================
   CONFIG VARIABLES — live-editable, as FTC Dashboard exposes them
   ============================================================ */
function renderConfigVars(){
  const box=$("#cfgVars"), note=$("#cfgVarNote"), pill=$("#cfgVarPill");
  if(!CODE||!CODE.config.length){
    pill.textContent="none"; box.innerHTML="";
    note.innerHTML="This OpMode has no <code>static</code> fields to tune. FTC Dashboard exposes <code>public static</code> fields of a class marked <code>@Config</code>.";
    return;
  }
  pill.textContent=CODE.config.length+" field"+(CODE.config.length===1?"":"s");
  note.innerHTML=CODE.hasConfigAnnotation
    ?"The class has <code>@Config</code>, so FTC Dashboard lists these too. Edits apply live — press INIT to start from the source values."
    :"Edits apply live. Note the class has no <code>@Config</code>, so FTC Dashboard itself won't list these until you add it.";
  box.innerHTML=CODE.config.map(f=>{
    const v=Sim.vars[f.name]!==undefined?Sim.vars[f.name]:0;
    const input=f.type==="boolean"
      ?`<input type="checkbox" data-cv="${esc(f.name)}"${v?" checked":""} aria-label="${esc(f.name)}">`
      :`<input class="mini" type="number" step="${/int|long/.test(f.type)?1:"any"}" data-cv="${esc(f.name)}" value="${esc(fmtNum(v))}" aria-label="${esc(f.name)}">`;
    return `<div class="cv-row${CONFIG_OVR[f.name]!==undefined?" edited":""}" data-cvrow="${esc(f.name)}">
      <div class="cv-name">${esc(f.name)}<small>${esc((f.isPublic?"public static ":"static ")+f.type)}</small></div>
      ${input}<button class="cv-reset" data-cvreset="${esc(f.name)}" title="Back to the value in the source" aria-label="Reset ${esc(f.name)}">↺</button></div>`;
  }).join("");
  $$("#cfgVars [data-cv]").forEach(inp=>inp.addEventListener("change",()=>{
    const name=inp.dataset.cv, f=CODE.config.filter(x=>x.name===name)[0]; if(!f) return;
    let v=inp.type==="checkbox"?(inp.checked?1:0):parseFloat(inp.value);
    if(!isFinite(v)) return;
    if(/int|long/.test(f.type)) v=Math.round(v);
    CONFIG_OVR[name]=v; Sim.vars[name]=v;
    inp.closest(".cv-row").classList.add("edited");
  }));
  $$("#cfgVars [data-cvreset]").forEach(b=>b.addEventListener("click",()=>{
    const name=b.dataset.cvreset; delete CONFIG_OVR[name];
    const src=CODE.vars[name]!==undefined?CODE.vars[name]:0;
    Sim.vars[name]=src; renderConfigVars();
  }));
}
function updateConfigValues(){
  $$("#cfgVars [data-cv]").forEach(inp=>{
    if(document.activeElement===inp) return;
    const v=Sim.vars[inp.dataset.cv]; if(v===undefined) return;
    if(inp.type==="checkbox") inp.checked=!!v;
    else { const t=fmtNum(v); if(inp.value!==t) inp.value=t; }
  });
}

/* ============================================================
   GRAPH — telemetry and actuators over time
   One y-axis per chart: wide-range values (encoder counts) and unit-range
   values (servo position, motor power) get separate charts on a shared
   time axis rather than two scales on one plot.
   ============================================================ */
const Graph={
  win:30, paused:false, series:new Map(), t0:0, hoverT:null, maxSlots:8,
  reset(){ this.series.clear(); this.t0=performance.now()/1000; this.hoverT=null; this.renderLegend(); this.draw(); },
  now(){ return performance.now()/1000-this.t0; },
  slotFor(s){
    if(s.slot!=null) return s.slot;
    const used={}; this.series.forEach(x=>{ if(x.slot!=null) used[x.slot]=1; });
    for(let i=0;i<this.maxSlots;i++) if(!used[i]){ s.slot=i; return i; }
    let victim=null; this.series.forEach(x=>{ if(!victim&&x.slot!=null&&!x.on) victim=x; });
    if(victim){ s.slot=victim.slot; victim.slot=null; return s.slot; }
    return null;
  },
  push(key,label,sub,v,defaultOn,wide){
    let s=this.series.get(key);
    if(!s){
      s={key,label,sub,on:false,slot:null,data:[],wide:!!wide};
      this.series.set(key,s);
      if(defaultOn&&this.slotFor(s)!=null) s.on=true;
      this.legendDirty=true;
    }
    if(Math.abs(v)>2&&!s.wide){ s.wide=true; }
    const t=this.now();
    s.data.push(t,v);
    while(s.data.length>2&&s.data[0]<t-62) s.data.splice(0,2);
    s.last=v;
  },
  sample(){
    if(this.paused||!CODE||Sim.phase==="empty") return;
    const env=Sim.env(); let telCount=0;
    for(const t of CODE.telemetry) if(t.kind==="addData"){
      const v=telemetryValue(t,env);
      if(typeof v==="number"){ this.push("tel:"+t.label,t.label.trim(),"telemetry",v,true,false); telCount++; }
    }
    for(const d of CODE.devices){
      const s=Sim.dev[d.name]; if(!s||!/Servo|DcMotor/i.test(d.type||"")) continue;
      if(s.kind==="servo") this.push("pos:"+d.name,d.name,"servo position",s.act,telCount===0,false);
      else{
        this.push("pow:"+d.name,d.name,"motor power",s.act,false,false);
        this.push("tick:"+d.name,d.name,"encoder counts",s.ticks,false,true);
      }
    }
    if(this.legendDirty){ this.legendDirty=false; this.renderLegend(); }
  },
  color(slot){ return getComputedStyle(document.documentElement).getPropertyValue("--s"+(slot+1)).trim()||"#888"; },
  renderLegend(){
    const el=$("#legend"); if(!el) return;
    const list=[...this.series.values()];
    if(!list.length){ el.innerHTML=""; return; }
    const order={"telemetry":0,"servo position":1,"motor power":2,"encoder counts":3};
    list.sort((a,b)=>(order[a.sub]-order[b.sub])||a.label.localeCompare(b.label));
    el.innerHTML=list.map(s=>`<label class="lg-row${s.on?"":" off"}">
        <input type="checkbox" data-lg="${esc(s.key)}"${s.on?" checked":""}>
        <i style="background:${s.on&&s.slot!=null?this.color(s.slot):"transparent"};${s.on?"":"box-shadow:inset 0 0 0 1px var(--line)"}"></i>
        <span class="lg-name">${esc(s.label)} <small>${esc(s.sub)}</small></span>
        <span class="lg-v" data-lgv="${esc(s.key)}">—</span></label>`).join("")+
      `<div class="lg-note" id="lgNote">Up to ${this.maxSlots} series at once. Each keeps its colour while it's on.</div>`;
    $$("#legend [data-lg]").forEach(cb=>cb.addEventListener("change",()=>{
      const s=this.series.get(cb.dataset.lg); if(!s) return;
      if(cb.checked){ if(this.slotFor(s)==null){ cb.checked=false; $("#lgNote").textContent="Already showing "+this.maxSlots+" series — turn one off first."; return; } s.on=true; }
      else s.on=false;
      this.renderLegend(); this.draw();
    }));
    this.updateLegendValues();
  },
  updateLegendValues(){
    $$("#legend [data-lgv]").forEach(el=>{ const s=this.series.get(el.dataset.lgv); if(s&&s.last!=null) el.textContent=fmtNum(s.last); });
  },
  groups(){
    const on=[...this.series.values()].filter(s=>s.on&&s.slot!=null);
    return [{id:"wide", title:"Counts & wide-range values", list:on.filter(s=>s.wide)},
            {id:"norm", title:"Positions & power  (−1 … 1)", list:on.filter(s=>!s.wide)}].filter(g=>g.list.length);
  },
  layout(){
    const box=$("#charts"); if(!box) return [];
    const groups=this.groups();
    const sig=groups.map(g=>g.id).join("|");
    if(box.dataset.sig!==sig){
      box.dataset.sig=sig;
      box.innerHTML=groups.length?groups.map(g=>`<div class="chart" data-chart="${g.id}"><h4>${esc(g.title)}</h4><canvas></canvas><div class="tip" hidden></div></div>`).join("")
        :`<div class="chart-empty">${CODE?"Turn on a series below, or press START and drive — values appear as the OpMode runs.":"Load an OpMode to graph it."}</div>`;
      $$("#charts .chart canvas").forEach(cv=>{
        cv.addEventListener("pointermove",e=>{ const r=cv.getBoundingClientRect(); this.hoverX=(e.clientX-r.left)/r.width; this.hoverChart=cv.parentElement.dataset.chart; this.draw(); });
        cv.addEventListener("pointerleave",()=>{ this.hoverX=null; this.draw(); });
      });
    }
    return groups;
  },
  draw(){
    if(!paneVisible("graph")) return;
    const groups=this.layout(); if(!groups.length) return;
    const css=getComputedStyle(document.documentElement);
    const ink2=css.getPropertyValue("--tx-2").trim(), ink3=css.getPropertyValue("--tx-3").trim();
    const grid=css.getPropertyValue("--grid").trim(), axis=css.getPropertyValue("--axis").trim();
    const panel=css.getPropertyValue("--panel").trim();
    const tNow=this.paused&&this.pausedAt!=null?this.pausedAt:this.now(), t0=tNow-this.win;
    groups.forEach((g,gi)=>{
      const wrap=document.querySelector(`[data-chart="${g.id}"]`); if(!wrap) return;
      const cv=wrap.querySelector("canvas"), tip=wrap.querySelector(".tip");
      const last=gi===groups.length-1;
      const W=cv.clientWidth||300, H=last?168:146, dpr=Math.min(devicePixelRatio||1,2);
      cv.style.height=H+"px";
      if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
      const ctx=cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
      const L=46, R=66, T=8, B=last?22:8, pw=W-L-R, ph=H-T-B;
      // y domain from what's visible in the window
      let lo=Infinity, hi=-Infinity;
      for(const s of g.list) for(let i=0;i<s.data.length;i+=2){ if(s.data[i]<t0) continue; const v=s.data[i+1]; if(v<lo)lo=v; if(v>hi)hi=v; }
      if(!isFinite(lo)){ lo=0; hi=1; }
      if(g.id==="norm"){ lo=Math.min(lo,0); hi=Math.max(hi,lo<0?1:1); if(lo<0) lo=Math.min(lo,-1); }
      else { if(lo>0&&lo<hi*0.3) lo=0; if(hi<0&&hi>lo*0.3) hi=0; }
      if(hi-lo<1e-9){ hi+=1; lo-=1; }
      const span=hi-lo, raw=span/4, mag=Math.pow(10,Math.floor(Math.log10(raw))), f=raw/mag;
      const step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;
      lo=Math.floor(lo/step)*step; hi=Math.ceil(hi/step)*step;
      const X=t=>L+(t-t0)/this.win*pw, Y=v=>T+(1-(v-lo)/(hi-lo))*ph;
      // grid and y labels
      ctx.lineWidth=1; ctx.font="10px "+css.getPropertyValue("--mono"); ctx.textBaseline="middle";
      for(let v=lo; v<=hi+step*0.5; v+=step){
        const y=Math.round(Y(v))+0.5;
        ctx.strokeStyle=Math.abs(v)<step*1e-6?axis:grid; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(L+pw,y); ctx.stroke();
        ctx.fillStyle=ink3; ctx.textAlign="right"; ctx.fillText(fmtTick(v,step),L-6,y);
      }
      if(last){
        ctx.textAlign="center"; ctx.textBaseline="top";
        const marks=this.win<=10?[10,5,0]:this.win<=30?[30,20,10,0]:[60,45,30,15,0];
        for(const m of marks){ const x=X(tNow-m); ctx.fillStyle=ink3; ctx.fillText(m===0?"now":"−"+m+" s",x,T+ph+6); }
      }
      // lines
      ctx.save(); ctx.beginPath(); ctx.rect(L,T-2,pw,ph+4); ctx.clip();
      ctx.lineJoin="round"; ctx.lineCap="round"; ctx.lineWidth=2;
      for(const s of g.list){
        ctx.strokeStyle=this.color(s.slot); ctx.beginPath(); let started=false;
        for(let i=0;i<s.data.length;i+=2){
          if(s.data[i]<t0-1) continue;
          const x=X(s.data[i]), y=Y(s.data[i+1]);
          if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // endpoint marks and direct labels, nudged apart
      const ends=g.list.filter(s=>s.data.length).map(s=>({s, x:X(s.data[s.data.length-2]), y:Y(s.data[s.data.length-1])}));
      ends.sort((a,b)=>a.y-b.y);
      for(let i=1;i<ends.length;i++) if(ends[i].ly==null){ ends[i].ly=Math.max(ends[i].y,(ends[i-1].ly!=null?ends[i-1].ly:ends[i-1].y)+12); }
      ctx.textAlign="left"; ctx.textBaseline="middle";
      ends.forEach(e=>{
        ctx.fillStyle=this.color(e.s.slot); ctx.strokeStyle=panel; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(Math.min(e.x,L+pw),e.y,4,0,Math.PI*2); ctx.fill(); ctx.stroke();
        if(g.list.length<=4){ ctx.fillStyle=ink2; ctx.fillText(e.s.label.slice(0,10),L+pw+8,Math.min(T+ph,Math.max(T,e.ly!=null?e.ly:e.y))); }
      });
      // crosshair and tooltip
      if(this.hoverX!=null){
        const x=L+Math.max(0,Math.min(1,(this.hoverX*W-L)/pw))*pw, t=t0+(x-L)/pw*this.win;
        ctx.strokeStyle=ink3; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(Math.round(x)+0.5,T); ctx.lineTo(Math.round(x)+0.5,T+ph); ctx.stroke();
        if(this.hoverChart===g.id){
          const rows=g.list.map(s=>{ let best=null,bd=1e9; for(let i=0;i<s.data.length;i+=2){ const d=Math.abs(s.data[i]-t); if(d<bd){bd=d;best=s.data[i+1];} } return {s,v:best}; });
          tip.hidden=false;
          tip.innerHTML=`<div class="tt">${(tNow-t).toFixed(1)} s ago</div>`+rows.map(r=>`<div class="tr"><i style="background:${this.color(r.s.slot)}"></i><span>${esc(r.s.label)}</span><span>${r.v==null?"—":esc(fmtNum(r.v))}</span></div>`).join("");
          const tw=tip.offsetWidth||140;
          tip.style.left=Math.max(0,Math.min(W-tw,x+(x>W/2?-tw-10:10)))+"px"; tip.style.top="22px";
        } else tip.hidden=true;
      } else tip.hidden=true;
    });
  }
};
function fmtTick(v,step){
  if(Math.abs(v)>=10000) return (v/1000).toFixed(0)+"k";
  // as many decimals as the step needs: 0.25 → 2, 0.5 → 1, 2 → 0
  let d=0; while(d<4&&Math.abs(Math.round(step*Math.pow(10,d))-step*Math.pow(10,d))>1e-6) d++;
  return v.toFixed(d);
}

/* ============================================================
   THEME — dark by default; the choice is remembered
   ============================================================ */
const SUN='<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3"/></g></svg>';
const MOON='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" fill="currentColor"/></svg>';
const currentTheme=()=>document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";
function setTheme(t){
  document.documentElement.setAttribute("data-theme",t);
  store.set("ftcbench.theme",t);
  const b=$("#themeBtn"); if(!b) return;
  const next=t==="dark"?"light":"dark";
  b.innerHTML=t==="dark"?SUN:MOON;
  b.setAttribute("aria-label","Switch to "+next+" theme"); b.title="Switch to "+next+" theme";
  Graph.draw();
}

/* ============================================================
   COMPARE TWO OPMODES
   ============================================================ */
function renderCompareSelects(){
  const opts=LIBRARY.filter(e=>e.code).map(e=>`<option value="${esc(e.id)}">${esc(opName(e))} — ${esc(e.file)}</option>`).join("");
  const a=$("#cmpA"), b=$("#cmpB"), va=a.value, vb=b.value;
  a.innerHTML=opts; b.innerHTML=opts;
  a.value=entry(va)?va:(CURRENT_ID||"");
  const other=LIBRARY.filter(e=>e.code&&e.id!==a.value&&opKind(e)===opKind(entry(a.value)||{}))[0]||LIBRARY.filter(e=>e.code&&e.id!==a.value)[0];
  b.value=entry(vb)&&vb!==a.value?vb:(other?other.id:a.value);
  if(paneVisible("compare")) renderCompare();
}
function renderCompare(){
  const A=entry($("#cmpA").value), B=entry($("#cmpB").value), box=$("#compare");
  if(!A||!B||!A.code||!B.code){ box.innerHTML=`<p class="cmp-note">Load a second OpMode to compare against — two versions of the same TeleOp is the usual case.</p>`; return; }
  if(A.id===B.id){ box.innerHTML=`<p class="cmp-note">Pick two different OpModes.</p>`; return; }
  const d=diffOpModes(A.code,B.code), S=d.summary;
  const rank={changed:0,added:1,removed:2,same:3};
  const rows=d.controls.slice().sort((x,y)=>rank[x.status]-rank[y.status]);
  const side=list=>list.length?list.map(esc).join("<br>"):"<em>nothing</em>";
  box.innerHTML=`<div class="cmp-sum">
      <span class="pill${S.changed?" warnp":""}">${S.changed} changed</span>
      <span class="pill${S.added?" live":""}">${S.added} only in B</span>
      <span class="pill${S.removed?" failp":""}">${S.removed} only in A</span>
      <span class="pill">${S.same} same</span></div>
    <div class="cmp-sec"><h4>Controls</h4>${rows.length?rows.map(r=>`<div class="cmp-row ${r.status}">
        <div class="ctl">${esc(r.control)} <span class="st">${r.status==="added"?"only in B":r.status==="removed"?"only in A":r.status}</span></div>
        <div class="side">${side(r.a)}</div><div class="side">${side(r.b)}</div></div>`).join(""):`<p class="hint">Neither OpMode reads a gamepad.</p>`}</div>
    ${(d.devices.added.length||d.devices.removed.length)?`<div class="cmp-sec"><h4>Devices</h4>
      ${d.devices.removed.length?`<div class="cmp-row removed"><div class="ctl">only in A</div><div class="side">${d.devices.removed.map(esc).join(", ")}</div></div>`:""}
      ${d.devices.added.length?`<div class="cmp-row added"><div class="ctl">only in B</div><div class="side">${d.devices.added.map(esc).join(", ")}</div></div>`:""}</div>`:""}
    ${d.values.length?`<div class="cmp-sec"><h4>Values</h4>${d.values.map(v=>`<div class="cmp-row changed">
        <div class="ctl">${esc(v.name)}</div><div class="side">${v.a===undefined?"<em>not declared</em>":esc(fmtNum(v.a))}</div><div class="side">${v.b===undefined?"<em>not declared</em>":esc(fmtNum(v.b))}</div></div>`).join("")}</div>`:""}`;
}

/* ============================================================
   SHOT — the BIOBUZZ Shot Sim, live from where the robot is
   ============================================================ */
const VERDICT_CLASS={"POSSIBLE":"pass","NOT CONSISTENT":"warn","WON'T WORK":"fail"};
const VERDICT_HEX={"POSSIBLE":0x3FB68B,"NOT CONSISTENT":0xE0A42E,"WON'T WORK":0xE4574E};
const ShotUI={key:null, still:0, t:0, dirty:true, full:false, res:null, win:null, preview:null, arc:true, arcKey:null};
const wrap180=d=>((d%360)+540)%360-180;
const poseText=c=>Field.ok
  ? `x ${(c.x/IN).toFixed(1)} · y ${(c.y/IN).toFixed(1)} in · ${Math.round(wrap180(c.h*180/Math.PI))}°`
  : `x ${c.x.toFixed(2)} m · y ${c.y.toFixed(2)} m · ${Math.round(c.h*180/Math.PI)}°`;
function setHTML(el,html){ if(el&&el.innerHTML!==html) el.innerHTML=html; }
function placeAtStart(){
  const p=Field.ok?Field.startPose(Shots.alliance,footprintOf(CAD,OPTS.front)):{x:0,y:0,h:0};
  Sim.chassis={x:p.x,y:p.y,h:p.h}; OPTS.startPose=Object.assign({},p);
}
function setAlliance(al,move){
  Shots.alliance=al==="blue"?"blue":"red"; View.alliance=Shots.alliance; store.set("ftcbench.alliance",Shots.alliance);
  if(View.mode==="field") View.setView("field");
  if(move&&CAD&&Sim.phase!=="running") placeAtStart();
  ShotUI.dirty=true; ShotUI.t=0; renderShotSetup();
}
/* Ticks per second at full speed for the flywheel as the code declares it,
   so the advice comes out in the units setVelocity() takes. */
function flywheelTicks(){
  const s=Shots.cfg&&Shots.cfg.shooter&&Sim.dev[Shots.cfg.shooter];
  return s?(s.spec.rpm||300)/60*s.tpr:2800;
}
function shotEvaluate(mode){
  try{
    const c=Sim.chassis;
    ShotUI.res=Field.E.evaluate(Shots.params(c),mode);
    ShotUI.win=paneVisible("shot")?Shots.window(c,ShotUI.res.best?ShotUI.res.best.yawDeg:ShotUI.res.psi0Deg):null;
  }catch(e){ ShotUI.res=null; ShotUI.win=null; }
}
function shotTick(now){
  if(!Field.ok||!Shots.cfg||!CAD) return;
  const c=Sim.chassis;
  const key=[(c.x/IN).toFixed(1),(c.y/IN).toFixed(1),Field.hive.red,Field.hive.blue,Shots.alliance,JSON.stringify(Shots.cfg)].join("|");
  if(key!==ShotUI.key){ ShotUI.key=key; ShotUI.still=now; ShotUI.dirty=true; ShotUI.full=false; }
  let fresh=false;
  if(ShotUI.dirty&&now-ShotUI.t>=250){ shotEvaluate("coarse"); ShotUI.t=now; ShotUI.dirty=false; fresh=true; }
  else if(!ShotUI.dirty&&!ShotUI.full&&now-ShotUI.still>=700){ shotEvaluate("full"); ShotUI.full=true; fresh=true; }
  // what would happen if the robot fired right now
  ShotUI.preview=null;
  if(Shots.cfg.shooter&&Shots.spin()>0.1){
    const v=Shots.exitSpeed();
    if(v>=1) ShotUI.preview=Field.E.classifyShot(Shots.params(c),Shots.cfg.hoodDeg,v,Shots.yawDeg(c));
  }
  updateArc();
  const sc=$("#shotCount"), r=ShotUI.res;
  if(sc){ const k=r?VERDICT_CLASS[r.verdict]:""; sc.textContent=r?(k==="pass"?"✓":k==="warn"?"~":"✕"):""; sc.className="count"+(k==="fail"?" fail":k==="warn"?" warn":""); }
  if(paneVisible("shot")){ if(fresh) renderShotVerdict(); renderShotLive(); renderHives(); renderShotLog(); }
}
function updateArc(){
  let path=null, col=0, dashed=false;
  if(ShotUI.arc){
    if(ShotUI.preview){ path=ShotUI.preview.path; col=ShotUI.preview.hit?0x3FB68B:0xE4574E; }
    // the best arc only when it's worth showing: a WON'T WORK "best" can be a 6 m lob
    else if(ShotUI.res&&ShotUI.res.trajectory&&ShotUI.res.verdict!=="WON'T WORK"){
      path=ShotUI.res.trajectory; col=VERDICT_HEX[ShotUI.res.verdict]||0x8595A8; dashed=true; }
  }
  const k=path?[path.length,path[0].join(","),path[path.length-1].join(","),col,dashed].join("|"):"";
  if(k===ShotUI.arcKey) return;
  ShotUI.arcKey=k; View.setArc(path,col,dashed);
}
function renderShotVerdict(){
  const el=$("#shotVerdict"); if(!el) return;
  if(!Field.ok){ el.className="verdict"; el.innerHTML=`<div class="vs">The BIOBUZZ field didn't load, so there is nothing to shoot at. Everything else on the bench works.</div>`; return; }
  const r=ShotUI.res, c=Sim.chassis, al=Shots.target().toUpperCase();
  if(!r){ el.className="verdict"; el.innerHTML=`<div class="vs">Working out the shot from here…</div>`; return; }
  const b=r.best;
  el.className="verdict "+(VERDICT_CLASS[r.verdict]||"");
  el.innerHTML=`<div class="vhead"><span class="vw">${esc(r.verdict)}</span><span class="vr">${Math.round((r.hitRate||0)*100)}% score</span></div>
    <div class="vs">From x ${(c.x/IN).toFixed(0)}, y ${(c.y/IN).toFixed(0)} in to the ${al} up-CELL, ${Math.round(r.distIn)} in away. ${esc(r.reason||"")}</div>
    ${b?`<div class="vk"><div><b>${b.thetaDeg.toFixed(0)}°</b><span>launch</span></div><div><b>${b.v.toFixed(2)}</b><span>m/s exit</span></div><div><b>${r.motor?Math.round(r.motor.motorRpm).toLocaleString():"—"}</b><span>motor rpm</span></div></div>`:""}
    ${(r.warnings||[]).map(w=>`<div class="vwarn">${esc(w.text)}</div>`).join("")}`;
}
function renderShotLive(){
  const el=$("#shotLive"); if(!el||!Shots.cfg) return;
  const cfg=Shots.cfg, full=Shots.full(), spin=Shots.spin(), c=Sim.chassis, out=[];
  if(!cfg.shooter) out.push(`<div>No flywheel motor picked. Choose one below, or press Fire to see the best shot from here.</div>`);
  else out.push(`<div><code>${esc(cfg.shooter)}</code> ${spin>0.01
    ?`at <b>${Math.round(spin*100)}%</b> of free speed → ${Math.round(Math.min(full.rpm,spin*full.free)).toLocaleString()} rpm → <b>${Shots.exitSpeed().toFixed(2)} m/s</b>`
    :"is stopped"+(Sim.phase==="running"?"":" — press START")}</div>`);
  const w=ShotUI.win, T=flywheelTicks();
  if(w&&full.v){
    const sp=v=>v/full.v*full.rpm/full.free;           // exit speed → share of free speed
    const band=(a,b)=>a===b?a:a+"–"+b;
    out.push(`<div>At ${cfg.hoodDeg}° this spot scores from <b>${w.lo.toFixed(2)} to ${w.hi.toFixed(2)} m/s</b>: <code>setVelocity(${band(Math.round(sp(w.lo)*T),Math.round(sp(w.hi)*T))})</code> or power ${band(sp(w.lo).toFixed(2),sp(w.hi).toFixed(2))}.</div>`);
  }else if(ShotUI.res&&paneVisible("shot")){
    out.push(`<div>No flywheel speed scores from here at ${cfg.hoodDeg}°${ShotUI.res.best?` — the best arc from this spot leaves at ${ShotUI.res.best.thetaDeg.toFixed(0)}°`:""}.</div>`);
  }
  if(ShotUI.res&&ShotUI.res.best){
    const d=wrap180(ShotUI.res.best.yawDeg-Shots.yawDeg(c));
    out.push(Math.abs(d)<1.5?`<div>Aimed at the up-CELL.</div>`:`<div>Aim: turn <b>${Math.abs(d).toFixed(0)}° ${d>0?"left":"right"}</b>.</div>`);
  }
  if(ShotUI.preview) out.push(`<div>Fire now and it ${ShotUI.preview.hit?`<b class="ok">goes in</b>`:`<b class="bad">${esc(CAUSE_TEXT[ShotUI.preview.cause]||"misses")}</b>`}.</div>`);
  setHTML(el,out.join(""));
}
function renderHives(){
  const el=$("#hiveRows"); if(!el||!Field.ok) return;
  const rows=["red","blue"].map(al=>{
    const list=Field.cells[al], g=Field.grams(al);
    const n={pollen:0,nectar:0}; list.forEach(e=>n[e.kind]++);
    const what=list.length?[n.nectar?n.nectar+" NECTAR":"",n.pollen?n.pollen+" POLLEN":""].filter(Boolean).join(" + "):"empty";
    const side=Field.hive[al]<0?"audience side":"far side";
    return `<div class="hive-row"><div class="hive-top"><span class="al ${al}">${al.toUpperCase()}</span>
      <span class="what">up-CELL on the ${side} · ${what}</span>
      <button class="btn-sm" data-tip="${al}" title="Swing the ${al} HIVE over by hand">TIP</button></div>
      <div class="tipbar"><i style="width:${Math.min(100,g/TIP_GRAMS*100).toFixed(0)}%"></i></div>
      <div class="hive-sub"><span>${Math.round(g)} g of ~${TIP_GRAMS} g to TIP</span><span>${Field.tips[al]} TIP${Field.tips[al]===1?"":"s"} · ${Field.tips[al]*20} pts</span></div></div>`;
  }).join("");
  setHTML(el,rows);
}
function renderShotLog(){
  const el=$("#shotLog"); if(!el) return;
  const head=Shots.fired?`<div><span>this run</span>${Shots.fired} fired · ${Shots.scored} in</div>`:"";
  setHTML(el,head+Shots.log.map(l=>`<div><span>${l.t.toFixed(1)} s</span>${esc(l.text)}</div>`).join(""));
}
function renderShotSetup(){
  if(!$("#shotDev")) return;
  $$("#allySeg button").forEach(b=>b.classList.toggle("on",b.dataset.al===Shots.alliance));
  const cfg=Shots.cfg;
  const fire=$("#fireBtn"); if(fire) fire.disabled=!Field.ok||!cfg;
  if(!cfg||!Field.ok){ renderShotVerdict(); return; }
  const devs=(CODE&&CODE.devices)||[];
  const opt=(list,sel,none)=>[`<option value="">${none}</option>`].concat(list.map(d=>
    `<option value="${esc(d.name)}"${d.name===sel?" selected":""}>${esc(d.name)}</option>`)).join("");
  setHTML($("#shotDev"),opt(devs.filter(d=>/DcMotor/i.test(d.type||"")),cfg.shooter,"— none —"));
  setHTML($("#shotFeed"),opt(devs.filter(d=>d.name!==cfg.shooter&&/Servo|DcMotor/i.test(d.type||"")),cfg.feeder,"— by hand (F) —"));
  $$("#ballSeg button").forEach(b=>b.classList.toggle("on",b.dataset.ball===cfg.ball));
  $$("#typeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.type===cfg.type));
  $$("#mountSeg button").forEach(b=>b.classList.toggle("on",+b.dataset.mount===(cfg.mountDeg||0)));
  $("#hoodSlider").value=cfg.hoodDeg; $("#hoodVal").textContent=cfg.hoodDeg+"°";
  $("#h0Slider").value=cfg.h0In; $("#h0Val").textContent=cfg.h0In+" in";
  const motors=Field.data.motors.motors;
  setHTML($("#motorSel"),motors.map(m=>`<option value="${esc(m.id)}"${m.id===cfg.motorId?" selected":""}>${esc(m.label)}</option>`).join(""));
  const wheels=Field.data.shooter.wheels;
  setHTML($("#wheelSel"),wheels.map(w=>`<option value="${w.diameterMm}|${esc(w.id)}"${w.diameterMm===cfg.wheelMm&&(!cfg.wheelId||cfg.wheelId===w.id)?" selected":""}>${esc(w.label)}</option>`).join(""));
  if(document.activeElement!==$("#gearIn")) $("#gearIn").value=cfg.gear;
  renderShotVerdict(); renderShotLive(); renderHives(); renderShotLog();
}
function shotChanged(){ ShotUI.dirty=true; ShotUI.t=0; saveRig(); renderShotSetup(); }
function shotFire(){
  if(!Field.ok||!Shots.cfg) return;
  if(Shots.cfg.shooter&&Shots.spin()>0.1) Shots.fire(Sim.chassis,"fired by hand");
  else Shots.fireBest(Sim.chassis);
  renderShotLog();
}
function wireShotTab(){
  $("#fireBtn").addEventListener("click",shotFire);
  $("#fieldReset").addEventListener("click",()=>{ Field.reset(); Shots.reset(); ShotUI.dirty=true; ShotUI.t=0; renderShotSetup(); });
  $("#hiveRows").addEventListener("click",e=>{ const b=e.target.closest("[data-tip]"); if(!b) return; Field.tip(b.dataset.tip); ShotUI.dirty=true; ShotUI.t=0; renderHives(); });
  $("#arcToggle").addEventListener("change",e=>{ ShotUI.arc=e.target.checked; store.set("ftcbench.arc",e.target.checked?"1":"0"); ShotUI.arcKey=null; updateArc(); });
  $("#allySeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(b) setAlliance(b.dataset.al,true); });
  const seg=(id,apply)=>$(id).addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b||!Shots.cfg) return; apply(b); shotChanged(); });
  seg("#ballSeg",b=>Shots.cfg.ball=b.dataset.ball);
  seg("#typeSeg",b=>Shots.cfg.type=b.dataset.type);
  seg("#mountSeg",b=>Shots.cfg.mountDeg=+b.dataset.mount);
  $("#hoodSlider").addEventListener("input",e=>{ if(!Shots.cfg) return; Shots.cfg.hoodDeg=+e.target.value; $("#hoodVal").textContent=e.target.value+"°"; ShotUI.dirty=true; saveRig(); });
  $("#h0Slider").addEventListener("input",e=>{ if(!Shots.cfg) return; Shots.cfg.h0In=+e.target.value; $("#h0Val").textContent=e.target.value+" in"; ShotUI.dirty=true; saveRig(); });
  $("#motorSel").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.motorId=e.target.value; shotChanged(); });
  $("#wheelSel").addEventListener("change",e=>{ if(!Shots.cfg) return; const p=e.target.value.split("|"); Shots.cfg.wheelMm=+p[0]; Shots.cfg.wheelId=p[1]; shotChanged(); });
  $("#gearIn").addEventListener("change",e=>{ if(!Shots.cfg) return; const v=parseFloat(e.target.value); if(isFinite(v)&&v>0) Shots.cfg.gear=Math.max(0.25,Math.min(4,v)); shotChanged(); });
  $("#shotDev").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.shooter=e.target.value||null; Shots.cfg.motorId=nearestMotorId(Shots.deviceRpm()); shotChanged(); });
  $("#shotFeed").addEventListener("change",e=>{ if(!Shots.cfg) return; Shots.cfg.feeder=e.target.value||null; shotChanged(); });
  $("#frontSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    OPTS.front=b.dataset.front; Sim.footprint=footprintOf(CAD,OPTS.front);
    Sim.obstacles=Field.ok?Field.obstacles(Sim.footprint.h):[];
    syncOptionControls(); saveRig(); });
}

/* ============================================================
   ORCHESTRATION
   ============================================================ */
function renderLegend3D(){
  const COL={"revolute-yaw":"#E0A42E","revolute-lift":"#4D9FFF","effector":"#3FB68B","linear":"#8C9EFF","fixed":"#8899AA"};
  const shown=CAD.mechs.filter(m=>m.kind!=="fixed").slice(0,6);
  $("#vpLegend").innerHTML=shown.map(m=>{
    const n=rigCarries(CAD.mechs,m.id).length;
    return `<span><i style="background:${COL[m.kind]||"#8899AA"}"></i>${esc(mlabel(m))} · ${JOINT_KINDS[m.kind].label}${n?" +"+n:""}</span>`;
  }).join("")+(Sim.drivetrain&&Sim.drivetrain.ok?`<span><i style="background:#C3CEDB"></i>drive base · ${Sim.drivetrain.style}</span>`:"");
  $("#pip").hidden=!liftState().aS;
}
function analyzeAll(){
  if(!CODE||!CAD) return;
  FINDINGS=analyze(CODE,CAD,MAP,OPTS);
  renderFindings(); renderTables(); renderRig(); renderCoverage();
}
/* Rebuild the simulation after a rig or hardware change, keeping the Driver
   Station where it was — a running OpMode restarts, like re-deploying code. */
function reloadSim(){
  if(!CODE||!CAD) return;
  const phase=Sim.phase;
  Sim.load(CODE,CAD,MAP,withPose()); applyConfigOverrides();
  if(phase!=="stopped"){ Sim.init(); applyConfigOverrides(); }
  if(phase==="running") Sim.start();
  buildGauges(); renderPad(); renderLegend3D(); updateDS();
}
function rebuild(){ analyzeAll(); reloadSim(); }
function syncOptionControls(){
  $$("#trustSeg button").forEach(b=>b.classList.toggle("on",b.dataset.trust===OPTS.trust));
  $("#trustNote").textContent=OPTS.trust==="code"
    ?"Servo and motor types come from your declarations and comments. The CAD is used for geometry only."
    :"Servo and motor types come from the part numbers in the STEP assembly.";
  const g=Math.round(OPTS.payloadKg*1000), d=Math.round(OPTS.duty*100), t=Math.round((View.turretScale||0.55)*100);
  $("#massSlider").value=g; $("#massVal").textContent=g+" g";
  $("#dutySlider").value=d; $("#dutyVal").textContent=d+" %";
  $("#turretSlider").value=t; $("#turretVal").textContent=t+" %";
  $$("#frontSeg button").forEach(b=>b.classList.toggle("on",b.dataset.front===OPTS.front));
}
function loadCAD(cad,label,cls){
  CAD=cad;
  $("#cadStatus").textContent=label; $("#cadDrop").className="drop "+(cls||"ok");
  $("#vpTitle").textContent=(cad.name||label)+" · "+(cad.points?cad.points.length.toLocaleString():"0")+" pts · "+cad.mechs.length+" mechanism"+(cad.mechs.length===1?"":"s")+(Field.ok?" · BIOBUZZ field":"");
  const b=cad.bbox, mm=v=>(v*1000).toFixed(0);
  $("#vpDims").textContent=`${mm(b.max[0]-b.min[0])} × ${mm(b.max[1]-b.min[1])} × ${mm(b.max[2]-b.min[2])} mm`;
  RIG_DEVICES={}; HW_USER={}; Shots.cfg=null; OPTS.front="+x";
  const restored=loadSavedRig();
  View.load(cad);
  if(Sim.phase!=="running") placeAtStart();
  if(CODE){ MAP=autoMap(CODE.devices,CAD.mechs); applyDeviceMemory(); rebuild(); }
  if(restored) $("#cadStatus").textContent=label+" · rig restored";
  syncOptionControls();
}

/* ============================================================
   FILE INTAKE — click, drop on a target, or drop anywhere
   ============================================================ */
function readText(file,cb,err){
  const r=new FileReader();
  r.onerror=()=>err&&err("couldn't read "+file.name);
  r.onload=()=>cb(r.result);
  r.readAsText(file);
}
function takeCAD(file){
  $("#cadStatus").textContent="reading "+file.name+" …"; $("#cadDrop").className="drop";
  readText(file,text=>{
    const mb=(text.length/1048576).toFixed(1);
    $("#cadStatus").textContent="parsing "+mb+" MB …";
    setTimeout(()=>{
      try{
        const cad=parseSTEP(text,msg=>{ $("#cadStatus").textContent=msg; });
        cad.name=file.name;
        loadCAD(cad, file.name+" · "+mb+" MB · "+cad.mechs.length+" mechanism"+(cad.mechs.length===1?"":"s"), cad.mechs.length?"ok":"bad");
      }catch(e){ $("#cadStatus").textContent="couldn't parse this STEP file — "+e.message; $("#cadDrop").className="drop bad"; }
    },30);
  },m=>{ $("#cadStatus").textContent=m; });
}
function takeCode(file){ readText(file,text=>addOpModeFromText(file.name,text)); }
function setRobotConfig(text,name){
  try{
    const cfg=parseRobotConfig(text);
    OPTS.robotConfig=cfg; ROBOT_CFG_NAME=name;
    store.set("ftcbench.robotconfig",JSON.stringify({name,text}));
    $("#cfgStatus").textContent=name+" · "+cfg.devices.length+" devices on "+cfg.modules.length+" hub"+(cfg.modules.length===1?"":"s");
    $("#cfgDrop").className="drop ok"; $("#cfgClear").hidden=false;
  }catch(e){
    $("#cfgStatus").textContent="couldn't read "+name+" — "+e.message; $("#cfgDrop").className="drop bad";
  }
  analyzeAll();
}
function takeRobotConfig(file){ readText(file,text=>setRobotConfig(text,file.name)); }
function routeFile(file){
  const n=file.name.toLowerCase();
  if(/\.(step|stp)$/.test(n)) takeCAD(file);
  else if(/\.xml$/.test(n)) takeRobotConfig(file);
  else takeCode(file);
}
function wireDrop(dropEl,inputEl,handler){
  const open=()=>inputEl.click();
  dropEl.addEventListener("click",e=>{ if(e.target!==inputEl) open(); });
  dropEl.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
  ["dragenter","dragover"].forEach(ev=>dropEl.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); dropEl.classList.add("armed"); document.body.classList.remove("dragging"); }));
  ["dragleave","drop"].forEach(ev=>dropEl.addEventListener(ev,e=>{ e.preventDefault(); dropEl.classList.remove("armed"); }));
  dropEl.addEventListener("drop",e=>{ e.stopPropagation(); document.body.classList.remove("dragging"); const f=e.dataTransfer.files[0]; if(f) handler(f); });
  inputEl.addEventListener("change",e=>{ const f=e.target.files[0]; if(f) handler(f); inputEl.value=""; });
}
function wirePageDrop(){
  let depth=0;
  addEventListener("dragenter",e=>{ if(e.dataTransfer&&[].indexOf.call(e.dataTransfer.types||[],"Files")>=0){ depth++; document.body.classList.add("dragging"); } });
  addEventListener("dragleave",()=>{ depth=Math.max(0,depth-1); if(!depth) document.body.classList.remove("dragging"); });
  addEventListener("dragover",e=>e.preventDefault());
  addEventListener("drop",e=>{ e.preventDefault(); depth=0; document.body.classList.remove("dragging");
    [].forEach.call((e.dataTransfer&&e.dataTransfer.files)||[],routeFile); });
}

/* ============================================================
   KEYBOARD & USB GAMEPAD
   ============================================================ */
const KEYMAP={KeyA:"a",KeyB:"b",KeyX:"x",KeyY:"y",KeyQ:"left_bumper",KeyE:"right_bumper",
  ArrowUp:"dpad_up",ArrowDown:"dpad_down",ArrowLeft:"dpad_left",ArrowRight:"dpad_right"};
const STICKKEYS={KeyI:["left_stick_y",-1],KeyK:["left_stick_y",1],KeyJ:["left_stick_x",-1],KeyL:["left_stick_x",1],
                 KeyU:["right_stick_x",-1],KeyO:["right_stick_x",1]};
const typing=e=>{ const t=e.target.tagName; return t==="TEXTAREA"||t==="INPUT"||t==="SELECT"||(e.target.dataset&&e.target.dataset.stick)||(e.target.getAttribute&&e.target.getAttribute("role")==="tab"); };
function knobTo(axis,v){
  for(const k of STICKS){
    if(k.ax!==axis&&k.ay!==axis) continue;
    const knob=$(`[data-knob="${k.id}"]`); if(!knob) continue;
    if(k.ax===axis) knob.setAttribute("cx",k.cx+v*(k.r-7)); else knob.setAttribute("cy",k.cy+v*(k.r-7));
  }
}
addEventListener("keydown",e=>{
  if(typing(e)||e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.code==="KeyF"&&!e.repeat){ e.preventDefault(); shotFire(); return; }
  const sk=STICKKEYS[e.code];
  if(sk){ e.preventDefault(); Sim.pad[activePad][sk[0]]=sk[1]; knobTo(sk[0],sk[1]); return; }
  const b=KEYMAP[e.code]; if(!b) return;
  e.preventDefault(); Sim.pad[activePad][b]=true;
  const el=$(`#padwrap [data-btn="${b}"]`); if(el) el.classList.add("down");
});
addEventListener("keyup",e=>{
  const sk=STICKKEYS[e.code];
  if(sk){ Sim.pad[activePad][sk[0]]=0; knobTo(sk[0],0); return; }
  const b=KEYMAP[e.code]; if(!b) return;
  Sim.pad[activePad][b]=false;
  const el=$(`#padwrap [data-btn="${b}"]`); if(el) el.classList.remove("down");
});
const HW_ORDER=["a","b","x","y","left_bumper","right_bumper","left_trigger","right_trigger",
  "back","start","left_stick_button","right_stick_button","dpad_up","dpad_down","dpad_left","dpad_right","guide"];
let hwWas=null;
function pollHW(){
  const gps=navigator.getGamepads?navigator.getGamepads():[];
  let live=false;
  for(let i=0;i<gps.length&&i<2;i++){
    const g=gps[i]; if(!g) continue; live=true;
    const pad=i+1;
    g.buttons.forEach((b,j)=>{ const n=HW_ORDER[j]; if(!n) return;
      // triggers are analog on the SDK: expose the value, not just pressed
      Sim.pad[pad][n]=(n==="left_trigger"||n==="right_trigger")?b.value:b.pressed;
      if(pad===activePad){ const el=$(`#padwrap [data-btn="${n}"]`); if(el) el.classList.toggle("down",b.pressed); } });
    const dz=v=>Math.abs(v)<0.08?0:v;
    if(g.axes.length>=4){
      Sim.pad[pad].left_stick_x=dz(g.axes[0]); Sim.pad[pad].left_stick_y=dz(g.axes[1]);
      Sim.pad[pad].right_stick_x=dz(g.axes[2]); Sim.pad[pad].right_stick_y=dz(g.axes[3]);
    }
  }
  if(live!==hwWas){ hwWas=live; const p=$("#hwPad"); p.textContent=live?"USB pad live":"no USB pad"; p.className="pill"+(live?" live":""); }
}

/* ============================================================
   MAIN LOOP
   ============================================================ */
let last=performance.now(), acc=0, slowAcc=0, loopErr=null;
function guarded(fn){ try{ fn(); }catch(e){ if(!loopErr){ loopErr=e; console.error("bench:",e); } } }
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  guarded(()=>{
    pollHW();
    acc+=dt; let n=0;
    while(acc>=0.02&&n++<8){ Sim.tick(0.02); acc-=0.02; }
    if(acc>0.5) acc=0;
    View.update(); View.render(); updateGauges();
  });
  slowAcc+=dt;
  if(slowAcc>=0.05){ slowAcc=0; guarded(()=>{
    Graph.sample(); Graph.draw(); Graph.updateLegendValues();
    $("#dsPanel").innerHTML=renderDS();
    updateClock(); updateConfigValues();
    const m=renderMech();
    if(m){ $("#mech").innerHTML=m.svg; $("#pipDeg").textContent=m.deg+"° off level"; }
    const c=Sim.chassis||{x:0,y:0,h:0};
    const zone=Field.ok?Field.zoneAt(c.x/IN,c.y/IN):null;
    $("#vpPose").textContent=poseText(c)+(Sim.bump?` · against the ${Sim.bump}`:zone&&/LOADING|HIVE/.test(zone)?` · ${zone}`:"");
    shotTick(now);
    const anyDown=Object.keys(Sim.pad[activePad]).some(k=>Sim.pad[activePad][k]);
    const tp=$("#tickPill");
    tp.textContent=Sim.phase==="running"?(anyDown?"commanding":"holding"):Sim.phase==="init"?"init positions":"idle";
    const lp=$("#loopPill");
    lp.textContent=Sim.phase==="running"?Sim.t.toFixed(1)+" s · 50 Hz":Sim.phase; lp.className="pill"+(Sim.phase==="running"?" live":"");
    $$(".bindrow").forEach(r=>r.classList.toggle("active",!!Sim.pad[activePad][r.dataset.btn]));
  }); }
  requestAnimationFrame(frame);
}

/* ============================================================
   BOOT
   ============================================================ */
(function boot(){
  setTheme(store.get("ftcbench.theme","dark")==="light"?"light":"dark");
  $("#themeBtn").addEventListener("click",()=>setTheme(currentTheme()==="dark"?"light":"dark"));
  // the BIOBUZZ field and shot physics, from the vendored Shot Sim
  Field.init(window.ShotEngine,window.SHOT_DATA);
  let al=store.get("ftcbench.alliance","red");
  try{ const qa=new URLSearchParams(location.search).get("alliance"); if(qa==="red"||qa==="blue") al=qa; }catch(e){}
  Shots.alliance=View.alliance=al==="blue"?"blue":"red";
  ShotUI.arc=store.get("ftcbench.arc","1")!=="0"; $("#arcToggle").checked=ShotUI.arc;
  View.init($("#viewport"));
  View.setView("iso");
  initTabs();
  initLibrary();

  try{ const rc=JSON.parse(store.get("ftcbench.robotconfig","null")); if(rc&&rc.text){ OPTS.robotConfig=parseRobotConfig(rc.text); ROBOT_CFG_NAME=rc.name;
    $("#cfgStatus").textContent=rc.name+" · "+OPTS.robotConfig.devices.length+" devices"; $("#cfgDrop").className="drop ok"; $("#cfgClear").hidden=false; } }catch(e){}

  const sample=JSON.parse(JSON.stringify(SAMPLE_CAD));
  sample.points=synthGeometry();
  classifyMechs(sample.mechs);
  loadCAD(sample,"sample: fulll.step (measured)","ok");

  const saved=store.get("ftcbench.current",null);
  selectOpMode(entry(saved)?saved:"sample-claw");
  renderCompareSelects();

  // Driver Station
  $("#btnInit").addEventListener("click",dsInit);
  $("#btnStart").addEventListener("click",dsStart);
  $("#btnStop").addEventListener("click",dsStop);
  $("#opSelect").addEventListener("change",e=>selectOpMode(e.target.value));
  $("#practice").checked=store.get("ftcbench.practice","0")==="1";
  $("#practice").addEventListener("change",e=>{ store.set("ftcbench.practice",e.target.checked?"1":"0"); updateClock(); });

  // code
  $("#addOpMode").addEventListener("click",()=>$("#codeFile").click());
  $("#codeFile").addEventListener("change",e=>{ [].forEach.call(e.target.files,takeCode); e.target.value=""; });
  $("#reparse").addEventListener("click",()=>{
    const e=entry(CURRENT_ID); if(!e) return;
    e.source=$("#srcbox").value; parseEntry(e);
    if(!e.builtin) saveLibrary();
    selectOpMode(e.id);
  });

  // hardware
  wireDrop($("#cadDrop"),$("#cadFile"),takeCAD);
  wireDrop($("#cfgDrop"),$("#cfgFile"),takeRobotConfig);
  wirePageDrop();
  $("#cfgClear").addEventListener("click",()=>{
    OPTS.robotConfig=null; ROBOT_CFG_NAME=null; store.del("ftcbench.robotconfig");
    $("#cfgStatus").textContent="From the FIRST folder on the Control Hub. Every hardwareMap name gets checked.";
    $("#cfgDrop").className="drop"; $("#cfgClear").hidden=true; analyzeAll();
  });
  $("#trustSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    OPTS.trust=b.dataset.trust; syncOptionControls(); rebuild(); saveRig(); });

  // rig
  $("#turretSlider").addEventListener("input",e=>{ View.turretScale=+e.target.value/100; $("#turretVal").textContent=e.target.value+" %"; View.load(CAD); saveRig(); });
  $("#addJoint").addEventListener("click",addManualJoint);
  $("#rigCopy").addEventListener("click",()=>{
    const txt=JSON.stringify(exportRig(),null,1); $("#rigJson").value=txt;
    const done=ok=>{ const b=$("#rigCopy"); b.textContent=ok?"Copied":"Select & copy"; setTimeout(()=>{ b.textContent="Copy"; },1400); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(()=>done(true),()=>{ $("#rigJson").select(); done(false); });
    else { $("#rigJson").select(); done(false); }
  });
  $("#rigApply").addEventListener("click",()=>{
    const b=$("#rigApply");
    try{
      const r=JSON.parse($("#rigJson").value);
      if(r.format!=="ftc-sim-bench.rig") throw new Error("not a rig document");
      applyRig(r); applyDeviceMemory(); View.load(CAD); rebuild(); saveRig();
      b.textContent="Applied"; setTimeout(()=>{ b.textContent="Apply"; },1400);
    }catch(err){ b.textContent="Not a rig"; setTimeout(()=>{ b.textContent="Apply"; },1800); }
  });
  $("#rigReset").addEventListener("click",()=>{
    store.del(rigKey()); HW_USER={}; RIG_DEVICES={};
    for(const m of CAD.mechs){ m.kind=m.hasActuator===false?"fixed":null; m.leverOverride=null; m.label=null; }
    CAD.mechs=CAD.mechs.filter(m=>!m.manual);
    classifyMechs(CAD.mechs);
    if(CODE) MAP=autoMap(CODE.devices,CAD.mechs);
    rigChanged();
  });

  // config
  $("#massSlider").addEventListener("input",e=>{ OPTS.payloadKg=+e.target.value/1000; $("#massVal").textContent=e.target.value+" g"; analyzeAll(); saveRig(); });
  $("#dutySlider").addEventListener("input",e=>{ OPTS.duty=+e.target.value/100; $("#dutyVal").textContent=e.target.value+" %"; analyzeAll(); saveRig(); });

  // stage & dock
  $("#viewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x===b)); View.setView(b.dataset.v); });
  $("#resetPose").addEventListener("click",placeAtStart);
  wireShotTab();
  $("#padSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    activePad=+b.dataset.pad; $$("#padSeg button").forEach(x=>x.classList.toggle("on",x===b)); renderPad(); });

  // graph & compare
  $("#winSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return;
    Graph.win=+b.dataset.w; $$("#winSeg button").forEach(x=>x.classList.toggle("on",x===b)); Graph.draw(); });
  $("#graphPause").addEventListener("click",()=>{ Graph.paused=!Graph.paused; Graph.pausedAt=Graph.paused?Graph.now():null;
    $("#graphPause").textContent=Graph.paused?"Resume":"Pause"; });
  $("#graphClear").addEventListener("click",()=>Graph.reset());
  $("#cmpA").addEventListener("change",renderCompare);
  $("#cmpB").addEventListener("change",renderCompare);

  addEventListener("resize",()=>{ View.resize(); Graph.draw(); });
  if(typeof ResizeObserver!=="undefined") new ResizeObserver(()=>View.resize()).observe($("#viewport"));

  /* Link straight into a state: ?opmode=sample-auto&start=1&view=field&right=graph
     — for demo links in a README, or sharing "look at this" with a teammate. */
  try{
    const q=new URLSearchParams(location.search);
    if(q.get("opmode")&&entry(q.get("opmode"))) selectOpMode(q.get("opmode"));
    // ?pose=-40,-30,29 — a spot on the field in inches and a heading in degrees
    const ps=(q.get("pose")||"").split(",").filter(s=>s!=="").map(Number);
    if(ps.length>=2&&ps.every(isFinite)){
      Sim.chassis={x:ps[0]*IN, y:ps[1]*IN, h:(ps[2]||0)*Math.PI/180};
      if(Field.ok&&Sim.footprint) Field.collide(Sim.chassis,Sim.footprint,Sim.obstacles);
      OPTS.startPose=Object.assign({},Sim.chassis);
    }
    const v=q.get("view");
    if(v&&/^(iso|front|side|top|field)$/.test(v)){ View.setView(v); $$("#viewSeg button").forEach(x=>x.classList.toggle("on",x.dataset.v===v)); }
    ["left","right"].forEach(side=>{ const t=q.get(side), nav=$(`.tabs[data-tabs="${side}"]`);
      if(t&&nav&&nav.querySelector(`button[data-tab="${t}"]`)) selectTab(nav,t); });
    if(q.get("start")==="1") dsStart();
  }catch(e){}

  saveRig();
  requestAnimationFrame(frame);
})();
