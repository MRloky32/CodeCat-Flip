// =============================================================================
//  CodeCat Flip, Level 1 (tutorial)
//  Edit this map to change the level. The game reads it on load.
// =============================================================================
//
//  6 rows, top to bottom: ceiling tiles, 4 rows of open space, floor tiles.
//  Each character is one square. Every row must have the same length.
//
//    #  solid floor / ceiling tile (top and bottom rows)
//    B  wall block (solid, CodeCat cannot walk through it)
//    ^  spike on the floor (pointing up)
//    v  spike on the ceiling (pointing down)
//    o  coin
//    *  optional star (risk / reward)
//    <  enemy arrow that starts moving left
//    >  enemy arrow that starts moving right
//    S  start (CodeCat begins here, standing on the floor)
//    F  goal flag (reaching this column ends the level)
//    .  empty space
//
//  Enemies walk along the floor or ceiling, one square per beat, and turn
//  around when they hit a wall, a spike or the edge of the level.
//
//  Sections (12 columns each):  1 Introduction | 2 Development + Twist | 3 Conclusion
//                                0         1         2         3
//                                012345678901234567890123456789012345
window.LEVEL_MAP = [
  "####################################",
  ".....oooB....vv...........<v..o.v.o.",
  ".....B..B...........................",
  ".....B..B...........................",
  "S....B..........^..*<.^.......^.o.^F",
  "####################################",
];
