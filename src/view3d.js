/* ============================================================
   8.  3D VIEW — articulated, driven by the sim
   ============================================================ */
const View={
  init(el){
    this.el=el;
    this.scene=new THREE.Scene();
    this.cam=new THREE.PerspectiveCamera(42,1,0.01,200);
    this.ren=new THREE.WebGLRenderer({antialias:true});
    this.ren.setPixelRatio(Math.min(devicePixelRatio,2));
    this.ren.setClearColor(0x000000,0);
    el.appendChild(this.ren.domElement);
    this.world=new THREE.Group(); this.scene.add(this.world);
    this.theta=-0.7; this.phi=1.15; this.rad=0.95; this.size=0.5;
    this.bind(); this.resize();
  },
  bind(){
    const c=this.ren.domElement; let drag=false,lx=0,ly=0;
    c.addEventListener("pointerdown",e=>{drag=true;lx=e.clientX;ly=e.clientY;c.setPointerCapture(e.pointerId);});
    c.addEventListener("pointerup",()=>{drag=false;});
    c.addEventListener("pointercancel",()=>{drag=false;});
    c.addEventListener("pointermove",e=>{ if(!drag) return;
      this.theta-=(e.clientX-lx)*0.008;
      this.phi=Math.max(0.08,Math.min(3.05,this.phi-(e.clientY-ly)*0.008));
      lx=e.clientX; ly=e.clientY; });
    c.addEventListener("wheel",e=>{ e.preventDefault();
      this.rad=Math.max(0.12,Math.min(24,this.rad*(1+Math.sign(e.deltaY)*0.09))); },{passive:false});
    addEventListener("resize",()=>this.resize());
  },
  resize(){ const w=this.el.clientWidth,h=this.el.clientHeight; if(!w||!h) return;
    this.cam.aspect=w/h; this.cam.updateProjectionMatrix(); this.ren.setSize(w,h,false); },

  /* world (Z-up, metres) → view (Y-up) */
  v3(p){ return new THREE.Vector3(p[0]-this.c[0], p[2]-this.c[2], -(p[1]-this.c[1])); },
  vAxis(a){ return new THREE.Vector3(a[0],a[2],-a[1]).normalize(); },

  load(cad){
    while(this.world.children.length) this.world.remove(this.world.children[0]);
    const bb=cad.bbox;
    this.c=[0,1,2].map(i=>(bb.min[i]+bb.max[i])/2);
    const size=Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5;
    this.size=size; this.cad=cad;

    // ---- field floor
    const grid=new THREE.GridHelper(3.66,24,0x33414F,0x1B2430);
    grid.position.y=bb.min[2]-this.c[2];
    this.world.add(grid); this.grid=grid;

    // ---- chassis group carries everything that drives around
    this.chassisG=new THREE.Group(); this.world.add(this.chassisG);

    const M=cad.mechs;
    const distSeg=(p,a,b)=>{
      const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
      const L2=ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
      let t=0;
      if(L2>1e-12) t=Math.max(0,Math.min(1,((p[0]-a[0])*ab[0]+(p[1]-a[1])*ab[1]+(p[2]-a[2])*ab[2])/L2));
      const q=[a[0]+ab[0]*t, a[1]+ab[1]*t, a[2]+ab[2]*t];
      return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
    };
    /* every link's own span: its pivot out to whatever it carries */
    const segs=M.filter(m=>m.pivot).map(m=>({id:m.id, m, a:m.pivot, b:m.distalTo||m.pivot}));

    /* Points far out from a root joint's axis are frame, not turret — they
       stay behind while the column above the joint swings. */
    const radialTo=(p,m)=>{
      const a=m.pivot, ax=m.axis;
      const d=[p[0]-a[0],p[1]-a[1],p[2]-a[2]];
      const t=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2];
      return Math.hypot(d[0]-ax[0]*t, d[1]-ax[1]*t, d[2]-ax[2]*t);
    };
    const groups={chassis:[]};
    M.forEach(m=>groups[m.id]=[]);
    const pts=cad.points||[];
    const stride=Math.max(1,Math.ceil(pts.length/110000));
    for(let i=0;i<pts.length;i+=stride){
      const p=pts[i];
      if(!segs.length){ groups.chassis.push(p); continue; }
      let best=null, bd=1e9;
      for(const s of segs){ const d=distSeg(p,s.a,s.b); if(d<bd){bd=d; best=s;} }
      let id=best.id;
      const m=best.m;
      // a leaf effector only claims what is genuinely near it
      if(!rigKids(M,m.id).length && m.lever>0 && bd>m.lever*0.55 && m.parent!=="chassis") id=m.parent;
      // and a root joint only carries what sits inside its turret radius
      const root = M.filter(x=>x.id===id)[0];
      if(root && root.parent==="chassis" && root.kind==="revolute-yaw"){
        const turretR=Math.max(size*0.10, (root.lever||size*0.3)*this.turretScale);
        if(radialTo(p,root)>turretR) id="chassis";
      }
      (groups[id]||groups.chassis).push(p);
    }

    const TINT={"revolute-yaw":[0.62,0.70,0.86],"revolute-lift":[0.36,0.68,1.00],
                "linear":[0.55,0.62,1.00],"effector":[0.30,0.85,0.68],"fixed":[0.55,0.60,0.68]};
    const mkPoints=(list,tint)=>{
      const n=list.length; if(!n) return null;
      const pos=new Float32Array(n*3), col=new Float32Array(n*3);
      const zmin=bb.min[2], zspan=(bb.max[2]-zmin)||1;
      for(let i=0;i<n;i++){
        const v=this.v3(list[i]);
        pos[i*3]=v.x; pos[i*3+1]=v.y; pos[i*3+2]=v.z;
        const t=Math.max(0,Math.min(1,(list[i][2]-zmin)/zspan));
        col[i*3]=tint[0]*(0.62+0.5*t); col[i*3+1]=tint[1]*(0.62+0.5*t); col[i*3+2]=tint[2]*(0.62+0.5*t);
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.BufferAttribute(pos,3));
      g.setAttribute("color",new THREE.BufferAttribute(col,3));
      return new THREE.Points(g,new THREE.PointsMaterial({size:size*0.0042,vertexColors:true,sizeAttenuation:true}));
    };

    const chasP=mkPoints(groups.chassis,[0.50,0.60,0.72]);
    if(chasP) this.chassisG.add(chasP);

    /* ---- build the hierarchy from the rig, whatever shape it is ---- */
    const COL={"revolute-lift":0x4D9FFF,"revolute-yaw":0xE0A42E,"effector":0x3FB68B,
               "linear":0x8C9EFF,"fixed":0x8899AA};
    this.jawSets=[];
    const buildLink=(mech,parentInv)=>{
      const g=new THREE.Group();  g.position.copy(this.v3(mech.pivot));
      const inv=new THREE.Group(); inv.position.copy(this.v3(mech.pivot).clone().multiplyScalar(-1));
      g.add(inv); parentInv.add(g);
      mech._g=g; mech._inv=inv;

      const p=mkPoints(groups[mech.id]||[], TINT[mech.kind]||TINT.fixed);
      if(p) inv.add(p);

      const s=new THREE.Mesh(new THREE.SphereGeometry(size*0.026,14,10),
              new THREE.MeshBasicMaterial({color:COL[mech.kind]||0x8899AA}));
      s.position.copy(this.v3(mech.pivot)); inv.add(s);
      if(mech.distalTo){
        const gg=new THREE.BufferGeometry().setFromPoints([this.v3(mech.pivot),this.v3(mech.distalTo)]);
        inv.add(new THREE.Line(gg,new THREE.LineBasicMaterial({color:COL[mech.kind]||0x8899AA})));
      }
      if(mech.kind==="effector"){
        const par=M.filter(x=>x.id===mech.parent)[0];
        const from=par?par.pivot:[mech.pivot[0],mech.pivot[1],mech.pivot[2]-size*0.1];
        const reach=Math.max(size*0.05, Math.hypot(
          mech.pivot[0]-from[0],mech.pivot[1]-from[1],mech.pivot[2]-from[2])*0.30);
        const o=this.v3(mech.pivot);
        const dir=this.v3(mech.pivot).sub(this.v3(from)).normalize();
        if(!isFinite(dir.x)||dir.length()<0.1) dir.set(0,1,0);
        const side=new THREE.Vector3().crossVectors(dir,new THREE.Vector3(0,1,0));
        if(side.length()<0.1) side.set(1,0,0); else side.normalize();
        const mk=()=>{ const gg=new THREE.BufferGeometry().setFromPoints([o.clone(),o.clone()]);
          const l=new THREE.Line(gg,new THREE.LineBasicMaterial({color:0x3FB68B})); inv.add(l); return l; };
        this.jawSets.push({mech, a:mk(), b:mk(), o, dir, side, reach});
      }
      for(const k of rigKids(M,mech.id)) buildLink(k,inv);
    };
    for(const r of rigRoots(M)) buildLink(r,this.chassisG);

    this.groupCounts={chassis:groups.chassis.length};
    M.forEach(m=>this.groupCounts[m.id]=(groups[m.id]||[]).length);
    this.rad=size*1.9;
    this.baseY=bb.min[2]-this.c[2];
  },
  turretScale:0.55,

  update(){
    if(!this.cad) return;
    const ch=Sim.chassis;
    this.chassisG.position.set(ch.x, 0, -ch.y);
    this.chassisG.rotation.y = -ch.h;

    for(const m of this.cad.mechs){
      if(!m._g) continue;
      const dn=deviceOn(m.id);
      const s=dn?Sim.dev[dn]:null;
      if(!s) continue;
      const travel=(s.act-s.restPos);
      if(m.kind==="revolute-yaw"||m.kind==="revolute-lift"){
        const ang=travel*(s.travelDeg||300)*Math.PI/180*(m.dir||1)*(m.kind==="revolute-lift"?-1:1);
        m._g.quaternion.setFromAxisAngle(this.vAxis(m.axis), ang);
      }else if(m.kind==="linear"){
        const d=travel*(m.lever||this.size*0.3)*(m.dir||1);
        m._g.position.copy(this.v3(m.pivot).add(this.vAxis(m.axis).multiplyScalar(d)));
      }
    }
    for(const J of this.jawSets||[]){
      const dn=deviceOn(J.mech.id);
      const s=dn?Sim.dev[dn]:null;
      const open=s? (1-clamp01(s.act))*0.9+0.12 : 0.5;
      const setL=(line,sgn)=>{
        const end=J.o.clone().add(J.dir.clone().multiplyScalar(J.reach))
                  .add(J.side.clone().multiplyScalar(sgn*J.reach*open));
        line.geometry.setFromPoints([J.o.clone(),end]);
      };
      setL(J.a,1); setL(J.b,-1);
    }
  },
  setView(v){
    if(v==="front"){ this.theta=-Math.PI/2; this.phi=Math.PI/2; }
    else if(v==="side"){ this.theta=0; this.phi=Math.PI/2; }
    else if(v==="top"){ this.theta=-Math.PI/2; this.phi=0.09; }
    else { this.theta=-0.7; this.phi=1.15; }
    this.rad=this.size*1.9;
  },
  render(){
    if(!this.cam) return;
    const r=this.rad;
    this.cam.position.set(r*Math.sin(this.phi)*Math.cos(this.theta), r*Math.cos(this.phi)+this.size*0.12, r*Math.sin(this.phi)*Math.sin(this.theta));
    this.cam.lookAt(0,0,0);
    this.ren.render(this.scene,this.cam);
  }
};
function deviceOn(mechId){
  for(const n in MAP) if(MAP[n]===mechId && Sim.dev[n]) return n;
  return null;
}
