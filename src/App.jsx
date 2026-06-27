import React, { useState, useEffect, useRef } from 'react';
import { 
  PenTool, 
  Paintbrush as BrushIcon, 
  Blend, 
  PaintBucket as BucketIcon, 
  Eraser as EraserIcon, 
  Undo, 
  Redo, 
  Trash2, 
  HelpCircle, 
  Download, 
  X,
  Sparkles,
  Info,
  Palette,
  Hand,
  Maximize,
  Menu
} from 'lucide-react';
import { performFloodFill, createSmudgeBuffer, applySmudge } from './canvas-utils';

// Color Preset Palettes
const PALETTES = {
  vibrant: [
    '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', 
    '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#0f172a'
  ],
  pastel: [
    '#fecdd3', '#ffedd5', '#fef9c3', '#dcfce7', '#ecfeff', 
    '#dbeafe', '#e0e7ff', '#f3e8ff', '#fce7f3', '#f8fafc'
  ],
  retro: [
    '#c2410c', '#b45309', '#a16207', '#15803d', '#0e7490', 
    '#1d4ed8', '#4338ca', '#6d28d9', '#be185d', '#334155'
  ],
  monochrome: [
    '#000000', '#1e293b', '#475569', '#64748b', '#94a3b8', 
    '#cbd5e1', '#e2e8f0', '#f1f5f9', '#f8fafc', '#ffffff'
  ]
};

// Canvas Resolution constants
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

