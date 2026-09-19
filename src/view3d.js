/* ============================================================
   8.  3D VIEW — the BIOBUZZ field and the articulated robot, driven by the sim
   ============================================================ */
const FIELD_COL={tile:0x2d333a, seam:0x454e59, ground:0x0c1117, alu:0xa4aeb9, rail:0x7f8a96, poly:0xaac4de,
  red:0xe0453c, blue:0x2f7dea, redTape:0xd8372f, blueTape:0x2a6ad8, pollen:0xf2c230, flower:0xdfe5eb,
  arm:0x4d5661, logo:0x1b2129};
const View={
  init(el){
    this.el=el;
    this.scene=new THREE.Scene();
    this.cam=new THREE.PerspectiveCamera(42,1,0.01,200);
    this.ren=new THREE.WebGLRenderer({antialias:true});
    this.ren.setPixelRatio(Math.min(devicePixelRatio,2));
    this.ren.setClearColor(0x000000,0);
    el.appendChild(this.ren.domElement);
    this.scene.add(new THREE.HemisphereLight(0xe4ecf5,0x1c222a,0.95));
    const sun=new THREE.DirectionalLight(0xffffff,0.7); sun.position.set(-2.5,6,4); this.scene.add(sun);
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

  /* robot CAD (Z-up, metres) → view (Y-up), centred on the CAD box */
  v3(p){ return new THREE.Vector3(p[0]-this.c[0], p[2]-this.c[2], -(p[1]-this.c[1])); },
  vAxis(a){ return new THREE.Vector3(a[0],a[2],-a[1]).normalize(); },
  /* field frame (inches, Z-up) → view */
  fv(p){ return new THREE.Vector3(p[0]*IN, p[2]*IN+this.floorY, -p[1]*IN); },

  load(cad){
    while(this.world.children.length){ const o=this.world.children[0]; this.world.remove(o); this.dispose(o); }
    const bb=cad.bbox;
    this.c=[0,1,2].map(i=>(bb.min[i]+bb.max[i])/2);
    const size=Math.max(bb.max[0]-bb.min[0],bb.max[1]-bb.min[1],bb.max[2]-bb.min[2])||0.5;
    this.size=size; this.cad=cad;
    this.floorY=bb.min[2]-this.c[2];
    this.look=new THREE.Vector3(0,0,0);

    this.fieldG=new THREE.Group(); this.world.add(this.fieldG);
    this.hiveG={}; this.shownHive=null; this.tipAnim=null; this.shownCells=-1;
    if(Field.ok) this.buildField(); else this.buildPlainField();
    this.dynG=new THREE.Group(); this.world.add(this.dynG);
    this.ballPool=[]; this.arcLine=null;

    // ---- chassis group carries everything that drives around
    this.chassisG=new THREE.Group(); this.world.add(this.chassisG);
    this.frontG=new THREE.Group(); this.chassisG.add(this.frontG);
    this.front=null;
    this.buildRobot(cad);
    this.footG=null;
    this.rad=size*1.9;
    this.baseY=this.floorY;
  },
  turretScale:0.55, alliance:"red",

  buildRobot(cad){
    const bb=cad.bbox, size=this.size, M=cad.mechs;
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
    if(chasP) this.frontG.add(chasP);

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
    for(const r of rigRoots(M)) buildLink(r,this.frontG);

    this.groupCounts={chassis:groups.chassis.length};
    M.forEach(m=>this.groupCounts[m.id]=(groups[m.id]||[]).length);
  },

  /* The footprint the collisions use, and an arrow for the drive base's forward. */
  buildFootprint(fp){
    if(this.footG) this.chassisG.remove(this.footG);
    const g=new THREE.Group(), y=this.floorY+0.004;
    const pts=[[fp.hx,fp.hy],[fp.hx,-fp.hy],[-fp.hx,-fp.hy],[-fp.hx,fp.hy],[fp.hx,fp.hy]]
      .map(p=>new THREE.Vector3(p[0],y,-p[1]));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:0x9fb3c8,transparent:true,opacity:0.55})));
    const a=Math.min(fp.hx,fp.hy)*0.45;
    const tri=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fp.hx+a*0.9,y,0), new THREE.Vector3(fp.hx+0.01,y,-a*0.6), new THREE.Vector3(fp.hx+0.01,y,a*0.6)]);
    g.add(new THREE.Mesh(tri,new THREE.MeshBasicMaterial({color:0x9fb3c8,transparent:true,opacity:0.7,side:THREE.DoubleSide})));
    this.footG=g; this.fpShown=fp.hx+"|"+fp.hy;
    this.chassisG.add(g);
  },

  /* ---------------- the field ---------------- */
  buildPlainField(){
    const FIELD=3.6576, WALL=0.31, y=this.floorY;
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(FIELD,FIELD),new THREE.MeshBasicMaterial({color:0x252c35}));
    floor.rotation.x=-Math.PI/2; floor.position.y=y-0.003; this.fieldG.add(floor);
    const seams=new THREE.GridHelper(FIELD,6,0x4a5664,0x4a5664); seams.position.y=y; this.fieldG.add(seams);
    const wall=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(FIELD,WALL,FIELD)),
      new THREE.LineBasicMaterial({color:0x5b6776}));
    wall.position.y=y+WALL/2; this.fieldG.add(wall);
    this.fieldSize=FIELD;
  },
  mat(c,o){ o=o||{}; return new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:0.62, metalness:0.1},o)); },
  flat(c,op){ return new THREE.MeshBasicMaterial({color:c, transparent:op<1, opacity:op, depthWrite:op>=1,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}); },
  box(g,center,size,mat){ // inches, field frame, size [x,y,z]
    const m=new THREE.Mesh(new THREE.BoxGeometry(size[0]*IN,size[2]*IN,size[1]*IN),mat);
    m.position.copy(this.fv(center)); g.add(m); return m;
  },
  rod(g,a,b,r,mat,seg){
    const va=this.fv(a), vb=this.fv(b), len=va.distanceTo(vb); if(len<1e-6) return null;
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r*IN,r*IN,len,seg||10),mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),vb.clone().sub(va).normalize());
    g.add(m); return m;
  },
  rect(g,x0,x1,y0,y1,mat,lift){ // a flat rectangle on the tiles
    const m=new THREE.Mesh(new THREE.PlaneGeometry((x1-x0)*IN,(y1-y0)*IN),mat);
    m.rotation.x=-Math.PI/2; m.position.copy(this.fv([(x0+x1)/2,(y0+y1)/2,lift||0.03])); g.add(m); return m;
  },
  ball(kind,color){
    const r=(kind==="nectar"?1.81:1.4)*IN;
    const c=kind==="nectar"?(color==="blue"?FIELD_COL.blue:FIELD_COL.red):FIELD_COL.pollen;
    const key=kind+"|"+c;
    this._ballGeo=this._ballGeo||{}; this._ballMat=this._ballMat||{};
    if(!this._ballGeo[kind]) this._ballGeo[kind]=new THREE.SphereGeometry(r,18,12);
    if(!this._ballMat[key]) this._ballMat[key]=this.mat(c,{roughness:0.5});
    const m=new THREE.Mesh(this._ballGeo[kind],this._ballMat[key]);
    m.userData.shared=true;              // geometry and material are reused: never dispose them
    return m;
  },
  dispose(obj){
    obj.traverse(o=>{ if(o.userData.shared) return;
      if(o.geometry) o.geometry.dispose();
      if(o.material){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  },
  label(g,text,x,y,rot,w,color){
    const cv=document.createElement("canvas"); cv.width=512; cv.height=64;
    const ctx=cv.getContext("2d");
    ctx.font="600 40px 'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
    ctx.fillStyle=color||"#8a97a6"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(text,256,34);
    const tex=new THREE.CanvasTexture(cv);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w*IN,w/8*IN),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.rotation.z=rot||0;
    m.position.copy(this.fv([x,y,0.05])); g.add(m);
  },

  buildField(){
    const D=Field.data.field, F=D.field, H=F.half, g=this.fieldG, WH=F.wallHeight, WT=F.wallThickness||1;
    this.fieldSize=2*H*IN;

    // venue floor, alliance areas, labels
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshBasicMaterial({color:FIELD_COL.ground}));
    ground.rotation.x=-Math.PI/2; ground.position.y=this.floorY-0.004; g.add(ground);
    for(const al of ["red","blue"]){
      const a=D.allianceAreas[al], col=al==="red"?FIELD_COL.redTape:FIELD_COL.blueTape;
      this.rect(g,a.x0,a.x1,a.y0,a.y1,this.flat(col,0.10),0.01);
      const edge=this.flat(col,0.8), outer=al==="red"?a.x0:a.x1;
      this.rect(g,a.x0,a.x1,a.y0,a.y0+2,edge,0.02); this.rect(g,a.x0,a.x1,a.y1-2,a.y1,edge,0.02);
      this.rect(g,Math.min(outer,outer-(al==="red"?-2:2)),Math.max(outer,outer-(al==="red"?-2:2)),a.y0,a.y1,edge,0.02);
      this.label(g,al.toUpperCase()+" ALLIANCE",(al==="red"?-1:1)*(H+14),0,al==="red"?-Math.PI/2:Math.PI/2,40,al==="red"?"#e0746c":"#6e9ff0");
      // the NECTAR tray each alliance starts with
      this.box(g,[(al==="red"?-1:1)*(H+30),0,1],[5,20,2],this.mat(0x2a3139));
      for(let i=0;i<5;i++){ const b=this.ball("nectar",al); b.position.copy(this.fv([(al==="red"?-1:1)*(H+30),-7.2+i*3.6,3.9])); g.add(b); }
    }
    this.label(g,"AUDIENCE",0,-H-12,0,34,"#7d8a99");

    // foam tiles and their seams
    const tiles=new THREE.Mesh(new THREE.PlaneGeometry(2*H*IN,2*H*IN),this.mat(FIELD_COL.tile,{roughness:0.96,metalness:0}));
    tiles.rotation.x=-Math.PI/2; tiles.position.y=this.floorY; g.add(tiles);
    const sp=[], yS=this.floorY+0.001;
    for(const s of F.tileSeams||[]){
      sp.push(s*IN,yS,-H*IN, s*IN,yS,H*IN, -H*IN,yS,-s*IN, H*IN,yS,-s*IN);
    }
    const sg=new THREE.BufferGeometry(); sg.setAttribute("position",new THREE.Float32BufferAttribute(sp,3));
    g.add(new THREE.LineSegments(sg,new THREE.LineBasicMaterial({color:FIELD_COL.seam})));

    // perimeter: polycarbonate panels on aluminium, a post at every seam
    const poly=this.mat(FIELD_COL.poly,{transparent:true,opacity:0.13,roughness:0.15,depthWrite:false,side:THREE.DoubleSide});
    const alu=this.mat(FIELD_COL.alu,{metalness:0.55,roughness:0.38});
    const rail=this.mat(FIELD_COL.rail,{metalness:0.45,roughness:0.5});
    const L=2*H+2*WT, o=H+WT/2;
    for(const w of [[0,o,L,WT],[0,-o,L,WT],[o,0,WT,2*H],[-o,0,WT,2*H]]){
      this.box(g,[w[0],w[1],WH/2],[w[2],w[3],WH],poly);
      this.box(g,[w[0],w[1],WH-0.5],[w[2]+0.01,w[3]+0.3,1],alu);
      this.box(g,[w[0],w[1],0.75],[w[2]+0.01,w[3]+0.3,1.5],rail);
    }
    const posts=[-H,-47,-23.5,0,23.5,47,H];
    for(const p of posts) for(const s of [-1,1]){
      this.box(g,[p,s*o,WH/2],[1.2,WT+0.4,WH],alu);
      this.box(g,[s*o,p,WH/2],[WT+0.4,1.2,WH],alu);
    }

    // tape: LOADING ZONES (outline, open to the wall) and GARDENS (a strip)
    const T=2;
    for(const al of ["red","blue"]){
      const z=D.loadingZones[al], m=this.flat(al==="red"?FIELD_COL.redTape:FIELD_COL.blueTape,0.95);
      const inner=al==="red"?z.x1:z.x0, s=al==="red"?-1:1;
      this.rect(g,Math.min(inner,inner+s*T),Math.max(inner,inner+s*T),z.y0,z.y1,m);
      this.rect(g,z.x0,z.x1,z.y0,z.y0+T,m); this.rect(g,z.x0,z.x1,z.y1-T,z.y1,m);
      const gd=D.gardens[al];
      this.rect(g,gd.x0,gd.x1,gd.y0,gd.y1,m);
      // four POLLEN staged in a line in the GARDEN corner
      const cx=al==="red"?-H+1.5:H-1.5, cy=al==="red"?-H+1.5:H-1.5;
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([cx-s*i*2.9,cy,1.4])); g.add(b); }
    }

    // FLOWERs: rings on four pipes, POLLEN stacked inside from the tile
    const fm=this.mat(FIELD_COL.flower,{roughness:0.45});
    for(const fl of D.flowers){
      const ax=[fl.x,fl.y], R=fl.openingDia/2+0.25;
      const ring=(z,r,tube)=>{ const t=new THREE.Mesh(new THREE.TorusGeometry(r*IN,tube*IN,8,28),fm);
        t.rotation.x=Math.PI/2; t.position.copy(this.fv([ax[0],ax[1],z])); g.add(t); };
      ring(fl.openingZ,R,0.3); ring(4,R,0.3); ring(0.25,R,0.25);
      for(let k=0;k<4;k++){ const a=Math.PI/4+k*Math.PI/2;
        this.rod(g,[ax[0]+Math.cos(a)*R,ax[1]+Math.sin(a)*R,0],[ax[0]+Math.cos(a)*R,ax[1]+Math.sin(a)*R,fl.openingZ],0.3,fm,8); }
      const n=fl.wall==="+y"?[0,1]:fl.wall==="-y"?[0,-1]:fl.wall==="+x"?[1,0]:[-1,0];
      const bs=[ax[0]+n[0]*(R+0.2),ax[1]+n[1]*(R+0.2),(fl.openingZ+fl.backstopTopZ)/2];
      this.box(g,bs,n[0]?[0.3,fl.openingDia,fl.backstopTopZ-fl.openingZ+0.3]:[fl.openingDia,0.3,fl.backstopTopZ-fl.openingZ+0.3],fm);
      for(let i=0;i<4;i++){ const b=this.ball("pollen"); b.position.copy(this.fv([ax[0],ax[1],1.4+i*2.8])); g.add(b); }
    }

    // HIVE frame: two leaning A-frames joined by a crossbar
    const fr=Field.model().frame, frame=this.mat(FIELD_COL.alu,{metalness:0.55,roughness:0.4});
    for(const s of fr.legs) this.rod(g,s[0],s[1],fr.tubeRadius,frame,8);
    this.rod(g,fr.crossbar[0],fr.crossbar[1],fr.tubeRadius,frame,8);
    if(fr.cornerBlocks) for(const s of fr.cornerBlocks.segments) this.rod(g,s[0],s[1],fr.cornerBlocks.radius,frame,10);
    if(fr.footBars) for(const s of fr.footBars.segments){
      const len=Math.hypot(s[1][0]-s[0][0],s[1][1]-s[0][1]);
      this.box(g,[(s[0][0]+s[1][0])/2,(s[0][1]+s[1][1])/2,0.5],[fr.footBars.width,len,1],frame);
    }
    if(fr.logoPanels) for(const q of fr.logoPanels.quads){
      const geo=new THREE.BufferGeometry().setFromPoints([q[0],q[1],q[2],q[0],q[2],q[3]].map(p=>this.fv(p)));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo,this.mat(FIELD_COL.logo,{side:THREE.DoubleSide,roughness:0.8})));
    }
  },

  /* The two HIVE arms with their CELLs, for the current state. Each lives in
     a group at its pivot so a TIP can swing it. */
  buildHive(al){
    if(this.hiveG[al]){ this.world.remove(this.hiveG[al]); this.dispose(this.hiveG[al]); }
    const hm=Field.model(), h=hm.hives.filter(x=>x.alliance===al)[0];
    const pz=Field.data.field.hive.pivotZ, piv=this.fv([h.hx,0,pz]);
    const G=new THREE.Group(); G.position.copy(piv); this.world.add(G);
    const inner=new THREE.Group(); inner.position.copy(piv.clone().multiplyScalar(-1)); G.add(inner);
    const col=al==="red"?FIELD_COL.red:FIELD_COL.blue;
    const armM=this.mat(FIELD_COL.arm,{metalness:0.4,roughness:0.5});
    for(let i=0;i+1<h.armBar.length;i++) this.rod(inner,h.armBar[i],h.armBar[i+1],h.armRadius,armM,8);
    this.rod(inner,[h.hx-1.6,0,pz],[h.hx+1.6,0,pz],1.3,armM,14);
    for(const cell of h.cells){
      const up=cell.role==="up", v=cell.vertices.map(p=>this.fv(p));
      const pos=[], idx=[];
      v.forEach(q=>pos.push(q.x,q.y,q.z));
      for(let i=0;i<5;i++){ const j=(i+1)%5; idx.push(i,j,5+j, i,5+j,5+i); }
      idx.push(0,1,2, 0,2,3, 0,3,4);
      const geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)); geo.setIndex(idx); geo.computeVertexNormals();
      inner.add(new THREE.Mesh(geo,this.mat(col,{transparent:true,opacity:up?0.46:0.30,side:THREE.DoubleSide,depthWrite:false,roughness:0.35})));
      const lp=[]; const seg=(a,b)=>lp.push(v[a].x,v[a].y,v[a].z,v[b].x,v[b].y,v[b].z);
      for(let k=0;k<5;k++){ seg(k,(k+1)%5); seg(5+k,5+(k+1)%5); seg(k,5+k); }
      const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.Float32BufferAttribute(lp,3));
      inner.add(new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:up?0.95:0.6})));
      // the mouth ring
      const mouth=cell.mouth.concat([cell.mouth[0]]);
      const ringM=this.mat(up?0xf4f7fa:col,{roughness:0.4, emissive:up?0x222222:0x000000});
      for(let k=0;k+1<mouth.length;k++) this.rod(inner,mouth[k],mouth[k+1],Field.data.field.hive.cell.ringThickness+0.15,ringM,6);
      if(up) this.fillCell(inner,cell,al);
    }
    this.hiveG[al]=G;
  },
  /* What's in an up-CELL, resting on its floor against the back wall,
     from the alliance's side inward. */
  fillCell(g,cell,al){
    const list=Field.cells[al]; if(!list.length) return;
    const V=cell.vertices;
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b,k)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
    const len=a=>Math.hypot(a[0],a[1],a[2]), nrm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
    const across=nrm(sub(V[1],V[0])), depth=nrm(sub(V[5],V[0])), wide=len(sub(V[1],V[0]));
    let up=[across[1]*depth[2]-across[2]*depth[1], across[2]*depth[0]-across[0]*depth[2], across[0]*depth[1]-across[1]*depth[0]];
    const mid=V.slice(0,5).reduce((s,p)=>[s[0]+p[0]/5,s[1]+p[1]/5,s[2]+p[2]/5],[0,0,0]);
    const toMid=sub(mid,V[0]); if(up[0]*toMid[0]+up[1]*toMid[1]+up[2]*toMid[2]<0) up=[-up[0],-up[1],-up[2]];
    const fromHigh=al==="blue";          // start on the alliance-area side
    let u=0.4, row=0;
    for(const e of list){
      const r=e.kind==="nectar"?1.81:1.4;
      if(u+2*r>wide-0.4){ u=0.4; row++; }
      const along=fromHigh?wide-u-r:u+r;
      const p=add(add(add(V[0],across,along),depth,0.3+r+row*3.4),up,r+0.2);
      const b=this.ball(e.kind,e.color); b.position.copy(this.fv(p)); g.add(b);
      u+=2*r+0.15;
    }
  },

  /* A path in field inches, drawn as a line: solid for your shot, dashed for
     the best arc from here. */
  setArc(path,color,dashed){
    if(this.arcLine){ this.dynG.remove(this.arcLine); this.arcLine.geometry.dispose(); this.arcLine=null; }
    if(!path||path.length<2||!this.dynG) return;
    const geo=new THREE.BufferGeometry().setFromPoints(path.map(p=>this.fv(p)));
    const mat=dashed?new THREE.LineDashedMaterial({color,dashSize:0.06,gapSize:0.045,transparent:true,opacity:0.85})
                    :new THREE.LineBasicMaterial({color,transparent:true,opacity:0.95});
    const line=new THREE.Line(geo,mat); if(dashed) line.computeLineDistances();
    this.arcLine=line; this.dynG.add(line);
  },

  update(){
    if(!this.cad) return;
    const ch=Sim.chassis;
    this.chassisG.position.set(ch.x, 0, -ch.y);
    this.chassisG.rotation.y = ch.h;                     // CCW from +x, like the field frame
    const front=(Sim.opts&&Sim.opts.front)||"+x";
    if(front!==this.front){ this.front=front; this.frontG.rotation.y=FRONTS[front]||0; }
    const fp=Sim.footprint;
    if(fp&&(!this.footG||this.fpShown!==fp.hx+"|"+fp.hy)) this.buildFootprint(fp);

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
    if(Field.ok) this.updateField();
  },
  updateField(){
    // a TIP swings the arm 2 × armDeg about the pivot, then the new state is built
    const now=performance.now();
    if(this.tipAnim){
      const A=this.tipAnim, k=Math.min(1,(now-A.t0)/420), e=k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
      if(this.hiveG[A.al]) this.hiveG[A.al].rotation.x=A.angle*e;
      if(k>=1){ this.tipAnim=null; this.shownHive=null; }
    }
    const key=Field.hive.red+","+Field.hive.blue;
    if(!this.tipAnim&&(this.shownHive!==key||this.shownCells!==Field.version)){
      const was=this.shownHive?this.shownHive.split(",").map(Number):null;
      const al=was&&(was[0]!==Field.hive.red?"red":was[1]!==Field.hive.blue?"blue":null);
      if(al&&this.hiveG[al]){
        const from=al==="red"?was[0]:was[1];
        const arm=Field.data.field.hive.armDeg*Math.PI/180;
        this.tipAnim={al, t0:now, angle:2*arm*Math.sign(-from)};
        this.shownHive=key; this.shownCells=-2;        // rebuild after the swing
        // what was in the CELL spills as it goes down
        for(const g of this.hiveG[al].children[0].children) if(g.userData.shared) g.visible=false;
      }else{
        this.buildHive("red"); this.buildHive("blue");
        this.shownHive=key; this.shownCells=Field.version;
      }
    }
    // balls in flight, and misses lying on the tiles
    const want=Shots.flying.map(b=>b).concat(Shots.landed);
    while(this.ballPool.length>want.length){ const m=this.ballPool.pop(); this.dynG.remove(m); }
    for(let i=0;i<want.length;i++){
      const b=want[i], key2=b.kind+"|"+(b.color||"");
      let m=this.ballPool[i];
      if(!m||m.userData.key!==key2){ if(m) this.dynG.remove(m); m=this.ball(b.kind,b.color); m.userData.key=key2; this.ballPool[i]=m; this.dynG.add(m); }
      m.position.copy(this.fv(b.pos));
    }
  },

  setView(v){
    this.mode=v;
    if(v==="field"){
      // from behind the alliance's own wall, where the drivers stand
      this.theta=this.alliance==="blue"?0:Math.PI; this.phi=0.82; this.rad=(this.fieldSize||3.58)*1.5; return;
    }
    if(v==="front"){ this.theta=-Math.PI/2; this.phi=Math.PI/2; }
    else if(v==="side"){ this.theta=0; this.phi=Math.PI/2; }
    else if(v==="top"){ this.theta=-Math.PI/2; this.phi=0.09; }
    else { this.theta=-0.7; this.phi=1.15; }
    this.rad=this.size*1.9;
  },
  render(){
    if(!this.cam) return;
    // robot views follow the chassis as it drives; the field view holds still
    const target=new THREE.Vector3(0,0,0);
    if(this.mode==="field") target.set(this.alliance==="blue"?0.25:-0.25,(this.floorY||0)+0.3,0);
    else if(this.chassisG) target.copy(this.chassisG.position);
    if(!this.look) this.look=target.clone();
    this.look.lerp(target,0.18);
    const r=this.rad;
    this.cam.position.set(this.look.x+r*Math.sin(this.phi)*Math.cos(this.theta),
                          this.look.y+r*Math.cos(this.phi)+this.size*0.12,
                          this.look.z+r*Math.sin(this.phi)*Math.sin(this.theta));
    this.cam.lookAt(this.look);
    this.ren.render(this.scene,this.cam);
  }
};
function deviceOn(mechId){
  for(const n in MAP) if(MAP[n]===mechId && Sim.dev[n]) return n;
  return null;
}
