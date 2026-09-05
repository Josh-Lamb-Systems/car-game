import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080713);
scene.fog = new THREE.FogExp2(0x15101e, 0.0085);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 600);
camera.position.set(8.5, 4.3, 10.5);

const state = { mode: 'garage', paused: false, car: 0, speed: 0, x: 0, boost: 100, boosting: false, drifting: false, distance: 0, stage: 1, elapsed: 0, topSpeed: 0, nearMisses: 0, shake: 0 };
const keys = { left: false, right: false, up: false, down: false, boost: false, drift: false };
const cars = [
  { name: 'VORTEX R1', primary: 0xd7ff38, secondary: 0x0b0e0e, accent: 0xffffff, max: 338, accel: 72, handling: 7.5 },
  { name: 'PHANTOM GT', primary: 0xf2f0e8, secondary: 0x14151a, accent: 0xff4b18, max: 362, accel: 65, handling: 6.5 },
  { name: 'NEON XR', primary: 0x28dbe8, secondary: 0x151026, accent: 0xd955ff, max: 326, accel: 82, handling: 9.2 },
];

// A lightweight procedural engine note keeps the build asset-free.
const engineAudio = {
  context: null, master: null, low: null, high: null, enabled: true,
  start() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain(); this.master.gain.value = .09; this.master.connect(this.context.destination);
      this.low = this.context.createOscillator(); this.low.type = 'sawtooth';
      this.high = this.context.createOscillator(); this.high.type = 'square';
      const lowGain = this.context.createGain(), highGain = this.context.createGain();
      lowGain.gain.value = .72; highGain.gain.value = .05;
      this.low.connect(lowGain).connect(this.master); this.high.connect(highGain).connect(this.master);
      this.low.start(); this.high.start();
    }
    if (this.context.state === 'suspended') this.context.resume();
  },
  update(speed, boosting) {
    if (!this.context) return;
    const now=this.context.currentTime, rpm=45+speed*1.55;
    this.low.frequency.setTargetAtTime(rpm,now,.06); this.high.frequency.setTargetAtTime(rpm*2.01,now,.05);
    this.master.gain.setTargetAtTime(this.enabled?(boosting?.15:.075):0,now,.08);
  },
  toggle() { this.enabled=!this.enabled; if(this.context)this.master.gain.setTargetAtTime(this.enabled?.08:0,this.context.currentTime,.05); return this.enabled; }
};

const hemi = new THREE.HemisphereLight(0x665f98, 0xff5c27, 1.9);
scene.add(hemi);
const moonLight = new THREE.DirectionalLight(0xb7c7ff, 4.2);
moonLight.position.set(-20, 25, 15); moonLight.castShadow = true; moonLight.shadow.mapSize.set(1024,1024); scene.add(moonLight);
const sunsetLight = new THREE.PointLight(0xff5a24, 180, 130); sunsetLight.position.set(0, 18, -70); scene.add(sunsetLight);

function mat(color, roughness=.55, metalness=.15, emissive=0x000000, intensity=0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: intensity });
}
const roadMat = mat(0x111318, .88, .05); const groundMat = mat(0x24172a, 1, 0); const darkMat = mat(0x080a0d,.45,.55);

// Sunset disc and stylized distant mountains.
const sun = new THREE.Mesh(new THREE.CircleGeometry(11, 64), new THREE.MeshBasicMaterial({ color: 0xff5326, fog: false }));
sun.position.set(-5, 15, -145); scene.add(sun);
const sunGlow = new THREE.Mesh(new THREE.CircleGeometry(17, 64), new THREE.MeshBasicMaterial({ color: 0xff3618, transparent:true, opacity:.12, fog:false, depthWrite:false })); sunGlow.position.copy(sun.position); sunGlow.position.z += .5; scene.add(sunGlow);

