(() => {
'use strict';

if (!window.Matter) {
  document.body.innerHTML = '<main style="min-height:100vh;background:#111317;color:#fff;display:grid;place-items:center;padding:32px;text-align:center;font:14px ui-monospace,monospace"><div><h2>PHYSICS ENGINE DID NOT LOAD</h2><p>Mechyard needs an internet connection on the first load. Reload while online; the service worker will cache the game afterward.</p></div></main>';
  return;
}

const {Engine, World, Bodies, Body, Constraint, Composite, Events, Query, Vector} = Matter;
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', {alpha:false, desynchronized:true});
const engine = Engine.create({enableSleeping:true, positionIterations:12, velocityIterations:10, constraintIterations:10});
engine.gravity.scale = 0.001;
engine.gravity.y = 1;

const TAU = Math.PI * 2;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const uid = ()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-6);
const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const normAngle = a=>Math.atan2(Math.sin(a),Math.cos(a));
const clone = o=>JSON.parse(JSON.stringify(o ?? {}));
const nowMs = ()=>performance.now();
const rotatePoint = (p,a)=>({x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)});

const state = {
  tool:'select', category:'living', spawnKey:null, selected:null, toolFirst:null,
  camera:{x:0,y:150,zoom:1}, pointers:new Map(), gesture:null, pan:null, drag:null,
  paused:false, timeScale:1, gravity:1, grabStrength:1.75, touchRadius:46,
  showJoints:true, showGrid:true, snap:false, damage:true, sfx:true, music:false,
  map:'yard', followBody:null, history:[], historyIndex:-1, loading:false,
  fps:60, frameTimes:[], lastFrame:performance.now(), worldTime:0, lastPointerWorld:{x:0,y:0},
  currentMod:null, lastRotationBucket:null, dpr:1, longPressTimer:null
};

const special = {
  boundaries:[], waterZones:[], lavaZones:[], pistons:[], sliders:[], livings:new Map(),
  particles:[], grips:new Map(), conveyorContacts:new Map()
};

const jointColors = {
  rope:'#b69f76', steelrope:'#aeb8c2', chain:'#6f7780', fixedrope:'#d5d8dc', rigid:'#768796',
  spring:'#ccd5dd', elastic:'#d8c7a2', suspension:'#87a4b8', pin:'#e2e5e8', weld:'#7c8da0', wire:'#f1db67', winchrope:'#c1a46d'
};

const MAPS = {
  yard:{name:'Build Yard',desc:'Huge flat grid for serious contraptions.',preview:'default',gravity:1,sky:'#758896'},
  endless:{name:'Endless Flat',desc:'Extra-wide floor for giant mechs and vehicles.',preview:'hills',gravity:1,sky:'#78909f'},
  warehouse:{name:'Warehouse',desc:'Roofed test hall with shelves and platforms.',preview:'city',gravity:1,sky:'#515b64'},
  deepwater:{name:'Deep Water',desc:'Working buoyancy, docks and a deep basin.',preview:'water',gravity:1,sky:'#7898ac'},
  ocean:{name:'Endless Ocean',desc:'Very deep water for boats, ballast and submersibles.',preview:'water',gravity:1,sky:'#6f93aa'},
  hills:{name:'Green Hills',desc:'Slopes and valleys for suspension walkers.',preview:'hills',gravity:1,sky:'#7894a4'},
  skate:{name:'Skate Park',desc:'Ramps, bowls and hard launch surfaces.',preview:'skate',gravity:1,sky:'#758797'},
  highway:{name:'Highway',desc:'Long elevated roadway with gaps and barriers.',preview:'city',gravity:1,sky:'#6b7b87'},
  blocks:{name:'Block City',desc:'Static towers, alleys and rooftops.',preview:'city',gravity:1,sky:'#687985'},
  stairs:{name:'Mega Stairs',desc:'Huge steps for leg and suspension testing.',preview:'stairs',gravity:1,sky:'#6f8190'},
  tower:{name:'Vertical Tower',desc:'Tall vertical arena with floating ledges.',preview:'stairs',gravity:1,sky:'#566675'},
  lab:{name:'Test Laboratory',desc:'Rooms, shelves and compact machine test zones.',preview:'tiny',gravity:1,sky:'#5d6872'},
  moon:{name:'Moon',desc:'Low gravity and broken lunar terrain.',preview:'moon',gravity:.18,sky:'#17192b'},
  zero:{name:'Zero-G Chamber',desc:'Weightless enclosed room with anchor plates.',preview:'tiny',gravity:0,sky:'#111827'},
  volcano:{name:'Volcano',desc:'Rock slopes around a damaging lava pool.',preview:'volcano',gravity:1,sky:'#4d3537'},
  desert:{name:'Desert Basin',desc:'Long dunes and a broad center bowl.',preview:'hills',gravity:1,sky:'#927b65'},
  pit:{name:'Machine Pit',desc:'A deep reinforced shaft for destructive testing.',preview:'tiny',gravity:1,sky:'#525d65'}
};

const LIVING_TYPES = {
  melon:{name:'Melon',head:'#78a848',body:'#65923c',blood:'#b84b4b'},
  pumpkin:{name:'Pumpkin',head:'#d18132',body:'#ad6627',blood:'#b84b4b'},
  corn:{name:'Corn',head:'#ddbd4b',body:'#80983d',blood:'#c7b447'},
  apple:{name:'Apple',head:'#bb4f52',body:'#923f43',blood:'#b84b4b'},
  cactus:{name:'Cactus',head:'#5e9d64',body:'#4d8654',blood:'#78b47b'},
  robot:{name:'Robot',head:'#8d949c',body:'#646b73',blood:'#c4cbd2',robot:true},
  dummy:{name:'Test Dummy',head:'#c9a36a',body:'#9b7c50',blood:'#9a7348'},
  heavybot:{name:'Heavy Bot',head:'#4d6978',body:'#324954',blood:'#a9c8d6',robot:true,heavy:true}
};

const spawnDefs = {
  microbeam:{shape:'rect',w:46,h:10,color:'#8995a2',density:.003,name:'Micro Beam',kind:'metal'},
  beam:{shape:'rect',w:90,h:14,color:'#818c98',density:.003,name:'Beam',kind:'metal'},
  longbeam:{shape:'rect',w:180,h:14,color:'#75818e',density:.003,name:'Long Beam',kind:'metal'},
  ultrabeam:{shape:'rect',w:340,h:16,color:'#6d7986',density:.0032,name:'Ultra Beam',kind:'metal'},
  thinrod:{shape:'rect',w:130,h:8,color:'#a9b1ba',density:.0027,name:'Thin Rod',kind:'metal'},
  microblock:{shape:'rect',w:30,h:30,color:'#5d6b7b',density:.0033,name:'Micro Block',kind:'metal'},
  block:{shape:'rect',w:58,h:58,color:'#586879',density:.0034,name:'Block',kind:'metal'},
  bigblock:{shape:'rect',w:110,h:110,color:'#4d5d6f',density:.0036,name:'Large Block',kind:'metal'},
  plate:{shape:'rect',w:92,h:58,color:'#566475',density:.0033,name:'Plate',kind:'metal'},
  thinplate:{shape:'rect',w:120,h:28,color:'#637184',density:.0031,name:'Thin Plate',kind:'metal'},
  longplate:{shape:'rect',w:190,h:56,color:'#536274',density:.0035,name:'Long Plate',kind:'metal'},
  armor:{shape:'rect',w:112,h:70,color:'#343d48',density:.009,name:'Heavy Armor',kind:'metal'},
  superarmor:{shape:'rect',w:150,h:82,color:'#27313b',density:.014,name:'Dense Armor',kind:'metal'},
  wood:{shape:'rect',w:120,h:28,color:'#765a43',density:.0019,name:'Wood Plank',kind:'wood',friction:.75},
  woodblock:{shape:'rect',w:70,h:70,color:'#6f533d',density:.0018,name:'Wood Block',kind:'wood',friction:.78},
  glass:{shape:'rect',w:112,h:58,color:'rgba(173,211,227,.55)',density:.0017,name:'Glass Plate',kind:'glass',friction:.35},
  rubber:{shape:'rect',w:105,h:26,color:'#2f3438',density:.0027,name:'Rubber Bar',kind:'rubber',friction:1.5,restitution:.45},
  ice:{shape:'rect',w:112,h:48,color:'rgba(190,225,238,.64)',density:.002,name:'Ice Block',kind:'glass',friction:.015,restitution:.03},
  concrete:{shape:'rect',w:120,h:70,color:'#676a6d',density:.008,name:'Concrete Block',kind:'stone',friction:.8},
  roundplate:{shape:'circle',r:34,color:'#647486',density:.0033,name:'Round Plate',kind:'metal'},
  smallwheel:{shape:'circle',r:22,color:'#252a30',density:.0038,name:'Small Wheel',kind:'rubber',wheel:true,friction:1.4},
  wheel:{shape:'circle',r:36,color:'#252a30',density:.0038,name:'Wheel',kind:'rubber',wheel:true,friction:1.4},
  bigwheel:{shape:'circle',r:62,color:'#22272c',density:.0042,name:'Large Wheel',kind:'rubber',wheel:true,friction:1.5},
  motorwheel:{shape:'circle',r:38,color:'#2a3036',density:.0045,name:'Motor Wheel',kind:'machine',wheel:true,friction:1.55,poweredType:'motor',active:false,motorSpeed:.24},
  motortire:{shape:'circle',r:64,color:'#20262b',density:.005,name:'Large Motor Wheel',kind:'machine',wheel:true,friction:1.6,poweredType:'motor',active:false,motorSpeed:.18},
  gyro:{shape:'circle',r:28,color:'#3f5968',density:.006,name:'Gyroscope',kind:'machine',poweredType:'gyro',active:true,targetAngle:0,gyroStrength:1.25},
  servo:{shape:'circle',r:26,color:'#545970',density:.006,name:'Servo',kind:'machine',poweredType:'servo',active:true,targetAngle:0,gyroStrength:1.1},
  thruster:{shape:'rect',w:72,h:34,color:'#485b6d',density:.004,name:'Thruster',kind:'machine',poweredType:'thruster',active:false,thrust:1},
  microthruster:{shape:'rect',w:42,h:24,color:'#52687b',density:.0037,name:'Micro Thruster',kind:'machine',poweredType:'thruster',active:false,thrust:.55},
  rotor:{shape:'rect',w:132,h:12,color:'#6f7b86',density:.0028,name:'Rotor',kind:'machine',poweredType:'rotor',active:false,rotorSpeed:.42},
  propeller:{shape:'rect',w:150,h:10,color:'#8a959f',density:.0025,name:'Propeller',kind:'machine',poweredType:'propeller',active:false,thrust:.7,rotorSpeed:.35},
  conveyor:{shape:'rect',w:155,h:28,color:'#3e4a55',density:.006,name:'Conveyor',kind:'machine',poweredType:'conveyor',active:false,conveyorSpeed:1},
  accelerator:{shape:'rect',w:74,h:46,color:'#455d6e',density:.005,name:'Directional Accelerator',kind:'machine',poweredType:'accelerator',active:false,fieldStrength:1},
  button:{shape:'rect',w:48,h:28,color:'#4d5662',density:.004,name:'Toggle Button',kind:'logic',source:true,active:false,button:true},
  lever:{shape:'rect',w:45,h:36,color:'#505965',density:.004,name:'Lever',kind:'logic',source:true,active:false,button:true},
  pressure:{shape:'rect',w:88,h:14,color:'#5d686f',density:.004,name:'Pressure Pad',kind:'logic',source:true,active:false,pressure:true},
  timer:{shape:'rect',w:58,h:40,color:'#4b5766',density:.004,name:'Pulse Timer',kind:'logic',source:true,active:true,timer:true,interval:1200,lastPulse:0},
  sensor:{shape:'circle',r:22,color:'#576775',density:.004,name:'Impact Sensor',kind:'logic',source:true,active:true,sensor:true,lastPulse:0},
  proximity:{shape:'circle',r:22,color:'#495f69',density:.004,name:'Proximity Sensor',kind:'logic',source:true,active:true,proximity:true,range:180,lastPulse:0},
  gravitycore:{shape:'circle',r:30,color:'#394f5b',density:.008,name:'Gravity Core',kind:'machine',poweredType:'gravity',active:false,fieldStrength:1},
  magnet:{shape:'rect',w:62,h:42,color:'#7b4146',density:.005,name:'Magnet',kind:'machine',poweredType:'magnet',active:false,magnet:true,fieldStrength:1},
  repulsor:{shape:'circle',r:30,color:'#4c506c',density:.006,name:'Repulsor',kind:'machine',poweredType:'repulsor',active:false,fieldStrength:1},
  healer:{shape:'rect',w:54,h:54,color:'#49705b',density:.004,name:'Healing Module',kind:'machine',poweredType:'healer',active:false,fieldStrength:1},
  balloon:{shape:'circle',r:32,color:'#779bab',density:.00035,name:'Lift Cell',kind:'utility',balloon:true,lift:1},
  ballast:{shape:'rect',w:54,h:54,color:'#252a2e',density:.03,name:'Ballast',kind:'metal'},
  collider:{shape:'rect',w:110,h:40,color:'rgba(149,162,176,.25)',density:.003,name:'Collider',kind:'utility',colliderOnly:true},
  anchor:{shape:'rect',w:62,h:62,color:'#32373c',density:.02,name:'Anchor Block',kind:'metal',spawnStatic:true},
  winch:{shape:'circle',r:30,color:'#49545e',density:.008,name:'Rope Controller',kind:'machine',poweredType:'winch',active:false,winchSpeed:1.2}
};

const categories = {
  living:[
    ['melon','Melon','Active balance, walking and recovery'],['pumpkin','Pumpkin','Active living with AI'],['corn','Corn','Active living with AI'],['apple','Apple','Active living with AI'],
    ['cactus','Cactus','Active living with AI'],['robot','Robot','Durable mechanical living'],['dummy','Test Dummy','Active physics test living'],['heavybot','Heavy Bot','Heavy active living']
  ],
  blocks:[
    ['microbeam','Micro Beam','Tiny frame member'],['beam','Beam','General frame member'],['longbeam','Long Beam','Long chassis member'],['ultrabeam','Ultra Beam','Very long structural member'],
    ['thinrod','Thin Rod','Brace and linkage'],['microblock','Micro Block','Small square part'],['block','Block','Standard building block'],['bigblock','Large Block','Large rigid block'],
    ['plate','Plate','Medium plate'],['thinplate','Thin Plate','Low-profile plate'],['longplate','Long Plate','Long body panel'],['armor','Heavy Armor','Dense impact plate'],
    ['superarmor','Dense Armor','Extremely heavy panel'],['wood','Wood Plank','Light wood construction'],['woodblock','Wood Block','Light wood block'],['glass','Glass Plate','Light transparent panel'],
    ['rubber','Rubber Bar','High-friction bumper'],['ice','Ice Block','Very low friction'],['concrete','Concrete Block','Very heavy structure'],['roundplate','Round Plate','Circular rigid part']
  ],
  mechanics:[
    ['smallwheel','Small Wheel','Free wheel'],['wheel','Wheel','Free wheel'],['bigwheel','Large Wheel','Heavy free wheel'],['motorwheel','Motor Wheel','Powered wheel'],['motortire','Large Motor Wheel','Heavy powered wheel'],
    ['piston_small','Micro Piston','Short linear actuator'],['piston','Piston','Powered linear actuator'],['piston_long','Long Piston','Long-travel actuator'],['gyro','Gyroscope','Active angle stabilizer'],['servo','Servo','Powered target-angle holder'],
    ['thruster','Thruster','Directional force'],['microthruster','Micro Thruster','Compact directional force'],['rotor','Rotor','Powered spinning bar'],['propeller','Propeller','Powered spinning air prop'],
    ['conveyor','Conveyor','Moves objects across its top'],['accelerator','Directional Accelerator','Pushes nearby objects forward'],['winch','Rope Controller','Drives winch rope length']
  ],
  logic:[
    ['button','Toggle Button','Wire it to machines'],['lever','Lever','Persistent power switch'],['pressure','Pressure Pad','Power while pressed'],['timer','Pulse Timer','Repeated on/off pulses'],
    ['sensor','Impact Sensor','Triggers after hard impacts'],['proximity','Proximity Sensor','Triggers when an object is near'],['gravitycore','Gravity Core','Local attraction field'],['magnet','Magnet','Attracts metal'],
    ['repulsor','Repulsor','Pushes nearby objects'],['healer','Healing Module','Repairs nearby living']
  ],
  vehicles:[
    ['build_mech','Block Mech Frame','Articulated mech made from normal blocks'],['build_titan','Aqua Forge Titan','Large block-built mech inspired by your reference'],['build_rover','Suspension Rover','Block chassis, motor wheels and suspension'],
    ['build_spider','Spider Walker','Six-legged block walker'],['build_crane','Cable Crane','Frame, winch and physical cable'],['build_hover','Hover Platform','Gyro and thruster platform'],
    ['build_sub','Mini Sub','Ballast, propellers and sealed frame'],['build_lift','Piston Lift','Block-built powered lift']
  ],
  ropes:[
    ['tool:rope','Physical Rope','Segmented rope that bends and collides'],['tool:steelrope','Steel Cable','Heavier segmented cable'],['tool:fixedrope','Fixed Rope','Strong tension-only cable'],['tool:slider','Slider Rail','Allows movement along one axis'],['tool:rigid','Rigid Rod','Physical rigid connector'],
    ['tool:spring','Spring','Elastic connection'],['tool:suspension','Suspension','Damped spring connection'],['tool:winchrope','Winch Rope','Retractable line for Rope Controller'],['tool:pin','Pin / Hinge','Single-point rotating joint'],
    ['tool:weld','Weld / Parent','Rigidly locks two objects'],['tool:wire','Activation Wire','Connect buttons to machines']
  ],
  utility:[
    ['balloon','Lift Cell','Continuous upward lift'],['ballast','Ballast','Very heavy compact mass'],['collider','Collider','Collision-only construction part'],['anchor','Anchor Block','Spawns frozen in place'],
    ['glass','Glass Plate','Light transparent panel'],['rubber','Rubber Bar','Impact bumper'],['ice','Ice Block','Low-friction surface'],['concrete','Concrete Block','Heavy structural material']
  ]
};


