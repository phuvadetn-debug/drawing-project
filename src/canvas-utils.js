/**
 * Canvas Drawing Utilities
 * Includes High-Performance Flood Fill and Smudge/Blending Brush calculations
 */

// Helper to convert hex color string to RGBA components
export function hexToRgba(hex, opacity = 1.0) {
  // Remove leading hash
  const cleanHex = hex.replace(/^#/, '');
  
  let r = 0, g = 0, b = 0;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }
  
  const a = Math.round(opacity * 255);
  return [r, g, b, a];
}

// Calculate color distance (Euclidean distance in RGBA space)
function colorDistance(c1, c2) {
  const dr = c1[0] - c2[0];
  const dg = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  const da = c1[3] - c2[3];
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

/**
 * High-performance Flood Fill (BFS) using a 1D index queue
 * Avoids browser freezes by pre-allocating memory and avoiding tiny array allocations
 */
export function performFloodFill(canvas, startX, startY, fillHex, fillOpacity, tolerance) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  // Get start coordinates in integer space
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  // Start pixel index
  const startIdx = (y * width + x) * 4;
  const targetColor = [
    data[startIdx],
    data[startIdx + 1],
    data[startIdx + 2],
    data[startIdx + 3]
  ];
  
  const fillRgba = hexToRgba(fillHex, fillOpacity);
  
  // If clicked color matches fill color within tolerance, skip
  if (colorDistance(targetColor, fillRgba) <= tolerance && targetColor[3] !== 0) {
    return;
  }
  
  // Queue to store 1D pixel coordinates
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  
  // Visited array to prevent infinite loops
  const visited = new Uint8Array(width * height);
  
  // Push start pixel
  queue[tail++] = y * width + x;
  visited[y * width + x] = 1;
  
  const targetR = targetColor[0];
  const targetG = targetColor[1];
  const targetB = targetColor[2];
  const targetA = targetColor[3];
  
  const fillR = fillRgba[0];
  const fillG = fillRgba[1];
  const fillB = fillRgba[2];
  const fillA = fillRgba[3];
  
  while (head < tail) {
    const coord = queue[head++];
    const cy = Math.floor(coord / width);
    const cx = coord % width;
    
    const idx = coord * 4;
    
    // Set color of the current pixel
    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = fillA;
    
    // Check neighbors: Left, Right, Up, Down
    const neighbors = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1]
    ];
    
    for (let i = 0; i < 4; i++) {
      const nx = neighbors[i][0];
      const ny = neighbors[i][1];
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nCoord = ny * width + nx;
        
        if (!visited[nCoord]) {
          const nIdx = nCoord * 4;
          const currColor = [
            data[nIdx],
            data[nIdx + 1],
            data[nIdx + 2],
            data[nIdx + 3]
          ];
          
          const dist = Math.sqrt(
            (currColor[0] - targetR) ** 2 +
            (currColor[1] - targetG) ** 2 +
            (currColor[2] - targetB) ** 2 +
            (currColor[3] - targetA) ** 2
          );
          
          if (dist <= tolerance) {
            queue[tail++] = nCoord;
            visited[nCoord] = 1;
          }
        }
      }
    }
  }
  
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Initializes the Smudge offscreen buffer canvas.
 * Captures the canvas pixels around (startX, startY) inside a circle of size.
 */
export function createSmudgeBuffer(canvas, startX, startY, brushSize) {
  const size = Math.max(10, Math.floor(brushSize * 2));
  const halfSize = size / 2;
  
  // Create offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = size;
  offscreen.height = size;
  const oCtx = offscreen.getContext('2d');
  
  // Create a circular clipping mask
  oCtx.beginPath();
  oCtx.arc(halfSize, halfSize, halfSize - 1, 0, Math.PI * 2);
  oCtx.clip();
  
  // Draw the main canvas content onto our offscreen brush tip
  oCtx.drawImage(
    canvas, 
    startX - halfSize, startY - halfSize, size, size, // Source rect
    0, 0, size, size                                 // Dest rect
  );
  
  return {
    canvas: offscreen,
    context: oCtx,
    size: size,
    halfSize: halfSize
  };
}

/**
 * Draws the smudge brush tip onto the canvas at (x, y) and samples/blends
 * the canvas content back into the smudge buffer.
 */
export function applySmudge(ctx, mainCanvas, x, y, smudge, strength = 0.2) {
  const oCtx = smudge.context;
  const size = smudge.size;
  const halfSize = smudge.halfSize;
  
  const dpr = window.devicePixelRatio || 1;
  const cssSize = size / dpr;
  const cssHalfSize = halfSize / dpr;
  
  // Coordinates for drawing smudge canvas back onto the main canvas (CSS space)
  const drawX = x - cssHalfSize;
  const drawY = y - cssHalfSize;
  
  // Save main context state
  ctx.save();
  
  // Draw the current smudge buffer onto the canvas with blending opacity
  ctx.globalAlpha = strength;
  ctx.drawImage(smudge.canvas, drawX, drawY, cssSize, cssSize);
  
  ctx.restore();
  
  // Coordinates for picking up updated pixels from the main canvas (Device space)
  const deviceX = Math.round(x * dpr) - halfSize;
  const deviceY = Math.round(y * dpr) - halfSize;
  
  // Now, pick up/blend the canvas paint back into the smudge buffer
  // We draw a small slice of the updated main canvas onto the smudge buffer with low opacity.
  oCtx.save();
  oCtx.globalAlpha = 0.15; // Rate of picking up new paint
  try {
    oCtx.drawImage(
      mainCanvas, 
      deviceX, deviceY, size, size, // Source (Device pixels)
      0, 0, size, size              // Dest (Device pixels)
    );
  } catch (err) {
    // Ignore canvas boundary sampling errors (draws outside the canvas area)
  }
  oCtx.restore();
}