function createMountain(seed, x, z, color, scale=1) {
  const pts=[]; for(let i=0;i<15;i++){ const a=(i/14)*Math.PI*2; const r=(i%2?4.5:7.5)*(1+Math.sin(seed+i*7)*.18); pts.push(new THREE.Vector2(Math.cos(a)*r, Math.sin(a)*r)); }
  const geo=new THREE.ConeGeometry(11*scale, 25*scale, 7); const mesh=new THREE.Mesh(geo, mat(color,1,0)); mesh.position.set(x,7*scale,z); mesh.rotation.y=seed; scene.add(mesh); return mesh;
}
for(let i=0;i<18;i++){ const side=i%2?-1:1; createMountain(i*.73, side*(27+(i%5)*10), -55-i*12, i%3?0x1d1428:0x2b1730, 1+(i%4)*.45); }

const track = new THREE.Group(); scene.add(track);
const segments=[]; const SEG=30, SEG_COUNT=16;
function stripeTextureMaterial(color){ return new THREE.MeshBasicMaterial({ color }); }
for(let i=0;i<SEG_COUNT;i++){
  const g=new THREE.Group(); g.position.z=-i*SEG+20;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(180,SEG),groundMat); ground.rotation.x=-Math.PI/2; ground.position.y=-.04; g.add(ground);
  const road=new THREE.Mesh(new THREE.PlaneGeometry(19,SEG),roadMat); road.rotation.x=-Math.PI/2; road.receiveShadow=true; g.add(road);
  [-9.7,9.7].forEach((x,si)=>{ const curb=new THREE.Mesh(new THREE.BoxGeometry(1.35,.12,SEG), stripeTextureMaterial(si?0xd7ff38:0xff4b18)); curb.position.set(x,.06,0); g.add(curb); });
  [-3.2,3.2].forEach(x=>{ for(let z=-12;z<15;z+=7){ const dash=new THREE.Mesh(new THREE.PlaneGeometry(.09,3),new THREE.MeshBasicMaterial({color:0x8e8e93,transparent:true,opacity:.25})); dash.rotation.x=-Math.PI/2; dash.position.set(x,.012,z); g.add(dash); } });
  const center=new THREE.Mesh(new THREE.PlaneGeometry(.06,SEG),new THREE.MeshBasicMaterial({color:0xd7ff38,transparent:true,opacity:.15})); center.rotation.x=-Math.PI/2; center.position.y=.015; g.add(center);
  segments.push(g); track.add(g);
}

function makeLightPole(side,z){ const group=new THREE.Group(); const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,7,8),darkMat); pole.position.y=3.5; group.add(pole); const arm=new THREE.Mesh(new THREE.BoxGeometry(2.1,.06,.06),darkMat); arm.position.set(-side*.95,6.85,0); group.add(arm); const lamp=new THREE.PointLight(side>0?0xd7ff38:0x4acfff,9,18); lamp.position.set(-side*1.85,6.7,0); group.add(lamp); const bulb=new THREE.Mesh(new THREE.BoxGeometry(.7,.06,.18),new THREE.MeshBasicMaterial({color:side>0?0xd7ff38:0x4acfff})); bulb.position.copy(lamp.position); group.add(bulb); group.position.set(side*15,0,z); scene.add(group); return group; }
const poles=[]; for(let i=0;i<18;i++) poles.push(makeLightPole(i%2?1:-1,15-i*24));

function makeBillboard(text,color,z,side){ const c=document.createElement('canvas'); c.width=512;c.height=180;const x=c.getContext('2d');x.fillStyle='#090b10';x.fillRect(0,0,512,180);x.strokeStyle='#343741';x.lineWidth=6;x.strokeRect(3,3,506,174);x.fillStyle=color;x.font='italic 900 76px Arial';x.textAlign='center';x.fillText(text,256,112);x.font='600 18px Arial';x.letterSpacing='8px';x.fillStyle='#fff';x.fillText('CHASE THE LIMIT',256,148);const tex=new THREE.CanvasTexture(c);const mesh=new THREE.Mesh(new THREE.PlaneGeometry(10,3.5),new THREE.MeshBasicMaterial({map:tex}));mesh.position.set(side*20,4,z);mesh.rotation.y=side>0?-.32:.32;scene.add(mesh);return mesh; }
const billboards=[makeBillboard('APEX','#d7ff38',-36,-1),makeBillboard('VELOCITY','#28dbe8',-140,1),makeBillboard('NO LIMITS','#ff4b18',-245,-1)];