// Expanded building library: dense size steps so large mechs can be assembled from real parts.
Object.assign(spawnDefs, {
  nanobeam:{shape:'rect',w:28,h:7,color:'#9aa4af',density:.0027,name:'Nano Beam',kind:'metal'},
  shortbeam:{shape:'rect',w:66,h:12,color:'#87929e',density:.0029,name:'Short Beam',kind:'metal'},
  tallbeam:{shape:'rect',w:18,h:150,color:'#77838e',density:.0031,name:'Tall Beam',kind:'metal'},
  megabeam:{shape:'rect',w:520,h:20,color:'#66727f',density:.0033,name:'Mega Beam',kind:'metal'},
  microbrace:{shape:'rect',w:48,h:6,color:'#aab2bb',density:.0023,name:'Micro Brace',kind:'metal'},
  brace:{shape:'rect',w:135,h:9,color:'#919ca7',density:.0028,name:'Brace',kind:'metal'},
  giantbrace:{shape:'rect',w:310,h:10,color:'#75818c',density:.003,name:'Giant Brace',kind:'metal'},
  miniplate:{shape:'rect',w:55,h:36,color:'#687789',density:.0031,name:'Mini Plate',kind:'metal'},
  wideplate:{shape:'rect',w:170,h:78,color:'#4f6071',density:.0038,name:'Wide Plate',kind:'metal'},
  tallplate:{shape:'rect',w:62,h:150,color:'#526273',density:.0038,name:'Tall Plate',kind:'metal'},
  ultrawide:{shape:'rect',w:300,h:72,color:'#48596a',density:.0042,name:'Ultra Wide Plate',kind:'metal'},
  giantplate:{shape:'rect',w:380,h:130,color:'#435262',density:.0048,name:'Giant Plate',kind:'metal'},
  armorstrip:{shape:'rect',w:150,h:18,color:'#303a45',density:.009,name:'Armor Strip',kind:'metal'},
  microarmor:{shape:'rect',w:45,h:28,color:'#39434d',density:.0085,name:'Micro Armor',kind:'metal'},
  armorblock:{shape:'rect',w:72,h:72,color:'#2d3742',density:.012,name:'Armor Block',kind:'metal'},
  ultrarmor:{shape:'rect',w:220,h:96,color:'#202a34',density:.016,name:'Ultra Armor',kind:'metal'},
  jointblock:{shape:'circle',r:18,color:'#707b86',density:.0055,name:'Joint Hub',kind:'metal'},
  smallhub:{shape:'circle',r:12,color:'#8d969f',density:.0045,name:'Small Hub',kind:'metal'},
  bighub:{shape:'circle',r:48,color:'#586573',density:.0065,name:'Large Hub',kind:'metal'},
  spacer:{shape:'rect',w:30,h:14,color:'#a1a8af',density:.0022,name:'Spacer',kind:'metal'},
  frameblock:{shape:'rect',w:78,h:46,color:'#56697a',density:.0037,name:'Frame Block',kind:'metal'},
  rubberblock:{shape:'rect',w:62,h:62,color:'#2b3035',density:.003,name:'Rubber Block',kind:'rubber',friction:1.7,restitution:.5},
  longrubber:{shape:'rect',w:185,h:24,color:'#272d32',density:.003,name:'Long Rubber',kind:'rubber',friction:1.7,restitution:.45},
  lightpanel:{shape:'rect',w:130,h:52,color:'#718292',density:.0012,name:'Light Panel',kind:'metal'},
  heavybar:{shape:'rect',w:170,h:24,color:'#303a44',density:.014,name:'Heavy Bar',kind:'metal'},
  counterweight:{shape:'rect',w:70,h:90,color:'#20262c',density:.028,name:'Counterweight',kind:'metal'},
  glassbeam:{shape:'rect',w:170,h:18,color:'rgba(173,211,227,.55)',density:.0014,name:'Glass Beam',kind:'glass',friction:.3},
  tinywheel:{shape:'circle',r:13,color:'#282d32',density:.0035,name:'Tiny Wheel',kind:'rubber',wheel:true,friction:1.4},
  gear:{shape:'circle',r:27,color:'#5f6872',density:.006,name:'Drive Gear',kind:'machine',wheel:true,friction:1.2,poweredType:'motor',active:false,motorSpeed:.34},
  microgyro:{shape:'circle',r:16,color:'#4d6878',density:.004,name:'Micro Gyro',kind:'machine',poweredType:'gyro',active:true,targetAngle:0,gyroStrength:.8},
  heavygyro:{shape:'circle',r:42,color:'#334b59',density:.013,name:'Heavy Gyro',kind:'machine',poweredType:'gyro',active:true,targetAngle:0,gyroStrength:2.8},
  microservo:{shape:'circle',r:16,color:'#61657c',density:.004,name:'Micro Servo',kind:'machine',poweredType:'servo',active:true,targetAngle:0,gyroStrength:.72},
  booster:{shape:'rect',w:95,h:42,color:'#3f5365',density:.005,name:'Heavy Thruster',kind:'machine',poweredType:'thruster',active:false,thrust:1.8},
  battery:{shape:'rect',w:54,h:36,color:'#4f5b65',density:.005,name:'Battery',kind:'logic',source:true,active:true,battery:true},
  relay:{shape:'rect',w:48,h:34,color:'#3f4b56',density:.004,name:'Relay',kind:'logic',source:true,active:false,relay:true},
  latch:{shape:'rect',w:48,h:34,color:'#444f5c',density:.004,name:'Toggle Relay',kind:'logic',source:true,active:false,button:true}
});

categories.blocks.push(
  ['nanobeam','Nano Beam','Ultra-small bracing'],['shortbeam','Short Beam','Compact frame member'],['tallbeam','Tall Beam','Vertical frame member'],['megabeam','Mega Beam','Huge frame rail'],
  ['microbrace','Micro Brace','Tiny linkage brace'],['brace','Brace','Thin structural brace'],['giantbrace','Giant Brace','Long reinforcement strip'],
  ['miniplate','Mini Plate','Small armor panel'],['wideplate','Wide Plate','Wide chassis plate'],['tallplate','Tall Plate','Tall armor panel'],['ultrawide','Ultra Wide Plate','Very wide body panel'],['giantplate','Giant Plate','Huge mech body plate'],
  ['microarmor','Micro Armor','Tiny dense plate'],['armorstrip','Armor Strip','Dense narrow armor'],['armorblock','Armor Block','Compact dense armor'],['ultrarmor','Ultra Armor','Massive armored panel'],
  ['jointblock','Joint Hub','Circular hinge hub'],['smallhub','Small Hub','Tiny connector hub'],['bighub','Large Hub','Large connector hub'],['spacer','Spacer','Tiny mounting spacer'],
  ['frameblock','Frame Block','Medium structural block'],['rubberblock','Rubber Block','High-friction bumper block'],['longrubber','Long Rubber','Long high-friction bumper'],['lightpanel','Light Panel','Low-mass mech skin'],
  ['heavybar','Heavy Bar','Dense structural bar'],['counterweight','Counterweight','Very dense balance weight'],['glassbeam','Glass Beam','Transparent structural beam']
);
categories.mechanics.push(
  ['tinywheel','Tiny Wheel','Tiny free wheel'],['gear','Drive Gear','Small powered wheel'],['microgyro','Micro Gyro','Compact stabilizer'],['heavygyro','Heavy Gyro','Powerful stabilizer'],
  ['microservo','Micro Servo','Compact angle holder'],['booster','Heavy Thruster','High-force thruster']
);
categories.logic.push(
  ['battery','Battery','Always-on activation source'],['relay','Relay','Signal source / repeater'],['latch','Toggle Relay','Toggleable signal source']
);
categories.ropes.push(
  ['tool:chain','Chain','Heavy segmented articulated chain'],['tool:elastic','Elastic Cord','Soft stretchy physical cord']
);

const FEATURED_MODS = [
  {id:'verity',title:'Verity',author:'Featured Workshop',spawnKey:'mod_verity',rarity:'FEATURED',art:'verity',desc:'Small yellow helper sphere with hovering, active stabilization and high durability.',features:['Hovering','Self-stabilizing','High durability','Original in-game vector art']},
  {id:'verity_monster',title:'Verity Monster',author:'Featured Workshop',spawnKey:'mod_verity_monster',rarity:'FEATURED',art:'monster',desc:'Large articulated yellow living with active balance, long limbs and heavy joints.',features:['Active living','Large articulated body','Recovery AI','High durability']}
];

const WORKSHOP_POOL = [
  ['forge_titan','Aqua Forge Titan','mod_forge_titan','Tall teal-and-gold block mech with a hammer and claw.','mech',['40+ physical blocks','Hinged limbs','Gyro balance','Steel-cable bracing']],
  ['crawler_rig','Crawler Rig','mod_crawler','Six-wheel motorized block chassis.','machine',['Motor wheels','Block chassis','Gyro']],
  ['skyhook','Skyhook Platform','mod_skyhook','Twin-thruster lifting platform with cable hardpoints.','machine',['Thrusters','Gyro','Cable-ready']],
  ['crusher_frame','Crusher Frame','mod_crusher','Heavy frame with twin actuators.','machine',['Pistons','Armor','Powered frame']],
  ['orbital_wheel','Orbital Wheel','mod_orbital','Oversized powered wheel with protected hub.','machine',['Huge wheel','Powered','Heavy duty']],
  ['spider_core','Spider Core','mod_spider','Wide six-legged walker starter.','mech',['Walker','Pin joints','Stable stance']],
  ['cargo_drone','Cargo Drone','mod_drone','Gyro-stabilized twin-thruster cargo platform.','machine',['Hovering','Gyro','Cargo']],
  ['shock_lab','Shock Test Rig','mod_shock','Spring-mounted impact test chassis.','machine',['Suspension','Ballast','Test rig']],
  ['micro_mech','Micro Mech','mod_micro','Compact articulated block mech.','mech',['Block-built','Hinges','Gyro']],
  ['rope_crane','Rope Crane','mod_ropecrane','Tall crane using a real segmented cable.','machine',['Physical cable','Winch','Frame']],
  ['moon_walker','Moon Walker','mod_moonwalker','Long-legged low-gravity walker.','mech',['Walker','Low-gravity ready','Gyro']],
  ['bridge_layer','Bridge Layer','mod_bridge','Motor chassis carrying a hinged bridge deck.','machine',['Hinged bridge','Motor wheels','Block build']],
  ['piston_arm','Piston Arm','mod_pistonarm','Articulated industrial arm with linear actuator.','machine',['Piston','Servo','Pinned arm']],
  ['cable_lift','Cable Lift','mod_cablelift','Platform suspended from multiple steel cables.','machine',['Steel cables','Winch','Lift platform']],
  ['deep_sub','Deep Sub','mod_deepsub','Heavy block-built underwater vehicle.','machine',['Ballast','Propellers','Ocean ready']],
  ['gyro_car','Gyro Car','mod_gyrocar','Fast block car that keeps its chassis level.','machine',['Motor wheels','Gyro','Suspension']],
  ['tower_climber','Tower Climber','mod_climber','Compact gripping machine for vertical maps.','machine',['Magnets','Pistons','Compact']],
  ['factory_cart','Factory Cart','mod_factorycart','Small motor cart with conveyor bed.','machine',['Conveyor','Motor wheels','Cargo']],
  ['quad_hover','Quad Hover','mod_quadhover','Four-thruster stabilized platform.','machine',['4 thrusters','Gyro','Hover']],
  ['heavy_walker','Heavy Walker','mod_heavywalker','Armored two-leg mech frame.','mech',['Armor','Hinged legs','Stabilizers']],
  ['rope_spider','Cable Spider','mod_ropespider','Spider rig with tension-cable reinforcement.','mech',['Six legs','Cables','Wide stance']],
  ['lab_lifter','Lab Lifter','mod_lablifter','Compact piston lift for testing maps.','machine',['Piston','Platform','Anchor base']],
  ['desert_buggy','Desert Buggy','mod_buggy','Long-travel suspension vehicle.','machine',['Suspension','Motor wheels','Light frame']],
  ['block_guard','Block Guard','mod_guard','Broad-shouldered block-built mech.','mech',['Block-built','Active balance','Heavy frame']]
].map(([id,title,spawnKey,desc,art,features])=>({id,title,spawnKey,desc,art,features,author:'Rotating Workshop'}));

const allMods = ()=>[...FEATURED_MODS,...WORKSHOP_POOL];
const installedMods = new Set(JSON.parse(localStorage.getItem('mechyard.installedMods') || '[]'));

function ensurePlugin(b){b.plugin=b.plugin||{};return b.plugin;}
function ensureUid(b){const p=ensurePlugin(b);if(!p.uid)p.uid=uid();return p.uid;}
function bodyByUid(id){return Composite.allBodies(engine.world).find(b=>b.plugin?.uid===id)||null;}
function bodySize(b){const p=b.plugin||{};return {w:p.width||(b.circleRadius?b.circleRadius*2:b.bounds.max.x-b.bounds.min.x),h:p.height||(b.circleRadius?b.circleRadius*2:b.bounds.max.y-b.bounds.min.y)};}
function localPoint(body,world){return Vector.rotate(Vector.sub(world,body.position),-body.angle);}
function worldPoint(body,local){return Vector.add(body.position,Vector.rotate(local,body.angle));}
function toast(msg,type=''){const e=document.createElement('div');e.className='toast '+type;e.textContent=msg;document.getElementById('toastLayer').appendChild(e);setTimeout(()=>e.remove(),1800);}
function snapPoint(p){if(!state.snap)return p;const g=20;return {x:Math.round(p.x/g)*g,y:Math.round(p.y/g)*g};}
function worldToScreen(p){return {x:(p.x-state.camera.x)*state.camera.zoom+canvas.clientWidth/2,y:(p.y-state.camera.y)*state.camera.zoom+canvas.clientHeight/2};}
function screenToWorld(p){return {x:state.camera.x+(p.x-canvas.clientWidth/2)/state.camera.zoom,y:state.camera.y+(p.y-canvas.clientHeight/2)/state.camera.zoom};}
function isWorldScreenPoint(x,y){return document.elementsFromPoint(x,y).some(el=>el===canvas);}

function addBoundaryRect(x,y,w,h,angle=0,color='#363c42',extra={}){
  const b=Bodies.rectangle(x,y,w,h,{isStatic:true,friction:.9,restitution:.02,angle});
  b.plugin={boundary:true,name:'Map',color,...extra,width:w,height:h,shape:'rect'};special.boundaries.push(b);World.add(engine.world,b);return b;
}
function addBoundaryCircle(x,y,r,color='#3a4046',extra={}){
  const b=Bodies.circle(x,y,r,{isStatic:true,friction:.9,restitution:.02});b.plugin={boundary:true,name:'Map',color,...extra,radius:r,shape:'circle'};special.boundaries.push(b);World.add(engine.world,b);return b;
}
function clearMapGeometry(){for(const b of special.boundaries)World.remove(engine.world,b);special.boundaries=[];special.waterZones=[];special.lavaZones=[];}
function setGravity(v){state.gravity=v;engine.gravity.y=v;document.getElementById('gravitySlider').value=v;document.getElementById('gravityValue').textContent=Number(v).toFixed(2);}
function createMap(name,resetGravity=true){
  clearMapGeometry();state.map=MAPS[name]?name:'yard';const m=MAPS[state.map];if(resetGravity)setGravity(m.gravity);
  const ground=(y=620,w=30000)=>addBoundaryRect(0,y,w,90,0,'#34393e');
  switch(state.map){
    case 'yard': ground(620,18000);addBoundaryRect(-880,450,260,22,-.15,'#3b4147');addBoundaryRect(880,450,260,22,.15,'#3b4147');break;
    case 'endless': ground(640,60000);break;
    case 'warehouse':
      ground(640,12000);addBoundaryRect(0,-220,12000,50,0,'#30363b');addBoundaryRect(-1180,210,45,900,0,'#30363b');addBoundaryRect(1180,210,45,900,0,'#30363b');
      [-720,-260,240,720].forEach((x,i)=>{addBoundaryRect(x,430-(i%2)*120,330,26,0,'#41474d');addBoundaryRect(x-145,520-(i%2)*120,18,190,0,'#3b4147');addBoundaryRect(x+145,520-(i%2)*120,18,190,0,'#3b4147');});break;
    case 'deepwater':
      addBoundaryRect(0,1060,5000,90,0,'#313940');addBoundaryRect(-1180,500,1200,45,0,'#3d444a');addBoundaryRect(1180,500,1200,45,0,'#3d444a');special.waterZones.push({x1:-2600,x2:2600,y:300,bottom:1040});break;
    case 'ocean': addBoundaryRect(0,1700,50000,100,0,'#283139');special.waterZones.push({x1:-25000,x2:25000,y:220,bottom:1680});break;
    case 'hills':
      addBoundaryRect(-1200,640,1700,110,-.08,'#445548');addBoundaryRect(300,690,1500,110,.12,'#435447');addBoundaryRect(1550,570,1200,110,-.18,'#45594a');addBoundaryRect(-2450,520,1000,110,.17,'#45594a');break;
    case 'skate':
      ground(680,9000);addBoundaryRect(-900,520,600,35,.35,'#3f454b');addBoundaryRect(900,520,600,35,-.35,'#3f454b');addBoundaryRect(0,560,350,34,0,'#3f454b');addBoundaryRect(-1600,470,500,30,.55,'#3f454b');addBoundaryRect(1600,470,500,30,-.55,'#3f454b');break;
    case 'highway':
      for(let i=-5;i<=5;i++){if(i===0||i===3)continue;addBoundaryRect(i*620,560,560,65,0,'#3b4045');}
      addBoundaryRect(-3600,800,9000,90,0,'#2d3338');break;
    case 'blocks':
      ground(700,12000);[-1500,-1100,-650,-150,350,900,1450].forEach((x,i)=>{const h=250+(i%4)*110;addBoundaryRect(x,660-h/2,300,h,0,['#3b4248','#424a50','#353c42'][i%3]);});break;
    case 'stairs':
      ground(760,10000);for(let i=0;i<10;i++){addBoundaryRect(-1100+i*230,720-i*55,230,70,0,'#3a4046');}for(let i=0;i<14;i++){addBoundaryRect(1200+i*230,720-i*55,230,70,0,'#3a4046');}break;
    case 'tower':
      addBoundaryRect(0,900,2200,80,0,'#32383e');addBoundaryRect(-1040,-1000,55,4000,0,'#30363b');addBoundaryRect(1040,-1000,55,4000,0,'#30363b');
      for(let y=650;y>-2200;y-=320){const side=((Math.abs(y/320)|0)%2)?-1:1;addBoundaryRect(side*520,y,620,35,0,'#41484f');}break;
    case 'lab':
      addBoundaryRect(0,650,2200,70,0,'#353b41');addBoundaryRect(0,-250,2200,50,0,'#353b41');addBoundaryRect(-1080,200,45,900,0,'#353b41');addBoundaryRect(1080,200,45,900,0,'#353b41');
      addBoundaryRect(-420,480,360,26,0,'#424950');addBoundaryRect(430,340,420,26,0,'#424950');addBoundaryRect(0,120,300,24,0,'#424950');break;
    case 'moon':
      addBoundaryRect(-1500,680,1400,110,.08,'#5c5e68');addBoundaryRect(0,730,1700,110,-.06,'#64666f');addBoundaryRect(1750,640,1400,110,.13,'#595c65');addBoundaryCircle(-500,585,90,'#555861');addBoundaryCircle(920,590,120,'#555861');break;
    case 'zero': addBoundaryRect(0,720,2200,55,0,'#343c49');addBoundaryRect(0,-500,2200,55,0,'#343c49');addBoundaryRect(-1080,100,55,1250,0,'#343c49');addBoundaryRect(1080,100,55,1250,0,'#343c49');[-600,0,600].forEach(x=>addBoundaryRect(x,120,160,22,.2*(x/600||0),'#485465'));break;
    case 'volcano':
      addBoundaryRect(-1350,620,1800,100,.18,'#2f3032');addBoundaryRect(1350,620,1800,100,-.18,'#2f3032');addBoundaryRect(0,900,2200,80,0,'#2a2b2d');special.lavaZones.push({x1:-520,x2:520,y:610,bottom:880});break;
    case 'desert':
      addBoundaryRect(-1500,650,1700,100,.10,'#695c4d');addBoundaryRect(0,720,1700,100,-.08,'#695c4d');addBoundaryRect(1600,620,1800,100,.12,'#695c4d');break;
    case 'pit':
      addBoundaryRect(-1100,590,1200,70,0,'#33393f');addBoundaryRect(1100,590,1200,70,0,'#33393f');addBoundaryRect(0,1400,1200,80,0,'#2d3338');addBoundaryRect(-620,980,55,850,0,'#33393f');addBoundaryRect(620,980,55,850,0,'#33393f');break;
  }
  renderMapCards();
}

