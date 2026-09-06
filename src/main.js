import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91b4ca);
scene.fog = new THREE.Fog(0xacc4ce, 105, 270);
const camera = new THREE.PerspectiveCamera(61, innerWidth / innerHeight, .1, 700);
const camera2 = new THREE.PerspectiveCamera(61, innerWidth / innerHeight, .1, 700);

const state = {
  mode: 'garage', paused: false, car: 0, speed: 0, throttle: 0, boost: 100,
  boosting: false, drifting: false, total: .002, lateral: 0, lateralVelocity: 0,
  lap: 1, elapsed: 0, topSpeed: 0, nearMisses: 0, shake: 0, tireGrip: 100,
  impactCooldown: 0, contactCooldown: 0, lastCorner: '', finishPosition: 1
};
const keys = { left: false, right: false, up: false, down: false, boost: false, drift: false };
const keys2 = { left: false, right: false, up: false, down: false, boost: false, drift: false };
const state2 = { ...state, mode: 'standby', car: 1, total: .002, lateral: 1.7 };
let gameMode = 'solo';
const cars = [
  { name: 'VORTEX R1', primary: 0xcdf42f, secondary: 0x101416, accent: 0xffffff, max: 322, accel: 12.2, grip: 1.84, braking: 25 },
  { name: 'PHANTOM GT', primary: 0xecece4, secondary: 0x14161c, accent: 0xff4b23, max: 340, accel: 11.4, grip: 1.72, braking: 24 },
  { name: 'NEON XR', primary: 0x16b9ce, secondary: 0x171127, accent: 0xe46aff, max: 310, accel: 12.8, grip: 1.98, braking: 26 },
];

const engineAudio = {
  context: null, master: null, low: null, high: null, enabled: true,
  start() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain(); this.master.gain.value = .07; this.master.connect(this.context.destination);
      this.low = this.context.createOscillator(); this.low.type = 'sawtooth';
      this.high = this.context.createOscillator(); this.high.type = 'square';
      const a=this.context.createGain(), b=this.context.createGain(); a.gain.value=.7; b.gain.value=.035;
      this.low.connect(a).connect(this.master); this.high.connect(b).connect(this.master); this.low.start(); this.high.start();
    }
    if (this.context.state === 'suspended') this.context.resume();
  },
  update(speed, boost) {
    if (!this.context) return; const now=this.context.currentTime, rpm=55+speed*1.7;
    this.low.frequency.setTargetAtTime(rpm,now,.045); this.high.frequency.setTargetAtTime(rpm*2.03,now,.04);
    this.master.gain.setTargetAtTime(this.enabled?(boost?.12:.065):0,now,.07);
  },
  toggle() { this.enabled=!this.enabled; if(this.context)this.master.gain.setTargetAtTime(this.enabled?.07:0,this.context.currentTime,.05); return this.enabled; }
};

const std=(color,roughness=.65,metalness=.05)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const asphalt=std(0x303237,.92,.02), concrete=std(0xb8b3a9,.9,.02), metal=std(0x798087,.28,.78);
asphalt.side=THREE.DoubleSide; concrete.side=THREE.DoubleSide;

scene.add(new THREE.HemisphereLight(0xd9efff,0x596258,2.4));
const sunLight=new THREE.DirectionalLight(0xfff1d2,4.8);sunLight.position.set(-70,110,55);sunLight.castShadow=true;sunLight.shadow.mapSize.set(2048,2048);sunLight.shadow.camera.left=-85;sunLight.shadow.camera.right=85;sunLight.shadow.camera.top=85;sunLight.shadow.camera.bottom=-85;scene.add(sunLight);
const sky=new THREE.Mesh(new THREE.SphereGeometry(400,32,18),new THREE.ShaderMaterial({side:THREE.BackSide,fog:false,vertexShader:'varying vec3 w; void main(){w=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 w; void main(){float h=normalize(w).y;vec3 low=vec3(.72,.82,.85);vec3 high=vec3(.16,.42,.67);gl_FragColor=vec4(mix(low,high,smoothstep(-.05,.8,h)),1.);}'}));scene.add(sky);
const sunDisc=new THREE.Mesh(new THREE.CircleGeometry(9,48),new THREE.MeshBasicMaterial({color:0xffdf9d,fog:false}));sunDisc.position.set(-105,92,-190);sunDisc.lookAt(camera.position);scene.add(sunDisc);

// A compact interpretation of Circuit de Monaco: elevation, hairpins, tunnel and harbor section.
const controlPoints=[
  [-16,0,43],[8,0,43],[29,.3,37],[40,1,24],[34,4,6],[23,8,-12],[5,11,-27],[-14,12,-34],
  [-30,10,-27],[-38,8,-13],[-32,6,1],[-42,4,10],[-46,3,20],[-38,2,28],[-23,1,23],[-7,.5,12],
  [14,.3,7],[34,.2,5],[53,.1,10],[59,0,23],[51,0,34],[34,0,31],[24,0,20],[13,0,27],
  [8,0,38],[-3,0,34],[-13,0,28],[-24,0,35]
].map(p=>new THREE.Vector3(...p));
const circuit=new THREE.CatmullRomCurve3(controlPoints,true,'catmullrom',.24);
const TRACK_LENGTH=circuit.getLength(), METERS_PER_UNIT=10.8, ROAD_HALF=6.6, TRACK_SAMPLES=720;
const CAR_LENGTH=5.4, GRID_GAP=7.2/TRACK_LENGTH;
const mod=n=>THREE.MathUtils.euclideanModulo(n,1);
const trackPoint=p=>circuit.getPointAt(mod(p));
const trackTangent=p=>circuit.getTangentAt(mod(p)).normalize();
const trackRight=p=>{const t=trackTangent(p);return new THREE.Vector3(t.z,0,-t.x).normalize();};
function trackData(p){const d=.0024,t0=trackTangent(p-d),t1=trackTangent(p+d),point=trackPoint(p),right=trackRight(p);const angle=t0.angleTo(t1),curvature=angle/(TRACK_LENGTH*d*2);const sign=Math.sign(new THREE.Vector3().crossVectors(t0,t1).y)||1;return{point,tangent:trackTangent(p),right,curvature,sign};}

