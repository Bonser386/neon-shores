// Neon Shores — shared tuning and content data.
// Single source of truth for world layout, speeds, economy and missions.
// (Next session: police.js reads wanted, missions.js reads missions, hud.js reads colors/clock.)

export const CONFIG = {
  // ---- world layout: 8x8 blocks, roads on a 70 m pitch ----
  world: {
    gridN: 8,            // blocks per side
    spacing: 70,         // road centreline pitch (m)
    roadWidth: 14,       // driving surface width (m)
    sidewalk: 4,         // sidewalk width each side of a road (m)
    half: 280,           // road 0 is at -280, road 8 at +280
    bound: 320,          // playable clamp (m); ocean starts east of this
  },

  // ---- districts (by block centre) ----
  // north (z < -140): downtown — tall towers
  // east  (x >  140): beach — hotels, palms, boardwalk, ocean
  // south (z >  140): port — warehouses, containers, cranes
  // west  (x < -140): suburbs — low houses
  // else: midtown — medium blocks

  // ---- player (Rico Vega, on foot) ----
  player: {
    walkSpeed: 6.5,      // m/s
    runSpeed: 10.5,      // m/s (Shift)
    accel: 40,           // m/s^2
    radius: 0.6,         // collision radius (m)
    health: 100,
    magSize: 12,         // pistol rounds per magazine
    reserve: Infinity,   // infinite reserve ammo
    reloadTime: 1.0,     // s
    punchRange: 2.4,     // m
    punchDamage: 25,
    shootRange: 45,      // m
    shootDamage: 34,
    shootCooldown: 0.22, // s between shots
  },

  // ---- cars ----
  car: {
    accel: 20,           // m/s^2
    brake: 34,           // m/s^2
    reverseAccel: 12,
    maxSpeed: 40,        // m/s (~144 km/h)
    maxReverse: 12,      // m/s
    steer: 2.1,          // rad/s at low speed, scaled down with speed
    grip: 8,             // lateral damping
    trafficSpeed: 9,     // m/s cruise for AI traffic
    trafficSpeedJitter: 2,
    laneOffset: 3.2,     // right-hand lane offset from centreline (m)
  },

  // ---- population ----
  traffic: { moving: 16, parked: 7 },   // 24 cars total (16 traffic + 7 parked + gold coupe)
  peds: { count: 28, walkSpeed: 1.6, fleeSpeed: 7.0 },

  // ---- wanted level (police.js reads this) ----
  wanted: {
    maxStars: 5,
    decayPerSec: 0.045,  // stars fade when no crime is committed
    stealStars: 1,       // stealing a car
    punchStars: 1,       // punching a pedestrian
    shootStars: 2,       // firing the pistol (per shot that hits / is heard)
    killStars: 3,        // killing a pedestrian
    chaseTrigger: 1,     // stars >= this: police chase
  },

  // ---- missions (missions.js implements the logic; data lives here) ----
  missions: [
    {
      id: 'first-wheels',
      name: 'First Wheels',
      blurb: 'Steal a car and drive to the pickup on the boardwalk.',
      reward: 250,
    },
    {
      id: 'gold-coupe',
      name: 'Gold Standard',
      blurb: 'Steal the gold coupe and deliver it to the chop shop.',
      reward: 600,
    },
    {
      id: 'lose-heat',
      name: 'Lose the Heat',
      blurb: 'Get a 3-star wanted level, then lose the tail.',
      reward: 500,
    },
    {
      id: 'cash-drops',
      name: 'Cash Drops',
      blurb: 'Collect 5 cash drops scattered around Solmar.',
      reward: 800,
    },
    {
      id: 'dock-run',
      name: 'Dock Run',
      blurb: 'Final delivery at the docks — under pursuit.',
      reward: 1500,
    },
  ],

  // ---- look: golden hour ----
  colors: {
    sky: 0xff9a52,
    fog: 0xf79c5e,
    sun: 0xffb36b,
    ground: 0x35302a,
    road: 0x3a3d42,
    sidewalk: 0x8d8578,
    ocean: 0x14506e,
    boardwalk: 0x8a6b4a,
    buildingDowntown: 0x4a4a58,
    buildingMidtown: 0x5a4a42,
    buildingHouse: 0x6b5a48,
    buildingPort: 0x4a5560,
  },

  // ---- in-game clock ----
  clock: { startHour: 17, startMinute: 45, minutesPerSecond: 0.5 },

  saveKey: 'neon-shores-save-v1',
};

// Road centreline coordinate for road index i (0..8).
export function roadCoord(i) {
  return -CONFIG.world.half + i * CONFIG.world.spacing;
}
