# CodeCat Flip

A 2D rhythm platformer starring CodeCat. You can only move on the beat: step, flip gravity or wait.

Up and Down point where CodeCat should be: they flip gravity when CodeCat is on the other surface and wait when it is already there. This came from the digital playtest. Miss 5 beats in a row and the level restarts.

This is the digital version of the paper prototype from Activity 02 (Video Game Design S03, CUCEI). It is one short tutorial level that teaches its mechanic through level design only, with no text on screen while you play.

**Play it:** https://mrloky32.github.io/CodeCat-Flip/

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Move left / right | ← → or A D | D-pad left / right |
| Go to the ceiling (or wait if already there) | ↑ or W | D-pad up |
| Go to the floor (or wait if already there) | ↓ or S | D-pad down |
| Flip gravity (toggle) | Space | A |
| Wait one beat | | B |
| Pause | Esc | Start |
| Restart | R | |

On a phone, on-screen buttons appear after the first tap.

## How to run it

No build step and nothing to install.

1. Download or clone this repository.
2. Open `index.html` in Chrome.

If your browser blocks local files, serve the folder instead, for example with `python3 -m http.server` and then open http://localhost:8000.

## Where to change things

| What | Where |
|---|---|
| The level map | `level.js` (one character per square, legend at the top of the file) |
| Tempo, timing windows, move and fall speed, camera | the **TUNING** block at the top of `game.js` |
| Art | `assets/` |

### Level map symbols

```
#  floor / ceiling tile      B  wall block
^  spike on the floor        v  spike on the ceiling
o  coin                      *  optional star
<  enemy moving left         >  enemy moving right
S  start                     F  goal flag
.  empty
```

Example of a live change: move the star one square to the right by moving `*` in `level.js`, or make the level faster by changing `BPM` at the top of `game.js`. Save and reload the page.

## Files

```
index.html     page and styles
level.js       the level as a text map
game.js        game logic, rendering and procedural music (Web Audio)
assets/        CodeCat sprite and title cover
```

## Credits

- Game design, level design, character and cover art: Louis Adrian García Núñez
- Code written with an AI assistant (Claude) from my design decisions, as allowed by the activity. The design rationale lists what I asked for and what I decided.
- Fonts: Pixelify Sans and Tiny5 (Google Fonts)