function ribbon(width,yOffset,material,uvScale=1){
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=TRACK_SAMPLES;i++){const u=i/TRACK_SAMPLES,p=trackPoint(u),r=trackRight(u);for(const side of [-1,1]){positions.push(p.x+r.x*width,p.y+yOffset,p.z+r.z*width);uvs.push((side+1)/2,u*uvScale);}}
  for(let i=0;i<TRACK_SAMPLES;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
const cityGround=new THREE.Mesh(new THREE.PlaneGeometry(420,360),std(0x71806e,1,0));cityGround.rotation.x=-Math.PI/2;cityGround.position.y=-.5;cityGround.receiveShadow=true;scene.add(cityGround);
const seaMat=new THREE.MeshPhysicalMaterial({color:0x087996,roughness:.18,metalness:.12,transparent:true,opacity:.9,clearcoat:1});
const sea=new THREE.Mesh(new THREE.CircleGeometry(76,64),seaMat);sea.rotation.x=-Math.PI/2;sea.position.set(25,-.22,78);scene.add(sea);
ribbon(ROAD_HALF+1.45,-.08,concrete,12);ribbon(ROAD_HALF,0,asphalt,55);

const trackFurniture=new THREE.Group();scene.add(trackFurniture);
function orientAlong(mesh,p,lateral,y=0){const d=trackData(p),pos=d.point.clone().addScaledVector(d.right,lateral);pos.y+=y;mesh.position.copy(pos);mesh.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z);return mesh;}
for(let i=0;i<240;i++){
  const p=i/240,d=trackData(p),segLen=TRACK_LENGTH/240*1.05;
  const roadSlab=new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF*2,.1,segLen*1.08),asphalt);orientAlong(roadSlab,p,0,.01);roadSlab.receiveShadow=true;trackFurniture.add(roadSlab);
  [-1,1].forEach(side=>{
    const curb=new THREE.Mesh(new THREE.BoxGeometry(.58,.11,segLen),std(i%2?0xf4f1e6:0xe93226,.58,.1));orientAlong(curb,p,side*(ROAD_HALF-.28),.08);trackFurniture.add(curb);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(.16,.75,segLen),metal);orientAlong(rail,p,side*(ROAD_HALF+1.08),.57);rail.castShadow=true;trackFurniture.add(rail);
    const railLine=new THREE.Mesh(new THREE.BoxGeometry(.035,.12,segLen),new THREE.MeshBasicMaterial({color:side>0?0xe6e6df:0xc8c8c2}));orientAlong(railLine,p,side*(ROAD_HALF+.97),.62);trackFurniture.add(railLine);
  });
  if(i%5===0){const mark=new THREE.Mesh(new THREE.PlaneGeometry(.1,2.2),new THREE.MeshBasicMaterial({color:0xe7e6dc,transparent:true,opacity:.48}));orientAlong(mark,p,0,.015);mark.rotation.x=-Math.PI/2;mark.rotation.z=-d.tangent.y;trackFurniture.add(mark);}
}

function makeWindowTexture(base,lit){
  const c=document.createElement('canvas');c.width=512;c.height=512;const x=c.getContext('2d');
  x.fillStyle=base;x.fillRect(0,0,512,512);
  for(let yy=22;yy<500;yy+=62)for(let xx=20;xx<500;xx+=58){
    x.fillStyle='rgba(35,38,40,.2)';x.fillRect(xx-5,yy-5,42,48);
    x.fillStyle=((xx+yy)/2)%4===0?lit:'#54717e';x.fillRect(xx,yy,32,37);
    const grad=x.createLinearGradient(xx,yy,xx+32,yy+37);grad.addColorStop(0,'rgba(255,255,255,.42)');grad.addColorStop(.38,'rgba(255,255,255,.04)');grad.addColorStop(1,'rgba(5,20,30,.26)');x.fillStyle=grad;x.fillRect(xx,yy,32,37);
    x.fillStyle='rgba(245,241,225,.55)';x.fillRect(xx+15,yy,2,37);x.fillRect(xx,yy+18,32,2);
  }
  x.strokeStyle='rgba(65,55,45,.2)';x.lineWidth=3;for(let yy=0;yy<512;yy+=62){x.beginPath();x.moveTo(0,yy);x.lineTo(512,yy);x.stroke();}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1.1,1.6);t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;
}
const facadeTextures=[makeWindowTexture('#d8cfbe','#f2d089'),makeWindowTexture('#d9a987','#fff0b1'),makeWindowTexture('#c4c8bc','#dff0ff'),makeWindowTexture('#e3ded4','#ffe4a1')];
let seed=7281;const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
const buildings=[];
function distanceToCircuit(pos){let closest=Infinity;for(let i=0;i<180;i++){const p=trackPoint(i/180),d=Math.hypot(pos.x-p.x,pos.z-p.z);if(d<closest)closest=d;}return closest;}
function makeBuilding(x,z,w,d,h,style=0){
  const group=new THREE.Group(),material=new THREE.MeshStandardMaterial({map:facadeTextures[style%facadeTextures.length],roughness:.84,color:0xffffff});
  const radius=Math.min(.58,w*.08,d*.08),curved=style%5===1||style%7===3,body=new THREE.Mesh(curved?new THREE.CylinderGeometry(w*.46,w*.5,h,28,1,false):new RoundedBoxGeometry(w,h,d,7,radius),material);if(curved)body.scale.z=d/w;body.position.y=h/2;body.castShadow=true;body.receiveShadow=true;group.add(body);
  const trim=std(style%2?0xeee4d2:0xe0e3df,.75,.03),roofColor=std(style%3?0x98523f:0x59646d,.67,.12);
  const base=new THREE.Mesh(new RoundedBoxGeometry(w*1.03,.7,d*1.03,3,.16),std(0x7a7168,.82,.04));base.position.y=.35;group.add(base);
  for(const side of [-1,1]){const pilaster=new THREE.Mesh(new RoundedBoxGeometry(.28,h*.96,.25,3,.08),trim);pilaster.position.set(side*(w/2-.23),h*.5,d/2+.08);group.add(pilaster);}
  for(let y=3.1;y<h-1.5;y+=3.35){
    const slab=new THREE.Mesh(new RoundedBoxGeometry(w*.92,.12,.74,4,.05),trim);slab.position.set(0,y,d/2+.34);group.add(slab);
    const railMat=std(0x34383a,.35,.68),topRail=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,w*.84,8),railMat);topRail.rotation.z=Math.PI/2;topRail.position.set(0,y+.55,d/2+.66);group.add(topRail);
    for(let bx=-w*.37;bx<=w*.37;bx+=.55){const rail=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.5,6),railMat);rail.position.set(bx,y+.3,d/2+.65);group.add(rail);}
  }
  const cornice=new THREE.Mesh(new RoundedBoxGeometry(w*1.07,.36,d*1.07,4,.1),trim);cornice.position.y=h-.15;group.add(cornice);
  const roof=new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w,d)*.36,Math.min(w,d)*.49,2.1,style%3===0?10:4),roofColor);roof.scale.x=w/d;roof.position.y=h+1;roof.rotation.y=Math.PI/4;group.add(roof);
  const rooftop=new THREE.Mesh(new RoundedBoxGeometry(w*.3,.9,d*.3,4,.18),trim);rooftop.position.y=h+2.1;group.add(rooftop);
  if(style%3===0){const awningMat=std(0x214e67,.65,.05);for(let ax=-w*.32;ax<=w*.32;ax+=1.25){const awning=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.72,16,1,false,0,Math.PI),awningMat);awning.rotation.z=Math.PI/2;awning.position.set(ax,1.75,d/2+.48);group.add(awning);}}
  group.position.set(x,-.25,z);scene.add(group);buildings.push(group);return group;
}
for(let i=0;i<58;i++){
  const p=(i/58+.018)%1,d=trackData(p),side=(i%5===0?-1:1),offset=ROAD_HALF+10+rnd()*16;
  if(p>.54&&p<.79&&side>0)continue;
  const pos=d.point.clone().addScaledVector(d.right,side*offset),w=4+rnd()*5,dep=4+rnd()*5,h=7+rnd()*22+(p>.12&&p<.42?8:0);
  if(distanceToCircuit(pos)<ROAD_HALF+Math.hypot(w,dep)*.55+3.5)continue;
  const b=makeBuilding(pos.x,pos.z,w,dep,h,i);b.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z)+(rnd()-.5)*.25;
}
function makeCasinoLandmark(){
  const d=trackData(.27),g=new THREE.Group(),stone=std(0xddd2bd,.76,.04),roof=std(0x69a29a,.52,.18),dark=std(0x385463,.26,.35);
  const center=new THREE.Mesh(new RoundedBoxGeometry(13,8.5,7,7,.45),stone);center.position.y=4.25;center.castShadow=true;g.add(center);
  [-1,1].forEach(side=>{const wing=new THREE.Mesh(new RoundedBoxGeometry(8,6.5,6.3,6,.36),stone);wing.position.set(side*9.6,3.25,.3);wing.castShadow=true;g.add(wing);const tower=new THREE.Mesh(new THREE.CylinderGeometry(2.15,2.45,8,24),stone);tower.position.set(side*6.1,5.6,0);g.add(tower);const dome=new THREE.Mesh(new THREE.SphereGeometry(2.25,28,14,0,Math.PI*2,0,Math.PI/2),roof);dome.position.set(side*6.1,9.55,0);g.add(dome);});
  for(let x=-5;x<=5;x+=2){const column=new THREE.Mesh(new THREE.CylinderGeometry(.18,.23,4.2,16),stone);column.position.set(x,2.35,3.72);g.add(column);const window=new THREE.Mesh(new RoundedBoxGeometry(1.1,2.6,.12,8,.35),dark);window.position.set(x,5.9,3.56);g.add(window);}
  const pediment=new THREE.Mesh(new THREE.ConeGeometry(4.2,2.1,3),stone);pediment.rotation.set(0,0,-Math.PI/2);pediment.scale.z=.35;pediment.position.set(0,9.2,3.45);g.add(pediment);
  const pos=d.point.clone().addScaledVector(d.right,-22);g.position.copy(pos);g.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z);scene.add(g);buildings.push(g);
}
makeCasinoLandmark();
function organicHill(radius,color){const geometry=new THREE.SphereGeometry(radius,40,24),pos=geometry.attributes.position;for(let i=0;i<pos.count;i++){const v=new THREE.Vector3().fromBufferAttribute(pos,i),noise=1+.055*Math.sin(v.x*.41)+.045*Math.sin(v.z*.57+v.y);v.multiplyScalar(noise);pos.setXYZ(i,v.x,v.y,v.z);}geometry.computeVertexNormals();return new THREE.Mesh(geometry,std(color,1,0));}
for(let i=0;i<12;i++){const rock=organicHill(12+rnd()*13,i%2?0x617266:0x758371);rock.scale.set(1,.65+rnd()*.65,1);rock.position.set(-20+rnd()*65,2+rnd()*8,-70-rnd()*32);scene.add(rock);}