function makeBody(key,x,y,extra={}){
  const d=spawnDefs[key];if(!d)return null;const opt={density:d.density||.003,friction:d.friction??.55,restitution:d.restitution??.06,frictionAir:d.frictionAir??.01};
  let b=d.shape==='circle'?Bodies.circle(x,y,d.r,opt):Bodies.rectangle(x,y,d.w,d.h,opt);
  b.plugin={uid:uid(),spawnKey:key,name:d.name,color:d.color,kind:d.kind||'part',shape:d.shape,width:d.w,height:d.h,radius:d.r,...clone(d),...clone(extra)};
  if(d.spawnStatic||extra.isStatic){Body.setStatic(b,true);b.plugin.frozen=true;}
  if(extra.angle)Body.setAngle(b,extra.angle);
  if(extra.group!==undefined)b.collisionFilter.group=extra.group;
  World.add(engine.world,b);return b;
}

function makeCustomRect(x,y,w,h,color,meta={},angle=0){
  const b=Bodies.rectangle(x,y,w,h,{density:meta.density||.0035,friction:meta.friction??.65,restitution:meta.restitution??.04,frictionAir:.01});
  b.plugin={uid:uid(),name:meta.name||'Block',color,kind:meta.kind||'metal',shape:'rect',width:w,height:h,...clone(meta)};if(angle)Body.setAngle(b,angle);if(meta.group!==undefined)b.collisionFilter.group=meta.group;World.add(engine.world,b);return b;
}
function makeCustomCircle(x,y,r,color,meta={}){
  const b=Bodies.circle(x,y,r,{density:meta.density||.0038,friction:meta.friction??.7,restitution:meta.restitution??.05,frictionAir:.01});b.plugin={uid:uid(),name:meta.name||'Round Part',color,kind:meta.kind||'metal',shape:'circle',radius:r,...clone(meta)};if(meta.group!==undefined)b.collisionFilter.group=meta.group;World.add(engine.world,b);return b;
}

function addConstraint(a,b,pA={x:0,y:0},pB={x:0,y:0},opt={}){
  const c=Constraint.create({bodyA:a||undefined,bodyB:b||undefined,pointA:pA,pointB:pB,length:opt.length??0,stiffness:opt.stiffness??.8,damping:opt.damping??.08});
  c.plugin={uid:uid(),kind:opt.kind||'joint',visible:opt.visible!==false,color:opt.color||jointColors[opt.kind]||'#d8dde2',...clone(opt.plugin||{})};World.add(engine.world,c);return c;
}
function addConstraintWorld(a,worldA,b,worldB,opt={}){return addConstraint(a,b,a?localPoint(a,worldA):worldA,b?localPoint(b,worldB):worldB,opt);}
function weldBodies(a,b,at){
  const v=Vector.sub(b.position,a.position);const n=Vector.magnitude(v)>1?Vector.normalise({x:-v.y,y:v.x}):{x:0,y:1};const p1=at,p2={x:at.x+n.x*24,y:at.y+n.y*24};
  const c1=addConstraintWorld(a,p1,b,p1,{length:0,stiffness:1,damping:.2,kind:'weld'});const c2=addConstraintWorld(a,p2,b,p2,{length:0,stiffness:1,damping:.2,kind:'weld'});return [c1,c2];
}
function pinBodies(a,b,at,opt={}){return addConstraintWorld(a,at,b,at,{length:0,stiffness:opt.stiffness??.95,damping:opt.damping??.1,kind:opt.kind||'pin'});}

function createPiston(x,y,size='normal',group=0){
  const cfg=size==='small'?{baseW:54,baseH:28,rodW:56,rodH:12,min:12,max:58,speed:1.7}:size==='long'?{baseW:90,baseH:38,rodW:125,rodH:15,min:18,max:170,speed:1.45}:{baseW:72,baseH:34,rodW:82,rodH:14,min:15,max:105,speed:1.6};
  const id=uid();const base=makeCustomRect(x,y,cfg.baseW,cfg.baseH,'#56616c',{name:size==='small'?'Micro Piston':size==='long'?'Long Piston':'Piston',kind:'machine',poweredType:'piston',active:false,pistonId:id,pistonRole:'base',group});
  const rod=makeCustomRect(x+cfg.baseW*.55+cfg.min,y,cfg.rodW,cfg.rodH,'#bac2c9',{name:'Piston Rod',kind:'machine',pistonId:id,pistonRole:'rod',group});
  const p={id,base,rod,min:cfg.min,max:cfg.max,current:cfg.min,speed:cfg.speed};base.plugin.pistonMin=cfg.min;base.plugin.pistonMax=cfg.max;base.plugin.pistonSpeed=cfg.speed;special.pistons.push(p);return base;
}

function ropeSegmentColor(kind){return kind==='chain'?'#6f7780':kind==='steelrope'?'#aab4be':kind==='rope'?'#a38b66':'#c0c6cc';}
function createSegmentedRope(a,worldA,b,worldB,kind='rope'){
  if(!a||!b)return null;const start=worldA,end=worldB;const d=dist(start,end);if(d<12)return null;
  const steel=kind==='steelrope'||kind==='chain';const spacing=kind==='chain'?18:(steel?16:14);const count=clamp(Math.ceil(d/spacing),3,58);const group=-Math.floor(10000+Math.random()*800000);const segs=[];const cons=[];let prev=a,prevPoint=localPoint(a,start);
  const angle=Math.atan2(end.y-start.y,end.x-start.x);const segLen=d/count*.8;
  for(let i=0;i<count;i++){
    const t=(i+.5)/count;const p={x:lerp(start.x,end.x,t),y:lerp(start.y,end.y,t)};
    const s=Bodies.rectangle(p.x,p.y,segLen,kind==='chain'?8:(steel?6:5),{density:kind==='chain'?.006:(steel?.0045:.0017),friction:.7,frictionAir:.01,angle});
    s.collisionFilter.group=group;s.plugin={uid:uid(),name:kind==='chain'?'Chain Link':(steel?'Steel Cable Segment':'Rope Segment'),kind:'ropeSegment',ropeKind:kind,color:ropeSegmentColor(kind),shape:'rect',width:segLen,height:kind==='chain'?8:(steel?6:5),ropeId:group};World.add(engine.world,s);segs.push(s);
    const attachPrev=prev===a?prevPoint:{x:segLen*.5,y:0};const attachCur={x:-segLen*.5,y:0};
    cons.push(addConstraint(prev,s,attachPrev,attachCur,{length:1.5,stiffness:steel?.98:.88,damping:steel?.12:.08,kind,visible:true}));
    prev=s;prevPoint={x:segLen*.5,y:0};
  }
  cons.push(addConstraint(prev,b,{x:segLen*.5,y:0},localPoint(b,end),{length:1.5,stiffness:steel?.98:.88,damping:steel?.12:.08,kind,visible:true}));
  return {segs,cons};
}
function createRigidRod(a,worldA,b,worldB){
  const d=dist(worldA,worldB);if(d<10)return null;const mid={x:(worldA.x+worldB.x)/2,y:(worldA.y+worldB.y)/2};const ang=Math.atan2(worldB.y-worldA.y,worldB.x-worldA.x);const group=-Math.floor(10000+Math.random()*800000);
  const rod=makeCustomRect(mid.x,mid.y,d,10,'#7d8994',{name:'Rigid Link',kind:'metal',density:.003,group,ropeRod:true},ang);rod.collisionFilter.group=group;
  weldBodies(a,rod,worldA);weldBodies(rod,b,worldB);return rod;
}
function createSimpleLink(kind,a,worldA,b,worldB){
  const d=dist(worldA,worldB);if(kind==='fixedrope')return addConstraintWorld(a,worldA,b,worldB,{length:d,stiffness:.995,damping:.05,kind});
  if(kind==='spring')return addConstraintWorld(a,worldA,b,worldB,{length:d,stiffness:.055,damping:.025,kind});
  if(kind==='suspension')return addConstraintWorld(a,worldA,b,worldB,{length:d,stiffness:.14,damping:.22,kind});
  if(kind==='winchrope'){
    const source=a.plugin?.poweredType==='winch'?a:(b.plugin?.poweredType==='winch'?b:null);const c=addConstraintWorld(a,worldA,b,worldB,{length:d,stiffness:.86,damping:.12,kind,plugin:{winchSource:source?ensureUid(source):null,restLength:d}});if(!source)toast('Tip: start or end a Winch Rope on a Rope Controller');return c;
  }
  return null;
}

function livingPart(x,y,w,h,color,group,meta={},shape='rect'){
  let b;if(shape==='circle')b=Bodies.circle(x,y,w/2,{density:meta.density||.0025,friction:.75,restitution:.04,frictionAir:.015});else b=Bodies.rectangle(x,y,w,h,{density:meta.density||.0025,friction:.75,restitution:.04,frictionAir:.015,chamfer:{radius:Math.min(5,w/5,h/5)}});
  b.collisionFilter.group=group;b.plugin={uid:uid(),name:meta.name||'Living',color,kind:'living',livingId:meta.livingId,part:meta.part,shape:shape==='circle'?'circle':'rect',width:w,height:h,radius:shape==='circle'?w/2:undefined,maxHealth:meta.maxHealth||100,health:meta.maxHealth||100,robot:meta.robot||false,monster:meta.monster||false};World.add(engine.world,b);return b;
}
function livingJoint(a,b,world,stiff=.75,len=0){const c=addConstraintWorld(a,world,b,world,{length:len,stiffness:stiff,damping:.12,kind:'livingJoint',visible:false});c.plugin.livingJoint=true;return c;}
function createLiving(type,x,y,scale=1,monster=false){
  const def=LIVING_TYPES[type]||LIVING_TYPES.melon;const id=uid();const group=-Math.floor(1000+Math.random()*900000);const sc=scale*(def.heavy?1.15:1);const mh=def.robot?220:monster?520:130;const headColor=monster?'#d8ca5d':def.head,bodyColor=monster?'#a89f49':def.body;
  const mk=(dx,dy,w,h,color,part,shape='rect')=>livingPart(x+dx*sc,y+dy*sc,w*sc,h*sc,color,group,{livingId:id,part,maxHealth:mh,robot:def.robot,monster},shape);
  const head=mk(0,-95,48,48,headColor,'head','circle');const chest=mk(0,-40,56,75,bodyColor,'chest');const hips=mk(0,13,50,34,bodyColor,'hips');
  const ual=mk(-45,-47,22,60,bodyColor,'upperArmL'),uar=mk(45,-47,22,60,bodyColor,'upperArmR');const fal=mk(-50,-3,19,58,bodyColor,'foreArmL'),far=mk(50,-3,19,58,bodyColor,'foreArmR');
  const handL=mk(-51,32,20,20,headColor,'handL','circle'),handR=mk(51,32,20,20,headColor,'handR','circle');
  const thl=mk(-17,52,25,76,bodyColor,'thighL'),thr=mk(17,52,25,76,bodyColor,'thighR');const shl=mk(-18,108,22,73,bodyColor,'shinL'),shr=mk(18,108,22,73,bodyColor,'shinR');
  const footL=mk(-27,148,48,18,bodyColor,'footL'),footR=mk(27,148,48,18,bodyColor,'footR');
  const parts=[head,chest,hips,ual,uar,fal,far,handL,handR,thl,thr,shl,shr,footL,footR];const joints=[];
  joints.push(livingJoint(head,chest,{x,y:y-74*sc},.86));joints.push(livingJoint(chest,hips,{x,y:y-3*sc},.9));
  joints.push(livingJoint(chest,ual,{x:x-28*sc,y:y-58*sc},.74),livingJoint(chest,uar,{x:x+28*sc,y:y-58*sc},.74));
  joints.push(livingJoint(ual,fal,{x:x-48*sc,y:y-20*sc},.7),livingJoint(uar,far,{x:x+48*sc,y:y-20*sc},.7));
  joints.push(livingJoint(fal,handL,{x:x-51*sc,y:y+23*sc},.72),livingJoint(far,handR,{x:x+51*sc,y:y+23*sc},.72));
  joints.push(livingJoint(hips,thl,{x:x-15*sc,y:y+25*sc},.78),livingJoint(hips,thr,{x:x+15*sc,y:y+25*sc},.78));
  joints.push(livingJoint(thl,shl,{x:x-18*sc,y:y+80*sc},.76),livingJoint(thr,shr,{x:x+18*sc,y:y+80*sc},.76));
  joints.push(livingJoint(shl,footL,{x:x-20*sc,y:y+139*sc},.8),livingJoint(shr,footR,{x:x+20*sc,y:y+139*sc},.8));
  const l={id,type,name:monster?'Verity Monster':def.name,parts,joints,head,chest,hips,ual,uar,fal,far,handL,handR,thl,thr,shl,shr,footL,footR,health:mh,maxHealth:mh,blood:def.blood,robot:def.robot,monster,mode:'wander',brain:true,dead:false,phase:Math.random()*TAU,walkDir:Math.random()<.5?-1:1,nextTurn:nowMs()+2000+Math.random()*3000,nextBlink:nowMs()+700+Math.random()*2500,blinkUntil:0,knockoutUntil:0,drown:0,grips:[]};special.livings.set(id,l);return chest;
}
function createVerity(x,y){const b=makeCustomCircle(x,y,34,'#e8d454',{name:'Verity',kind:'living',hover:true,targetAngle:0,verity:true,maxHealth:420,health:420,density:.0017});return b;}
function livingForBody(b){return b?.plugin?.livingId?special.livings.get(b.plugin.livingId):null;}