function createCar(config, isPlayer=true){
  const car=new THREE.Group(); const bodyMat=mat(config.primary,.28,.55); const secondary=mat(config.secondary,.35,.65); const accent=new THREE.MeshStandardMaterial({color:config.accent,emissive:config.accent,emissiveIntensity:.7});
  const floor=new THREE.Mesh(new THREE.BoxGeometry(2.15,.22,4.7),secondary);floor.position.y=.48;floor.castShadow=true;car.add(floor);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.45,.48,3.65),bodyMat);body.position.set(0,.75,-.05);body.scale.set(1,1,.95);body.castShadow=true;car.add(body);
  const nose=new THREE.Mesh(new THREE.BoxGeometry(.65,.26,2.4),bodyMat);nose.position.set(0,.66,-2.2);nose.castShadow=true;car.add(nose);
  const cockpit=new THREE.Mesh(new THREE.SphereGeometry(.62,16,8,0,Math.PI*2,0,Math.PI/2),secondary);cockpit.scale.set(.9,.65,1.25);cockpit.position.set(0,1.05,.3);car.add(cockpit);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.5,.045,6,20,Math.PI),darkMat);halo.rotation.set(Math.PI/2,0,0);halo.position.set(0,1.22,.08);car.add(halo);
  const frontWing=new THREE.Mesh(new THREE.BoxGeometry(2.85,.1,.45),bodyMat);frontWing.position.set(0,.43,-2.55);car.add(frontWing);
  const rearWing=new THREE.Mesh(new THREE.BoxGeometry(2.35,.16,.42),secondary);rearWing.position.set(0,1.15,1.95);car.add(rearWing);
  const supports=new THREE.Mesh(new THREE.BoxGeometry(.08,.65,.16),secondary);supports.position.set(0,.82,1.9);car.add(supports);
  [[-1.08,.54,-1.55],[1.08,.54,-1.55],[-1.12,.55,1.35],[1.12,.55,1.35]].forEach(([x,y,z])=>{ const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.47,.47,.36,18),darkMat);wheel.rotation.z=Math.PI/2;wheel.position.set(x,y,z);wheel.castShadow=true;car.add(wheel); });
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.16,.018,3.8),accent);stripe.position.set(0,1.005,-.3);car.add(stripe);
  const tail=new THREE.Mesh(new THREE.BoxGeometry(.38,.08,.05),accent);tail.position.set(0,.7,2.37);car.add(tail);
  if(isPlayer){ const glow=new THREE.PointLight(config.primary,7,12);glow.position.set(0,.4,2.4);car.add(glow); }
  car.userData.bodyMat=bodyMat; car.userData.accent=accent; return car;
}

let player=createCar(cars[0]);player.position.set(3,.02,2.5);player.rotation.y=-.22;scene.add(player);
const racers=[];
for(let i=0;i<7;i++){ const c=createCar(cars[(i+1)%3],false); c.scale.setScalar(.88);c.position.set(((i%3)-1)*5.2,.02,-30-i*24);c.rotation.y=Math.PI;scene.add(c);racers.push({mesh:c,lane:c.position.x,speed:150+Math.random()*90,passed:false,phase:Math.random()*5}); }