function palmLeafGeometry(){const shape=new THREE.Shape();shape.moveTo(0,0);shape.bezierCurveTo(.55,.08,1.7,.25,2.7,0);shape.bezierCurveTo(1.7,-.35,.65,-.22,0,0);return new THREE.ShapeGeometry(shape,10);}
const sharedPalmLeaf=palmLeafGeometry();
function palm(x,z,s=1){const g=new THREE.Group(),trunk=new THREE.Mesh(new THREE.CylinderGeometry(.11,.25,4.5,16),std(0x76563a,.92,0));trunk.position.y=2.25;g.add(trunk);for(let i=0;i<9;i++){const leaf=new THREE.Mesh(sharedPalmLeaf,std(i%2?0x216f45:0x2b8955,.82,0));leaf.position.y=4.48;leaf.rotation.x=-.12-(i%3)*.08;leaf.rotation.y=i/9*Math.PI*2;leaf.rotation.z=(i%2-.5)*.08;g.add(leaf);}g.position.set(x,0,z);g.scale.setScalar(s);scene.add(g);}
for(let i=0;i<18;i++)palm(-3+i*3.8,48+rnd()*6,.7+rnd()*.35);
function yacht(x,z,scale=1,heading=0){const g=new THREE.Group(),white=std(0xf5f5ed,.22,.24);const hull=new THREE.Mesh(loftGeometry([[-3,0,.34,.22,.18],[-2.2,0,.38,.8,.33],[.2,0,.38,1.05,.4],[2.55,0,.4,.82,.34],[3,0,.44,.35,.2]],24),white);g.add(hull);const cabin=new THREE.Mesh(new RoundedBoxGeometry(1.45,.72,2.5,8,.25),std(0xe7f1ef,.16,.18));cabin.position.set(0,.92,.25);g.add(cabin);const glass=new THREE.Mesh(new THREE.SphereGeometry(.78,24,12,0,Math.PI*2,0,Math.PI/2),std(0x163b4c,.08,.58));glass.scale.set(.92,.46,1.45);glass.position.set(0,1.18,-.2);g.add(glass);const rail=new THREE.Mesh(new THREE.TorusGeometry(.88,.025,8,32,Math.PI),metal);rail.scale.z=2.4;rail.rotation.x=Math.PI/2;rail.position.set(0,.87,-2.05);g.add(rail);g.position.set(x,0,z);g.scale.setScalar(scale);g.rotation.y=heading;scene.add(g);}
for(let i=0;i<13;i++)yacht(-3+(i%7)*8,62+Math.floor(i/7)*14,.65+rnd()*.45,(rnd()-.5)*.25);
function grandstand(p,side){const d=trackData(p),g=new THREE.Group();for(let row=0;row<5;row++){const seat=new THREE.Mesh(new THREE.BoxGeometry(10,.25,1),std(row%2?0xe9e8e0:0x2b64a2,.65,.04));seat.position.set(0,row*.65,row*.65);g.add(seat);}const pos=d.point.clone().addScaledVector(d.right,side*11);g.position.copy(pos);g.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z)+(side>0?0:Math.PI);scene.add(g);}
grandstand(.015,-1);grandstand(.78,1);

for(let p=.535;p<.655;p+=.012){const d=trackData(p),g=new THREE.Group();const roof=new THREE.Mesh(new THREE.BoxGeometry(17,.48,3.4),std(0x858a87,.88,.06));roof.position.y=5.7;g.add(roof);[-1,1].forEach(side=>{const wall=new THREE.Mesh(new THREE.BoxGeometry(.48,5.7,3.4),std(0x8e918d,.9,.04));wall.position.set(side*8.15,2.8,0);g.add(wall);});const pos=d.point.clone();g.position.copy(pos);g.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z);scene.add(g);if(Math.round(p*1000)%24<12){const light=new THREE.PointLight(0xffc36c,13,15);light.position.copy(pos);light.position.y+=5.1;scene.add(light);}}