function groupBodies(bodies,group){for(const b of bodies)if(b)b.collisionFilter.group=group;return bodies;}
function attachWheel(chassis,wheel,world){pinBodies(chassis,wheel,world,{stiffness:.98,damping:.04});}
function addBrace(a,b,color='#dda62a',thickness=8){
  const pa=a.position,pb=b.position,d=dist(pa,pb),mid={x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2},ang=Math.atan2(pb.y-pa.y,pb.x-pa.x);const br=makeCustomRect(mid.x,mid.y,d,thickness,color,{name:'Brace',kind:'metal',density:.0025,group:a.collisionFilter.group},ang);weldBodies(a,br,{x:lerp(pa.x,pb.x,.25),y:lerp(pa.y,pb.y,.25)});weldBodies(br,b,{x:lerp(pa.x,pb.x,.75),y:lerp(pa.y,pb.y,.75)});return br;
}
function createMechFrame(x,y,variant='frame'){
  const g=-Math.floor(1000+Math.random()*900000);const c=variant==='guard'?'#435c68':'#327984',dark=variant==='guard'?'#26333a':'#17383e',accent='#dc9f25';const parts=[];
  const core=makeCustomRect(x,y,96,120,c,{name:'Mech Torso',kind:'machine',group:g,stabilizer:variant==='guard'?2:1.5,targetAngle:0,density:.007});
  const chest=makeCustomRect(x,y-18,68,100,dark,{name:'Chest Armor',kind:'metal',group:g,density:.009});weldBodies(core,chest,{x,y:y-20});parts.push(core,chest);
  const head=makeCustomRect(x,y-112,72,54,c,{name:'Mech Head',kind:'metal',group:g,density:.005});const visor=makeCustomRect(x+13,y-117,48,18,'#e9f7fb',{name:'Visor',kind:'glass',group:g,density:.001});weldBodies(head,visor,{x:x+13,y:y-117});pinBodies(core,head,{x,y:y-75});parts.push(head,visor);
  const hips=makeCustomRect(x,y+82,86,42,dark,{name:'Mech Hips',kind:'machine',group:g,stabilizer:.55,targetAngle:0,density:.008});pinBodies(core,hips,{x,y:y+58});parts.push(hips);
  const shoulderL=makeCustomRect(x-68,y-48,44,72,c,{name:'Shoulder L',kind:'metal',group:g,density:.007}),shoulderR=makeCustomRect(x+68,y-48,44,72,c,{name:'Shoulder R',kind:'metal',group:g,density:.007});pinBodies(core,shoulderL,{x:x-48,y:y-52});pinBodies(core,shoulderR,{x:x+48,y:y-52});parts.push(shoulderL,shoulderR);
  const foreL=makeCustomRect(x-72,y+12,38,86,dark,{name:'Forearm L',kind:'metal',group:g,density:.007}),foreR=makeCustomRect(x+72,y+12,38,86,dark,{name:'Forearm R',kind:'metal',group:g,density:.007});pinBodies(shoulderL,foreL,{x:x-70,y:y-10});pinBodies(shoulderR,foreR,{x:x+70,y:y-10});parts.push(foreL,foreR);
  const clawL=makeCustomRect(x-86,y+64,44,18,c,{name:'Claw L',kind:'metal',group:g,density:.005},-.3),clawR=makeCustomRect(x+86,y+64,44,18,c,{name:'Claw R',kind:'metal',group:g,density:.005},.3);pinBodies(foreL,clawL,{x:x-74,y:y+52});pinBodies(foreR,clawR,{x:x+74,y:y+52});parts.push(clawL,clawR);
  const thighL=makeCustomRect(x-31,y+147,42,105,c,{name:'Thigh L',kind:'machine',group:g,stabilizer:.35,targetAngle:0,density:.008}),thighR=makeCustomRect(x+31,y+147,42,105,c,{name:'Thigh R',kind:'machine',group:g,stabilizer:.35,targetAngle:0,density:.008});pinBodies(hips,thighL,{x:x-25,y:y+101});pinBodies(hips,thighR,{x:x+25,y:y+101});parts.push(thighL,thighR);
  const shinL=makeCustomRect(x-34,y+245,46,116,dark,{name:'Shin L',kind:'machine',group:g,stabilizer:.22,targetAngle:0,density:.009}),shinR=makeCustomRect(x+34,y+245,46,116,dark,{name:'Shin R',kind:'machine',group:g,stabilizer:.22,targetAngle:0,density:.009});pinBodies(thighL,shinL,{x:x-32,y:y+196});pinBodies(thighR,shinR,{x:x+32,y:y+196});parts.push(shinL,shinR);
  const footL=makeCustomRect(x-49,y+315,82,28,c,{name:'Foot L',kind:'metal',group:g,density:.012,friction:1.6}),footR=makeCustomRect(x+49,y+315,82,28,c,{name:'Foot R',kind:'metal',group:g,density:.012,friction:1.6});pinBodies(shinL,footL,{x:x-34,y:y+298});pinBodies(shinR,footR,{x:x+34,y:y+298});parts.push(footL,footR);
  [thighL,thighR,shinL,shinR].forEach((p,i)=>{const br=makeCustomRect(p.position.x+(i%2?-12:12),p.position.y,8,Math.max(70,bodySize(p).h*.75),accent,{name:'Gold Brace',kind:'metal',group:g,density:.0024});weldBodies(p,br,p.position);parts.push(br);});
  return {root:core,parts,group:g,hands:[clawL,clawR]};
}
function createAquaForgeTitan(x,y){
  const g=-Math.floor(1000+Math.random()*900000), teal='#24777c', teal2='#2e8b91', dark='#12383e', dark2='#0b2d32', gold='#e1a52b', white='#eaf8fa';
  const root=makeCustomRect(x,y-25,118,145,teal,{name:'Aqua Forge Titan Torso',kind:'machine',group:g,density:.008,stabilizer:3.2,targetAngle:0});
  const chest=makeCustomRect(x+4,y-22,84,116,dark,{name:'Titan Chest Core',kind:'metal',group:g,density:.011});weldBodies(root,chest,{x:x,y:y-20});
  for(const sx of [-1,1]){
    const p1=makeCustomRect(x+sx*48,y-64,42,54,teal2,{name:'Shoulder Layer',kind:'metal',group:g,density:.006},sx*.14);weldBodies(root,p1,p1.position);
    const p2=makeCustomRect(x+sx*63,y-49,50,28,dark2,{name:'Shoulder Armor',kind:'metal',group:g,density:.009},sx*.25);weldBodies(root,p2,p2.position);
    const rib=makeCustomRect(x+sx*37,y+10,15,110,gold,{name:'Gold Torso Brace',kind:'metal',group:g,density:.004},sx*.06);weldBodies(root,rib,rib.position);
  }
  const neck=makeCustomRect(x,y-116,44,32,dark,{name:'Titan Neck',kind:'metal',group:g,density:.006});pinBodies(root,neck,{x,y:y-93});
  const head=makeCustomRect(x+5,y-160,76,62,teal2,{name:'Titan Head',kind:'metal',group:g,density:.006},.03);pinBodies(neck,head,{x,y:y-132});
  const jaw=makeCustomRect(x+4,y-134,70,25,dark,{name:'Titan Jaw',kind:'metal',group:g,density:.007});weldBodies(head,jaw,jaw.position);
  const visor=makeCustomRect(x+19,y-163,50,22,white,{name:'Titan Visor',kind:'glass',group:g,density:.001});weldBodies(head,visor,visor.position);
  const brow=makeCustomRect(x+4,y-182,72,12,dark2,{name:'Titan Brow',kind:'metal',group:g,density:.006});weldBodies(head,brow,brow.position);
  const hips=makeCustomRect(x,y+78,104,42,dark,{name:'Titan Hips',kind:'machine',group:g,density:.011,stabilizer:1.1,targetAngle:0});pinBodies(root,hips,{x,y:y+52});
  const core=makeCustomCircle(x-2,y+13,15,'#d4df4b',{name:'Titan Core',kind:'machine',group:g,density:.004,stabilizer:3.5,targetAngle:0});weldBodies(root,core,core.position);
  const armData=[];
  for(const sx of [-1,1]){
    const shoulder=makeCustomRect(x+sx*82,y-58,48,80,teal,{name:'Titan Upper Arm',kind:'metal',group:g,density:.008},sx*.1);pinBodies(root,shoulder,{x:x+sx*57,y:y-63});
    const shoulderCap=makeCustomRect(x+sx*94,y-78,60,28,dark,{name:'Titan Shoulder Cap',kind:'metal',group:g,density:.01},sx*.22);weldBodies(shoulder,shoulderCap,shoulderCap.position);
    const upperBrace=makeCustomRect(x+sx*82,y-55,10,64,gold,{name:'Arm Gold Brace',kind:'metal',group:g,density:.003});weldBodies(shoulder,upperBrace,upperBrace.position);
    const fore=makeCustomRect(x+sx*90,y+15,56,105,dark,{name:'Titan Forearm',kind:'metal',group:g,density:.011},sx*.04);pinBodies(shoulder,fore,{x:x+sx*87,y:y-15});
    const forePlate=makeCustomRect(x+sx*104,y+12,36,94,teal2,{name:'Forearm Plate',kind:'metal',group:g,density:.007},sx*.05);weldBodies(fore,forePlate,forePlate.position);
    const foreBrace=makeCustomRect(x+sx*88,y+18,10,84,gold,{name:'Forearm Gold Brace',kind:'metal',group:g,density:.003});weldBodies(fore,foreBrace,foreBrace.position);
    const wrist=makeCustomRect(x+sx*94,y+79,42,28,teal,{name:'Titan Wrist',kind:'metal',group:g,density:.007});pinBodies(fore,wrist,{x:x+sx*92,y:y+65});
    armData.push({sx,shoulder,fore,wrist});
  }
  const legs=[];
  for(const sx of [-1,1]){
    const hipPlate=makeCustomRect(x+sx*39,y+98,54,60,teal2,{name:'Hip Armor',kind:'metal',group:g,density:.009},sx*.05);pinBodies(hips,hipPlate,{x:x+sx*32,y:y+91});
    const thigh=makeCustomRect(x+sx*43,y+160,58,120,teal,{name:'Titan Thigh',kind:'machine',group:g,density:.011,stabilizer:.55,targetAngle:0},sx*.03);pinBodies(hipPlate,thigh,{x:x+sx*41,y:y+120});
    const thighInner=makeCustomRect(x+sx*28,y+160,24,103,dark,{name:'Thigh Inner Armor',kind:'metal',group:g,density:.009});weldBodies(thigh,thighInner,thighInner.position);
    const thighBrace=makeCustomRect(x+sx*48,y+160,10,94,gold,{name:'Thigh Gold Brace',kind:'metal',group:g,density:.003});weldBodies(thigh,thighBrace,thighBrace.position);
    const knee=makeCustomCircle(x+sx*44,y+226,18,gold,{name:'Titan Knee',kind:'metal',group:g,density:.008});pinBodies(thigh,knee,{x:x+sx*43,y:y+218});
    const shin=makeCustomRect(x+sx*46,y+292,66,132,dark,{name:'Titan Shin',kind:'machine',group:g,density:.013,stabilizer:.36,targetAngle:0},sx*.02);pinBodies(knee,shin,{x:x+sx*45,y:y+239});
    const shinPlate=makeCustomRect(x+sx*53,y+286,42,116,teal2,{name:'Shin Armor',kind:'metal',group:g,density:.009},sx*.03);weldBodies(shin,shinPlate,shinPlate.position);
    for(let k=-1;k<=2;k++){const ring=makeCustomRect(x+sx*48,y+270+k*19,48,7,gold,{name:'Shin Band',kind:'metal',group:g,density:.002});weldBodies(shin,ring,ring.position);}
    const ankle=makeCustomRect(x+sx*49,y+360,56,34,dark2,{name:'Titan Ankle',kind:'metal',group:g,density:.01});pinBodies(shin,ankle,{x:x+sx*47,y:y+350});
    const foot=makeCustomRect(x+sx*62,y+391,100,34,teal,{name:'Titan Foot',kind:'metal',group:g,density:.015,friction:1.8});pinBodies(ankle,foot,{x:x+sx*49,y:y+376});
    const toe=makeCustomRect(x+sx*88,y+390,46,30,teal2,{name:'Titan Toe',kind:'metal',group:g,density:.009});weldBodies(foot,toe,toe.position);
    legs.push({sx,thigh,knee,shin,ankle,foot});
  }
  const left=armData[0], right=armData[1];
  const hammerShaft=makeCustomRect(x-146,y-118,14,224,gold,{name:'Titan Hammer Shaft',kind:'metal',group:g,density:.007},.19);
  const hammerHead=makeCustomCircle(x-167,y-226,42,'#7e858b',{name:'Titan Hammer Head',kind:'metal',group:g,density:.019});
  const hammerFace=makeCustomRect(x-167,y-226,72,24,'#626a72',{name:'Hammer Face',kind:'metal',group:g,density:.012},.19);weldBodies(hammerShaft,hammerHead,hammerHead.position);weldBodies(hammerHead,hammerFace,hammerFace.position);weldBodies(left.wrist,hammerShaft,{x:x-127,y:y-61});
  const palm=makeCustomRect(x+120,y+93,46,34,teal2,{name:'Titan Claw Palm',kind:'metal',group:g,density:.008});weldBodies(right.wrist,palm,{x:x+104,y:y+84});
  for(const off of [-19,0,19]){const finger=makeCustomRect(x+132+off*.55,y+128,12,58,gold,{name:'Titan Claw Finger',kind:'metal',group:g,density:.005},.45+off*.008);pinBodies(palm,finger,{x:x+121+off*.45,y:y+108});}
  const backA=makeCustomRect(x-72,y-9,42,170,dark2,{name:'Back Spine',kind:'metal',group:g,density:.012},.12);weldBodies(root,backA,backA.position);
  const backB=makeCustomRect(x-93,y+8,32,124,teal,{name:'Back Armor',kind:'metal',group:g,density:.01},.16);weldBodies(root,backB,backB.position);
  const cableAnchorL=makeCustomCircle(x-46,y+39,9,gold,{name:'Cable Mount',kind:'metal',group:g,density:.004});const cableAnchorR=makeCustomCircle(x+46,y+39,9,gold,{name:'Cable Mount',kind:'metal',group:g,density:.004});weldBodies(root,cableAnchorL,cableAnchorL.position);weldBodies(root,cableAnchorR,cableAnchorR.position);
  createSegmentedRope(root,cableAnchorL.position,legs[0].shin,{x:legs[0].shin.position.x-4,y:legs[0].shin.position.y-35},'steelrope');
  createSegmentedRope(root,cableAnchorR.position,legs[1].shin,{x:legs[1].shin.position.x+4,y:legs[1].shin.position.y-35},'steelrope');
  createSimpleLink('fixedrope',root,{x:x-54,y:y+44},left.fore,{x:left.fore.position.x,y:left.fore.position.y+30});
  createSimpleLink('fixedrope',root,{x:x+54,y:y+44},right.fore,{x:right.fore.position.x,y:right.fore.position.y+30});
  return root;
}
function createRover(x,y,buggy=false){
  const g=-Math.floor(1000+Math.random()*900000);const frame=makeCustomRect(x,y,270,34,buggy?'#6f6848':'#4b5d70',{name:buggy?'Desert Buggy':'Suspension Rover',kind:'machine',group:g,density:.007,stabilizer:.7,targetAngle:0});
  const cab=makeCustomRect(x+35,y-43,96,54,'#314450',{name:'Cab',kind:'metal',group:g,density:.004});weldBodies(frame,cab,{x:x+35,y:y-18});
  for(const dx of [-96,96]){const w=makeBody('motorwheel',x+dx,y+60,{name:'Rover Motor Wheel'});w.collisionFilter.group=g;w.plugin.motorSpeed=dx<0?.23:.23;addConstraintWorld(frame,{x:x+dx,y:y+5},w,w.position,{length:55,stiffness:buggy?.11:.18,damping:.24,kind:'suspension'});}
  return frame;
}
function createSpiderWalker(x,y,cabled=false){
  const g=-Math.floor(1000+Math.random()*900000);const core=makeCustomRect(x,y,150,58,'#435b68',{name:cabled?'Cable Spider':'Spider Walker',kind:'machine',group:g,density:.008,stabilizer:1.9,targetAngle:0});
  for(let i=0;i<3;i++)for(const s of [-1,1]){const sx=s*(82+i*16),sy=-18+i*20;const upper=makeCustomRect(x+sx,y+sy+45,22,100,'#34505b',{name:'Spider Leg',kind:'metal',group:g,density:.006},s*(.45+i*.12));const lower=makeCustomRect(x+sx+s*55,y+sy+115,20,100,'#243c45',{name:'Spider Shin',kind:'metal',group:g,density:.006},s*(.7-i*.08));pinBodies(core,upper,{x:x+s*70,y:y+sy});pinBodies(upper,lower,{x:x+sx+s*30,y:y+sy+85});if(cabled)createSimpleLink('fixedrope',core,{x:x+s*50,y:y+sy},lower,{x:x+sx+s*55,y:y+sy+115});}
  return core;
}
function createCrane(x,y){
  const g=-Math.floor(1000+Math.random()*900000);const base=makeCustomRect(x,y,260,48,'#3e4a55',{name:'Cable Crane Base',kind:'machine',group:g,density:.012});const mast=makeCustomRect(x,y-145,28,300,'#54616c',{name:'Crane Mast',kind:'metal',group:g,density:.006});weldBodies(base,mast,{x,y:y-15});const arm=makeCustomRect(x+135,y-285,300,26,'#65717c',{name:'Crane Arm',kind:'metal',group:g,density:.005},-.05);weldBodies(mast,arm,{x:x+20,y:y-275});const winch=makeBody('winch',x+40,y-260,{group:g});winch.collisionFilter.group=g;weldBodies(arm,winch,{x:x+40,y:y-260});const hook=makeCustomRect(x+250,y-50,24,32,'#7b8085',{name:'Hook Weight',kind:'metal',group:g,density:.012});const c=createSimpleLink('winchrope',winch,winch.position,hook,hook.position);if(c)c.plugin.winchSource=ensureUid(winch);return base;
}
function createHover(x,y,quad=false){
  const g=-Math.floor(1000+Math.random()*900000);const plat=makeCustomRect(x,y,240,36,'#445a68',{name:quad?'Quad Hover':'Hover Platform',kind:'machine',group:g,density:.006,stabilizer:2.2,targetAngle:0});const offsets=quad?[-90,-30,30,90]:[-80,80];for(const dx of offsets){const t=makeBody('thruster',x+dx,y+38,{group:g,active:true,thrust:quad?.45:.75});t.collisionFilter.group=g;Body.rotate(t,-Math.PI/2);t.plugin.active=true;weldBodies(plat,t,{x:x+dx,y:y+22});}return plat;
}
function createSub(x,y){
  const g=-Math.floor(1000+Math.random()*900000);const hull=makeCustomRect(x,y,280,92,'#354a56',{name:'Deep Sub',kind:'machine',group:g,density:.009});const glass=makeCustomCircle(x-50,y-10,30,'rgba(150,205,225,.7)',{name:'Viewport',kind:'glass',group:g,density:.002});weldBodies(hull,glass,glass.position);const ball=makeBody('ballast',x+40,y+22,{group:g});ball.collisionFilter.group=g;weldBodies(hull,ball,ball.position);const p=makeBody('propeller',x-165,y,{group:g,active:true,thrust:.9});p.collisionFilter.group=g;p.plugin.active=true;weldBodies(hull,p,{x:x-140,y});return hull;
}
function createPistonLift(x,y){const base=makeCustomRect(x,y+120,240,40,'#363e46',{name:'Lift Base',kind:'metal',density:.015,isStatic:true});Body.setStatic(base,true);base.plugin.frozen=true;const p=createPiston(x,y+70,'long');Body.rotate(p,-Math.PI/2);const rod=special.pistons[special.pistons.length-1].rod;Body.rotate(rod,-Math.PI/2);weldBodies(base,p,{x,y:y+100});const plat=makeCustomRect(x,y-60,240,34,'#596674',{name:'Lift Platform',kind:'metal',density:.008});weldBodies(rod,plat,{x,y:y-45});return p;}
function createCrusher(x,y){const base=makeCustomRect(x,y+100,260,45,'#353d45',{name:'Crusher Base',kind:'metal',density:.014});const l=createPiston(x-80,y,'long'),r=createPiston(x+80,y,'long');Body.rotate(l,-Math.PI/2);Body.rotate(r,-Math.PI/2);const lp=special.pistons.find(p=>p.base===l),rp=special.pistons.find(p=>p.base===r);Body.rotate(lp.rod,-Math.PI/2);Body.rotate(rp.rod,-Math.PI/2);weldBodies(base,l,{x:x-80,y:y+75});weldBodies(base,r,{x:x+80,y:y+75});const top=makeCustomRect(x,y-110,250,36,'#59636e',{name:'Crusher Plate',kind:'metal',density:.015});weldBodies(lp.rod,top,{x:x-80,y:y-95});weldBodies(rp.rod,top,{x:x+80,y:y-95});return base;}
function createFactoryCart(x,y){const root=createRover(x,y,false);const conv=makeBody('conveyor',x,y-40,{active:true});conv.plugin.active=true;weldBodies(root,conv,{x,y:y-20});return root;}

function spawnWorkshopMachine(key,x,y){
  switch(key){
    case 'mod_verity': return createVerity(x,y);
    case 'mod_verity_monster': return createLiving('melon',x,y,1.45,true);
    case 'mod_forge_titan': return createAquaForgeTitan(x,y-120);
    case 'mod_crawler': case 'mod_gyrocar': return createRover(x,y,key==='mod_gyrocar');
    case 'mod_spider': return createSpiderWalker(x,y);case 'mod_ropespider': return createSpiderWalker(x,y,true);
    case 'mod_skyhook': case 'mod_drone': case 'mod_quadhover': return createHover(x,y,key==='mod_quadhover');
    case 'mod_crusher': return createCrusher(x,y);case 'mod_ropecrane': case 'mod_cablelift': return createCrane(x,y);
    case 'mod_deepsub': return createSub(x,y);case 'mod_factorycart': return createFactoryCart(x,y);
    case 'mod_micro': case 'mod_guard': case 'mod_moonwalker': case 'mod_heavywalker': return createMechFrame(x,y-80,key==='mod_guard'||key==='mod_heavywalker'?'guard':'frame').root;
    case 'mod_pistonarm': case 'mod_lablifter': return createPistonLift(x,y);
    case 'mod_buggy': case 'mod_bridge': case 'mod_climber': return createRover(x,y,true);
    case 'mod_orbital': {const hub=makeCustomCircle(x,y,42,'#4e5964',{name:'Orbital Hub',kind:'machine',density:.01,stabilizer:1.3,targetAngle:0});const w=makeBody('motortire',x,y,{active:true});w.plugin.active=true;pinBodies(hub,w,{x,y});return hub;}
    case 'mod_shock': {const f=makeCustomRect(x,y,260,36,'#46525d',{name:'Shock Rig',kind:'machine',density:.008});for(const dx of [-90,90]){const w=makeBody('wheel',x+dx,y+70);addConstraintWorld(f,{x:x+dx,y:y+8},w,w.position,{length:62,stiffness:.08,damping:.28,kind:'suspension'});}return f;}
    default: return createMechFrame(x,y-60,'frame').root;
  }
}

function spawnPart(key,x,y,silent=false){
  const p=snapPoint({x,y});x=p.x;y=p.y;let b=null;
  if(LIVING_TYPES[key])b=createLiving(key,x,y-30,1,false);
  else if(key==='piston_small')b=createPiston(x,y,'small');else if(key==='piston')b=createPiston(x,y,'normal');else if(key==='piston_long')b=createPiston(x,y,'long');
  else if(key==='build_mech')b=createMechFrame(x,y-80).root;else if(key==='build_titan')b=createAquaForgeTitan(x,y-120);else if(key==='build_rover')b=createRover(x,y);else if(key==='build_spider')b=createSpiderWalker(x,y);else if(key==='build_crane')b=createCrane(x,y);else if(key==='build_hover')b=createHover(x,y);else if(key==='build_sub')b=createSub(x,y);else if(key==='build_lift')b=createPistonLift(x,y);
  else if(key.startsWith('mod_'))b=spawnWorkshopMachine(key,x,y);else b=makeBody(key,x,y);
  if(b&&!silent){selectBody(b);recordHistory();sfx('place');}return b;
}