// Particles for nitro, dust, sparks and speed streaks.
const particles=[];
function particle(color,size=.12){ const m=new THREE.Mesh(new THREE.IcosahedronGeometry(size,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1,depthWrite:false}));scene.add(m);return m; }
function emit(type){ if(particles.length>180){ const old=particles.shift(); scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
  const isBoost=type==='boost', isSmoke=type==='smoke'; const p=particle(isBoost?(Math.random()>.45?0x42dfff:0xd7ff38):(isSmoke?0x9c91a4:0xffba44),isBoost?.1+Math.random()*.13:.08+Math.random()*.18);p.position.copy(player.position);p.position.x+=(Math.random()-.5)*(isSmoke?2.1:.35);p.position.y=.35+Math.random()*.22;p.position.z+=2.3;particles.push({mesh:p,life:1,vel:new THREE.Vector3((Math.random()-.5)*(isSmoke?1.5:.4),isSmoke?.4:0,3+Math.random()*5),type}); }
const streaks=[]; for(let i=0;i<42;i++){ const l=new THREE.Mesh(new THREE.BoxGeometry(.012,.012,1+Math.random()*4),new THREE.MeshBasicMaterial({color:i%3?0xffffff:0xd7ff38,transparent:true,opacity:0}));l.position.set((Math.random()-.5)*42,Math.random()*9,-Math.random()*90);scene.add(l);streaks.push(l); }

const arches=[];
function createArch(z){ const g=new THREE.Group();const m=mat(0x202329,.4,.6);const glow=new THREE.MeshBasicMaterial({color:0xd7ff38});[-11,11].forEach(x=>{const p=new THREE.Mesh(new THREE.BoxGeometry(.35,7,.35),m);p.position.set(x,3.5,0);g.add(p);});const top=new THREE.Mesh(new THREE.BoxGeometry(22.4,.45,.45),m);top.position.y=7;g.add(top);const line=new THREE.Mesh(new THREE.BoxGeometry(21.5,.07,.06),glow);line.position.set(0,6.72,.25);g.add(line);g.position.z=z;scene.add(g);return g;}
for(let i=0;i<4;i++)arches.push(createArch(-90-i*130));

function rebuildPlayer(index){ const oldPos=player.position.clone(); const oldRot=player.rotation.clone(); scene.remove(player); player=createCar(cars[index]);player.position.copy(oldPos);player.rotation.copy(oldRot);scene.add(player); }

function resetRace(){ Object.assign(state,{mode:'race',paused:false,speed:0,x:0,boost:100,boosting:false,drifting:false,distance:0,stage:1,elapsed:0,topSpeed:0,nearMisses:0,shake:0});engineAudio.start();player.position.set(0,.02,2.5);player.rotation.set(0,0,0);racers.forEach((r,i)=>{r.mesh.position.set(((i%3)-1)*5.2,.02,-35-i*26);r.passed=false;});document.querySelector('#garage').classList.add('exit');document.querySelector('#result').classList.add('hidden');document.querySelector('#hud').classList.remove('hidden');if(matchMedia('(pointer: coarse)').matches)document.querySelector('#mobile-controls').classList.remove('hidden');flash('READY');setTimeout(()=>flash('GO!'),800); }

function flash(text){ const el=document.querySelector('#status-message');el.textContent=text;el.classList.remove('show');requestAnimationFrame(()=>el.classList.add('show'));clearTimeout(flash.t);flash.t=setTimeout(()=>el.classList.remove('show'),900); }

const clock=new THREE.Clock();
function update(dt,time){
  const cfg=cars[state.car];
  if(state.mode==='garage'){
    player.rotation.y=-.22+Math.sin(time*.35)*.05;player.position.y=.05+Math.sin(time*1.5)*.025;
    camera.position.x+=(8.5-camera.position.x)*dt*2;camera.position.y+=(4.3-camera.position.y)*dt*2;camera.position.z+=(10.5-camera.position.z)*dt*2;camera.lookAt(1,.7,0);
    racers.forEach(r=>r.mesh.visible=false); return;
  }
  racers.forEach(r=>r.mesh.visible=true); if(state.mode!=='race'||state.paused)return;
  state.elapsed+=dt;
  const accelerating=keys.up || (!keys.down && state.speed<95);
  const targetMax=cfg.max+(keys.boost&&state.boost>0?85:0);
  if(accelerating) state.speed=Math.min(targetMax,state.speed+cfg.accel*dt); else state.speed=Math.max(0,state.speed-38*dt);
  if(keys.down)state.speed=Math.max(0,state.speed-115*dt);
  state.boosting=keys.boost&&state.boost>0&&state.speed>80;
  if(state.boosting){state.boost=Math.max(0,state.boost-26*dt);state.speed=Math.min(targetMax,state.speed+105*dt);state.shake=.16;for(let i=0;i<3;i++)emit('boost');}
  else state.boost=Math.min(100,state.boost+9*dt);
  const steer=(keys.left?-1:0)+(keys.right?1:0);state.drifting=keys.drift&&steer!==0&&state.speed>100;
  const steerRate=cfg.handling*(.42+state.speed/cfg.max*.58)*(state.drifting?1.5:1);state.x+=steer*steerRate*dt;state.x=THREE.MathUtils.clamp(state.x,-11.2,11.2);
  player.position.x+=(state.x-player.position.x)*Math.min(1,dt*8);player.rotation.z+=(steer*(state.drifting?.2:.075)-player.rotation.z)*dt*7;player.rotation.y+=(steer*(state.drifting?-.18:-.055)-player.rotation.y)*dt*6;
  if(state.drifting){state.speed=Math.max(70,state.speed-24*dt);emit('smoke');if(Math.random()>.72)emit('spark');}
  if(Math.abs(state.x)>9.1){state.speed=Math.max(50,state.speed-70*dt);state.shake=.24;if(Math.random()>.45)emit('smoke');}
  const move=state.speed*dt*.105;state.distance+=move;state.topSpeed=Math.max(state.topSpeed,state.speed);
  segments.forEach(s=>{s.position.z+=move;if(s.position.z>35)s.position.z-=SEG*SEG_COUNT;});
  [...poles,...billboards,...arches].forEach(o=>{o.position.z+=move;if(o.position.z>35)o.position.z-=420;});
  racers.forEach((r,i)=>{r.mesh.position.z+=(state.speed-r.speed)*dt*.105;r.mesh.position.x=r.lane+Math.sin(time*.55+r.phase)*.35;r.mesh.rotation.z=Math.sin(time*.55+r.phase)*.018;if(r.mesh.position.z>18){r.mesh.position.z=-190-Math.random()*180;r.lane=(Math.floor(Math.random()*3)-1)*5.2;r.speed=160+Math.random()*125;r.passed=true;}if(r.mesh.position.z<-390){r.mesh.position.z=12;r.passed=false;}const dx=Math.abs(r.mesh.position.x-player.position.x),dz=Math.abs(r.mesh.position.z-player.position.z);if(dz<2.9&&dx<1.75){state.speed*=.55;state.shake=.65;r.mesh.position.x+=player.position.x>r.mesh.position.x?-1.5:1.5;flash('IMPACT');}else if(!r.passed&&dz<3&&dx<3.2){r.passed=true;state.nearMisses++;flash('NEAR MISS +1');}});
  particles.forEach(p=>{p.life-=dt*(p.type==='smoke'?.65:1.5);p.mesh.position.addScaledVector(p.vel,dt);p.mesh.material.opacity=Math.max(0,p.life);p.mesh.scale.setScalar(1+(1-p.life)*(p.type==='smoke'?2.5:.5));});for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0){scene.remove(particles[i].mesh);particles.splice(i,1);}
  streaks.forEach(s=>{s.material.opacity=state.boosting?.15+Math.random()*.35:Math.max(0,(state.speed-220)/800);s.position.z+=move*(state.boosting?2.5:1);if(s.position.z>14){s.position.z=-100-Math.random()*30;s.position.x=(Math.random()-.5)*38;s.position.y=.4+Math.random()*8;}});
  const shake=state.shake;state.shake=Math.max(0,state.shake-dt*1.8);const camTargetX=player.position.x*.48;camera.position.x+=(camTargetX-camera.position.x)*dt*5;camera.position.x+=(Math.random()-.5)*shake;camera.position.y+=(3.4+(state.boosting?.18:0)-camera.position.y)*dt*4;camera.position.z+=(9.2+(state.boosting?1.1:0)-camera.position.z)*dt*4;camera.fov+=( (state.boosting?66:58)-camera.fov)*dt*5;camera.updateProjectionMatrix();camera.lookAt(player.position.x*.38,.6,-5);
  engineAudio.update(state.speed,state.boosting);
  state.stage=Math.min(3,Math.floor(state.distance/1150)+1); if(state.distance>=3450)finishRace();
  updateHUD();
}