const cornerMarkers=[
  [.055,'SAINTE DÉVOTE'],[.145,'BEAU RIVAGE'],[.255,'MASSENET / CASINO'],[.355,'MIRABEAU'],[.435,'FAIRMONT HAIRPIN'],
  [.525,'PORTIER'],[.665,'NOUVELLE CHICANE'],[.745,'TABAC'],[.815,'SWIMMING POOL'],[.925,'RASCASSE']
];
function sponsorTexture(text,color='#d7ff38'){const c=document.createElement('canvas');c.width=768;c.height=160;const x=c.getContext('2d');x.fillStyle='#14202a';x.fillRect(0,0,c.width,c.height);x.strokeStyle='#d9dde0';x.lineWidth=8;x.strokeRect(4,4,760,152);x.fillStyle=color;x.font='italic 900 74px Arial';x.textAlign='center';x.fillText(text,384,103);x.fillStyle='#fff';x.font='600 18px Arial';x.fillText('MONACO GRAND PRIX',384,135);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function overheadBanner(p,text,color){const d=trackData(p),g=new THREE.Group();const sign=new THREE.Mesh(new THREE.PlaneGeometry(12,2.5),new THREE.MeshBasicMaterial({map:sponsorTexture(text,color),side:THREE.FrontSide}));sign.position.y=6.2;g.add(sign);[-6,6].forEach(x=>{const leg=new THREE.Mesh(new THREE.BoxGeometry(.22,6,.22),metal);leg.position.set(x,3,0);g.add(leg);});g.position.copy(d.point);g.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z);scene.add(g);}
overheadBanner(.042,'MONTE-CARLO','#d7ff38');overheadBanner(.675,'APEX VELOCITY','#ff5b30');

function decalTexture(config,number){const c=document.createElement('canvas');c.width=1024;c.height=512;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1024,512);x.fillStyle='#11151b';x.beginPath();x.moveTo(0,0);x.lineTo(660,0);x.lineTo(420,512);x.lineTo(0,512);x.fill();x.fillStyle=`#${config.accent.toString(16).padStart(6,'0')}`;x.beginPath();x.moveTo(490,0);x.lineTo(635,0);x.lineTo(380,512);x.lineTo(235,512);x.fill();x.fillStyle='#fff';x.font='900 170px Arial';x.fillText(number,65,230);x.font='700 48px Arial';x.fillText('AV MOTORSPORT',65,305);x.font='700 34px Arial';x.fillText('MONTE-CARLO',65,355);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function suspensionBeam(a,b,material){const mid=a.clone().add(b).multiplyScalar(.5),len=a.distanceTo(b),mesh=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,len,6),material);mesh.position.copy(mid);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return mesh;}
function loftGeometry(sections,radial=20){
  const positions=[],uvs=[],indices=[];
  for(let s=0;s<sections.length;s++){const [z,cx,cy,rx,ry]=sections[s];for(let i=0;i<radial;i++){const a=i/radial*Math.PI*2,x=cx+Math.cos(a)*rx,y=cy+Math.sin(a)*ry;positions.push(x,y,z);uvs.push(i/radial,s/(sections.length-1));}}
  for(let s=0;s<sections.length-1;s++)for(let i=0;i<radial;i++){const n=(i+1)%radial,a=s*radial+i,b=s*radial+n,c=(s+1)*radial+i,d=(s+1)*radial+n;indices.push(a,c,b,b,c,d);}
  const firstCenter=positions.length/3,lastCenter=firstCenter+1,first=sections[0],last=sections.at(-1);positions.push(first[1],first[2],first[0],last[1],last[2],last[0]);uvs.push(.5,0,.5,1);
  for(let i=0;i<radial;i++){const n=(i+1)%radial;indices.push(firstCenter,n,i,lastCenter,(sections.length-1)*radial+i,(sections.length-1)*radial+n);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function createCar(config,index=0,isPlayer=true){
  const car=new THREE.Group(),paint=new THREE.MeshPhysicalMaterial({color:config.primary,roughness:.23,metalness:.48,clearcoat:1,clearcoatRoughness:.18}),carbon=std(0x090b0c,.32,.72),accent=new THREE.MeshStandardMaterial({color:config.accent,emissive:config.accent,emissiveIntensity:.32,roughness:.35,metalness:.35});
  const floor=new THREE.Mesh(new RoundedBoxGeometry(2.22,.1,5.05,5,.045),carbon);floor.position.y=.34;car.add(floor);
  const diffuser=new THREE.Mesh(loftGeometry([[-.1,0,.4,1.05,.05],[1.45,0,.42,1.1,.07],[2.25,0,.55,.86,.14]],16),carbon);car.add(diffuser);
  const monocoque=new THREE.Mesh(loftGeometry([[-3.1,0,.54,.10,.07],[-2.65,0,.56,.18,.1],[-2.05,0,.59,.3,.15],[-1.4,0,.64,.43,.22],[-.65,0,.7,.55,.29],[.1,0,.73,.64,.34],[.72,0,.72,.58,.34],[1.25,0,.67,.48,.28],[1.8,0,.61,.42,.21],[2.18,0,.57,.48,.16]],24),paint);monocoque.castShadow=true;car.add(monocoque);
  [-1,1].forEach(side=>{
    const podSections=[[-1.12,side*.66,.59,.16,.12],[-.7,side*.85,.65,.38,.25],[-.05,side*.9,.68,.46,.3],[.72,side*.87,.65,.43,.27],[1.35,side*.72,.59,.31,.2],[1.77,side*.52,.55,.16,.13]],pod=new THREE.Mesh(loftGeometry(podSections,20),paint);pod.castShadow=true;car.add(pod);
    const inlet=new THREE.Mesh(new THREE.TorusGeometry(.23,.055,10,22,Math.PI),carbon);inlet.scale.set(1.35,1,1);inlet.rotation.set(0,side*Math.PI/2,Math.PI/2);inlet.position.set(side*1.18,.74,-.55);car.add(inlet);
    const decal=new THREE.Mesh(new THREE.PlaneGeometry(1.5,.42),new THREE.MeshBasicMaterial({map:decalTexture(config,10+index*7),transparent:true,side:THREE.DoubleSide}));decal.position.set(side*1.31,.72,.14);decal.rotation.y=side*Math.PI/2;car.add(decal);
    const mirrorStem=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.37,8),carbon);mirrorStem.rotation.z=Math.PI/2;mirrorStem.position.set(side*.72,1.02,-.52);car.add(mirrorStem);const mirror=new THREE.Mesh(new THREE.SphereGeometry(.13,16,8),paint);mirror.scale.set(1.45,.58,.72);mirror.position.set(side*.88,1.03,-.52);car.add(mirror);
  });
  const cockpit=new THREE.Mesh(new THREE.SphereGeometry(.57,32,18,0,Math.PI*2,0,Math.PI/2),carbon);cockpit.scale.set(.86,.64,1.3);cockpit.position.set(0,.91,.25);car.add(cockpit);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.255,28,18),accent);helmet.position.set(0,1.12,.18);car.add(helmet);const visor=new THREE.Mesh(new THREE.SphereGeometry(.258,28,10,0,Math.PI,0,Math.PI*.48),std(0x142a38,.08,.7));visor.rotation.y=Math.PI;visor.position.set(0,1.12,.17);car.add(visor);
  const haloCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.5,1.02,-.05),new THREE.Vector3(-.52,1.26,.2),new THREE.Vector3(0,1.38,.48),new THREE.Vector3(.52,1.26,.2),new THREE.Vector3(.5,1.02,-.05)]),halo=new THREE.Mesh(new THREE.TubeGeometry(haloCurve,36,.045,8,false),carbon);car.add(halo);car.add(suspensionBeam(new THREE.Vector3(0,1.34,.45),new THREE.Vector3(0,.82,-.42),carbon));
  const airbox=new THREE.Mesh(new THREE.TorusGeometry(.2,.065,12,24,Math.PI),paint);airbox.rotation.set(Math.PI/2,0,Math.PI);airbox.position.set(0,1.28,.82);car.add(airbox);
  const finShape=new THREE.Shape();finShape.moveTo(0,0);finShape.lineTo(1.5,.05);finShape.lineTo(.45,.8);finShape.lineTo(0,.7);finShape.closePath();const fin=new THREE.Mesh(new THREE.ExtrudeGeometry(finShape,{depth:.055,bevelEnabled:true,bevelSize:.018,bevelThickness:.018,bevelSegments:3}),paint);fin.rotation.y=Math.PI/2;fin.position.set(-.027,.64,.72);car.add(fin);
  const frontWing=new THREE.Mesh(new RoundedBoxGeometry(2.92,.08,.48,5,.035),carbon);frontWing.position.set(0,.34,-3.15);frontWing.rotation.x=-.055;car.add(frontWing);const frontFlap=new THREE.Mesh(new RoundedBoxGeometry(2.66,.055,.34,5,.025),paint);frontFlap.position.set(0,.43,-3.02);frontFlap.rotation.x=-.12;car.add(frontFlap);
  [-1,1].forEach(side=>{const endShape=new THREE.Shape();endShape.moveTo(-.34,0);endShape.bezierCurveTo(-.2,.4,.18,.48,.34,.34);endShape.lineTo(.34,0);endShape.closePath();const end=new THREE.Mesh(new THREE.ExtrudeGeometry(endShape,{depth:.055,bevelEnabled:true,bevelSize:.018,bevelThickness:.018,bevelSegments:2}),paint);end.rotation.y=side*Math.PI/2;end.position.set(side*1.46,.35,-3.12);car.add(end);});
  for(let level=0;level<2;level++){const rearWing=new THREE.Mesh(new RoundedBoxGeometry(2.34,.105,.38,5,.04),level?paint:carbon);rearWing.position.set(0,1.17+level*.2,2.18-level*.06);rearWing.rotation.x=-.08;car.add(rearWing);}[-.88,.88].forEach(x=>{const support=new THREE.Mesh(new RoundedBoxGeometry(.065,.78,.16,3,.025),carbon);support.position.set(x,.9,2.12);car.add(support);});
  const wheelPositions=[[-1.13,-1.78],[1.13,-1.78],[-1.17,1.43],[1.17,1.43]];
  wheelPositions.forEach(([x,z],wi)=>{const wheel=new THREE.Group(),radius=wi<2?.42:.47,tire=new THREE.Mesh(new THREE.TorusGeometry(radius*.68,radius*.32,18,36),std(0x070809,.72,.08));tire.rotation.y=Math.PI/2;tire.castShadow=true;wheel.add(tire);const sidewall=new THREE.Mesh(new THREE.CylinderGeometry(radius*.69,radius*.69,.08,32),std(0x111214,.58,.12));sidewall.rotation.z=Math.PI/2;sidewall.position.x=Math.sign(x)*.19;wheel.add(sidewall);const rim=new THREE.Mesh(new THREE.CylinderGeometry(radius*.48,radius*.48,.39,28),accent);rim.rotation.z=Math.PI/2;wheel.add(rim);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.42,16),carbon);hub.rotation.z=Math.PI/2;wheel.add(hub);wheel.position.set(x,.54,z);car.add(wheel);const inner=new THREE.Vector3(Math.sign(x)*.35,.57,z+(wi<2?.28:-.28)),outer=new THREE.Vector3(x,.55,z);car.add(suspensionBeam(inner,outer,carbon));car.add(suspensionBeam(new THREE.Vector3(Math.sign(x)*.42,.42,z-(wi<2?.22:-.22)),outer,carbon));});
  const spineCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.86,-2.55),new THREE.Vector3(0,1.04,-1.1),new THREE.Vector3(0,1.06,.65)]),spine=new THREE.Mesh(new THREE.TubeGeometry(spineCurve,32,.042,8,false),accent);car.add(spine);
  const rain=new THREE.Mesh(new THREE.SphereGeometry(.09,16,10),new THREE.MeshBasicMaterial({color:0xff2020}));rain.position.set(0,.67,2.42);car.add(rain);if(isPlayer){const glow=new THREE.PointLight(config.accent,3.5,5);glow.position.set(0,.35,2.1);car.add(glow);}car.scale.setScalar(.86);return car;
}

