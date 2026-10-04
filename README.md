# Mechyard Sandbox v2

A mobile-first 2D physics construction sandbox for GitHub Pages and iPhone/iPad browsers. The project is intentionally flat: every file belongs in the repository root and there are no folders inside the ZIP.

## Major v2 improvements
- Strong direct object dragging with a configurable mobile touch radius and grab strength.
- Frozen objects can still be repositioned directly without unfreezing them first.
- One-finger swipe on empty world space pans the camera.
- Two-finger pinch both zooms and pans around the gesture center.
- Spawn-menu items can be tapped to arm them or dragged directly into the world.
- Active living entities: Melon, Pumpkin, Corn, Apple, Cactus, Robot, Test Dummy and Heavy Bot use balance/recovery logic rather than acting as passive ragdolls. They can stand, wander, run, follow the cursor, sit, sleep, jump, recover from falls, grab nearby objects, release them and heal.
- Living entities blink, take impact damage, can be knocked out, drown in water, take lava damage and can be repaired/healed.
- 17 maps: Build Yard, Endless Flat, Warehouse, Deep Water, Endless Ocean, Green Hills, Skate Park, Highway, Block City, Mega Stairs, Vertical Tower, Test Laboratory, Moon, Zero-G Chamber, Volcano, Desert Basin and Machine Pit.
- Working low gravity, zero gravity, water buoyancy and lava hazard environments.
- Expanded building library with beams, rods, plates, armor, wood, glass, rubber, ice, concrete, wheels, motor wheels and utility parts.
- Physical rope, steel cable, fixed rope, rigid rod, slider rail, spring, suspension, winch rope, pin joints, welds and activation wires.
- Connections can anchor to the map/background, which is useful for cranes, suspended builds and giant mechs.
- Motors, pistons, gyroscopes, servos, thrusters, rotors, propellers, conveyors, accelerators, rope controllers, magnets, pressure pads, timers, impact sensors, proximity sensors, gravity cores, repulsors, lift cells and healing modules.
- Premade block-built mech, titan, rover, spider walker, crane, hover platform, submarine and piston-lift starters.
- Context controls for freeze, collisions, gravity, rotation lock, camera follow, duplicate, flip, rotate, resize and layer order.
- Per-machine tuning for motor speed, gyro target/strength, thruster power, field power, conveyor speed, winch speed, timer interval, sensor range and piston travel/speed.
- Local save/load, undo/redo and JSON build import/export.
- Verity and Verity Monster remain permanently featured in Workshop. Eight additional original machine packs rotate every three hours and installed packs appear in the MODS spawn category.
- No advertising system is included.

## Controls
- Tap an item in the spawn menu and tap the world to place copies.
- Drag an item card from the spawn menu directly into the world to place it exactly where you drop it.
- HAND: drag objects. Swipe empty world space to move the camera.
- Two fingers: pinch to zoom and move both fingers to pan.
- Double-tap an object, long-press it on touch, or press MORE for its context options.
- ACT: toggle buttons, sources and powered mechanisms.
- ROPE / CABLE: create physical segmented connections.
- FIXED: keep two points at a nearly fixed distance.
- SLIDER: constrain a second body to a one-axis rail on the first body.
- ROD: create a rigid physical linkage.
- SPRING / SUSP: create elastic or damped connections.
- WINCH: connect a retractable line; attach one end to a Rope Controller for powered retraction.
- PIN: create a rotating point joint.
- WELD: rigidly attach two bodies.
- WIRE: connect a button, timer or sensor to a powered machine.
- FREEZE: lock or unlock an object.
- NOCOL: disable or restore an object's collisions.
- DELETE: remove an object or whole living assembly.

## GitHub Pages
Upload the files from the ZIP directly into the root of a GitHub repository and enable GitHub Pages. Matter.js 0.20.0 is loaded from jsDelivr on the first successful online load. The service worker then caches the local game files and fetched assets for later use.
