// MediaPipe Hand landmark indices (21 points)
//   0 wrist
//   1-4   thumb  (cmc, mcp, ip, tip)
//   5-8   index  (mcp, pip, dip, tip)
//   9-12  middle (mcp, pip, dip, tip)
//   13-16 ring   (mcp, pip, dip, tip)
//   17-20 pinky  (mcp, pip, dip, tip)

const WRIST = 0;
const PALM = 9; // middle-finger MCP ≈ palm centre

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// A non-thumb finger is "extended" when its tip is farther from the wrist
// than its PIP joint. Orientation-independent — works in any hand pose.
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.04;
}

// Thumb: extended when the tip is farther from the palm centre than its MCP.
function thumbExtended(lm) {
  return dist(lm[4], lm[PALM]) > dist(lm[2], lm[PALM]) * 1.1;
}

/**
 * Classify a single hand's gesture from its landmarks.
 * @returns {{name:string, cursor:{x:number,y:number}, fingers:object}}
 *   name ∈ "draw" | "erase" | "clear" | "solve" | "none"
 *   cursor is in normalized [0..1] coords of the ORIGINAL (un-mirrored) frame.
 */
export function detectGesture(lm) {
  const index = fingerExtended(lm, 8, 6);
  const middle = fingerExtended(lm, 12, 10);
  const ring = fingerExtended(lm, 16, 14);
  const pinky = fingerExtended(lm, 20, 18);
  const thumb = thumbExtended(lm);

  const fingers = { thumb, index, middle, ring, pinky };

  // Thumb-only gestures: four fingers folded + thumb extended vertically.
  const fourFolded = !index && !middle && !ring && !pinky;
  if (fourFolded && thumb) {
    // 👎 Thumbs-down → clear (thumb tip clearly below the wrist).
    if (lm[4].y > lm[WRIST].y + 0.04 && lm[4].y > lm[2].y) {
      return { name: "clear", cursor: lm[4], fingers };
    }
    // 👍 Thumbs-up → solve (thumb tip clearly above the wrist).
    if (lm[4].y < lm[WRIST].y - 0.04 && lm[4].y < lm[2].y) {
      return { name: "solve", cursor: lm[4], fingers };
    }
  }

  // 🖐️ Open hand → erase at palm centre. Keyed on the three non-index fingers
  // (middle+ring+pinky) so ring/pinky jitter can't flip it on accidentally.
  if (middle && ring && pinky) {
    return { name: "erase", cursor: lm[PALM], fingers };
  }

  // ☝️ Index finger up, middle down → draw at the index tip.
  // Ring/pinky are deliberately ignored: they wobble the most and would
  // otherwise cause the pen to lift mid-stroke.
  if (index && !middle) {
    return { name: "draw", cursor: lm[8], fingers };
  }

  return { name: "none", cursor: lm[8], fingers };
}