function resolveRoot(b){if(!b)return null;if(b.plugin?.pistonId){const p=special.pistons.find(x=>x.id===b.plugin.pistonId);return p?.base||b;}return b;}
function getBodyAt(world){
  const bodies=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary&&!b.plugin?.backgroundAnchor);
  let found=Query.point(bodies,world).sort((a,b)=>(b.plugin?.z||0)-(a.plugin?.z||0))[0];if(found)return found;
  const r=state.touchRadius/state.camera.zoom;let best=null,bestD=Infinity;
  for(const b of bodies){const d=dist(world,b.position);if(d<r&&d<bestD){best=b;bestD=d;}}return best;
}
function selectBody(b){state.selected=b||null;updateSelectionUI();}
function freezeBody(b){if(!b||b.plugin?.boundary)return;pushPreAction();Body.setStatic(b,!b.isStatic);b.plugin.frozen=b.isStatic;recordHistory();updateSelectionUI();sfx('toggle');toast(b.isStatic?'Frozen':'Unfrozen');}
function toggleCollision(b){if(!b)return;pushPreAction();b.plugin.noCollide=!b.plugin.noCollide;b.collisionFilter.mask=b.plugin.noCollide?0:0xFFFFFFFF;recordHistory();toast(b.plugin.noCollide?'Collision disabled':'Collision enabled');updateSelectionUI();}
function toggleGravity(b){if(!b)return;pushPreAction();b.plugin.noGravity=!b.plugin.noGravity;recordHistory();toast(b.plugin.noGravity?'Gravity disabled':'Gravity enabled');}
function toggleRotationLock(b){if(!b)return;pushPreAction();b.plugin.rotationLock=!b.plugin.rotationLock;b.plugin.lockAngle=b.angle;recordHistory();toast(b.plugin.rotationLock?'Rotation locked':'Rotation unlocked');}
function rotateBody(b,d){if(!b)return;pushPreAction();Body.rotate(b,d);if(b.plugin?.targetAngle!==undefined)b.plugin.targetAngle=normAngle((b.plugin.targetAngle||0)+d);recordHistory();}
function scaleBody(b,f){if(!b)return;if(b.plugin?.pistonId||b.plugin?.livingId){toast('Resize the individual building parts instead','bad');return;}pushPreAction();Body.scale(b,f,f);const p=b.plugin||{};if(p.width)p.width*=f;if(p.height)p.height*=f;if(p.radius)p.radius*=f;recordHistory();updateSelectionUI();}
function flipBody(b){if(!b)return;pushPreAction();Body.scale(b,-1,1);b.plugin.flipped=!b.plugin.flipped;recordHistory();}
function setLayer(b,dir){if(!b)return;pushPreAction();b.plugin.z=(b.plugin.z||0)+dir*10;recordHistory();}
function duplicateBody(b){
  if(!b)return;const l=livingForBody(b);if(l){pushPreAction();const n=createLiving(l.type,l.chest.position.x+80,l.chest.position.y-20,l.monster?1.45:1,l.monster);recordHistory();selectBody(n);return;}
  const root=resolveRoot(b);if(root.plugin?.spawnKey&&root.plugin.spawnKey.startsWith('mod_')){pushPreAction();const n=spawnWorkshopMachine(root.plugin.spawnKey,root.position.x+100,root.position.y);recordHistory();selectBody(n);return;}
  const s=bodySize(root),np=root.plugin?.spawnKey?makeBody(root.plugin.spawnKey,root.position.x+60,root.position.y-20):makeCustomRect(root.position.x+60,root.position.y-20,s.w,s.h,root.plugin?.color||'#66717c',{...clone(root.plugin),uid:uid(),group:0},root.angle);if(np){Body.setAngle(np,root.angle);selectBody(np);recordHistory();}
}
function deleteBody(b,wholeLiving=false){
  if(!b)return;pushPreAction();const l=livingForBody(b);if(l&&wholeLiving!==false){for(const c of l.joints)World.remove(engine.world,c);for(const p of l.parts)World.remove(engine.world,p);for(const c of l.grips||[])World.remove(engine.world,c);special.livings.delete(l.id);}
  else {const root=resolveRoot(b);if(root.plugin?.pistonId){const p=special.pistons.find(x=>x.id===root.plugin.pistonId);if(p){World.remove(engine.world,p.base);World.remove(engine.world,p.rod);special.pistons=special.pistons.filter(x=>x!==p);}}else World.remove(engine.world,b);}
  state.selected=null;recordHistory();updateSelectionUI();sfx('delete');
}
function clearLiving(){pushPreAction();for(const l of [...special.livings.values()]){for(const c of l.joints)World.remove(engine.world,c);for(const c of l.grips||[])World.remove(engine.world,c);for(const b of l.parts)World.remove(engine.world,b);}special.livings.clear();for(const b of Composite.allBodies(engine.world).filter(b=>b.plugin?.verity))World.remove(engine.world,b);recordHistory();toast('Living cleared');}
function clearWorld(record=true){if(record)pushPreAction();for(const c of Composite.allConstraints(engine.world))World.remove(engine.world,c);for(const b of Composite.allBodies(engine.world))if(!b.plugin?.boundary)World.remove(engine.world,b);special.pistons=[];special.sliders=[];special.livings.clear();special.grips.clear();state.selected=null;state.toolFirst=null;if(record)recordHistory();updateSelectionUI();toast('Build cleared');}

function toggleSource(b,force=null){b=resolveRoot(b);if(!b?.plugin)return;const p=b.plugin;if(!(p.source||p.poweredType)){return;}const next=force===null?!p.active:force;p.active=next;if(p.source)applyLinks(b,next);sfx('toggle');updateSelectionUI();}
function applyLinks(src,on){for(const id of src.plugin?.linkedIds||[]){const t=bodyByUid(id);if(t?.plugin&&(t.plugin.poweredType||t.plugin.magnet))t.plugin.active=on;}}
function pulseLinks(src){for(const id of src.plugin?.linkedIds||[]){const t=bodyByUid(id);if(t?.plugin&&(t.plugin.poweredType||t.plugin.magnet)){t.plugin.active=true;setTimeout(()=>{if(t?.plugin)t.plugin.active=false;},220);}}}
function setLivingMode(l,mode){if(!l||l.dead)return;l.mode=mode;l.brain=mode!=='sleep';if(mode==='recover')l.knockoutUntil=0;toast(`${l.name}: ${mode}`);updateSelectionUI();}
function healLiving(l){if(!l)return;l.dead=false;l.brain=true;l.health=l.maxHealth;l.knockoutUntil=0;l.parts.forEach(p=>{p.plugin.health=p.plugin.maxHealth;});l.mode='stand';toast(l.name+' healed','good');updateSelectionUI();}
function releaseLiving(l){if(!l)return;for(const c of l.grips||[])World.remove(engine.world,c);l.grips=[];toast(l.name+' released objects');}
function grabNearestLiving(l){
  if(!l)return;releaseLiving(l);const all=Composite.allBodies(engine.world).filter(b=>!b.isStatic&&!b.plugin?.boundary&&!b.plugin?.livingId);for(const hand of [l.handL,l.handR]){let best=null,bd=75;for(const o of all){const d=dist(hand.position,o.position);if(d<bd){best=o;bd=d;}}if(best){const c=addConstraintWorld(hand,hand.position,best,hand.position,{length:0,stiffness:.88,damping:.14,kind:'livingGrip',visible:false});l.grips.push(c);}}
  toast(l.grips.length?`${l.name} grabbed something`:'Nothing close enough');
}

function connectTool(kind,a,aWorld,b,bWorld){
  if(!a||!b||a===b&&kind!=='pin')return false;pushPreAction();
  if(kind==='rope'||kind==='steelrope'||kind==='chain')createSegmentedRope(a,aWorld,b,bWorld,kind);
  else if(['fixedrope','spring','suspension','winchrope'].includes(kind))createSimpleLink(kind,a,aWorld,b,bWorld);
  else if(kind==='elastic')addConstraintWorld(a,aWorld,b,bWorld,{length:dist(aWorld,bWorld)*.82,stiffness:.028,damping:.03,kind:'elastic'});
  else if(kind==='slider')createSliderJoint(a,aWorld,b,bWorld);
  else if(kind==='rigid')createRigidRod(a,aWorld,b,bWorld);
  else if(kind==='pin')pinBodies(a,b,aWorld,{kind:'pin'});
  else if(kind==='weld')weldBodies(a,b,{x:(aWorld.x+bWorld.x)/2,y:(aWorld.y+bWorld.y)/2});
  else if(kind==='wire'){
    const src=a.plugin?.source?a:(b.plugin?.source?b:null);const target=src===a?b:a;if(!src){toast('Start or end the wire on a button, sensor or timer','bad');preActionSnapshot=null;return false;}ensureUid(src);ensureUid(target);src.plugin.linkedIds=src.plugin.linkedIds||[];if(!src.plugin.linkedIds.includes(target.plugin.uid))src.plugin.linkedIds.push(target.plugin.uid);addConstraintWorld(src,aWorld,target,bWorld,{length:dist(aWorld,bWorld),stiffness:0,kind:'wire',plugin:{visualOnly:true,sourceUid:src.plugin.uid,targetUid:target.plugin.uid}});
  }
  recordHistory();sfx('connect');return true;
}
function toolNeedsTwo(tool){return ['rope','steelrope','chain','fixedrope','slider','rigid','spring','elastic','suspension','winchrope','pin','weld','wire'].includes(tool);}
function setTool(tool){if(state.toolFirst?.body?.plugin?.backgroundAnchor)World.remove(engine.world,state.toolFirst.body);state.tool=tool;state.toolFirst=null;if(tool!=='select')state.spawnKey=null;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));document.querySelectorAll('.itemCard').forEach(c=>c.classList.remove('active'));const hints={select:'Drag objects. Swipe empty space to pan. Pinch to zoom.',activate:'Tap buttons or powered machines to activate them.',rope:'Tap two objects to attach a physical segmented rope.',steelrope:'Tap two objects to attach a heavy steel cable.',chain:'Tap two objects for a heavy articulated chain.',fixedrope:'Tap two objects for a strong fixed-length rope.',slider:'Tap two objects to make a one-axis slider rail.',rigid:'Tap two objects to create a rigid physical rod.',spring:'Tap two objects for an elastic spring.',elastic:'Tap two objects for a softer stretchy cord.',suspension:'Tap two objects for a damped suspension link.',winchrope:'Tap a Rope Controller and another object for a retractable rope.',pin:'Tap two objects to make a rotating pin joint.',weld:'Tap two objects to rigidly weld them.',wire:'Tap a source and powered machine to wire them.',freeze:'Tap an object to freeze or unfreeze it.',nocollide:'Tap an object to toggle collisions.',delete:'Tap an object to delete it.'};document.getElementById('hint').textContent=hints[tool]||'Build mode';}
function handleToolTap(world,body){
  if(state.tool==='activate'){if(body)toggleSource(body);return;}
  if(state.tool==='freeze'){if(body)freezeBody(body);return;}
  if(state.tool==='nocollide'){if(body)toggleCollision(body);return;}
  if(state.tool==='delete'){if(body)deleteBody(body,true);return;}
  if(toolNeedsTwo(state.tool)){
    if(!body&&state.tool==='wire'){toast('Wire needs a real source or machine');return;}
    const endpoint=body||createWorldAnchor(world);
    if(!state.toolFirst){state.toolFirst={body:endpoint,world};if(body)selectBody(body);toast(body?'First point selected':'Background anchor selected');return;}
    const first=state.toolFirst;state.toolFirst=null;if(connectTool(state.tool,first.body,first.world,endpoint,world))toast(state.tool.toUpperCase()+' connected','good');
  }
}

function stabilizeBody(body,target,strength=.08,damp=.82){if(!body||body.isStatic)return;const err=normAngle(target-body.angle);Body.setAngularVelocity(body,body.angularVelocity*damp+err*strength);}
function approachAngle(body,target,str=.07){if(!body||body.isStatic)return;const err=normAngle(target-body.angle);Body.setAngularVelocity(body,body.angularVelocity*.82+err*str);}
function applyPoweredSystems(now,dt){
  const bodies=Composite.allBodies(engine.world);
  for(const b of bodies){
    const p=b.plugin||{};if(p.boundary)continue;
    if(p.noGravity&&!b.isStatic)Body.applyForce(b,b.position,{x:-engine.gravity.x*engine.gravity.scale*b.mass,y:-engine.gravity.y*engine.gravity.scale*b.mass});
    if(p.rotationLock&&!b.isStatic){Body.setAngle(b,p.lockAngle??b.angle);Body.setAngularVelocity(b,0);}
    if(b.isStatic)continue;
    if(p.balloon)Body.applyForce(b,b.position,{x:0,y:-0.0009*b.mass*Math.max(.15,Math.abs(engine.gravity.y))*(p.lift||1)});
    if(p.hover){Body.applyForce(b,b.position,{x:0,y:-0.00103*b.mass*engine.gravity.y});stabilizeBody(b,p.targetAngle||0,.09,.82);}
    if(p.stabilizer)stabilizeBody(b,p.targetAngle||0,.055*(p.stabilizer||1),.82);
    if((p.poweredType==='thruster'||p.poweredType==='propeller')&&p.active){const mag=.00135*b.mass*(p.thrust||1),ang=b.angle;Body.applyForce(b,{x:b.position.x-Math.cos(ang)*20,y:b.position.y-Math.sin(ang)*20},{x:Math.cos(ang)*mag,y:Math.sin(ang)*mag});if(p.poweredType==='propeller')Body.setAngularVelocity(b,b.angularVelocity*.86+(p.rotorSpeed||.32)*.14);}
    if(p.poweredType==='motor'&&p.active)Body.setAngularVelocity(b,b.angularVelocity*.84+(p.motorSpeed||.24)*.16);
    if(p.poweredType==='rotor'&&p.active)Body.setAngularVelocity(b,b.angularVelocity*.78+(p.rotorSpeed||.4)*.22);
    if((p.poweredType==='gyro'||p.poweredType==='servo')&&p.active)stabilizeBody(b,p.targetAngle||0,.07*(p.gyroStrength||1),.8);
    if(p.poweredType==='conveyor'&&p.active){for(const o of bodies){if(o===b||o.isStatic||o.plugin?.boundary)continue;const rel=Vector.rotate(Vector.sub(o.position,b.position),-b.angle);if(Math.abs(rel.x)<(p.width||155)*.58&&rel.y<0&&rel.y>-55){const dir=rotatePoint({x:(p.conveyorSpeed||1)*.00018*o.mass,y:0},b.angle);Body.applyForce(o,o.position,dir);}}}
    if(p.poweredType==='accelerator'&&p.active){for(const o of bodies){if(o===b||o.isStatic||o.plugin?.boundary)continue;const rel=Vector.rotate(Vector.sub(o.position,b.position),-b.angle);if(rel.x>0&&rel.x<260&&Math.abs(rel.y)<110){const f=rotatePoint({x:.00022*(p.fieldStrength||1)*o.mass,y:0},b.angle);Body.applyForce(o,o.position,f);}}}
    if((p.magnet||p.poweredType==='magnet')&&p.active){for(const o of bodies){if(o===b||o.isStatic||!['metal','machine'].includes(o.plugin?.kind))continue;const d=Vector.sub(b.position,o.position),ds=Math.max(900,Vector.magnitudeSquared(d));if(ds<180000){const n=Vector.normalise(d),f=Math.min(.0014,.0000011*180000/ds)*(p.fieldStrength||1)*o.mass;Body.applyForce(o,o.position,{x:n.x*f,y:n.y*f});}}}
    if(p.poweredType==='gravity'&&p.active){for(const o of bodies){if(o===b||o.isStatic||o.plugin?.boundary)continue;const d=Vector.sub(b.position,o.position),ds=Math.max(900,Vector.magnitudeSquared(d));if(ds<240000){const n=Vector.normalise(d),f=.00012*(p.fieldStrength||1)*o.mass*(240000/ds);Body.applyForce(o,o.position,{x:n.x*f,y:n.y*f});}}}
    if(p.poweredType==='repulsor'&&p.active){for(const o of bodies){if(o===b||o.isStatic||o.plugin?.boundary)continue;const d=Vector.sub(o.position,b.position),ds=Math.max(900,Vector.magnitudeSquared(d));if(ds<180000){const n=Vector.normalise(d),f=.00015*(p.fieldStrength||1)*o.mass*(180000/ds);Body.applyForce(o,o.position,{x:n.x*f,y:n.y*f});}}}
    if(p.poweredType==='healer'&&p.active){for(const l of special.livings.values()){if(dist(l.chest.position,b.position)<190){l.health=Math.min(l.maxHealth,l.health+dt*.055);l.parts.forEach(q=>q.plugin.health=Math.min(q.plugin.maxHealth,q.plugin.health+dt*.055));if(l.health>0)l.dead=false;}}}
    if(p.timer&&p.active&&now-(p.lastPulse||0)>p.interval){p.lastPulse=now;p.pulseState=!p.pulseState;applyLinks(b,p.pulseState);}
    if(p.proximity&&p.active&&now-(p.lastPulse||0)>250){const hit=bodies.some(o=>o!==b&&!o.plugin?.boundary&&dist(o.position,b.position)<(p.range||180));if(hit!==p.proximityState){p.proximityState=hit;applyLinks(b,hit);}p.lastPulse=now;}
  }
  for(const piston of special.pistons){
    const {base,rod}=piston;if(!base||!rod||!Composite.allBodies(engine.world).includes(base)||!Composite.allBodies(engine.world).includes(rod))continue;
    const target=base.plugin?.active?piston.max:piston.min;piston.current+=Math.sign(target-piston.current)*Math.min(Math.abs(target-piston.current),piston.speed*Math.max(.15,state.timeScale));const ang=base.angle;const desired={x:base.position.x+Math.cos(ang)*(bodySize(base).w*.5+piston.current),y:base.position.y+Math.sin(ang)*(bodySize(base).w*.5+piston.current)};
    if(base.isStatic){if(!rod.isStatic)Body.setStatic(rod,true);Body.setPosition(rod,desired);Body.setAngle(rod,ang);}else {if(rod.isStatic&&rod.plugin?.frozen!==true)Body.setStatic(rod,false);Body.setPosition(rod,desired);Body.setAngle(rod,ang);Body.setVelocity(rod,base.velocity);Body.setAngularVelocity(rod,base.angularVelocity);}
  }
  for(const c of Composite.allConstraints(engine.world)){if(c.plugin?.kind==='winchrope'&&c.plugin.winchSource){const w=bodyByUid(c.plugin.winchSource);if(w?.plugin?.active)c.length=Math.max(18,c.length-(w.plugin.winchSpeed||1.2)*state.timeScale);else c.length=Math.min(c.plugin.restLength||c.length,c.length+.35*state.timeScale);}}
}