let player=createCar(cars[0],0,true);scene.add(player);
let player2=createCar(cars[1],1,true);player2.visible=false;scene.add(player2);
const ai=[];
for(let i=0;i<7;i++){const mesh=createCar(cars[(i+1)%3],i+1,false);scene.add(mesh);ai.push({mesh,total:.002-GRID_GAP*(i+1),speed:0,lateral:(i%2?1.35:-1.35),targetLane:(i%2?1.35:-1.35),skill:.84+rnd()*.14,aggression:.35+rnd()*.6,max:282+rnd()*40,mistake:0,phase:rnd()*10,contact:0});}

const particles=[];
function emit(type,count=1,driver=state,carMesh=player){const data=trackData(driver.total);for(let k=0;k<count;k++){if(particles.length>260){const q=particles.shift();scene.remove(q.mesh);}const color=type==='boost'?(rnd()>.45?0x4ddfff:0xd7ff38):type==='spark'?0xffc24c:0xbfc4c2,size=type==='smoke'?.12+rnd()*.16:.055+rnd()*.1;const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(size,0),new THREE.MeshBasicMaterial({color,transparent:true,depthWrite:false}));mesh.position.copy(carMesh.position).addScaledVector(data.tangent,-2.3).addScaledVector(data.right,(rnd()-.5)*2);mesh.position.y+=.25;scene.add(mesh);particles.push({mesh,life:1,type,velocity:data.tangent.clone().multiplyScalar(-(type==='boost'?4+rnd()*6:1+rnd()*2)).add(new THREE.Vector3((rnd()-.5)*.8,type==='smoke'?.5:rnd()*1.8,(rnd()-.5)*.8))});}}
const speedLines=[];for(let i=0;i<38;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(.018,.018,1+rnd()*3),new THREE.MeshBasicMaterial({color:i%4?0xffffff:0xd7ff38,transparent:true,opacity:0,depthWrite:false}));scene.add(line);speedLines.push(line);}