export default function App() {
  // --- STATE ---
  const [tool, setTool] = useState('pen'); // 'pen', 'brush', 'blend', 'bucket', 'eraser', 'hand'
  const [color, setColor] = useState('#38bdf8'); // Cyan/Sky blue as default
  const [brushSize, setBrushSize] = useState(8);
  const [opacity, setOpacity] = useState(0.9);
  const [tolerance, setTolerance] = useState(25);
  const [paletteType, setPaletteType] = useState('vibrant');
  const [bgColor, setBgColor] = useState('white'); // 'white', 'charcoal', 'slate', 'transparent'
  
  // Modals & UI states
  const [showHelp, setShowHelp] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Canvas Zoom / Pan states
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [showToolbar, setShowToolbar] = useState(true);

  // --- REFS ---
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastCoordsRef = useRef({ x: 0, y: 0 });
  const smudgeRef = useRef(null);

  // Gesture and Pointer Lock refs
  const primaryPointerIdRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const gestureStartDistRef = useRef(0);
  const gestureStartZoomRef = useRef(1);
  const gestureStartPanRef = useRef({ x: 0, y: 0 });
  const gestureActiveRef = useRef(false);

  // Check localStorage for onboarding visited
  useEffect(() => {
    const visited = localStorage.getItem('canvascraft_visited');
    if (visited) {
      setShowHelp(false);
    }
  }, []);

  // Initialize Canvas
  useEffect(() => {
    if (canvasRef.current) {
      initCanvas();
    }
  }, []);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Set internal resolution scaled by High-DPI device pixel ratio
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    
    // Scale context drawing actions to map CSS coordinates to DPR
    ctx.scale(dpr, dpr);
    
    // Clean transparent canvas to start
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Clear history stacks
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    
    // Save starting clean transparent state
    saveState();
  };

  // --- HISTORY STACK (Capped at 20 actions) ---
  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dataUrl = canvas.toDataURL();
    
    // Bounded check: Cap at 20 steps
    if (undoStackRef.current.length >= 20) {
      undoStackRef.current.shift(); // Remove oldest state
    }
    
    undoStackRef.current.push(dataUrl);
    redoStackRef.current = []; // Reset Redo stack on new drawing actions
    
    setCanUndo(undoStackRef.current.length > 1); // 1 state is initial blank canvas
    setCanRedo(false);
  };

  const handleUndo = () => {
    if (undoStackRef.current.length <= 1) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Pop current state and push to redo stack
    const currentState = undoStackRef.current.pop();
    redoStackRef.current.push(currentState);
    
    // Get the previous state
    const previousState = undoStackRef.current[undoStackRef.current.length - 1];
    
    restoreCanvasState(previousState, ctx, canvas, dpr);
    
    setCanUndo(undoStackRef.current.length > 1);
    setCanRedo(true);
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    const stateToRestore = redoStackRef.current.pop();
    undoStackRef.current.push(stateToRestore);
    
    restoreCanvasState(stateToRestore, ctx, canvas, dpr);
    
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  };

  const restoreCanvasState = (dataUrl, ctx, canvas, dpr) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.save();
      // Reset coordinates system scale temporarily
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.restore(); // Restores scale (DPR)
    };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    saveState();
    setShowClearConfirm(false);
  };

  // --- DRAWING LOGIC & GESTURES ---
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    
    // Retrieve coordinates from all possible sources to be 100% robust on mobile browsers
    let clientX = null;
    let clientY = null;

    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches[0]) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if (e.clientX !== undefined && e.clientX !== null) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else if (e.nativeEvent) {
      const ne = e.nativeEvent;
      if (ne.touches && ne.touches[0]) {
        clientX = ne.touches[0].clientX;
        clientY = ne.touches[0].clientY;
      } else if (ne.changedTouches && ne.changedTouches[0]) {
        clientX = ne.changedTouches[0].clientX;
        clientY = ne.changedTouches[0].clientY;
      } else if (ne.clientX !== undefined && ne.clientX !== null) {
        clientX = ne.clientX;
        clientY = ne.clientY;
      }
    }

    if (clientX === null) clientX = 0;
    if (clientY === null) clientY = 0;
    
    const relativeX = (clientX - rect.left) / rect.width;
    const relativeY = (clientY - rect.top) / rect.height;
    
    return {
      x: relativeX * CANVAS_WIDTH,
      y: relativeY * CANVAS_HEIGHT
    };
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Track active pointer contacts
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    // --- PAN/ZOOM MODE (HAND TOOL) ---
    if (tool === 'hand') {
      if (activePointersRef.current.size === 1) {
        gestureStartPanRef.current = { x: panX, y: panY };
        lastCoordsRef.current = { x: e.clientX, y: e.clientY };
      } else if (activePointersRef.current.size === 2) {
        const pointers = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
        gestureStartDistRef.current = dist;
        gestureStartZoomRef.current = zoom;
        gestureStartPanRef.current = { x: panX, y: panY };
        gestureActiveRef.current = false; // Threshold not yet reached
      }
      return;
    }

    // --- DRAWING MODE ---
    // Lock-on Feature: Ignore all secondary touches once drawing begins
    if (primaryPointerIdRef.current !== null) {
      return;
    }
    
    primaryPointerIdRef.current = e.pointerId;
    
    // Set pointer capture to track drawing outside canvas bounds
    if (e.target && typeof e.target.setPointerCapture === 'function' && e.pointerId !== undefined) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {
        console.warn("Failed to set pointer capture:", err);
      }
    }
    
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoords(e);
    lastCoordsRef.current = coords;
    isDrawingRef.current = true;
    
    const dpr = window.devicePixelRatio || 1;
    
    if (tool === 'bucket') {
      performFloodFill(canvas, coords.x * dpr, coords.y * dpr, color, opacity, tolerance);
      saveState();
      isDrawingRef.current = false;
      primaryPointerIdRef.current = null;
      return;
    }
    
    if (tool === 'blend') {
      smudgeRef.current = createSmudgeBuffer(canvas, coords.x * dpr, coords.y * dpr, brushSize * dpr);
    }
    
    ctx.save();
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0;
    } else if (tool === 'blend') {
      applySmudge(ctx, canvas, coords.x, coords.y, smudgeRef.current, opacity * 0.4);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = tool === 'brush' ? opacity : 1.0;
      ctx.fillStyle = color;
      
      if (tool === 'brush') {
        ctx.shadowBlur = brushSize * 0.15;
        ctx.shadowColor = color;
      }
    }
    
    if (tool !== 'blend') {
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const handlePointerMove = (e) => {
    e.preventDefault();
    
    // Update active pointers map
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    
    // --- PAN/ZOOM MODE (HAND TOOL) ---
    if (tool === 'hand') {
      // 1 pointer active: Pan / Drag canvas sheet
      if (activePointersRef.current.size === 1) {
        const last = lastCoordsRef.current;
        if (last) {
          const dx = e.clientX - last.x;
          const dy = e.clientY - last.y;
          setPanX(px => px + dx);
          setPanY(py => py + dy);
          lastCoordsRef.current = { x: e.clientX, y: e.clientY };
        }
      } 
      // 2 pointers active: Pinch to zoom
      else if (activePointersRef.current.size === 2) {
        const pointers = Array.from(activePointersRef.current.values());
        const dist = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
        const startDist = gestureStartDistRef.current;
        
        if (startDist > 0) {
          const deltaDist = Math.abs(dist - startDist);
          
          // Gestures Dead Zone / Threshold: Only scale if distance changed by > 15px
          if (!gestureActiveRef.current && deltaDist > 15) {
            gestureActiveRef.current = true;
          }
          
          if (gestureActiveRef.current) {
            const scale = dist / startDist;
            const newZoom = Math.min(5.0, Math.max(0.4, gestureStartZoomRef.current * scale));
            setZoom(newZoom);
          }
        }
      }
      return;
    }

    // --- DRAWING MODE ---
    if (!isDrawingRef.current) return;
    
    // Lock-on Feature: Only respond to moves from the primary pointer ID
    if (e.pointerId !== primaryPointerIdRef.current) {
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const coords = getCanvasCoords(e);
    const lastCoords = lastCoordsRef.current;
    
    ctx.save();
    
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(lastCoords.x, lastCoords.y);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      
    } else if (tool === 'pen') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(lastCoords.x, lastCoords.y);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      
    } else if (tool === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.shadowBlur = brushSize * 0.15;
      ctx.shadowColor = color;
      
      ctx.beginPath();
      ctx.moveTo(lastCoords.x, lastCoords.y);
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
      
    } else if (tool === 'blend') {
      if (!smudgeRef.current) return;
      
      const dx = coords.x - lastCoords.x;
      const dy = coords.y - lastCoords.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const steps = Math.max(1, Math.floor(dist / (brushSize / 4)));
      
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ix = lastCoords.x + dx * t;
        const iy = lastCoords.y + dy * t;
        applySmudge(ctx, canvas, ix, iy, smudgeRef.current, opacity * 0.45);
      }
    }
    
    ctx.restore();
    lastCoordsRef.current = coords;
  };

  const handlePointerUp = (e) => {
    e.preventDefault();
    
    // Remove pointer from tracking map
    activePointersRef.current.delete(e.pointerId);
    
    // --- PAN/ZOOM MODE (HAND TOOL) ---
    if (tool === 'hand') {
      gestureActiveRef.current = false;
      // If we still have 1 pointer active, reset its last panning start position to prevent jumps
      if (activePointersRef.current.size === 1) {
        const remainingPointer = Array.from(activePointersRef.current.entries())[0];
        lastCoordsRef.current = { x: remainingPointer[1].x, y: remainingPointer[1].y };
      }
      return;
    }

    // --- DRAWING MODE ---
    if (e.pointerId !== primaryPointerIdRef.current) {
      return;
    }
    
    isDrawingRef.current = false;
    smudgeRef.current = null;
    primaryPointerIdRef.current = null;
    
    // Release pointer capture
    if (e.target && typeof e.target.releasePointerCapture === 'function' && e.pointerId !== undefined) {
      try {
        e.target.releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore
      }
    }
    
    saveState();
  };

  // --- MOUSE WHEEL ZOOM (NATIVE EVENT FOR PASSIVE OVERRIDE) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelNative = (e) => {
      if (tool !== 'hand') return;
      e.preventDefault();
      const zoomFactor = 0.08;
      let newZoom = zoom;
      if (e.deltaY < 0) {
        newZoom = Math.min(5.0, zoom + zoomFactor);
      } else {
        newZoom = Math.max(0.4, zoom - zoomFactor);
      }
      setZoom(newZoom);
    };

    canvas.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheelNative);
    };
  }, [tool, zoom]);

  // --- RESET VIEW ---
  const resetView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  // --- SAVE / DOWNLOAD UTILITY ---
  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsExporting(true);
    
    // We create a temporary canvas to composite the transparent layers with the chosen background color
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    
    // 1. Draw solid background color (except if background is transparent)
    if (bgColor !== 'transparent') {
      exportCtx.fillStyle = 
        bgColor === 'white' ? '#ffffff' : 
        bgColor === 'charcoal' ? '#1e293b' : // slate-800
        '#64748b'; // slate-500
      exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }
    
    // 2. Draw drawing layer on top
    exportCtx.drawImage(canvas, 0, 0);
    
    // 3. Create native download link
    try {
      const url = exportCanvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `canvascraft_${Date.now()}.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export failed: ", err);
    } finally {
      setIsExporting(false);
    }
  };

  // --- CLOSE HELP MODAL ---
  const closeHelpModal = () => {
    localStorage.setItem('canvascraft_visited', 'true');
    setShowHelp(false);
  };

  // CSS backgrounds classes matching the UI state
  const canvasBgClass = 
    bgColor === 'white' ? 'bg-white' :
    bgColor === 'charcoal' ? 'bg-slate-800 shadow-slate-900/60' :
    bgColor === 'slate' ? 'bg-slate-500' :
    'checkerboard-bg';

  return (
    <div className="w-full h-full flex flex-col md:flex-row relative overflow-y-auto md:overflow-hidden bg-slate-950 text-slate-100">
      
      {/* BACKGROUND EFFECTS */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/10 blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

      {/* TOP HEADER / BAR */}
      <header className="absolute top-4 left-4 z-30 flex items-center gap-2.5 py-2 px-3.5 rounded-full glass-panel shadow-lg select-none border border-slate-800/40">
        <button
          onClick={() => setShowToolbar(!showToolbar)}
          className={`p-1 rounded-lg hover:text-sky-400 hover:bg-slate-900/50 transition-all duration-150 cursor-pointer ${!showToolbar ? 'text-sky-400 animate-pulse' : 'text-slate-300'}`}
          title={showToolbar ? "Hide Toolbar" : "Show Toolbar"}
        >
          <Menu className="w-4.5 h-4.5" />
        </button>
        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center shadow-md shadow-sky-500/20">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="hidden sm:block">
          <h1 className="text-xs font-semibold text-white tracking-wider">CanvasCraft</h1>
          <p className="text-[9px] text-slate-400 font-medium uppercase tracking-widest mt-[-2px]">Studio Pro</p>
        </div>
      </header>

      {/* SIDEBAR: DRAWING TOOLS */}
      <aside className={`z-20 md:absolute md:left-4 md:top-1/2 flex md:flex-col items-center justify-between md:justify-center gap-3 glass-panel md:rounded-2xl shadow-xl w-full md:w-auto border-b md:border-b-0 border-slate-800 transition-all duration-300 ease-in-out ${
        showToolbar 
          ? 'translate-y-0 md:-translate-y-1/2 opacity-100 max-h-[500px] p-3 md:py-5 md:px-3' 
          : '-translate-y-full md:-translate-x-[150%] md:-translate-y-1/2 opacity-0 pointer-events-none max-h-0 p-0 border-b-0 overflow-hidden'
      }`}>
        
        {/* LOGO FOR MOBILE (Hidden when toolbar is collapsed) */}
        {showToolbar && (
          <div className="md:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-xs font-bold tracking-wider">CanvasCraft</span>
          </div>
        )}

        <div className="flex md:flex-col gap-2 items-center">
          {/* Line-Art Pen */}
          <button
            onClick={() => setTool('pen')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'pen' ? 'glass-btn-active scale-105' : ''}`}
            title="Line-Art Pen (ปากกาตัดเส้น)"
          >
            <PenTool className="w-5 h-5" />
          </button>

          {/* Paintbrush */}
          <button
            onClick={() => setTool('brush')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'brush' ? 'glass-btn-active scale-105' : ''}`}
            title="Paintbrush (พู่กัน)"
          >
            <BrushIcon className="w-5 h-5" />
          </button>

          {/* Blending Pen */}
          <button
            onClick={() => setTool('blend')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'blend' ? 'glass-btn-active scale-105' : ''}`}
            title="Blending Pen (ปากกาผสมสี)"
          >
            <Blend className="w-5 h-5" />
          </button>

          {/* Paint Bucket */}
          <button
            onClick={() => setTool('bucket')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'bucket' ? 'glass-btn-active scale-105' : ''}`}
            title="Paint Bucket (ถังสี)"
          >
            <BucketIcon className="w-5 h-5" />
          </button>

          {/* Eraser */}
          <button
            onClick={() => setTool('eraser')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'eraser' ? 'glass-btn-active scale-105' : ''}`}
            title="Eraser (ยางลบ)"
          >
            <EraserIcon className="w-5 h-5" />
          </button>

          {/* Hand Tool (Pan/Zoom) */}
          <button
            onClick={() => setTool('hand')}
            className={`p-2.5 rounded-xl cursor-pointer glass-btn ${tool === 'hand' ? 'glass-btn-active scale-105' : ''}`}
            title="Pan & Zoom Mode (โหมดซูม/ย้าย)"
          >
            <Hand className="w-5 h-5" />
          </button>
        </div>

        {/* Small spacer on desktop */}
        <div className="hidden md:block w-8 h-[1px] bg-slate-800 my-1" />

        {/* Help Toggle Button */}
        <button
          onClick={() => setShowHelp(true)}
          className="p-2.5 rounded-xl cursor-pointer glass-btn hover:text-sky-400"
          title="How to Use Guide"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </aside>

      {/* CANVAS CONTAINER WRAPPER */}
      <main className="flex-1 min-h-[350px] md:min-h-0 h-full flex items-center justify-center p-3 md:p-6 overflow-hidden relative">
        {/* Reset View & Zoom Percent Overlay */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 py-1.5 px-3 rounded-full glass-panel border border-slate-800 shadow-md">
          <span className="text-xs font-semibold text-sky-400">{Math.round(zoom * 100)}%</span>
          <button
            onClick={resetView}
            className="p-1 rounded-md hover:bg-slate-900/50 hover:text-sky-400 transition-colors duration-150 cursor-pointer"
            title="Reset Zoom & Pan"
          >
            <Maximize className="w-3.5 h-3.5 text-slate-300" />
          </button>
        </div>

        {/* Dynamic panning instruction hint (only in hand mode) */}
        {tool === 'hand' && (
          <div className="absolute bottom-4 left-4 z-20 hidden sm:flex items-center gap-1.5 py-1 px-3.5 rounded-full bg-slate-900/90 border border-slate-800 text-[10px] text-slate-400 pointer-events-none select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
            Drag with 1 finger/mouse to Pan | Pinch with 2 fingers to Zoom
          </div>
        )}

        <div 
          className="relative max-w-full max-h-full aspect-[3/2] flex items-center justify-center" 
          ref={containerRef}
        >
          {/* Floating dynamic Canvas container with correct background */}
          <div 
            className={`w-full h-full rounded-2xl overflow-hidden shadow-2xl transition-colors duration-300 border border-slate-700/40 relative ${canvasBgClass}`}
            style={{
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: 'center center'
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className={`w-full h-full block ${tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
              style={{ touchAction: 'none' }}
            />
          </div>
        </div>
      </main>

      {/* RIGHT SIDE PANEL: CONTROLS & COLORS */}
      <aside className="z-20 md:absolute md:right-4 md:top-1/2 md:-translate-y-1/2 p-4 pb-28 md:py-6 md:px-4 md:pb-6 glass-panel md:rounded-2xl shadow-xl w-full md:w-80 flex flex-col gap-5 border-t md:border-t-0 border-slate-800 md:max-h-[85vh] overflow-y-auto">
        
        {/* SECTION 1: BRUSH SETTINGS */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-sky-400" /> Brush Settings
            </span>
            <div className="text-[10px] bg-sky-500/10 text-sky-400 font-bold px-2 py-0.5 rounded-full border border-sky-500/20 uppercase">
              {tool === 'pen' && 'Line Pen'}
              {tool === 'brush' && 'Paintbrush'}
              {tool === 'blend' && 'Blending'}
              {tool === 'bucket' && 'Bucket Fill'}
              {tool === 'eraser' && 'Eraser'}
              {tool === 'hand' && 'Pan & Zoom'}
            </div>
          </div>

          <div className="space-y-4">
            {/* Size Slider */}
            {tool !== 'bucket' && tool !== 'hand' && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Brush Size</span>
                  <span className="font-medium text-sky-400">{brushSize}px</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                />
              </div>
            )}

            {/* Opacity Slider (Only relevant for Paintbrush, Blending, and Paint Bucket opacity) */}
            {(tool === 'brush' || tool === 'blend' || tool === 'bucket') && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Opacity / Strength</span>
                  <span className="font-medium text-sky-400">{Math.round(opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={opacity * 100}
                  onChange={(e) => setOpacity(parseFloat(e.target.value) / 100)}
                />
              </div>
            )}

            {/* Color Tolerance Slider (Only for Paint Bucket) */}
            {tool === 'bucket' && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Fill Color Tolerance</span>
                  <span className="font-medium text-sky-400">{tolerance}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={tolerance}
                  onChange={(e) => setTolerance(parseInt(e.target.value))}
                />
                <p className="text-[10px] text-slate-500 mt-1">Lower values fill strict matches; higher values leak past gradients.</p>
              </div>
            )}

            {/* Dynamic Brush Preview Indicator */}
            {tool !== 'bucket' && tool !== 'hand' && (
              <div className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Tip Preview</span>
                <div className="flex-1 flex justify-center items-center h-12 bg-slate-950/40 rounded-lg relative overflow-hidden checkerboard-bg">
                  {/* Inside container to render correct color and opacity */}
                  <div 
                    key={`${tool}-${color}-${brushSize}-${opacity}`}
                    className="rounded-full shadow-sm animate-in fade-in duration-150"
                    style={{
                      width: `${Math.max(2, brushSize)}px`,
                      height: `${Math.max(2, brushSize)}px`,
                      backgroundColor: tool === 'eraser' ? '#0f172a' : color,
                      opacity: tool === 'eraser' ? 1.0 : opacity,
                      boxShadow: tool === 'brush' && tool !== 'eraser' ? `0 0 10px ${color}` : 'none',
                      maxHeight: '44px',
                      maxWidth: '44px'
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-full h-[1px] bg-slate-800" />

        {/* SECTION 2: PALETTES & COLOR PICKER */}
        {tool !== 'eraser' && tool !== 'hand' && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-sky-400" /> Color Studio
              </span>
              
              <select
                value={paletteType}
                onChange={(e) => setPaletteType(e.target.value)}
                className="text-[11px] bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2 py-0.5 focus:outline-none focus:border-sky-400 cursor-pointer font-medium"
              >
                <option value="vibrant">Vibrant</option>
                <option value="pastel">Pastel</option>
                <option value="retro">Retro</option>
                <option value="monochrome">Grayscale</option>
              </select>
            </div>

            {/* Presets Swatches */}
            <div className="grid grid-cols-5 gap-1.5">
              {PALETTES[paletteType].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`aspect-square w-full rounded-lg cursor-pointer border transition-transform duration-100 ${color === c ? 'border-sky-400 scale-110 shadow-md shadow-sky-500/20' : 'border-slate-800 hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>

            {/* Custom Color Input */}
            <div className="flex items-center gap-3 p-2 bg-slate-900/50 rounded-xl border border-slate-800 mt-1">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded-full border border-slate-800 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Custom Hex</p>
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.match(/^#[0-9A-Fa-f]{0,6}$/)) {
                      setColor(val);
                    }
                  }}
                  className="bg-transparent text-xs text-slate-300 font-mono w-full border-none p-0 focus:outline-none"
                  placeholder="#000000"
                />
              </div>
            </div>
          </div>
        )}

        <div className="w-full h-[1px] bg-slate-800" />

        {/* SECTION 3: BACKGROUND OPTION */}
        <div>
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest mb-3 block">
            Canvas Backdrop
          </span>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'white', name: 'White', colorClass: 'bg-white border-slate-200' },
              { id: 'charcoal', name: 'Dark', colorClass: 'bg-slate-700 border-slate-600' },
              { id: 'slate', name: 'Muted', colorClass: 'bg-slate-500 border-slate-400' },
              { id: 'transparent', name: 'Grid', colorClass: 'checkerboard-bg border-slate-700' }
            ].map((bg) => (
              <button
                key={bg.id}
                onClick={() => setBgColor(bg.id)}
                className={`flex flex-col items-center gap-1.5 p-1.5 rounded-lg border-2 text-[10px] cursor-pointer transition-all duration-200 ${bgColor === bg.id ? 'border-sky-400 bg-slate-900/70' : 'border-slate-800 hover:border-slate-700 bg-slate-900/30'}`}
              >
                <div className={`w-6 h-6 rounded-md border shadow-sm ${bg.colorClass}`} />
                <span className={bgColor === bg.id ? 'text-sky-400 font-semibold' : 'text-slate-400'}>{bg.name}</span>
              </button>
            ))}
          </div>
        </div>

      </aside>

      {/* FLOATING ACTION TOOLBAR (BOTTOM BAR) */}
      <footer className="z-20 absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-between gap-4 py-2 px-4 glass-panel rounded-full shadow-lg max-w-[90%] md:max-w-md">
        
        {/* Undo Button */}
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`p-2.5 rounded-full glass-btn shrink-0 ${canUndo ? 'text-white hover:text-sky-400 cursor-pointer' : 'text-slate-600 cursor-not-allowed border-slate-800 bg-transparent'}`}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="w-4.5 h-4.5" />
        </button>

        {/* Redo Button */}
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`p-2.5 rounded-full glass-btn shrink-0 ${canRedo ? 'text-white hover:text-sky-400 cursor-pointer' : 'text-slate-600 cursor-not-allowed border-slate-800 bg-transparent'}`}
          title="Redo (Ctrl+Y)"
        >
          <Redo className="w-4.5 h-4.5" />
        </button>

        {/* Separator line */}
        <div className="w-[1px] h-6 bg-slate-800" />

        {/* Clear Button */}
        <button
          onClick={() => setShowClearConfirm(true)}
          className="p-2.5 rounded-full glass-btn text-rose-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer shrink-0"
          title="Clear Canvas"
        >
          <Trash2 className="w-4.5 h-4.5" />
        </button>

        {/* Export / Download Button */}
        <button
          onClick={handleSave}
          disabled={isExporting}
          className={`flex items-center gap-2 py-2 px-4 rounded-full font-semibold text-xs transition-all duration-300 cursor-pointer border shrink-0 ${isExporting ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-500 hover:to-indigo-600 text-white border-transparent shadow-md shadow-sky-500/20'}`}
          title="Export Artwork (.PNG)"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">{isExporting ? 'Saving...' : 'Export'}</span>
        </button>
      </footer>

      {/* CONFIRMATION CLEAR DIALOG MODAL */}
      {showClearConfirm && (
        <div className="z-50 fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-panel max-w-sm w-full rounded-2xl p-6 shadow-2xl border border-rose-500/20 animate-in fade-in zoom-in duration-200">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
              <Trash2 className="w-5 h-5 text-rose-400" /> Clear Canvas?
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed mb-6">
              This will permanently delete your current drawing. This action is irreversible once cleared.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 cursor-pointer text-slate-300 border border-slate-700"
              >
                Keep Drawing
              </button>
              <button
                onClick={clearCanvas}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 hover:bg-rose-600 cursor-pointer text-white shadow-md shadow-rose-500/20"
              >
                Clear Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HELP / ONBOARDING GUIDE MODAL */}
      {showHelp && (
        <div className="z-50 fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto">
          <div className="glass-panel max-w-lg w-full rounded-2xl shadow-2xl border border-sky-500/10 animate-in fade-in zoom-in duration-200 relative my-8">
            
            {/* Close button if they already visited */}
            {localStorage.getItem('canvascraft_visited') && (
              <button 
                onClick={closeHelpModal}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-900 border border-slate-800 hover:text-sky-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <div className="p-6 md:p-8 flex flex-col items-center text-center">
              {/* Glowing header icon */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4 onboarding-pulse">
                <Sparkles className="w-7 h-7 text-white" />
              </div>

              <h2 className="text-xl font-bold text-white tracking-wide">Welcome to CanvasCraft Studio</h2>
              <p className="text-xs text-slate-400 mt-1 max-w-sm leading-relaxed">
                A professional, responsive digital canvas containing custom brush mechanics. Start creating in seconds!
              </p>

              <div className="w-full h-[1px] bg-slate-800 my-5" />

              {/* HOW TO USE GUIDE */}
              <div className="w-full text-left space-y-4 max-h-[300px] overflow-y-auto pr-1">
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-1.5 block">Guide &amp; Brush Physics</span>

                {/* Pen */}
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 self-start">
                    <PenTool className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">Line-Art Pen (ปากกาตัดเส้น)</h3>
                    <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      Clean, sharp, solid strokes. Ignores opacity sliders for precise ink line work and outlines.
                    </p>
                  </div>
                </div>

                {/* Paintbrush */}
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 self-start">
                    <BrushIcon className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">Paintbrush (พู่กัน)</h3>
                    <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      Smooth strokes with anti-aliased feathered edges. Customize opacity for coloring and soft shadows.
                    </p>
                  </div>
                </div>

                {/* Blending Pen */}
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 self-start">
                    <Blend className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">Blending Pen (ปากกาผสมสี / Smudge)</h3>
                    <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      Mimics oil smudging. Picks up existing pigments from the canvas and blends them dynamically as you drag.
                    </p>
                  </div>
                </div>

                {/* Paint Bucket */}
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 self-start">
                    <BucketIcon className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">Paint Bucket (ถังทาสี)</h3>
                    <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      Fills enclosed pixel boundaries. Set "Tolerance" in settings to control filling anti-aliased edge gaps.
                    </p>
                  </div>
                </div>

                {/* Eraser */}
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 self-start">
                    <EraserIcon className="w-4.5 h-4.5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-white">Eraser (ยางลบ)</h3>
                    <p className="text-[11px] text-slate-400 leading-normal mt-0.5">
                      Wipes away paint to transparent, revealing the canvas backdrop pattern. Perfect for shaping strokes.
                    </p>
                  </div>
                </div>
              </div>

              <div className="w-full h-[1px] bg-slate-800 my-5" />

              {/* ACTION BUTTON */}
              <button
                onClick={closeHelpModal}
                className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-500 hover:to-indigo-600 text-white cursor-pointer transition-all duration-300 shadow-md shadow-sky-500/20 active:scale-98"
              >
                Start Creating
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