function updateHUD(){document.querySelector('#speed').textContent=Math.round(state.speed).toString().padStart(3,'0');document.querySelector('#gear').textContent=state.speed<8?'N':Math.min(8,Math.ceil(state.speed/48));document.querySelector('#boost-value').textContent=Math.round(state.boost)+'%';document.querySelector('#boost-bar').style.width=state.boost+'%';document.querySelector('#stage').textContent=String(state.stage).padStart(2,'0');const remain=Math.max(0,1150-(state.distance%1150));document.querySelector('#checkpoint').textContent=(remain/1000).toFixed(1)+' KM';document.querySelector('#map-dot').style.bottom=(22+(state.distance/3450)*84)+'px';let ahead=0;racers.forEach(r=>{if(r.mesh.position.z<player.position.z)ahead++;});document.querySelector('#position').textContent=Math.min(8,ahead+1);}
function finishRace(){state.mode='result';state.speed=0;document.querySelector('#hud').classList.add('hidden');document.querySelector('#mobile-controls').classList.add('hidden');document.querySelector('#result').classList.remove('hidden');const mins=Math.floor(state.elapsed/60),secs=state.elapsed%60;document.querySelector('#final-time').textContent=`${String(mins).padStart(2,'0')}:${secs.toFixed(2).padStart(5,'0')}`;document.querySelector('#top-speed').textContent=Math.round(state.topSpeed)+' KM/H';document.querySelector('#near-misses').textContent=state.nearMisses;}
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.033);const time=clock.elapsedTime;update(dt,time);renderer.render(scene,camera);}animate();