function updateLivings(now,dt){
  for(const l of [...special.livings.values()]){
    l.parts=l.parts.filter(p=>Composite.allBodies(engine.world).includes(p));if(!l.parts.length){special.livings.delete(l.id);continue;}
    if(l.health<=0){l.dead=true;l.mode='sleep';l.brain=false;}
    if(now>l.nextBlink){l.blinkUntil=now+130;l.nextBlink=now+1700+Math.random()*3500;}
    if(l.dead||now<l.knockoutUntil||!l.brain)continue;
    const gravSign=engine.gravity.y>=0?1:-1;if(Math.abs(engine.gravity.y)<.05){stabilizeBody(l.chest,0,.035,.9);stabilizeBody(l.head,0,.035,.9);continue;}
    const fallen=Math.abs(normAngle(l.chest.angle))>1.0;if(fallen&&['stand','wander','run','follow'].includes(l.mode))l.mode='recover';
    if(l.mode==='recover'){
      stabilizeBody(l.chest,0,.18,.65);stabilizeBody(l.hips,0,.14,.7);approachAngle(l.thl,-.15,.1);approachAngle(l.thr,.15,.1);approachAngle(l.shl,0,.12);approachAngle(l.shr,0,.12);Body.applyForce(l.chest,l.chest.position,{x:0,y:-.0007*l.chest.mass*gravSign});if(Math.abs(l.chest.angle)<.35&&Math.abs(l.hips.angle)<.45)l.mode='stand';continue;
    }
    if(l.mode==='sit'){stabilizeBody(l.chest,.06,.09,.8);stabilizeBody(l.hips,0,.08,.8);approachAngle(l.thl,-1.05,.07);approachAngle(l.thr,1.05,.07);approachAngle(l.shl,.2,.05);approachAngle(l.shr,-.2,.05);continue;}
    if(l.mode==='sleep')continue;
    stabilizeBody(l.chest,0,l.monster?.15:.115,.74);stabilizeBody(l.hips,0,.10,.77);stabilizeBody(l.head,0,.11,.77);approachAngle(l.footL,0,.08);approachAngle(l.footR,0,.08);
    if(Math.cos(l.chest.angle)>.2)Body.applyForce(l.chest,l.chest.position,{x:0,y:-.00036*l.chest.mass*gravSign});
    let moving=['wander','run','follow'].includes(l.mode);if(moving){
      if(l.mode==='follow'){const dx=state.lastPointerWorld.x-l.chest.position.x;if(Math.abs(dx)>35)l.walkDir=Math.sign(dx)||1;else moving=false;}
      else if(now>l.nextTurn){l.nextTurn=now+2200+Math.random()*4200;if(Math.random()<.42)l.walkDir*=-1;}
      if(moving){const rate=l.mode==='run'?.014:.009;l.phase+=dt*rate*(l.monster?.72:1);const a=Math.sin(l.phase),b=Math.sin(l.phase+Math.PI),dir=l.walkDir||1;approachAngle(l.thl,a*.62*dir,.09);approachAngle(l.thr,b*.62*dir,.09);approachAngle(l.shl,-a*.34*dir,.075);approachAngle(l.shr,-b*.34*dir,.075);approachAngle(l.ual,-a*.42*dir,.06);approachAngle(l.uar,-b*.42*dir,.06);const force=(l.mode==='run'?.00028:.00017)*(l.monster?.8:1);Body.applyForce(l.hips,l.hips.position,{x:dir*force*l.hips.mass,y:0});}
    } else {approachAngle(l.thl,0,.06);approachAngle(l.thr,0,.06);approachAngle(l.shl,0,.055);approachAngle(l.shr,0,.055);}
    for(const wz of special.waterZones){const inside=l.head.position.x>wz.x1&&l.head.position.x<wz.x2&&l.head.position.y>wz.y&&l.head.position.y<wz.bottom;if(inside){l.drown+=dt;if(l.drown>5500)l.health=Math.max(0,l.health-dt*.007);}else l.drown=Math.max(0,l.drown-dt*.5);}
    for(const z of special.lavaZones){if(l.parts.some(p=>p.position.x>z.x1&&p.position.x<z.x2&&p.position.y>z.y&&p.position.y<z.bottom))l.health=Math.max(0,l.health-dt*.11);}
  }
  updateSelectionUI();
}

function applyZones(){
  const bodies=Composite.allBodies(engine.world).filter(b=>!b.isStatic&&!b.plugin?.boundary);
  for(const z of special.waterZones)for(const b of bodies){if(b.position.x<z.x1||b.position.x>z.x2||b.position.y<z.y||b.position.y>z.bottom)continue;const depth=clamp((b.position.y-z.y)/(z.bottom-z.y),0,1);Body.applyForce(b,b.position,{x:-b.velocity.x*.00005*b.mass,y:-engine.gravity.y*engine.gravity.scale*b.mass*(.78+depth*.5)});Body.setVelocity(b,{x:b.velocity.x*.993,y:b.velocity.y*.986});}
}

Events.on(engine,'collisionStart',ev=>{
  const now=nowMs();for(const pair of ev.pairs){const a=pair.bodyA,b=pair.bodyB;const rv=Vector.sub(a.velocity,b.velocity);const speed=Vector.magnitude(rv);
    for(const q of [a,b]){const p=q.plugin||{};if(p.pressure){p.active=true;applyLinks(q,true);}if(p.sensor&&p.active&&speed>4&&now-(p.lastPulse||0)>400){p.lastPulse=now;pulseLinks(q);}const l=livingForBody(q);if(l&&state.damage&&speed>5.7&&!l.dead){const damage=(speed-5.7)*6.3*(p.robot?.38:1)*(l.monster?.38:1);l.health=Math.max(0,l.health-damage);p.health=Math.max(0,(p.health||p.maxHealth)-damage*.65);if(speed>10)l.knockoutUntil=now+650+speed*55;if(l.health<=0){l.dead=true;l.brain=false;l.mode='sleep';}spawnParticles(q.position,p.robot?'#b7c3cc':l.blood,Math.min(8,Math.ceil(speed/2)));}}
  }
});
Events.on(engine,'collisionEnd',ev=>{for(const pair of ev.pairs)for(const q of [pair.bodyA,pair.bodyB])if(q.plugin?.pressure){q.plugin.active=false;applyLinks(q,false);}});

function spawnParticles(pos,color,count){for(let i=0;i<count;i++)special.particles.push({x:pos.x,y:pos.y,vx:(Math.random()-.5)*7,vy:(Math.random()-.6)*7,life:500+Math.random()*350,color});}
function updateParticles(dt){for(const p of special.particles){p.life-=dt;p.vy+=.012*dt;p.x+=p.vx*dt/16.67;p.y+=p.vy*dt/16.67;}special.particles=special.particles.filter(p=>p.life>0);}

function drawBackground(){
  const m=MAPS[state.map]||MAPS.yard;const w=canvas.clientWidth,h=canvas.clientHeight;ctx.setTransform(state.dpr,0,0,state.dpr,0,0);ctx.fillStyle=m.sky;ctx.fillRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(255,255,255,.035)');grad.addColorStop(1,'rgba(0,0,0,.18)');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
}
function beginWorldTransform(){const z=state.camera.zoom,d=state.dpr;ctx.setTransform(d*z,0,0,d*z,d*(canvas.clientWidth/2-state.camera.x*z),d*(canvas.clientHeight/2-state.camera.y*z));}
function drawGrid(){if(!state.showGrid)return;const z=state.camera.zoom;let step=40;if(z<.55)step=80;if(z>1.8)step=20;const tl=screenToWorld({x:0,y:0}),br=screenToWorld({x:canvas.clientWidth,y:canvas.clientHeight});ctx.lineWidth=1/z;ctx.strokeStyle='rgba(255,255,255,.075)';ctx.beginPath();for(let x=Math.floor(tl.x/step)*step;x<br.x;x+=step){ctx.moveTo(x,tl.y);ctx.lineTo(x,br.y);}for(let y=Math.floor(tl.y/step)*step;y<br.y;y+=step){ctx.moveTo(tl.x,y);ctx.lineTo(br.x,y);}ctx.stroke();ctx.strokeStyle='rgba(255,255,255,.12)';ctx.beginPath();for(let x=Math.floor(tl.x/(step*5))*step*5;x<br.x;x+=step*5){ctx.moveTo(x,tl.y);ctx.lineTo(x,br.y);}for(let y=Math.floor(tl.y/(step*5))*step*5;y<br.y;y+=step*5){ctx.moveTo(tl.x,y);ctx.lineTo(br.x,y);}ctx.stroke();}
function drawZones(){for(const z of special.waterZones){ctx.fillStyle='rgba(45,112,149,.48)';ctx.fillRect(z.x1,z.y,z.x2-z.x1,z.bottom-z.y);ctx.strokeStyle='rgba(166,221,244,.5)';ctx.lineWidth=2/state.camera.zoom;ctx.beginPath();ctx.moveTo(z.x1,z.y);ctx.lineTo(z.x2,z.y);ctx.stroke();}for(const z of special.lavaZones){ctx.fillStyle='rgba(207,86,39,.72)';ctx.fillRect(z.x1,z.y,z.x2-z.x1,z.bottom-z.y);ctx.fillStyle='rgba(255,181,57,.28)';for(let x=z.x1;x<z.x2;x+=48)ctx.fillRect(x,z.y+Math.sin((x+state.worldTime*.03)/35)*7,28,7);}}
function drawConstraint(c){if(c.plugin?.visible===false||c.plugin?.kind==='livingJoint'||c.plugin?.kind==='livingGrip')return;if(!state.showJoints&&c.plugin?.kind!=='wire')return;const a=c.bodyA?worldPoint(c.bodyA,c.pointA):c.pointA,b=c.bodyB?worldPoint(c.bodyB,c.pointB):c.pointB;if(!a||!b)return;const kind=c.plugin?.kind||'joint';ctx.save();ctx.lineWidth=(kind==='wire'?2:(kind==='steelrope'||kind==='chain')?4:(kind==='spring'||kind==='elastic')?3:2)/state.camera.zoom;ctx.strokeStyle=c.plugin?.color||jointColors[kind]||'#d8dde2';if(kind==='wire')ctx.setLineDash([7/state.camera.zoom,5/state.camera.zoom]);if(kind==='spring'||kind==='elastic'){const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/(len||1),ny=dx/(len||1),loops=Math.max(5,Math.floor(len/20));ctx.beginPath();ctx.moveTo(a.x,a.y);for(let i=1;i<loops;i++){const t=i/loops,off=(i%2?1:-1)*7;ctx.lineTo(lerp(a.x,b.x,t)+nx*off,lerp(a.y,b.y,t)+ny*off);}ctx.lineTo(b.x,b.y);ctx.stroke();}else {ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}ctx.restore();}
function roundedRectPath(g,x,y,w,h,r){r=Math.min(r,w/2,h/2);g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function drawBody(b){
  const p=b.plugin||{};if(p.hidden)return;ctx.save();ctx.translate(b.position.x,b.position.y);ctx.rotate(b.angle);ctx.fillStyle=p.color||'#697580';ctx.strokeStyle=p.boundary?'rgba(20,23,26,.55)':'rgba(13,16,18,.82)';ctx.lineWidth=(p.kind==='ropeSegment'?1.2:2)/state.camera.zoom;
  if(b.circleRadius){ctx.beginPath();ctx.arc(0,0,b.circleRadius,0,TAU);ctx.fill();ctx.stroke();}
  else {const s=bodySize(b),w=s.w,h=s.h;roundedRectPath(ctx,-w/2,-h/2,w,h,Math.min(5,w*.12,h*.12));ctx.fill();ctx.stroke();}
  if(p.wheel){const r=b.circleRadius||p.radius||30;ctx.strokeStyle='rgba(190,202,211,.62)';ctx.lineWidth=4/state.camera.zoom;ctx.beginPath();ctx.arc(0,0,r*.48,0,TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(-r*.45,0);ctx.lineTo(r*.45,0);ctx.moveTo(0,-r*.45);ctx.lineTo(0,r*.45);ctx.stroke();}
  if(p.poweredType==='gyro'||p.poweredType==='servo'){const r=b.circleRadius||22;ctx.strokeStyle=p.active?'#84daf5':'#83919a';ctx.lineWidth=3/state.camera.zoom;ctx.beginPath();ctx.arc(0,0,r*.62,0,TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(-r*.7,0);ctx.lineTo(r*.7,0);ctx.stroke();}
  if(p.poweredType==='thruster'){const s=bodySize(b);ctx.fillStyle=p.active?'#f3bd53':'#65717c';ctx.beginPath();ctx.moveTo(-s.w/2,s.h*.26);ctx.lineTo(-s.w/2-(p.active?30:10),0);ctx.lineTo(-s.w/2,-s.h*.26);ctx.fill();}
  if(p.button||p.source){const s=bodySize(b),w=Math.min(22,s.w*.45),h=Math.min(11,s.h*.4);ctx.fillStyle=p.active?'#86c96c':'#c75d63';ctx.fillRect(-w/2,-h/2,w,h);}
  if(p.pistonRole==='rod'){ctx.fillStyle='rgba(255,255,255,.45)';const s=bodySize(b);ctx.fillRect(-s.w*.35,-s.h*.2,s.w*.7,s.h*.4);}
  if(p.verity){const r=b.circleRadius||34;ctx.fillStyle='#171717';ctx.beginPath();ctx.arc(-r*.28,-r*.18,r*.07,0,TAU);ctx.arc(r*.28,-r*.18,r*.07,0,TAU);ctx.fill();ctx.strokeStyle='#171717';ctx.lineWidth=3/state.camera.zoom;ctx.beginPath();ctx.arc(0,r*.05,r*.43,.2*Math.PI,.8*Math.PI);ctx.stroke();}
  if(p.part==='head')drawLivingFace(b,p);
  if(p.colliderOnly){ctx.strokeStyle='rgba(215,230,241,.65)';ctx.setLineDash([6/state.camera.zoom,4/state.camera.zoom]);const s=bodySize(b);ctx.strokeRect(-s.w/2,-s.h/2,s.w,s.h);}
  if(p.frozen){ctx.strokeStyle='#8fd5f1';ctx.lineWidth=3/state.camera.zoom;const s=bodySize(b);if(b.circleRadius){ctx.beginPath();ctx.arc(0,0,b.circleRadius+4/state.camera.zoom,0,TAU);ctx.stroke();}else ctx.strokeRect(-s.w/2-3/state.camera.zoom,-s.h/2-3/state.camera.zoom,s.w+6/state.camera.zoom,s.h+6/state.camera.zoom);}
  ctx.restore();
}
function drawLivingFace(body,p){const l=livingForBody(body);const r=body.circleRadius||22,blink=l&&nowMs()<l.blinkUntil;ctx.fillStyle='#151719';if(l?.monster){ctx.beginPath();ctx.ellipse(-r*.3,-r*.13,r*.12,r*.18,0,0,TAU);ctx.ellipse(r*.3,-r*.13,r*.12,r*.18,0,0,TAU);ctx.fill();ctx.beginPath();ctx.ellipse(0,r*.25,r*.36,r*.2,0,0,TAU);ctx.fill();ctx.fillStyle='#e8dda0';for(let i=-r*.24;i<=r*.18;i+=r*.15){ctx.beginPath();ctx.moveTo(i,r*.1);ctx.lineTo(i+r*.075,r*.24);ctx.lineTo(i+r*.15,r*.1);ctx.fill();}return;}if(blink){ctx.fillRect(-r*.45,-r*.15,r*.25,2/state.camera.zoom);ctx.fillRect(r*.2,-r*.15,r*.25,2/state.camera.zoom);}else{ctx.beginPath();ctx.arc(-r*.3,-r*.12,r*.07,0,TAU);ctx.arc(r*.3,-r*.12,r*.07,0,TAU);ctx.fill();}ctx.strokeStyle='#151719';ctx.lineWidth=2.5/state.camera.zoom;ctx.beginPath();ctx.arc(0,r*.08,r*.38,.2*Math.PI,.8*Math.PI);ctx.stroke();}
function drawSelection(){const b=state.selected;if(!b||!Composite.allBodies(engine.world).includes(b))return;ctx.save();ctx.strokeStyle='#f4f6f7';ctx.lineWidth=2.5/state.camera.zoom;ctx.setLineDash([7/state.camera.zoom,5/state.camera.zoom]);if(b.circleRadius){ctx.beginPath();ctx.arc(b.position.x,b.position.y,b.circleRadius+8/state.camera.zoom,0,TAU);ctx.stroke();}else{ctx.translate(b.position.x,b.position.y);ctx.rotate(b.angle);const s=bodySize(b);ctx.strokeRect(-s.w/2-6/state.camera.zoom,-s.h/2-6/state.camera.zoom,s.w+12/state.camera.zoom,s.h+12/state.camera.zoom);}ctx.restore();if(state.toolFirst){ctx.save();ctx.fillStyle='#f5e675';ctx.beginPath();ctx.arc(state.toolFirst.world.x,state.toolFirst.world.y,7/state.camera.zoom,0,TAU);ctx.fill();ctx.restore();}}
function drawParticles(){for(const p of special.particles){ctx.globalAlpha=clamp(p.life/500,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x-2,p.y-2,4,4);}ctx.globalAlpha=1;}
function render(){
  resizeCanvas();drawBackground();beginWorldTransform();drawGrid();drawZones();
  const bodies=Composite.allBodies(engine.world).slice().sort((a,b)=>(a.plugin?.z||0)-(b.plugin?.z||0));for(const b of bodies)drawBody(b);for(const c of Composite.allConstraints(engine.world))drawConstraint(c);drawSelection();drawParticles();
  requestAnimationFrame(render);
}
function resizeCanvas(){const d=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);state.dpr=d;}}

function beginGrab(pointerId,body,world){
  const root=body;pushPreAction();if(root.isStatic){state.drag={pointerId,body:root,constraint:null,staticDrag:true,offset:Vector.sub(root.position,world),lastWorld:world,lastTime:nowMs(),vx:0,vy:0,moved:false};return;}
  const c=Constraint.create({bodyA:root,pointA:localPoint(root,world),pointB:{x:world.x,y:world.y},length:0,stiffness:clamp(.42*state.grabStrength,.2,.92),damping:.18});c.plugin={kind:'grab',visible:false};World.add(engine.world,c);if(Matter.Sleeping)Matter.Sleeping.set(root,false);state.drag={pointerId,body:root,constraint:c,lastWorld:world,lastTime:nowMs(),vx:0,vy:0,moved:false};
}
function endGrab(){if(!state.drag)return;const d=state.drag;if(d.constraint)World.remove(engine.world,d.constraint);if(d.body&&!d.body.isStatic&&d.moved){Body.setVelocity(d.body,{x:clamp(d.vx,-24,24),y:clamp(d.vy,-24,24)});}state.drag=null;recordHistory();}
function beginPan(pointerId,screen){state.pan={pointerId,startX:screen.x,startY:screen.y,camX:state.camera.x,camY:state.camera.y,zoom:state.camera.zoom,moved:false};}
function startGesture(){if(state.drag)endGrab();const ps=[...state.pointers.values()];if(ps.length<2)return;const a=ps[0],b=ps[1],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};state.gesture={ids:[a.id,b.id],dist:Math.max(5,Math.hypot(a.x-b.x,a.y-b.y)),zoom:state.camera.zoom,world:screenToWorld(center)};state.pan=null;}
function updateGesture(){if(!state.gesture)return;const a=state.pointers.get(state.gesture.ids[0]),b=state.pointers.get(state.gesture.ids[1]);if(!a||!b){state.gesture=null;return;}const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},d=Math.max(5,Math.hypot(a.x-b.x,a.y-b.y));const zoom=clamp(state.gesture.zoom*d/state.gesture.dist,.18,3.8);state.camera.zoom=zoom;state.camera.x=state.gesture.world.x-(center.x-canvas.clientWidth/2)/zoom;state.camera.y=state.gesture.world.y-(center.y-canvas.clientHeight/2)/zoom;}

canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();canvas.setPointerCapture?.(e.pointerId);const screen={x:e.clientX,y:e.clientY},world=screenToWorld(screen);state.lastPointerWorld=world;state.pointers.set(e.pointerId,{id:e.pointerId,x:e.clientX,y:e.clientY,type:e.pointerType});
  if(state.pointers.size>=2){startGesture();return;}
  if(state.spawnKey){pushPreAction();spawnPart(state.spawnKey,world.x,world.y,true);recordHistory();sfx('place');return;}
  const body=getBodyAt(world);
  if(state.tool!=='select'){handleToolTap(world,body);return;}
  if(body){selectBody(body);const now=nowMs();if(state.lastTapBody===body&&now-(state.lastTapTime||0)<320){openContext();state.lastTapBody=null;}else{state.lastTapBody=body;state.lastTapTime=now;}beginGrab(e.pointerId,body,world);if(e.pointerType!=='mouse'){clearTimeout(state.longPressTimer);state.longPressTimer=setTimeout(()=>{if(state.drag&&!state.drag.moved&&state.drag.body===body)openContext();},520);}}
  else {selectBody(null);beginPan(e.pointerId,screen);}
});
canvas.addEventListener('pointermove',e=>{
  const p=state.pointers.get(e.pointerId);if(p){p.x=e.clientX;p.y=e.clientY;}const world=screenToWorld({x:e.clientX,y:e.clientY});state.lastPointerWorld=world;
  if(state.gesture){updateGesture();return;}
  if(state.drag&&state.drag.pointerId===e.pointerId){const d=state.drag,now=nowMs(),dt=Math.max(8,now-d.lastTime);if(d.staticDrag)Body.setPosition(d.body,{x:world.x+d.offset.x,y:world.y+d.offset.y});else {d.constraint.pointB.x=world.x;d.constraint.pointB.y=world.y;}d.vx=(world.x-d.lastWorld.x)/(dt/16.67);d.vy=(world.y-d.lastWorld.y)/(dt/16.67);if(dist(world,d.lastWorld)>1.5)d.moved=true;d.lastWorld=world;d.lastTime=now;if(d.moved)clearTimeout(state.longPressTimer);return;}
  if(state.pan&&state.pan.pointerId===e.pointerId){const dx=e.clientX-state.pan.startX,dy=e.clientY-state.pan.startY;if(Math.abs(dx)+Math.abs(dy)>3)state.pan.moved=true;state.camera.x=state.pan.camX-dx/state.pan.zoom;state.camera.y=state.pan.camY-dy/state.pan.zoom;}
});
function pointerFinish(e){state.pointers.delete(e.pointerId);clearTimeout(state.longPressTimer);if(state.gesture){if(state.pointers.size<2)state.gesture=null;return;}if(state.drag&&state.drag.pointerId===e.pointerId)endGrab();if(state.pan&&state.pan.pointerId===e.pointerId)state.pan=null;}
canvas.addEventListener('pointerup',pointerFinish);canvas.addEventListener('pointercancel',pointerFinish);
canvas.addEventListener('wheel',e=>{e.preventDefault();const screen={x:e.clientX,y:e.clientY},before=screenToWorld(screen);const zoom=clamp(state.camera.zoom*Math.exp(-e.deltaY*.0015),.18,3.8);state.camera.zoom=zoom;state.camera.x=before.x-(screen.x-canvas.clientWidth/2)/zoom;state.camera.y=before.y-(screen.y-canvas.clientHeight/2)/zoom;},{passive:false});

function updateSelectionUI(){
  const box=document.getElementById('selectionPanel'),b=state.selected;if(!b||!Composite.allBodies(engine.world).includes(b)){box.classList.add('hidden');return;}box.classList.remove('hidden');const root=resolveRoot(b),p=root.plugin||{},l=livingForBody(root);document.getElementById('selectionName').textContent=l?l.name:(p.name||'Object');document.getElementById('selectionInfo').textContent=`${root.isStatic?'FROZEN':'DYNAMIC'}  •  ${String(p.kind||'PART').toUpperCase()}${p.active!==undefined?`  •  ${p.active?'ON':'OFF'}`:''}`;
  const ls=document.getElementById('livingStatus');ls.classList.toggle('hidden',!l);if(l){const pct=clamp(l.health/l.maxHealth*100,0,100);document.getElementById('healthText').textContent=Math.round(pct)+'%';document.getElementById('healthFill').style.width=pct+'%';document.getElementById('brainText').textContent='AI: '+(l.brain?'ACTIVE':'OFF');document.getElementById('moodText').textContent=String(l.mode||'idle').toUpperCase();}
  document.getElementById('selFreeze').textContent=root.isStatic?'UNFREEZE':'FREEZE';document.getElementById('selActivate').textContent=p.active?'TURN OFF':'ACTIVATE';
}
function openContext(){
  const b=state.selected;if(!b)return;const root=resolveRoot(b),p=root.plugin||{},l=livingForBody(root);document.getElementById('contextTitle').textContent=l?l.name:(p.name||'Object');document.getElementById('contextSubtitle').textContent='Object options and advanced controls';const actions=document.getElementById('contextActions');actions.innerHTML='';
  const defs=[['ROTATE -15',()=>rotateBody(root,-Math.PI/12)],['ROTATE +15',()=>rotateBody(root,Math.PI/12)],['ROTATE -90',()=>rotateBody(root,-Math.PI/2)],['ROTATE +90',()=>rotateBody(root,Math.PI/2)],['SCALE DOWN',()=>scaleBody(root,.82)],['SCALE UP',()=>scaleBody(root,1.22)],['FLIP',()=>flipBody(root)],[root.isStatic?'UNFREEZE':'FREEZE',()=>freezeBody(root)],[p.noCollide?'ENABLE COLLISION':'DISABLE COLLISION',()=>toggleCollision(root)],[p.noGravity?'ENABLE GRAVITY':'DISABLE GRAVITY',()=>toggleGravity(root)],[p.rotationLock?'UNLOCK ROTATION':'LOCK ROTATION',()=>toggleRotationLock(root)],['BRING FRONT',()=>setLayer(root,1)],['SEND BACK',()=>setLayer(root,-1)],['DUPLICATE',()=>duplicateBody(root)],['DELETE',()=>deleteBody(root,true)]];
  for(const [label,fn] of defs){const bt=document.createElement('button');bt.textContent=label;bt.onclick=()=>{fn();openContext();};actions.appendChild(bt);}document.getElementById('livingActions').classList.toggle('hidden',!l);renderMachineControls(root);document.getElementById('contextPanel').classList.remove('hidden');
}
function addControlRow(parent,label,min,max,step,value,oninput,format=v=>v){const row=document.createElement('label');row.className='controlRow';const span=document.createElement('span');span.textContent=label;const inp=document.createElement('input');inp.type='range';inp.min=min;inp.max=max;inp.step=step;inp.value=value;const out=document.createElement('output');out.textContent=format(+value);inp.oninput=e=>{oninput(+e.target.value);out.textContent=format(+e.target.value);};row.append(span,inp,out);parent.appendChild(row);}
function renderMachineControls(body){
  const wrap=document.getElementById('machineControls'),rows=document.getElementById('machineControlRows'),b=resolveRoot(body),p=b?.plugin||{};rows.innerHTML='';let any=false;
  if(p.poweredType==='motor'){any=true;addControlRow(rows,'Motor speed',-.8,.8,.01,p.motorSpeed??.24,v=>p.motorSpeed=v,v=>v.toFixed(2));}
  if(p.poweredType==='gyro'||p.poweredType==='servo'){any=true;addControlRow(rows,'Target angle',-180,180,1,(p.targetAngle||0)*180/Math.PI,v=>p.targetAngle=v*Math.PI/180,v=>Math.round(v)+' deg');addControlRow(rows,'Strength',.1,3,.1,p.gyroStrength||1,v=>p.gyroStrength=v,v=>v.toFixed(1));}
  if(['thruster','propeller'].includes(p.poweredType)){any=true;addControlRow(rows,'Power',.2,3,.1,p.thrust||1,v=>p.thrust=v,v=>v.toFixed(1));}
  if(['gravity','repulsor','magnet','accelerator'].includes(p.poweredType)){any=true;addControlRow(rows,'Field power',.2,4,.1,p.fieldStrength||1,v=>p.fieldStrength=v,v=>v.toFixed(1));}
  if(p.poweredType==='conveyor'){any=true;addControlRow(rows,'Belt speed',-3,3,.1,p.conveyorSpeed||1,v=>p.conveyorSpeed=v,v=>v.toFixed(1));}
  if(p.poweredType==='winch'){any=true;addControlRow(rows,'Winch speed',.2,4,.1,p.winchSpeed||1.2,v=>p.winchSpeed=v,v=>v.toFixed(1));}
  if(p.timer){any=true;addControlRow(rows,'Pulse interval',250,5000,50,p.interval||1200,v=>p.interval=v,v=>(v/1000).toFixed(2)+'s');}
  if(p.proximity){any=true;addControlRow(rows,'Sensor range',60,500,10,p.range||180,v=>p.range=v,v=>Math.round(v));}
  if(p.pistonId){const pi=special.pistons.find(x=>x.id===p.pistonId);if(pi){any=true;addControlRow(rows,'Piston travel',30,220,5,pi.max,v=>{pi.max=v;p.pistonMax=v;},v=>Math.round(v));addControlRow(rows,'Piston speed',.4,5,.1,pi.speed,v=>{pi.speed=v;p.pistonSpeed=v;},v=>v.toFixed(1));}}
  wrap.classList.toggle('hidden',!any);
}

function clonePlugin(p){const q=clone(p||{});delete q._temp;return q;}
function serializeBody(b){const p=clonePlugin(b.plugin),s=bodySize(b);return {oldId:b.id,x:b.position.x,y:b.position.y,angle:b.angle,vx:b.velocity.x,vy:b.velocity.y,av:b.angularVelocity,isStatic:b.isStatic,shape:b.circleRadius?'circle':'rect',r:b.circleRadius||p.radius,w:s.w,h:s.h,group:b.collisionFilter.group,mask:b.collisionFilter.mask,category:b.collisionFilter.category,plugin:p};}
function deserializeBody(o){const opt={density:o.plugin?.density||.003,friction:o.plugin?.friction??.55,restitution:o.plugin?.restitution??.06,frictionAir:.01};const b=o.shape==='circle'?Bodies.circle(o.x,o.y,o.r||20,opt):Bodies.rectangle(o.x,o.y,o.w||40,o.h||40,opt);b.plugin=clonePlugin(o.plugin);ensureUid(b);b.collisionFilter.group=o.group||0;b.collisionFilter.mask=Number.isFinite(o.mask)?o.mask:0xFFFFFFFF;b.collisionFilter.category=Number.isFinite(o.category)?o.category:1;Body.setAngle(b,o.angle||0);Body.setVelocity(b,{x:o.vx||0,y:o.vy||0});Body.setAngularVelocity(b,o.av||0);if(o.isStatic)Body.setStatic(b,true);World.add(engine.world,b);return b;}
function serializeScene(){
  const bodies=Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary).map(serializeBody),allowed=new Set(bodies.map(x=>x.oldId));const cons=Composite.allConstraints(engine.world).filter(c=>c.plugin?.kind!=='grab'&&(!c.bodyA||allowed.has(c.bodyA.id))&&(!c.bodyB||allowed.has(c.bodyB.id))).map(c=>({a:c.bodyA?.id||null,b:c.bodyB?.id||null,pa:clone(c.pointA),pb:clone(c.pointB),length:c.length,stiffness:c.stiffness,damping:c.damping,plugin:clonePlugin(c.plugin)}));
  const pistons=special.pistons.map(p=>({id:p.id,base:p.base?.id,rod:p.rod?.id,min:p.min,max:p.max,current:p.current,speed:p.speed}));const livings=[...special.livings.values()].map(l=>({id:l.id,type:l.type,name:l.name,health:l.health,maxHealth:l.maxHealth,blood:l.blood,robot:l.robot,monster:l.monster,mode:l.mode,brain:l.brain,dead:l.dead,walkDir:l.walkDir,partIds:Object.fromEntries(l.parts.map(p=>[p.plugin.part,p.id]))}));const sliders=special.sliders.map(sl=>({a:sl.a?.id,b:sl.b?.id,offsetY:sl.offsetY,originAlong:sl.originAlong,min:sl.min,max:sl.max,angleOffset:sl.angleOffset,visualUid:sl.visual?.plugin?.uid||null}));return {version:5,map:state.map,gravity:engine.gravity.y,timeScale:state.timeScale,camera:clone(state.camera),bodies,cons,pistons,sliders,livings};
}
function rebuildLivings(data,idMap){special.livings.clear();for(const o of data.livings||[]){const parts=[];const by={};for(const [role,old] of Object.entries(o.partIds||{})){const b=idMap.get(old);if(b){parts.push(b);by[role]=b;}}if(!parts.length)continue;const joints=Composite.allConstraints(engine.world).filter(c=>c.plugin?.livingJoint&&(c.bodyA?.plugin?.livingId===o.id||c.bodyB?.plugin?.livingId===o.id));special.livings.set(o.id,{id:o.id,type:o.type||'melon',name:o.name||'Living',parts,joints,...by,health:o.health??130,maxHealth:o.maxHealth??130,blood:o.blood||'#b84b4b',robot:!!o.robot,monster:!!o.monster,mode:o.mode||'stand',brain:o.brain!==false,dead:!!o.dead,phase:Math.random()*TAU,walkDir:o.walkDir||1,nextTurn:nowMs()+2500,nextBlink:nowMs()+1500,blinkUntil:0,knockoutUntil:0,drown:0,grips:[]});}}
function loadScene(data,keepHistory=true){
  state.loading=true;for(const c of Composite.allConstraints(engine.world))World.remove(engine.world,c);for(const b of Composite.allBodies(engine.world))if(!b.plugin?.boundary)World.remove(engine.world,b);special.pistons=[];special.sliders=[];special.livings.clear();state.map=data.map&&MAPS[data.map]?data.map:'yard';createMap(state.map,false);setGravity(Number.isFinite(data.gravity)?data.gravity:(MAPS[state.map].gravity||1));state.timeScale=data.timeScale||1;state.camera=data.camera||{x:0,y:150,zoom:1};document.getElementById('timeSlider').value=state.timeScale;document.getElementById('timeValue').textContent=state.timeScale.toFixed(2);
  const idMap=new Map();for(const o of data.bodies||[]){const b=deserializeBody(o);idMap.set(o.oldId,b);}for(const o of data.cons||[]){const a=o.a?idMap.get(o.a):null,b=o.b?idMap.get(o.b):null;const c=Constraint.create({bodyA:a||undefined,bodyB:b||undefined,pointA:o.pa,pointB:o.pb,length:o.length,stiffness:o.stiffness,damping:o.damping});c.plugin=clonePlugin(o.plugin);World.add(engine.world,c);}
  for(const p of data.pistons||[]){const base=idMap.get(p.base),rod=idMap.get(p.rod);if(base&&rod)special.pistons.push({id:p.id||base.plugin?.pistonId||uid(),base,rod,min:p.min||15,max:p.max||105,current:p.current||p.min||15,speed:p.speed||1.6});}
  for(const sl of data.sliders||[]){const a=idMap.get(sl.a),b=idMap.get(sl.b);if(a&&b){const visual=Composite.allConstraints(engine.world).find(c=>c.plugin?.kind==='slider'&&((c.bodyA===a&&c.bodyB===b)||(c.bodyA===b&&c.bodyB===a)));special.sliders.push({a,b,offsetY:sl.offsetY??0,originAlong:sl.originAlong??0,min:sl.min??-220,max:sl.max??220,angleOffset:sl.angleOffset??0,visual});}}
  rebuildLivings(data,idMap);state.selected=null;state.loading=false;updateSelectionUI();if(!keepHistory)recordHistory(true);
}
let preActionSnapshot=null;
function pushPreAction(){if(state.loading)return;preActionSnapshot=JSON.stringify(serializeScene());}
function recordHistory(force=false){if(state.loading)return;const snap=JSON.stringify(serializeScene());if(!force&&state.historyIndex>=0&&state.history[state.historyIndex]===snap){preActionSnapshot=null;return;}if(state.historyIndex<state.history.length-1)state.history=state.history.slice(0,state.historyIndex+1);if(preActionSnapshot&&state.history.length===0){state.history.push(preActionSnapshot);state.historyIndex=0;}state.history.push(snap);if(state.history.length>24)state.history.shift();state.historyIndex=state.history.length-1;preActionSnapshot=null;}
function undo(){if(state.historyIndex<=0){toast('Nothing to undo');return;}state.historyIndex--;loadScene(JSON.parse(state.history[state.historyIndex]),true);sfx('toggle');}
function redo(){if(state.historyIndex>=state.history.length-1){toast('Nothing to redo');return;}state.historyIndex++;loadScene(JSON.parse(state.history[state.historyIndex]),true);sfx('toggle');}
function saveBuild(){localStorage.setItem('mechyard.save.v4',JSON.stringify(serializeScene()));sfx('save');toast('Build saved on this device','good');}
function loadBuild(){const raw=localStorage.getItem('mechyard.save.v4')||localStorage.getItem('mechyard.save');if(!raw){toast('No saved build yet','bad');return;}pushPreAction();try{loadScene(JSON.parse(raw),true);recordHistory();toast('Build loaded','good');sfx('save');}catch{toast('Old save could not be loaded','bad');}}
function exportBuild(){const blob=new Blob([JSON.stringify(serializeScene(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mechyard-build-v4.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);sfx('save');}
function importBuild(file){const r=new FileReader();r.onload=()=>{try{pushPreAction();loadScene(JSON.parse(r.result),true);recordHistory();toast('Build imported','good');sfx('save');}catch{toast('That build file is invalid','bad');}};r.readAsText(file);}

function getRotationMods(){const bucket=Math.floor(Date.now()/(3*60*60*1000)),out=[];for(let i=0;i<8;i++){const idx=(bucket*11+i*7+i*i)%WORKSHOP_POOL.length;if(!out.includes(WORKSHOP_POOL[idx]))out.push(WORKSHOP_POOL[idx]);}for(let i=0;out.length<14&&i<WORKSHOP_POOL.length;i++)if(!out.includes(WORKSHOP_POOL[i]))out.push(WORKSHOP_POOL[i]);return out.slice(0,14);}
function openWorkshop(){document.getElementById('workshopPanel').classList.remove('hidden');renderWorkshop();sfx('open');}
function modArtHTML(art){if(art==='verity')return '<div class="verityOrb"><i class="veritySmile"></i></div>';if(art==='monster')return '<div class="monsterMini"></div>';return '<div class="genericModArt"></div>';}
function renderWorkshop(){const grid=document.getElementById('workshopGrid');grid.innerHTML='';for(const m of [...FEATURED_MODS,...getRotationMods()]){const installed=installedMods.has(m.id),card=document.createElement('button');card.className='workshopItem';card.innerHTML=`<span class="modBadge">${installed?'INSTALLED':(m.rarity||'ROTATING')}</span><div class="workshopArt">${modArtHTML(m.art)}</div><b>${m.title}</b><p>${m.desc}</p>`;card.onclick=()=>openModDetail(m);grid.appendChild(card);}}
function openModDetail(m){state.currentMod=m;document.getElementById('modTitle').textContent=m.title;document.getElementById('modAuthor').textContent=m.author||'Workshop';document.getElementById('modDescription').textContent=m.desc;document.getElementById('modFeatures').innerHTML=(m.features||[]).map(x=>`<span>${x}</span>`).join('');const btn=document.getElementById('modInstallButton');btn.textContent=installedMods.has(m.id)?'INSTALLED — READY IN MODS':'INSTALL TO SPAWN MENU';btn.disabled=installedMods.has(m.id);btn.onclick=()=>{installedMods.add(m.id);localStorage.setItem('mechyard.installedMods',JSON.stringify([...installedMods]));btn.textContent='INSTALLED — READY IN MODS';btn.disabled=true;renderItems();renderWorkshop();sfx('install');toast(m.title+' installed','good');};drawModPreview(m);document.getElementById('modDetail').classList.remove('hidden');}
function drawModPreview(m){const c=document.getElementById('modPreview'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);const grad=g.createLinearGradient(0,0,c.width,c.height);grad.addColorStop(0,'#0d151f');grad.addColorStop(1,'#171522');g.fillStyle=grad;g.fillRect(0,0,c.width,c.height);g.strokeStyle='rgba(255,255,255,.05)';for(let x=0;x<c.width;x+=40){g.beginPath();g.moveTo(x,0);g.lineTo(x,c.height);g.stroke();}for(let y=0;y<c.height;y+=40){g.beginPath();g.moveTo(0,y);g.lineTo(c.width,y);g.stroke();}
  if(m.art==='verity'){g.translate(c.width/2,c.height/2);g.fillStyle='#e8d454';g.beginPath();g.arc(0,0,74,0,TAU);g.fill();g.fillStyle='#151515';g.beginPath();g.arc(-21,-14,5,0,TAU);g.arc(21,-14,5,0,TAU);g.fill();g.strokeStyle='#151515';g.lineWidth=5;g.beginPath();g.arc(0,4,31,.2*Math.PI,.8*Math.PI);g.stroke();return;}
  if(m.art==='monster'){g.translate(c.width/2,c.height/2+20);g.fillStyle='#c9bc59';g.fillRect(-32,-62,64,155);g.beginPath();g.arc(0,-95,47,0,TAU);g.fill();g.fillRect(-86,-54,24,145);g.fillRect(62,-54,24,145);return;}
  g.translate(c.width/2,c.height/2);g.fillStyle=m.art==='mech'?'#327984':'#536473';g.fillRect(-48,-70,96,115);g.fillRect(-86,-45,28,110);g.fillRect(58,-45,28,110);g.fillRect(-38,45,30,105);g.fillRect(8,45,30,105);g.fillStyle='#dda62a';g.fillRect(-4,-65,8,200);g.fillStyle='#edf8fb';g.fillRect(-28,-112,56,24);g.fillStyle='#94a2ad';g.fillRect(-38,-125,76,18);
}
function updateRotation(){const bucket=Math.floor(Date.now()/(3*60*60*1000));if(state.lastRotationBucket!==null&&bucket!==state.lastRotationBucket){if(!document.getElementById('workshopPanel').classList.contains('hidden'))renderWorkshop();toast('Workshop rotation changed — new packs appeared','good');}state.lastRotationBucket=bucket;const next=(bucket+1)*3*60*60*1000-Date.now(),h=Math.floor(next/3600000),m=Math.floor((next%3600000)/60000),s=Math.floor((next%60000)/1000);document.getElementById('rotationTimer').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}


// ---------- SLIDER / BACKGROUND CONNECTIONS ----------
function createWorldAnchor(world){
  const a=Bodies.circle(world.x,world.y,3,{isStatic:true,isSensor:true});
  a.plugin={uid:uid(),name:'World Anchor',kind:'anchorPoint',hidden:true,backgroundAnchor:true,radius:3};
  World.add(engine.world,a);return a;
}
function createSliderJoint(a,worldA,b,worldB){
  if(!a||!b||a===b)return null;
  const rel=Vector.rotate(Vector.sub(b.position,a.position),-a.angle);
  const vis=addConstraintWorld(a,worldA,b,worldB,{length:dist(worldA,worldB),stiffness:0,damping:0,kind:'slider',plugin:{visualOnly:true}});
  const s={a,b,offsetY:rel.y,originAlong:rel.x,min:rel.x-220,max:rel.x+220,angleOffset:normAngle(b.angle-a.angle),visual:vis};
  special.sliders.push(s);return s;
}
function updateSliderJoints(){
  const bodies=new Set(Composite.allBodies(engine.world));
  special.sliders=special.sliders.filter(s=>bodies.has(s.a)&&bodies.has(s.b));
  for(const s of special.sliders){
    const a=s.a,b=s.b;if(!a||!b||b.isStatic)continue;
    const axis=rotatePoint({x:1,y:0},a.angle),perp={x:-axis.y,y:axis.x},rel=Vector.sub(b.position,a.position);
    let along=rel.x*axis.x+rel.y*axis.y;along=clamp(along,s.min,s.max);
    const desired={x:a.position.x+axis.x*along+perp.x*s.offsetY,y:a.position.y+axis.y*along+perp.y*s.offsetY};
    const dx=desired.x-b.position.x,dy=desired.y-b.position.y;
    Body.setPosition(b,{x:b.position.x+dx*.58,y:b.position.y+dy*.58});
    const v=b.velocity,perpV=v.x*perp.x+v.y*perp.y;Body.setVelocity(b,{x:v.x-perp.x*perpV*.72,y:v.y-perp.y*perpV*.72});
    stabilizeBody(b,a.angle+s.angleOffset,.055,.86);
  }
}

// ---------- SPAWN MENU / MAPS ----------
function itemIcon(key){
  if(key.startsWith('tool:'))return 'LINK';
  if(key.startsWith('build_'))return 'BUILD';
  if(key.startsWith('mod_'))return 'MOD';
  if(LIVING_TYPES[key])return 'LIVE';
  const p=spawnDefs[key]||{};
  if(p.wheel)return 'WHEEL';if(p.poweredType==='piston')return 'PISTON';if(p.source)return 'LOGIC';if(p.poweredType)return 'POWER';
  return p.shape==='circle'?'ROUND':'PART';
}
function currentItems(){
  if(state.category==='mods'){
    return allMods().filter(m=>installedMods.has(m.id)).map(m=>[m.spawnKey,m.title,m.desc||'Installed Workshop item']);
  }
  return categories[state.category]||[];
}
function armSpawn(key,card){
  if(key.startsWith('tool:')){setTool(key.slice(5));return;}
  state.spawnKey=key;state.tool='select';state.toolFirst=null;
  document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool==='select'));
  document.querySelectorAll('.itemCard').forEach(c=>c.classList.toggle('active',c===card));
  const entry=currentItems().find(x=>x[0]===key);document.getElementById('hint').textContent=`${entry?.[1]||'Item'} armed — tap the world to spawn, or drag this card into the world.`;
}
function renderItems(){
  const grid=document.getElementById('itemGrid'),q=(document.getElementById('itemSearch').value||'').trim().toLowerCase();grid.innerHTML='';
  let items=currentItems();if(q)items=items.filter(x=>(x[1]+' '+x[2]).toLowerCase().includes(q));
  if(!items.length){const empty=document.createElement('div');empty.className='emptyState';empty.textContent=state.category==='mods'?'Install Workshop packs to add them here.':'No items match your search.';grid.appendChild(empty);return;}
  for(const [key,name,desc] of items){
    const card=document.createElement('button');card.className='itemCard'+(state.spawnKey===key?' active':'');card.dataset.key=key;
    card.innerHTML=`<span class="itemGlyph">${itemIcon(key)}</span><b>${name}</b><small>${desc}</small>`;
    card.onclick=()=>{if(nowMs()<(state.suppressCardClickUntil||0))return;armSpawn(key,card);};
    card.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;state.itemDrag={key,name,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moved:false,pointerId:e.pointerId};});
    grid.appendChild(card);
  }
}
function updateDragGhost(){const d=state.itemDrag,ghost=document.getElementById('dragGhost');if(!d||!d.moved){ghost.classList.add('hidden');return;}ghost.classList.remove('hidden');ghost.style.left=d.x+'px';ghost.style.top=d.y+'px';document.getElementById('dragGhostName').textContent=d.name;document.getElementById('dragGhostIcon').textContent=itemIcon(d.key);}
window.addEventListener('pointermove',e=>{const d=state.itemDrag;if(!d||d.pointerId!==e.pointerId)return;d.x=e.clientX;d.y=e.clientY;if(Math.hypot(d.x-d.startX,d.y-d.startY)>7)d.moved=true;updateDragGhost();},{passive:true});
window.addEventListener('pointerup',e=>{const d=state.itemDrag;if(!d||d.pointerId!==e.pointerId)return;state.itemDrag=null;document.getElementById('dragGhost').classList.add('hidden');if(!d.moved)return;state.suppressCardClickUntil=nowMs()+350;const r=canvas.getBoundingClientRect();if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){const w=screenToWorld({x:e.clientX,y:e.clientY});pushPreAction();spawnPart(d.key,w.x,w.y,true);recordHistory();sfx('place');toast(d.name+' spawned','good');}},{passive:true});

