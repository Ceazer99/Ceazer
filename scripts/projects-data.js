/* ============================================================
   PROJECTS CONTENT - edit this file to add or change projects.
   ============================================================

   HOW TO ADD A PROJECT
   1. Put web-ready photos in images/projects/ named
        <slug>-1.webp, <slug>-2.webp ...        (large, ~1600px)
        <slug>-1-sm.webp, <slug>-2-sm.webp ...  (small, ~720px)
      Photo 1 is the cover.
   2. Copy one of the entries below and change the text.
      - featured: true  → big card in the top grid
      - featured: false → tile in the "More projects" gallery
      - photos: one description per photo (used for accessibility + Google)
      - videos: optional, files in videos/ (see existing entries)
      - fit: 'contain' shows the whole image (best for CAD renders on white);
             leave it out to fill the frame (best for photos).
   ============================================================ */

window.C3D_CATEGORIES = [
  { id: 'robotics',  label: 'Robotics & Automation' },
  { id: 'energy',    label: 'Renewable Energy' },
  { id: 'vehicles',  label: 'Vehicles & Mobile Robots' },
  { id: 'products',  label: 'Enclosures & Parts' },
  { id: 'art',       label: 'Art & Models' },
];

window.C3D_PROJECTS = [
  /* ── Featured ─────────────────────────────────────────────── */
  {
    slug: 'wind-turbine',
    featured: true,
    category: 'energy',
    tag: 'Renewable Energy',
    title: 'Variable-Pitch Wind Turbine',
    desc: 'A small-scale wind turbine with active blade-pitch control: a motor and gear train inside the nacelle rotate the blades to suit the wind. Designed as a full CAD assembly, then printed and built into a working prototype.',
    chips: ['CAD Assembly', 'FDM Printing', 'Gear Design', 'Prototype'],
    photos: [
      'Assembled variable-pitch wind turbine prototype with purple 3D-printed blades',
      'CAD render of the wind turbine with anemometer and solar panel',
      'Cutaway CAD render showing the pitch gear train and motor inside the nacelle',
      'Close-up of the 3D-printed blade pitch mechanism at the turbine hub',
      'Printed gearbox housing with blue drive gears and DC motor',
    ],
    videos: [],
  },
  {
    slug: 'gripper',
    featured: true,
    category: 'robotics',
    tag: 'Robotics',
    title: 'Lead-Screw Robotic Gripper',
    desc: 'A motor-driven gripper whose fingers open and close along a lead screw. Taken all the way from CAD to printed parts, assembly and motion testing on a vertical lift rig.',
    chips: ['CAD Design', 'FDM Printing', 'Mechanism', 'Assembly'],
    photos: [
      'Robotic gripper mounted on a lead-screw lift rig with purple printed fingers',
      'Gripper assembly with grey 3D-printed fingers and drive electronics',
    ],
    videos: [
      { src: 'videos/gripper-v1.mp4', poster: 'images/projects/gripper-v1.webp', title: 'Printing the gripper parts on our FDM printer' },
      { src: 'videos/gripper-v2.mp4', poster: 'images/projects/gripper-v2.webp', title: 'Assembling the gripper on the lift rig' },
      { src: 'videos/gripper-v3.mp4', poster: 'images/projects/gripper-v3.webp', title: 'Gripper fingers opening and closing' },
      { src: 'videos/gripper-v4.mp4', poster: 'images/projects/gripper-v4.webp', title: 'CAD motion study of the gripper mechanism' },
    ],
  },
  {
    slug: 'outboard',
    featured: true,
    category: 'vehicles',
    tag: 'Marine',
    title: 'Outboard Motor Steering Mechanism',
    desc: 'A worm-gear drive that turns an outboard motor for electronic steering. The gear and worm were designed in CAD, printed, then fitted and tested on a working vessel.',
    chips: ['CAD Design', 'Worm Gear', 'FDM Printing', 'Field Testing'],
    photos: [
      '3D-printed worm and spur gear for an outboard motor steering system',
      'Steering gear fitted to the vessel alongside wiring and motor',
      'Installing the printed steering mechanism on the outboard motor',
    ],
    videos: [
      { src: 'videos/outboard-v1.mp4', poster: 'images/projects/outboard-v1.webp', title: 'CAD animation of the worm gear turning the motor' },
      { src: 'videos/outboard-v2.mp4', poster: 'images/projects/outboard-v2.webp', title: 'CAD animation of the full steering linkage' },
    ],
  },
  {
    slug: 'throttle',
    featured: true,
    category: 'robotics',
    tag: 'Control Systems',
    title: 'Servo Throttle Control Mechanism',
    desc: 'A servo-actuated throttle lever with an electronic control interface. The housing and linkage were modelled in CAD, printed, and tested under live control.',
    chips: ['CAD Design', 'Servo Actuation', 'Electronics', 'FDM Printing'],
    fit: 'contain',
    photos: [
      'CAD render of the servo-driven throttle lever and housing',
      'CAD render of the throttle mechanism with servo on its mounting base',
      'Printed throttle unit with handheld control display during testing',
    ],
    videos: [
      { src: 'videos/throttle-v1.mp4', poster: 'images/projects/throttle-v1.webp', title: 'Live throttle control test from a laptop' },
      { src: 'videos/throttle-v2.mp4', poster: 'images/projects/throttle-v2.webp', title: 'Servo driving the printed throttle lever' },
      { src: 'videos/throttle-v3.mp4', poster: 'images/projects/throttle-v3.webp', title: 'CAD animation of the throttle lever motion' },
    ],
  },
  {
    slug: 'robotic-arm',
    featured: true,
    category: 'robotics',
    tag: 'Robotics',
    title: 'C3D Desktop Robotic Arm',
    desc: 'Our own multi-axis desktop robotic arm with servo-driven joints and a two-finger gripper. Designed in CAD, then printed and assembled in-house.',
    chips: ['In-House Design', 'Multi-Axis', 'Servo Control', 'FDM Printing'],
    fit: 'contain',
    photos: [
      'CAD render of the C3D robotic arm with servo joints and gripper',
      'CAD render of the C3D robotic arm showing the branded upper arm',
    ],
    videos: [
      { src: 'videos/robotic-arm-v1.mp4', poster: 'images/projects/robotic-arm-v1.webp', title: 'The C3D robotic arm moving through its joints' },
    ],
  },
  {
    slug: 'moulds',
    featured: true,
    category: 'products',
    tag: 'Tooling',
    title: 'Moulding Inserts & Multi-Cavity Moulds',
    desc: 'Textured moulding inserts and a multi-cavity mould tray, designed in CAD and printed as tooling. A fast, low-cost alternative to machining for short runs and trials.',
    chips: ['Tooling', 'Textured Surfaces', 'CAD Design', 'FDM Printing'],
    photos: [
      'Set of 3D-printed circular moulding inserts with textured faces',
      'CAD render of a moulding insert with textured top surface',
      'Multi-cavity mould tray printed in grey',
      'Close-up of a textured wedge-shaped moulding insert',
    ],
    videos: [],
  },

  /* ── Gallery ──────────────────────────────────────────────── */
  {
    slug: 'robotic-hand', category: 'robotics', title: 'Robotic Hand',
    desc: 'Exploded CAD view of a servo-actuated robotic hand.',
    photos: ['Exploded CAD view of a robotic hand with printed fingers and servo'],
  },
  {
    slug: 'gimbal', category: 'robotics', title: 'Camera Gimbal System',
    desc: 'Two-axis servo gimbal for a camera, designed for printing.', fit: 'contain',
    photos: ['CAD render of a two-axis servo camera gimbal'],
    videos: [
      { src: 'videos/gimbal-v1.mp4', poster: 'images/projects/gimbal-v1.webp', title: 'CAD animation of the gimbal axes' },
    ],
  },
  {
    slug: 'solar-cleaner', category: 'robotics', title: 'Solar Panel Cleaning Robot',
    desc: 'Tracked robot concept that travels across solar panels to clean them.',
    photos: ['CAD render of a tracked robot driving across a solar panel array'],
  },
  {
    slug: 'rail-cart', category: 'robotics', title: 'Rail Cart Carriage',
    desc: 'Printed carriage plate with guide wheels for a rail system.', fit: 'contain',
    photos: ['3D-printed rail cart carriage plate with guide wheels'],
  },
  {
    slug: 'kaplan', category: 'energy', title: 'Kaplan Hydro Turbine',
    desc: 'Transparent CAD study of a compact Kaplan turbine with generator.', fit: 'contain',
    photos: ['Transparent CAD render of a compact Kaplan turbine and generator'],
    videos: [
      { src: 'videos/kaplan-v1.mp4', poster: 'images/projects/kaplan-v1.webp', title: 'CAD walkthrough of the Kaplan turbine assembly' },
    ],
  },
  {
    slug: 'robot-car', category: 'vehicles', title: 'Autonomous Robot Car',
    desc: 'Four-wheel robot car chassis with ultrasonic sensors, battery bay and printed body shell.',
    photos: [
      'CAD render of a robot car with transparent printed body shell',
      'CAD render of the robot car chassis with battery pack and sensors',
      'CAD render of the enclosed robot car body',
    ],
  },
  {
    slug: 'rc-car', category: 'vehicles', title: 'RC Pickup Truck',
    desc: 'Scale RC pickup with a full CAD drivetrain and printed body.', fit: 'contain',
    photos: ['CAD render of a blue RC pickup truck body', 'Transparent CAD render showing the RC truck drivetrain'],
    videos: [
      { src: 'videos/rc-car-v1.mp4', poster: 'images/projects/rc-car-v1.webp', title: 'CAD animation of the RC chassis' },
    ],
  },
  {
    slug: 'two-wheel-robot', category: 'vehicles', title: 'Two-Wheel Delivery Robot',
    desc: 'Compact two-wheel robot with ultrasonic sensing and a top cargo bin.', fit: 'contain',
    photos: ['CAD render of a two-wheel robot with ultrasonic sensors and cargo bin'],
  },
  {
    slug: 'rover-wheel', category: 'vehicles', title: 'Mars Rover Wheel',
    desc: 'Printed rover wheel with curved spokes and a treaded rim.',
    photos: ['3D-printed purple rover wheel with curved spokes', 'Side view of the printed rover wheel tread'],
  },
  {
    slug: 'hmi', category: 'products', title: 'HMI Control Enclosure',
    desc: 'Flip-down enclosure for a touchscreen operator panel.', fit: 'contain',
    photos: ['CAD render of a flip-down HMI touchscreen enclosure'],
    videos: [
      { src: 'videos/hmi-v1.mp4', poster: 'images/projects/hmi-v1.webp', title: 'The printed HMI enclosure flip mechanism in use' },
    ],
  },
  {
    slug: 'gear', category: 'products', title: 'Replacement Gears',
    desc: 'Gears modelled from the original part, printed in FDM and resin.',
    photos: [
      'Printed white gear held next to its CAD model on screen',
      'Printed white spur gear',
      'Grey resin-printed gear with integrated pinion',
    ],
  },
  {
    slug: 'ring', category: 'art', title: 'Patterned Ring',
    desc: 'Ring with a cut-through geometric pattern, modelled for printing.', fit: 'contain',
    photos: ['CAD render of a ring with a geometric cut-out pattern'],
  },
  {
    slug: 'horse', category: 'art', title: 'Horse Sculpture',
    desc: 'Detailed decorative horse sculpture printed in black.',
    photos: ['Black 3D-printed sculpture of a galloping horse'],
  },
  {
    slug: 'solar-tracker', category: 'energy', title: 'Solar Tracking Mechanism',
    desc: 'Dual-axis mechanism that turns a solar panel to follow the sun, from CAD to working unit.',
    photos: [],
    videos: [
      { src: 'videos/solar-tracker-v1.mp4', poster: 'images/projects/solar-tracker-v1.webp', title: 'Printed solar tracker on its test frame' },
      { src: 'videos/solar-tracker-v2.mp4', poster: 'images/projects/solar-tracker-v2.webp', title: 'CAD animation of the tracking motion' },
    ],
  },
  {
    slug: 'pelton', category: 'energy', title: 'Pelton Wheel',
    desc: 'Pelton turbine runner with cupped buckets, modelled for printing.',
    photos: [],
    videos: [
      { src: 'videos/pelton-v1.mp4', poster: 'images/projects/pelton-v1.webp', title: 'CAD animation of the Pelton runner' },
    ],
  },
  {
    slug: 'drone', category: 'robotics', title: 'Quadcopter Drone Frame',
    desc: 'Lightweight quadcopter frame designed in CAD.',
    photos: [],
    videos: [
      { src: 'videos/drone-v1.mp4', poster: 'images/projects/drone-v1.webp', title: 'CAD render of the drone frame' },
    ],
  },
  {
    slug: 'steering', category: 'vehicles', title: 'Servo Steering Mechanism',
    desc: 'Servo-driven front steering assembly for a small vehicle.',
    photos: [],
    videos: [
      { src: 'videos/steering-v1.mp4', poster: 'images/projects/steering-v1.webp', title: 'CAD animation of the steering linkage' },
    ],
  },
  {
    slug: 'smart-watch', category: 'products', title: 'Smart Watch Enclosure',
    desc: 'Compact wearable enclosure for a display and electronics, designed and printed.',
    photos: [],
    videos: [
      { src: 'videos/smart-watch-v1.mp4', poster: 'images/projects/smart-watch-v1.webp', title: 'The printed smart watch enclosure' },
      { src: 'videos/smart-watch-v2.mp4', poster: 'images/projects/smart-watch-v2.webp', title: 'CAD view of the enclosure and internals' },
    ],
  },
  {
    slug: 'house-model', category: 'art', title: 'Farmhouse Scale Model',
    desc: 'Printed architectural scale model of a farmhouse with fenced yard.',
    photos: [],
    videos: [
      { src: 'videos/house-model-v1.mp4', poster: 'images/projects/house-model-v1.webp', title: 'Close look at the printed farmhouse model' },
    ],
  },
];