function setCarOnTrack(mesh,total,lateral,lean=0,yawOffset=0){const d=trackData(total);mesh.position.copy(d.point).addScaledVector(d.right,lateral);mesh.position.y+=.05;mesh.rotation.order='YXZ';mesh.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z)+yawOffset;mesh.rotation.x=Math.atan2(d.tangent.y,Math.hypot(d.tangent.x,d.tangent.z));mesh.rotation.z=lean;return d;}
setCarOnTrack(player,state.total,0);
function createMiniMap(){const holder=document.querySelector('.minimap'),old=holder.querySelector('svg');if(old)old.remove();const pts=[];for(let i=0;i<=100;i++)pts.push(trackPoint(i/100));const xs=pts.map(p=>p.x),zs=pts.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),path=pts.map((p,i)=>`${i?'L':'M'} ${8+(p.x-minX)/(maxX-minX)*42} ${8+(p.z-minZ)/(maxZ-minZ)*110}`).join(' ')+' Z';holder.insertAdjacentHTML('afterbegin',`<svg viewBox="0 0 58 128" aria-hidden="true"><path d="${path}"/></svg>`);holder.dataset.bounds=[minX,maxX,minZ,maxZ].join(',');}createMiniMap();

function curvatureSpeed(data,grip){if(data.curvature<.004)return 350;const radiusMeters=(1/data.curvature)*METERS_PER_UNIT;return THREE.MathUtils.clamp(Math.sqrt(grip*9.81*radiusMeters)*3.6,62,335);}
const activeHumans=()=>gameMode==='split'?[state,state2]:[state];
function playerPosition(driver){let ahead=0;for(const r of ai)if(r.total>driver.total)ahead++;for(const other of activeHumans())if(other!==driver&&other.total>driver.total)ahead++;return Math.min(ai.length+activeHumans().length,ahead+1);}
function updateAI(dt,time){
  for(const human of activeHumans())human.contactCooldown=Math.max(0,human.contactCooldown-dt);
  for(const r of ai){
    r.contact=Math.max(0,r.contact-dt);
    const d=trackData(r.total),safe=curvatureSpeed(d,1.72*r.skill);
    if(r.mistake>0)r.mistake-=dt;else if(rnd()<.002)r.mistake=.45+rnd()*1.1;
    let target=Math.min(r.max,safe*(r.mistake>0?.72:1));

    // Cars approaching another driver choose an alternate line before braking.
    let nearest=null,nearestGap=Infinity;
    for(const other of ai){const gap=(other.total-r.total)*TRACK_LENGTH;if(other!==r&&gap>0&&gap<nearestGap){nearest=other;nearestGap=gap;}}
    if(nearest&&nearestGap<10&&Math.abs(nearest.lateral-r.lateral)<2.1){
      r.targetLane=THREE.MathUtils.clamp(nearest.lateral+(r.aggression>.62?2.25:-2.25),-4.75,4.75);
      if(nearestGap<CAR_LENGTH+1.3)target=Math.min(target,Math.max(35,nearest.speed-5));
    }else{
      let chased=null,chasedGap=Infinity;
      for(const human of activeHumans()){const gap=(human.total-r.total)*TRACK_LENGTH;if(gap>0&&gap<chasedGap){chased=human;chasedGap=gap;}}
      if(chased&&chasedGap<12){const passSide=chased.lateral>0?-1:1;r.targetLane=THREE.MathUtils.clamp(chased.lateral+passSide*(2.1+r.aggression),-4.75,4.75);target=Math.min(r.max,target+14*r.aggression);}
      else r.targetLane=Math.sin(time*.18+r.phase)*1.15;
    }

    r.speed+=THREE.MathUtils.clamp(target-r.speed,-42*dt,(34+r.skill*7)*dt);r.speed=Math.max(0,r.speed);
    r.total+=(r.speed/3.6*dt)/(TRACK_LENGTH*METERS_PER_UNIT);r.lateral+=(r.targetLane-r.lateral)*dt*(1.25+r.aggression);
    const weave=Math.sin(time*.7+r.phase)*.1;setCarOnTrack(r.mesh,r.total,r.lateral+weave,Math.sin(time*.7+r.phase)*.012);

    activeHumans().forEach((human,humanIndex)=>{
      const carMesh=humanIndex===0?player:player2,longitudinal=Math.abs(r.total-human.total)*TRACK_LENGTH,lateralGap=Math.abs(r.lateral-human.lateral),nearKey=humanIndex===0?'near1':'near2';
      if(human.elapsed>1.5&&longitudinal<CAR_LENGTH*.72&&lateralGap<1.45&&r.contact<=0&&human.contactCooldown<=0){
        const closing=Math.abs(human.speed-r.speed);human.speed=Math.max(0,human.speed-Math.min(34,8+closing*.32));human.shake=.42;human.lateralVelocity+=(human.lateral>r.lateral?1:-1)*2.2;r.contact=1.1;human.contactCooldown=.9;flash('WHEEL TO WHEEL',human);emit('spark',6,human,carMesh);
      }else if(longitudinal<CAR_LENGTH*.8&&lateralGap<2.75&&!r[nearKey]){r[nearKey]=true;human.nearMisses++;flash('CLOSE RACING +1',human);}
      if(longitudinal>CAR_LENGTH*1.5)r[nearKey]=false;
    });
  }
}

function rebuildPlayer(index){scene.remove(player);player=createCar(cars[index],index,true);scene.add(player);setCarOnTrack(player,state.total,state.lateral);}
function rebuildPlayer2(index){scene.remove(player2);player2=createCar(cars[index],index,true);player2.visible=gameMode==='split';scene.add(player2);setCarOnTrack(player2,state2.total,state2.lateral);}
function resetHuman(driver,total,lateral){Object.assign(driver,{speed:0,throttle:0,boost:100,boosting:false,drifting:false,total,lateral,lateralVelocity:0,lap:1,elapsed:0,topSpeed:0,nearMisses:0,shake:0,tireGrip:100,impactCooldown:0,contactCooldown:0});}
function resetRace(){
  state.mode='race';state.paused=false;const split=gameMode==='split';resetHuman(state,.002,split?-1.7:0);resetHuman(state2,.002,1.7);player2.visible=split;
  ai.forEach((r,i)=>{r.total=.002-GRID_GAP*(i+1);r.speed=0;r.lateral=(i%2?1.35:-1.35);r.targetLane=r.lateral;r.mistake=0;r.contact=0;r.near1=false;r.near2=false;});
  setCarOnTrack(player,state.total,state.lateral);if(split)setCarOnTrack(player2,state2.total,state2.lateral);engineAudio.start();
  document.querySelector('#garage').classList.add('exit');document.querySelector('#result').classList.add('hidden');const hud=document.querySelector('#hud'),hud2=document.querySelector('#hud-p2');hud.classList.remove('hidden');hud.classList.toggle('split-pane',split);hud2.classList.toggle('hidden',!split);hud2.classList.toggle('split-pane',split);document.querySelector('#total-racers').textContent=split?'/9':'/8';document.querySelector('#total-racers-p2').textContent='/9';
  if(!split&&matchMedia('(pointer: coarse)').matches)document.querySelector('#mobile-controls').classList.remove('hidden');else document.querySelector('#mobile-controls').classList.add('hidden');flash('LIGHTS OUT',state);if(split)flash('LIGHTS OUT',state2);
}
function flash(text,driver=state){const isP2=driver===state2,el=document.querySelector(isP2?'#status-message-p2':'#status-message'),timerKey=isP2?'t2':'t1';el.textContent=text;el.classList.remove('show');requestAnimationFrame(()=>el.classList.add('show'));clearTimeout(flash[timerKey]);flash[timerKey]=setTimeout(()=>el.classList.remove('show'),1000);}