function renderMapCards(){
  const grid=document.getElementById('mapGrid');if(!grid)return;grid.innerHTML='';
  for(const [key,m] of Object.entries(MAPS)){const b=document.createElement('button');b.className='mapCard'+(state.map===key?' active':'');b.innerHTML=`<div class="mapPreview ${m.preview||'default'}"><i></i></div><b>${m.name}</b><small>${m.desc}</small>`;b.onclick=()=>{pushPreAction();createMap(key,true);recordHistory();renderMapCards();document.getElementById('mapPanel').classList.add('hidden');toast(m.name+' loaded','good');};grid.appendChild(b);}
}

// ---------- AUDIO ----------
let audioCtx=null,musicTimer=null,musicNodes=[];
function audioUnlock(){try{if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch{}}
function sfx(name){if(!state.sfx)return;audioUnlock();if(!audioCtx)return;const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);const spec={place:[230,120,.07],connect:[560,310,.08],delete:[135,65,.10],toggle:[690,450,.055],save:[760,440,.11],open:[350,230,.06],install:[430,880,.17]}[name]||[300,190,.06];o.type=name==='delete'?'sawtooth':'sine';o.frequency.setValueAtTime(spec[0],t);o.frequency.exponentialRampToValueAtTime(Math.max(20,spec[1]),t+spec[2]);g.gain.setValueAtTime(.038,t);g.gain.exponentialRampToValueAtTime(.001,t+spec[2]);o.start(t);o.stop(t+spec[2]);}
function setMusic(on){state.music=on;localStorage.setItem('mechyard.music',on?'1':'0');if(!on){if(musicTimer)clearInterval(musicTimer);musicTimer=null;musicNodes.forEach(n=>{try{n.stop()}catch{}});musicNodes=[];return;}audioUnlock();if(!audioCtx||musicTimer)return;const chord=()=>{if(!state.music||!audioCtx)return;const t=audioCtx.currentTime,roots=[82.41,92.5,73.42,98][Math.floor(Date.now()/6000)%4];[1,1.5,2,3].forEach((mul,i)=>{const o=audioCtx.createOscillator(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();o.type=i<2?'sine':'triangle';o.frequency.value=roots*mul;f.type='lowpass';f.frequency.value=480;o.connect(f);f.connect(g);g.connect(audioCtx.destination);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.008/(i+1),t+.65);g.gain.linearRampToValueAtTime(0,t+5.2);o.start(t);o.stop(t+5.3);musicNodes.push(o);});};chord();musicTimer=setInterval(chord,6000);}

// ---------- UI BINDINGS ----------
function bindUI(){
  document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tool==='select')state.spawnKey=null;setTool(b.dataset.tool);}));
  document.querySelectorAll('#categoryTabs button').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.category;document.querySelectorAll('#categoryTabs button').forEach(x=>x.classList.toggle('active',x===b));state.spawnKey=null;renderItems();}));
  document.getElementById('itemSearch').addEventListener('input',renderItems);document.getElementById('clearSearch').onclick=()=>{document.getElementById('itemSearch').value='';renderItems();};
  document.getElementById('libraryToggle').onclick=()=>document.getElementById('libraryPanel').classList.toggle('open');document.getElementById('libraryClose').onclick=()=>document.getElementById('libraryPanel').classList.remove('open');
  document.getElementById('mapButton').onclick=()=>{renderMapCards();document.getElementById('mapPanel').classList.remove('hidden');};document.getElementById('settingsButton').onclick=()=>document.getElementById('settingsPanel').classList.remove('hidden');
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.classList.add('hidden'));
  document.getElementById('undoButton').onclick=undo;document.getElementById('redoButton').onclick=redo;
  document.getElementById('pauseButton').onclick=()=>{state.paused=!state.paused;document.getElementById('pauseButton').textContent=state.paused?'PLAY':'PAUSE';toast(state.paused?'Physics paused':'Physics resumed');};
  document.getElementById('slowButton').onclick=()=>{state.timeScale=state.timeScale>.75?.25:1;document.getElementById('timeSlider').value=state.timeScale;document.getElementById('timeValue').textContent=state.timeScale.toFixed(2);document.getElementById('slowButton').textContent=state.timeScale<.75?'0.25X':'1X';};
  document.getElementById('gravitySlider').oninput=e=>setGravity(+e.target.value);document.getElementById('timeSlider').oninput=e=>{state.timeScale=+e.target.value;document.getElementById('timeValue').textContent=state.timeScale.toFixed(2);document.getElementById('slowButton').textContent=state.timeScale.toFixed(2)+'X';};
  document.getElementById('grabSlider').oninput=e=>{state.grabStrength=+e.target.value/100;document.getElementById('grabValue').textContent=e.target.value;};document.getElementById('touchRadiusSlider').oninput=e=>{state.touchRadius=+e.target.value;document.getElementById('touchRadiusValue').textContent=e.target.value;};
  document.getElementById('jointToggle').onchange=e=>state.showJoints=e.target.checked;document.getElementById('gridToggle').onchange=e=>state.showGrid=e.target.checked;document.getElementById('snapToggle').onchange=e=>state.snap=e.target.checked;document.getElementById('damageToggle').onchange=e=>state.damage=e.target.checked;
  document.getElementById('sfxToggle').onchange=e=>{state.sfx=e.target.checked;localStorage.setItem('mechyard.sfx',state.sfx?'1':'0');};document.getElementById('musicToggle').onchange=e=>setMusic(e.target.checked);
  document.getElementById('saveButton').onclick=saveBuild;document.getElementById('loadButton').onclick=loadBuild;document.getElementById('exportButton').onclick=exportBuild;document.getElementById('importButton').onclick=()=>document.getElementById('importFile').click();document.getElementById('importFile').onchange=e=>{if(e.target.files?.[0])importBuild(e.target.files[0]);e.target.value='';};document.getElementById('workshopButton').onclick=openWorkshop;
  document.getElementById('resetCamera').onclick=()=>{state.camera={x:0,y:150,zoom:1};state.followBody=null;};
  document.getElementById('clearLivingButton').onclick=clearLiving;document.getElementById('clearEverythingButton').onclick=()=>clearWorld(true);
  document.getElementById('selectionMore').onclick=openContext;document.getElementById('selFreeze').onclick=()=>state.selected&&freezeBody(resolveRoot(state.selected));document.getElementById('selActivate').onclick=()=>state.selected&&toggleSource(resolveRoot(state.selected));document.getElementById('selCopy').onclick=()=>state.selected&&duplicateBody(state.selected);document.getElementById('selDelete').onclick=()=>state.selected&&deleteBody(state.selected,true);
  document.querySelectorAll('[data-living-action]').forEach(b=>b.onclick=()=>{const l=livingForBody(state.selected);if(!l)return;const a=b.dataset.livingAction;if(a==='heal')healLiving(l);else if(a==='grab')grabNearestLiving(l);else if(a==='release')releaseLiving(l);else if(a==='brain'){l.brain=!l.brain;toast(l.name+' AI '+(l.brain?'enabled':'disabled'));}else if(a==='jump'){l.brain=true;if(l.hips&&!l.hips.isStatic)Body.applyForce(l.hips,l.hips.position,{x:0,y:-.018*l.hips.mass*Math.sign(engine.gravity.y||1)});}else if(a==='recover'){l.brain=true;l.knockoutUntil=0;l.mode='recover';}else setLivingMode(l,a);updateSelectionUI();});
}

// ---------- CONTEXT FOLLOW / CAMERA ----------
function followSelected(){if(state.selected){state.followBody=state.followBody===state.selected?null:state.selected;toast(state.followBody?'Camera following object':'Camera follow off');}}
function addFollowAction(){const actions=document.getElementById('contextActions');if(!actions||!state.selected)return;const b=document.createElement('button');b.textContent=state.followBody===state.selected?'STOP FOLLOW':'FOLLOW CAMERA';b.onclick=()=>{followSelected();openContext();};actions.prepend(b);}
const originalOpenContext=openContext;
openContext=function(){originalOpenContext();addFollowAction();};

// ---------- MAIN LOOP ----------
function simulationStep(now,dt){
  if(state.paused)return;
  const scaled=clamp(dt,4,33)*state.timeScale;state.worldTime+=scaled;
  applyPoweredSystems(now,scaled);updateSliderJoints();updateLivings(now,scaled);applyZones();Engine.update(engine,scaled);updateParticles(scaled);
}
function updateHud(now){
  if(state.followBody&&Composite.allBodies(engine.world).includes(state.followBody)){state.camera.x=lerp(state.camera.x,state.followBody.position.x,.12);state.camera.y=lerp(state.camera.y,state.followBody.position.y,.12);}else if(state.followBody)state.followBody=null;
  state.frameTimes.push(Math.max(1,now-state.lastFrame));if(state.frameTimes.length>45)state.frameTimes.shift();const avg=state.frameTimes.reduce((a,b)=>a+b,0)/state.frameTimes.length;state.fps=Math.round(1000/avg);document.getElementById('fpsText').textContent=String(state.fps);document.getElementById('objectCount').textContent=String(Composite.allBodies(engine.world).filter(b=>!b.plugin?.boundary&&!b.plugin?.backgroundAnchor).length);
  if(!state.lastRotationTick||now-state.lastRotationTick>1000){state.lastRotationTick=now;updateRotation();}
}
render=function(){
  resizeCanvas();const now=performance.now(),dt=Math.min(50,now-state.lastFrame||16.67);simulationStep(now,dt);drawBackground();beginWorldTransform();drawGrid();drawZones();
  const bodies=Composite.allBodies(engine.world).slice().sort((a,b)=>(a.plugin?.z||0)-(b.plugin?.z||0));for(const b of bodies)drawBody(b);for(const c of Composite.allConstraints(engine.world))drawConstraint(c);drawSelection();drawParticles();updateHud(now);state.lastFrame=now;requestAnimationFrame(render);
};

// ---------- INIT ----------
function init(){
  state.sfx=localStorage.getItem('mechyard.sfx')!=='0';state.music=localStorage.getItem('mechyard.music')==='1';document.getElementById('sfxToggle').checked=state.sfx;document.getElementById('musicToggle').checked=state.music;
  bindUI();createMap('yard',true);renderItems();renderMapCards();setTool('select');recordHistory(true);resizeCanvas();if(state.music)setMusic(true);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});
  requestAnimationFrame(render);toast('Mechyard ready — swipe, build, wire and break things','good');
}
init();
})();
