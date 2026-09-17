/* ============================================================
   7.  SIMULATION  — interprets the statement tree
   ============================================================ */
const Sim={
  dev:{}, vars:{}, pad:{1:{},2:{}}, t:0, chassis:{x:0,y:0,h:0},
  reset(code,cad,map,opts){
    this.dev={}; this.vars={}; this.t=0; this.chassis={x:0,y:0,h:0};
    this.code=code; this.cad=cad; this.map=map; this.opts=opts;
    for(const d of code.devices){
      const mech=cad.mechs.filter(m=>m.id===map[d.name])[0]||null;
      const spec=specFor(d,mech,opts.trust);
      const isMotor=spec.kind==="motor"||spec.kind==="crservo";
      this.dev[d.name]={kind:isMotor?"motor":"servo", mech, spec,
        cmd:isMotor?0:0.5, act:isMotor?0:0.5, revs:0, ticks:0, stalled:false,
        reversed:false,
        tpr: 28*(spec.ratio||19.2),        // goBILDA: 28 counts per motor rev
        restPos:restPosOf(code,d.name),
        sec60:spec.sec60||0.18, travelDeg:travelDegOf(spec)};
    }
    this.pids={};
    for(const v in code.vars) this.vars[v]=code.vars[v];
    this.dt=0.02;
    this.exec(code.inits,this.env());          // directions, PID objects, start positions
    for(const n in this.dev){ const s=this.dev[n]; s.act=s.cmd; }
    this.drivetrain=detectDrivetrain(code);
  },
  /* ---- PID objects the OpMode constructs (ftclib, RoadRunner, hand-rolled) ---- */
  pidOp(name,meth,a){
    const st=this.pids[name]||(this.pids[name]={p:0,i:0,d:0,sum:0,prev:null});
    if(meth==="setPID"||meth==="setPIDF"){ st.p=a[0]||0; st.i=a[1]||0; st.d=a[2]||0; return 0; }
    if(meth==="setP"){ st.p=a[0]||0; return 0; }
    if(meth==="setI"){ st.i=a[0]||0; return 0; }
    if(meth==="setD"){ st.d=a[0]||0; return 0; }
    if(meth==="reset"){ st.sum=0; st.prev=null; return 0; }
    if(meth==="calculate"){
      const cur=a[0]||0, tgt=(a.length>1?a[1]:0)||0;
      const err=tgt-cur, dt=this.dt||0.02;
      st.sum=Math.max(-1e7,Math.min(1e7,st.sum+err*dt));
      const der=(st.prev===null)?0:(err-st.prev)/dt;
      st.prev=err;
      st.err=err;
      return st.p*err + st.i*st.sum + st.d*der;
    }
    return 0;
  },
  env(){
    const self=this;
    return {
      get(n){
        if(n==="__imuYaw") return self.chassis.h;
        if(n==="__imuPitch"||n==="__imuRoll") return 0;
        if(self.vars[n]!==undefined) return self.vars[n];
        if(self.code.consts[n]!==undefined) return self.code.consts[n];
        const m=/^([A-Za-z_$][\w$]*)\.getPosition$/.exec(n);
        if(m&&self.dev[m[1]]) return self.dev[m[1]].cmd;
        return 0;
      },
      device(name,meth){
        const s=self.dev[name]; if(!s) return 0;
        if(meth==="getCurrentPosition") return Math.round(s.ticks);
        if(meth==="getPosition") return s.cmd;
        if(meth==="getPower") return s.cmd;
        if(meth==="getVelocity") return (s.spec.rpm||300)*s.act*s.tpr/60;
        return 0;
      },
      pid(name,meth,a){ return self.pidOp(name,meth,a); },
      pad(ref){
        const r=splitPadRef(ref); if(!r) return 0;
        const st=self.pad[r.pad]||{};
        const v=st[r.btn];
        if(v===undefined) return 0;
        return typeof v==="boolean" ? (v?1:0) : v;
      }
    };
  },
  exec(list,env){
    for(const st of list){
      if(st.kind==="if"){
        if(evalNode(st.condAst,env)) this.exec(st.then,env);
        else if(st.else) this.exec(st.else,env);
      }else if(st.kind==="assign"){
        const v=evalNode(st.ast,env);
        const cur=this.vars[st.name]!==undefined?this.vars[st.name]:(this.code.consts[st.name]||0);
        this.vars[st.name] =
          st.op==="+"?cur+v : st.op==="-"?cur-v : st.op==="*"?cur*v : st.op==="/"?(v?cur/v:cur) : v;
      }else if(st.kind==="call"){
        const s=this.dev[st.dev]; if(!s) continue;
        const v=evalNode(st.ast,env);
        /* setDirection(REVERSE) cancels a mirrored mounting. Since the bench
           doesn't model the mirrored mounting either, applying the reversal
           here would double-count it — a robot told to drive forward would
           spin. It's tracked for reporting instead. */
        if(st.op==="setPosition") s.cmd=clamp01(v);
        else s.cmd=Math.max(-1,Math.min(1,st.op==="setVelocity"?v/1000:v));
      }else if(st.kind==="pidnew"){
        const a=st.args.map(x=>evalNode(x,env));
        this.pidOp(st.obj,"setPID",a);
      }else if(st.kind==="sleep"){
        this.sleptMs=(this.sleptMs||0)+st.ms;      // flagged, not simulated
      }else if(st.kind==="objcall"){
        const s=this.dev[st.obj];
        if(s&&st.meth==="setDirection") s.reversed=/REVERSE/i.test(st.raw||"");
        else if(s&&st.meth==="setMode"&&/STOP_AND_RESET_ENCODER/i.test(st.raw||"")){ s.ticks=0; s.revs=0; }
        else if(/^set(PID|PIDF|P|I|D)$|^reset$/.test(st.meth) && !s)
          this.pidOp(st.obj,st.meth,st.args.map(x=>evalNode(x,env)));
        else if(st.meth==="resetYaw") this.chassis.h=0;
      }
    }
  },
  tick(dt){
    if(!this.code) return;
    this.t+=dt; this.dt=dt;
    this.exec(this.code.stmts,this.env());

    for(const name in this.dev){
      const s=this.dev[name];
      if(s.kind==="motor"){
        const slew=8*dt;
        s.act += Math.sign(s.cmd-s.act)*Math.min(Math.abs(s.cmd-s.act),slew);
        const rpm=(s.spec.rpm||300)*s.act;
        s.revs += rpm/60*dt;
        s.ticks = s.revs*s.tpr;                 // what getCurrentPosition() reads
        s.stalled=false;
        continue;
      }
      const rate=60/(s.sec60*s.travelDeg);
      const err=s.cmd-s.act;
      const step=Math.sign(err)*Math.min(Math.abs(err), rate*dt);
      const want=s.act+step;
      s.stalled=false;
      if(s.mech&&s.mech.kind==="revolute-lift"&&leverOf(s.mech)>0&&s.spec.stallNm){
        const distal=this.opts.payloadKg+0.060+0.055;
        const usable=s.spec.stallNm*this.opts.duty;
        const req=holdTorque(s.mech, armAngleDeg(s.mech,s.spec,want,s.restPos), distal);
        if(req>usable){ s.stalled=true; if(step>0) continue; }
      }
      s.act=want;
    }
    this.driveChassis(dt);
  },
  driveChassis(dt){
    const dtn=this.drivetrain;
    if(!dtn||!dtn.ok){ return; }
    let L=0,R=0,nl=0,nr=0,strafe=0,ns=0;
    for(const w of dtn.wheels){
      const s=this.dev[w.dev]; if(!s) continue;
      if(w.left){ L+=s.act; nl++; } else if(w.right){ R+=s.act; nr++; }
    }
    if(nl) L/=nl; if(nr) R/=nr;
    if(dtn.style==="mecanum"){
      // strafe shows up as front/back disagreement on the same side
      const lf=this.dev[(dtn.wheels.filter(w=>w.left&&w.front)[0]||{}).dev];
      const lb=this.dev[(dtn.wheels.filter(w=>w.left&&w.back)[0]||{}).dev];
      if(lf&&lb){ strafe=(lf.act-lb.act)/2; ns=1; }
    }
    const SPEED=1.15, TURN=3.4;               // m/s and rad/s at full power
    const v=(L+R)/2*SPEED, w=(R-L)/2*TURN;
    this.chassis.h += w*dt;
    this.chassis.x += (v*Math.cos(this.chassis.h) - strafe*SPEED*Math.sin(this.chassis.h))*dt;
    this.chassis.y += (v*Math.sin(this.chassis.h) + strafe*SPEED*Math.cos(this.chassis.h))*dt;
    const LIM=1.78;                            // half an FTC field
    this.chassis.x=Math.max(-LIM,Math.min(LIM,this.chassis.x));
    this.chassis.y=Math.max(-LIM,Math.min(LIM,this.chassis.y));
  }
};
const clamp01=v=>Math.max(0,Math.min(1,v));