function updateHuman(driver,carMesh,input,dt){
  const cfg=cars[driver.car],d=trackData(driver.total);driver.throttle+=(input.up?1-driver.throttle:-driver.throttle)*dt*7;const drag=.000053*driver.speed*driver.speed,rolling=1.2+(driver.speed<8?.6:0),engine=cfg.accel*driver.throttle*Math.max(.28,1-driver.speed/(cfg.max*1.25)),brakes=input.down?cfg.braking:0;driver.speed+=((engine-rolling-drag-brakes)*3.6)*dt;driver.speed=THREE.MathUtils.clamp(driver.speed,0,cfg.max+(driver.boosting?38:0));driver.boosting=input.boost&&driver.boost>0&&driver.speed>95;if(driver.boosting){driver.boost=Math.max(0,driver.boost-24*dt);driver.speed=Math.min(cfg.max+38,driver.speed+27*dt);driver.shake=Math.max(driver.shake,.08);emit('boost',2,driver,carMesh);}else driver.boost=Math.min(100,driver.boost+7*dt);
  const steer=(input.left?-1:0)+(input.right?1:0),speedFactor=THREE.MathUtils.clamp(driver.speed/140,.25,1.5);driver.drifting=input.drift&&steer!==0&&driver.speed>75;const gripFactor=(.68+.32*driver.tireGrip/100)*(driver.drifting?.42:1),safe=curvatureSpeed(d,cfg.grip*gripFactor),overspeed=Math.max(0,driver.speed-safe);driver.lateralVelocity+=steer*cfg.grip*3.25*speedFactor*dt*(driver.drifting?1.22:1);driver.lateralVelocity*=Math.exp(-dt*(driver.drifting?1.15:3.8));driver.lateralVelocity+=d.sign*(overspeed/45)**1.45*5.2*dt;driver.lateral+=driver.lateralVelocity*dt;if(overspeed>8){driver.tireGrip=Math.max(62,driver.tireGrip-dt*overspeed*.045);if(rnd()<.32)emit('smoke',1,driver,carMesh);}else driver.tireGrip=Math.min(100,driver.tireGrip+dt*1.9);
  driver.impactCooldown=Math.max(0,driver.impactCooldown-dt);if(Math.abs(driver.lateral)>ROAD_HALF-.55){if(driver.impactCooldown<=0){driver.speed*=.58;driver.shake=.72;driver.impactCooldown=.75;flash('BARRIER — BRAKE EARLIER',driver);emit('spark',14,driver,carMesh);}driver.lateral=Math.sign(driver.lateral)*(ROAD_HALF-.58);driver.lateralVelocity*=-.34;}driver.total+=(driver.speed/3.6*dt)/(TRACK_LENGTH*METERS_PER_UNIT);driver.lap=Math.min(3,Math.floor(driver.total)+1);driver.elapsed+=dt;driver.topSpeed=Math.max(driver.topSpeed,driver.speed);const yaw=-steer*.035-driver.lateralVelocity*.025-d.sign*(overspeed/350),lean=-steer*.035-driver.lateralVelocity*.018;setCarOnTrack(carMesh,driver.total,driver.lateral,lean,yaw);
}

function updateHumanCollision(){
  if(gameMode!=='split'||state.elapsed<1.5)return;const longitudinal=Math.abs(state.total-state2.total)*TRACK_LENGTH,lateralGap=Math.abs(state.lateral-state2.lateral);
  if(longitudinal<CAR_LENGTH*.72&&lateralGap<1.45&&state.contactCooldown<=0&&state2.contactCooldown<=0){const average=(state.speed+state2.speed)*.5;state.speed=Math.min(state.speed,average)-6;state2.speed=Math.min(state2.speed,average)-6;state.speed=Math.max(0,state.speed);state2.speed=Math.max(0,state2.speed);const push=state.lateral>state2.lateral?1:-1;state.lateralVelocity+=push*1.8;state2.lateralVelocity-=push*1.8;state.shake=state2.shake=.35;state.contactCooldown=state2.contactCooldown=1;flash('PLAYER CONTACT',state);flash('PLAYER CONTACT',state2);emit('spark',5,state,player);}
}