const keyMap={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Space:'boost',ShiftLeft:'drift',ShiftRight:'drift'};
addEventListener('keydown',e=>{if(keyMap[e.code]){keys[keyMap[e.code]]=true;e.preventDefault();}if(e.code==='Escape'&&state.mode==='race')togglePause();});addEventListener('keyup',e=>{if(keyMap[e.code])keys[keyMap[e.code]]=false;});
document.querySelectorAll('.car-choice').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.car-choice').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.car=+btn.dataset.car;rebuildPlayer(state.car);}));
document.querySelector('#start-btn').addEventListener('click',resetRace);document.querySelector('#restart-btn').addEventListener('click',resetRace);
function togglePause(){state.paused=!state.paused;document.querySelector('#pause-panel').classList.toggle('hidden',!state.paused);clock.getDelta();}document.querySelector('#pause-btn').addEventListener('click',()=>{if(state.mode==='race')togglePause();});document.querySelector('#resume-btn').addEventListener('click',togglePause);
document.querySelector('#sound-btn').addEventListener('click',e=>{const enabled=engineAudio.toggle();e.currentTarget.querySelector('span').textContent=enabled?'ON':'OFF';});
document.querySelectorAll('.mobile-controls button').forEach(btn=>{const k=btn.dataset.key;const on=e=>{e.preventDefault();keys[k]=true;};const off=e=>{e.preventDefault();keys[k]=false;};btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));});