function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt*(p.type==='smoke'?.48:1.6);p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.material.opacity=Math.max(0,p.life);p.mesh.scale.setScalar(1+(1-p.life)*(p.type==='smoke'?3:.6));if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1);}}}
function updateBuildingVisibility(){for(const b of buildings)b.visible=b.position.distanceTo(camera.position)>11&&(gameMode!=='split'||b.position.distanceTo(camera2.position)>11);}
function updateCameraFor(driver,viewCamera,dt,updateLines=false){const d=trackData(driver.total),behind=d.point.clone().addScaledVector(d.right,driver.lateral*.6).addScaledVector(d.tangent,-8.6);behind.y+=4.2+(driver.boosting?.35:0);const lerp=1-Math.exp(-dt*5.2);viewCamera.position.lerp(behind,lerp);if(driver.shake>0){viewCamera.position.x+=(rnd()-.5)*driver.shake;viewCamera.position.y+=(rnd()-.5)*driver.shake*.4;}driver.shake=Math.max(0,driver.shake-dt*2.2);const look=d.point.clone().addScaledVector(d.tangent,11).addScaledVector(d.right,driver.lateral*.32);look.y+=.8;viewCamera.lookAt(look);viewCamera.fov+=((driver.boosting?69:61)-viewCamera.fov)*dt*5;viewCamera.updateProjectionMatrix();if(updateLines)for(const s of speedLines){if(!s.userData.init||s.position.distanceTo(viewCamera.position)>42){s.userData.init=true;s.position.copy(viewCamera.position).addScaledVector(d.tangent,5+rnd()*34).addScaledVector(d.right,(rnd()-.5)*28);s.position.y+=-2+rnd()*10;s.rotation.y=Math.atan2(-d.tangent.x,-d.tangent.z);}s.material.opacity=driver.boosting?.16+rnd()*.42:Math.max(0,(driver.speed-245)/650);s.position.addScaledVector(d.tangent,-driver.speed/3.6*dt*.55);}}
function updateGarage(dt,time){const split=gameMode==='split',d=setCarOnTrack(player,.006,split?-1.8:0,0,Math.sin(time*.45)*.025);player2.visible=split;if(split)setCarOnTrack(player2,.006,1.8,0,-Math.sin(time*.45)*.025);const target=d.point.clone().addScaledVector(d.right,9.2).addScaledVector(d.tangent,-6.4);target.y+=4.8;camera.position.lerp(target,1-Math.exp(-dt*2.2));const look=player.position.clone().add(split?player2.position:new THREE.Vector3()).multiplyScalar(split?.5:1);look.y+=.72;camera.lookAt(look);updateBuildingVisibility();ai.forEach(r=>r.mesh.visible=false);}
function updateHUDFor(driver,suffix=''){const id=name=>document.querySelector(`#${name}${suffix}`);id('speed').textContent=Math.round(driver.speed).toString().padStart(3,'0');id('gear').textContent=driver.speed<5?'N':Math.min(8,Math.max(1,Math.ceil(driver.speed/43)));id('boost-value').textContent=Math.round(driver.boost)+'%';id('boost-bar').style.width=driver.boost+'%';id('stage').textContent=String(driver.lap).padStart(2,'0');id('position').textContent=playerPosition(driver);const p=mod(driver.total),next=cornerMarkers.find(c=>c[0]>p)||cornerMarkers[0],distance=next[0]>p?(next[0]-p):(1-p+next[0]);id('checkpoint').textContent=next[1];id('corner-label').textContent=`NEXT CORNER • ${Math.round(distance*TRACK_LENGTH*METERS_PER_UNIT)} M`;if(!suffix&&gameMode==='solo'){const bounds=document.querySelector('.minimap').dataset.bounds.split(',').map(Number),pos=trackPoint(p),dot=document.querySelector('#map-dot');dot.style.left=(8+(pos.x-bounds[0])/(bounds[1]-bounds[0])*42-3)+'px';dot.style.top=(8+(pos.z-bounds[2])/(bounds[3]-bounds[2])*110-3)+'px';dot.style.bottom='auto';}}
function finishRace(winner){state.mode='result';state.paused=false;for(const human of activeHumans())human.speed=0;document.querySelector('#hud').classList.add('hidden');document.querySelector('#hud-p2').classList.add('hidden');document.querySelector('#mobile-controls').classList.add('hidden');document.querySelector('#result').classList.remove('hidden');const mins=Math.floor(winner.elapsed/60),secs=winner.elapsed%60,place=playerPosition(winner),ordinal=place===1?'1ST':place===2?'2ND':place===3?'3RD':`${place}TH`;document.querySelector('#winner-banner').textContent=`${winner===state2?'PLAYER 2':'PLAYER 1'} FINISHES ${ordinal}`;document.querySelector('#final-time').textContent=`${String(mins).padStart(2,'0')}:${secs.toFixed(2).padStart(5,'0')}`;document.querySelector('#top-speed').textContent=Math.round(winner.topSpeed)+' KM/H';document.querySelector('#near-misses').textContent=winner.nearMisses;}

function renderViews(){const width=innerWidth,height=innerHeight;renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);renderer.clear();if(gameMode==='split'&&state.mode==='race'){const half=Math.floor(width/2);renderer.setScissorTest(true);camera.aspect=half/height;camera.updateProjectionMatrix();renderer.setViewport(0,0,half,height);renderer.setScissor(0,0,half,height);renderer.render(scene,camera);camera2.aspect=(width-half)/height;camera2.updateProjectionMatrix();renderer.setViewport(half,0,width-half,height);renderer.setScissor(half,0,width-half,height);renderer.render(scene,camera2);renderer.setScissorTest(false);}else{camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setViewport(0,0,width,height);renderer.render(scene,camera);}}
const clock=new THREE.Clock();function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.033),time=clock.elapsedTime;if(state.mode==='garage')updateGarage(dt,time);else if(state.mode==='race'&&!state.paused){ai.forEach(r=>r.mesh.visible=true);updateHuman(state,player,keys,dt);if(gameMode==='split')updateHuman(state2,player2,keys2,dt);updateHumanCollision();updateAI(dt,time);engineAudio.update(Math.max(state.speed,gameMode==='split'?state2.speed:0),state.boosting||state2.boosting);updateCameraFor(state,camera,dt,true);if(gameMode==='split')updateCameraFor(state2,camera2,dt,false);updateBuildingVisibility();updateParticles(dt);updateHUDFor(state);if(gameMode==='split')updateHUDFor(state2,'-p2');if(state.total>=3||gameMode==='split'&&state2.total>=3)finishRace(state2.total>=3&&state2.total>state.total?state2:state);}sea.material.opacity=.86+Math.sin(time*.7)*.025;renderViews();}animate();

const p1Map={KeyA:'left',KeyD:'right',KeyW:'up',KeyS:'down',Space:'boost',ShiftLeft:'drift'},p2Map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Enter:'boost',ShiftRight:'drift'},soloMap={...p1Map,...p2Map};
function setKey(code,down){const map=gameMode==='split'?(p1Map[code]?p1Map:p2Map):soloMap,key=map[code],target=gameMode==='split'&&p2Map[code]?keys2:keys;if(key){target[key]=down;return true;}return false;}
addEventListener('keydown',e=>{if(setKey(e.code,true))e.preventDefault();if(e.code==='Escape'&&state.mode==='race')togglePause();});addEventListener('keyup',e=>{if(setKey(e.code,false))e.preventDefault();});
document.querySelectorAll('.mode-choice').forEach(btn=>btn.addEventListener('click',()=>{gameMode=btn.dataset.mode;document.querySelectorAll('.mode-choice').forEach(x=>x.classList.toggle('active',x===btn));document.querySelector('#p2-select').classList.toggle('hidden',gameMode!=='split');document.querySelector('#control-hint').innerHTML=gameMode==='split'?'<span>P1</span> WASD + SPACE &nbsp; <span>P2</span> ARROWS + ENTER':'<span>WASD / ARROWS</span> TO DRIVE<br><span>SPACE</span> NITRO &nbsp; <span>SHIFT</span> DRIFT';player2.visible=gameMode==='split';}));
document.querySelectorAll('.car-choice').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.car-choice').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.car=+btn.dataset.car;rebuildPlayer(state.car);}));document.querySelectorAll('[data-p2-car]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-p2-car]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state2.car=+btn.dataset.p2Car;rebuildPlayer2(state2.car);}));
document.querySelector('#start-btn').addEventListener('click',resetRace);document.querySelector('#restart-btn').addEventListener('click',resetRace);function togglePause(){state.paused=!state.paused;document.querySelector('#pause-panel').classList.toggle('hidden',!state.paused);clock.getDelta();}document.querySelector('#pause-btn').addEventListener('click',()=>{if(state.mode==='race')togglePause();});document.querySelector('#resume-btn').addEventListener('click',togglePause);document.querySelector('#sound-btn').addEventListener('click',e=>{const enabled=engineAudio.toggle();e.currentTarget.querySelector('span').textContent=enabled?'ON':'OFF';});document.querySelectorAll('.mobile-controls button').forEach(btn=>{const k=btn.dataset.key,on=e=>{e.preventDefault();keys[k]=true;},off=e=>{e.preventDefault();keys[k]=false;};btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);});addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));});
