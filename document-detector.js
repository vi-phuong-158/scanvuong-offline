(function (root, factory) {
  const mod = factory();
  if (typeof define === 'function' && define.amd) {
    define([], function () { return mod; });
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.DocumentDetector = mod;
  }
  if (typeof window !== 'undefined') {
    window.DocumentDetector = mod;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.DocumentDetector = mod;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  // Constants
  const INPUT_SIZE = 224;
  const IMAGENET_MEAN = [0.485, 0.456, 0.406];
  const IMAGENET_STD = [0.229, 0.224, 0.225];

  const DEFAULT_CORNERS = [
    { x: 0.045, y: 0.045 },
    { x: 0.955, y: 0.045 },
    { x: 0.955, y: 0.955 },
    { x: 0.045, y: 0.955 }
  ];

  // Internal state for lazy singleton ML session
  let ortModule = null;
  let inferenceSession = null;
  let sessionInitPromise = null;
  let initError = null;

  // Test instrumentation hooks (test-only, not used by normal UX)
  let sessionCreateCount = 0;
  let sessionRunCount = 0;
  let customInferenceSession = null;
  let customRuntimeFactory = null;

  function resetState() {
    ortModule = null;
    inferenceSession = null;
    sessionInitPromise = null;
    initError = null;
    sessionCreateCount = 0;
    sessionRunCount = 0;
    customInferenceSession = null;
    customRuntimeFactory = null;
  }

  /**
   * Calculates the signed area of a 2D polygon using Shoelace formula.
   */
  function polygonArea(pts) {
    if (!pts || pts.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(sum) / 2;
  }

  /**
   * Validates that a 4-corner polygon is strictly convex and non-self-intersecting.
   */
  function isConvexQuad(corners) {
    if (!corners || corners.length !== 4) return false;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const p3 = corners[(i + 2) % 4];
      if (!p1 || !p2 || !p3 || !Number.isFinite(p1.x) || !Number.isFinite(p1.y) ||
          !Number.isFinite(p2.x) || !Number.isFinite(p2.y) ||
          !Number.isFinite(p3.x) || !Number.isFinite(p3.y)) {
        return false;
      }
      const dx1 = p2.x - p1.x;
      const dy1 = p2.y - p1.y;
      const dx2 = p3.x - p2.x;
      const dy2 = p3.y - p2.y;
      const cross = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(cross) < 1e-7) return false; // Collinear / collapsed edge
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false; // Non-convex or self-intersecting
      }
    }
    return true;
  }

  /**
   * Validates geometric sanity of the detected corners.
   */
  function validateGeometry(corners) {
    if (!corners || !Array.isArray(corners) || corners.length !== 4) {
      return { valid: false, error: 'Expected exactly 4 corners' };
    }

    // 1. Check finite coordinates
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      if (p === null || p === undefined || typeof p !== 'object' ||
          typeof p.x !== 'number' || typeof p.y !== 'number' ||
          !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
          Number.isNaN(p.x) || Number.isNaN(p.y)) {
        return { valid: false, error: `Corner ${i} has non-finite or NaN coordinates` };
      }
      // Check coordinates not wildly outside viewport [-0.2, 1.2]
      if (p.x < -0.2 || p.x > 1.2 || p.y < -0.2 || p.y > 1.2) {
        return { valid: false, error: `Corner ${i} is out of bounds: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})` };
      }
    }

    // 2. Check strict convexity
    if (!isConvexQuad(corners)) {
      return { valid: false, error: 'Quadrilateral is not convex or is self-intersecting' };
    }

    // 3. Check area bounds (must be at least 5% of viewport and <= 99.5%)
    const area = polygonArea(corners);
    if (!Number.isFinite(area) || area < 0.05) {
      return { valid: false, error: `Document area too small: ${((area || 0) * 100).toFixed(1)}%` };
    }
    if (area > 0.995) {
      return { valid: false, error: `Document area covers entire frame: ${(area * 100).toFixed(1)}%` };
    }

    // 4. Check edge lengths (each edge must be >= 5% of frame)
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (!Number.isFinite(dist) || dist < 0.05) {
        return { valid: false, error: `Edge ${i} too short: ${(dist || 0).toFixed(3)}` };
      }
    }

    return { valid: true, areaRatio: area };
  }

  /**
   * Clamps normalized coordinates to [0, 1].
   */
  function clampCorners(corners) {
    return corners.map(p => ({
      x: Math.max(0, Math.min(1, Number(p.x.toFixed(4)))),
      y: Math.max(0, Math.min(1, Number(p.y.toFixed(4))))
    }));
  }

  /**
   * Lazy initializes the ONNX Runtime WASM session.
   * Reuses singleton session across multiple pages.
   * Allows retry recovery after transient failures.
   */
  async function initMlSession(options = {}) {
    if (inferenceSession) return inferenceSession;
    if (sessionInitPromise) return sessionInitPromise;

    sessionInitPromise = (async () => {
      try {
        // Check test injection hooks
        if (customRuntimeFactory) {
          inferenceSession = await customRuntimeFactory(options);
          sessionCreateCount++;
          initError = null;
          return inferenceSession;
        }
        if (customInferenceSession) {
          inferenceSession = customInferenceSession;
          sessionCreateCount++;
          initError = null;
          return inferenceSession;
        }

        const basePath = options.assetBasePath || './assets/ml/';
        let cleanBase = basePath;
        if (!cleanBase.startsWith('/') && !cleanBase.startsWith('./') && !cleanBase.startsWith('http')) {
          cleanBase = './' + cleanBase;
        }
        if (!cleanBase.endsWith('/')) cleanBase += '/';

        const modelUrl = options.modelUrl || (cleanBase + 'doccornernet_lean.ort');
        const ortJsUrl = cleanBase + 'scanic-ort.wasm.min.js';

        // Load ONNX runtime JS
        if (typeof ort !== 'undefined') {
          ortModule = ort;
        } else if (typeof require === 'function' && typeof window === 'undefined') {
          // Node environment
          try {
            ortModule = require('onnxruntime-node');
          } catch (e1) {
            try {
              const path = require('path');
              const baseDir = typeof __dirname !== 'undefined' ? __dirname : (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.');
              ortModule = require(path.join(baseDir, 'benchmark', 'node_modules', 'onnxruntime-node'));
            } catch (e2) {
              ortModule = await import(ortJsUrl);
            }
          }
        } else {
          // Browser dynamic import
          ortModule = await import(ortJsUrl);
        }

        // Set WASM paths for ORT Web
        if (ortModule && ortModule.env && ortModule.env.wasm) {
          if (options.wasmPaths) {
            ortModule.env.wasm.wasmPaths = options.wasmPaths;
          }
          ortModule.env.wasm.numThreads = 1; // Thread safety in web worker/main thread
          ortModule.env.wasm.simd = true;
        }

        // Fetch model bytes
        let modelInput;
        if (options.modelBytes) {
          modelInput = options.modelBytes;
        } else if (typeof fetch === 'function') {
          const resp = await fetch(modelUrl);
          if (!resp.ok) throw new Error(`Failed to fetch model from ${modelUrl} (${resp.status})`);
          modelInput = new Uint8Array(await resp.arrayBuffer());
        } else if (typeof require === 'function') {
          const fs = require('fs');
          modelInput = new Uint8Array(fs.readFileSync(modelUrl));
        }

        const isBrowser = typeof window !== 'undefined' || (typeof self !== 'undefined' && typeof document !== 'undefined');
        const executionProviders = isBrowser ? ['wasm'] : (ortModule.InferenceSession ? [] : ['wasm']);

        inferenceSession = await ortModule.InferenceSession.create(modelInput, {
          executionProviders: executionProviders.length > 0 ? executionProviders : undefined,
          graphOptimizationLevel: 'all'
        });

        sessionCreateCount++;
        initError = null;
        return inferenceSession;
      } catch (err) {
        initError = err;
        inferenceSession = null;
        throw err;
      } finally {
        sessionInitPromise = null;
      }
    })();

    return sessionInitPromise;
  }

  /**
   * Preprocesses source canvas/image into a 224x224 normalized Float32 Tensor.
   */
  function preprocessToTensor(source, rotation = 0) {
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    } else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = INPUT_SIZE;
      canvas.height = INPUT_SIZE;
    } else {
      try {
        const { createCanvas } = require('canvas');
        canvas = createCanvas(INPUT_SIZE, INPUT_SIZE);
      } catch (e1) {
        try {
          const path = require('path');
          const baseDir = typeof __dirname !== 'undefined' ? __dirname : (typeof process !== 'undefined' && process.cwd ? process.cwd() : '.');
          const { createCanvas } = require(path.join(baseDir, 'benchmark', 'node_modules', 'canvas'));
          canvas = createCanvas(INPUT_SIZE, INPUT_SIZE);
        } catch (e2) {
          // Dependency-free mock canvas for Node environments without native canvas
          const buf = new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4);
          canvas = {
            width: INPUT_SIZE,
            height: INPUT_SIZE,
            getContext: () => ({
              imageSmoothingEnabled: true,
              imageSmoothingQuality: 'medium',
              createImageData: (w, h) => ({ data: buf, width: w, height: h }),
              getImageData: () => ({ data: buf, width: INPUT_SIZE, height: INPUT_SIZE }),
              putImageData: () => {},
              drawImage: () => { throw new Error('Mock drawImage'); },
              save: () => {},
              restore: () => {},
              translate: () => {},
              rotate: () => {}
            })
          };
        }
      }
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    // Apply rotation if needed
    try {
      const rad = ((rotation % 360) + 360) % 360;
      if (rad === 0) {
        const srcW = source.width || source.naturalWidth || source.videoWidth;
        const srcH = source.height || source.naturalHeight || source.videoHeight;
        ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, INPUT_SIZE, INPUT_SIZE);
      } else {
        ctx.save();
        ctx.translate(INPUT_SIZE / 2, INPUT_SIZE / 2);
        ctx.rotate((rad * Math.PI) / 180);
        ctx.drawImage(source, -INPUT_SIZE / 2, -INPUT_SIZE / 2, INPUT_SIZE, INPUT_SIZE);
        ctx.restore();
      }
    } catch (drawErr) {
      // If source is a mock object with getImageData, read its pixels directly
      if (typeof source.getContext === 'function') {
        const sctx = source.getContext('2d');
        if (sctx && typeof sctx.getImageData === 'function') {
          const sData = sctx.getImageData(0, 0, source.width, source.height);
          const targetImg = ctx.createImageData(INPUT_SIZE, INPUT_SIZE);
          const tData = targetImg.data;
          const sxScale = source.width / INPUT_SIZE;
          const syScale = source.height / INPUT_SIZE;
          for (let ty = 0; ty < INPUT_SIZE; ty++) {
            const sy = Math.min(source.height - 1, Math.floor(ty * syScale));
            for (let tx = 0; tx < INPUT_SIZE; tx++) {
              const sx = Math.min(source.width - 1, Math.floor(tx * sxScale));
              const sIdx = (sy * source.width + sx) * 4;
              const tIdx = (ty * INPUT_SIZE + tx) * 4;
              tData[tIdx]     = sData.data[sIdx];
              tData[tIdx + 1] = sData.data[sIdx + 1];
              tData[tIdx + 2] = sData.data[sIdx + 2];
              tData[tIdx + 3] = sData.data[sIdx + 3];
            }
          }
          ctx.putImageData(targetImg, 0, 0);
        }
      }
    }

    const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const data = imgData.data;
    const tensorData = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);

    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      tensorData[j]     = (data[i]     / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
      tensorData[j + 1] = (data[i + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
      tensorData[j + 2] = (data[i + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }

    if (ortModule && ortModule.Tensor) {
      return new ortModule.Tensor('float32', tensorData, [1, INPUT_SIZE, INPUT_SIZE, 3]);
    }
    return { type: 'float32', data: tensorData, dims: [1, INPUT_SIZE, INPUT_SIZE, 3] };
  }

  /**
   * Executes ML document corner detection.
   */
  async function detectMl(source, options = {}) {
    const session = await initMlSession(options);
    const tensor = preprocessToTensor(source, options.rotation || 0);

    const inputName = (session.inputNames && session.inputNames[0]) ? session.inputNames[0] : 'input';
    sessionRunCount++;
    const results = await session.run({ [inputName]: tensor });

    let coordsData = null;
    let logitData = null;

    if (results && typeof results === 'object') {
      for (const name of Object.keys(results)) {
        const out = results[name];
        if (out && out.data) {
          if (out.data.length === 8) coordsData = out.data;
          else if (out.data.length === 1) logitData = out.data[0];
        }
      }
    }

    if (!coordsData || coordsData.length !== 8) {
      throw new Error('ML model produced invalid or missing coordinates');
    }

    // Decode corners (TL, TR, BR, BL)
    const rawCorners = [
      { x: coordsData[0], y: coordsData[1] }, // Top-Left
      { x: coordsData[2], y: coordsData[3] }, // Top-Right
      { x: coordsData[4], y: coordsData[5] }, // Bottom-Right
      { x: coordsData[6], y: coordsData[7] }  // Bottom-Left
    ];

    const documentScore = logitData !== null && Number.isFinite(logitData) ? 1 / (1 + Math.exp(-logitData)) : null;
    const geom = validateGeometry(rawCorners);

    if (!geom.valid) {
      return {
        success: false,
        corners: rawCorners,
        documentScore,
        geometryValid: false,
        geometryScore: 0,
        error: geom.error
      };
    }

    const clamped = clampCorners(rawCorners);
    const geometryScore = Math.min(1.0, geom.areaRatio * 1.2);

    return {
      success: true,
      corners: clamped,
      documentScore: documentScore !== null ? Number(documentScore.toFixed(4)) : null,
      geometryValid: true,
      geometryScore: Number(geometryScore.toFixed(4)),
      error: null
    };
  }

  /**
   * Primary Document Detection entry point with automatic Classical Fallback.
   *
   * @param {CanvasImageSource} source - Source image, canvas, or video
   * @param {Object} options - Options { rotation, fallbackDetector, assetBasePath, ... }
   * @returns {Promise<Object>} Detection result { corners, documentScore, geometryValid, geometryScore, source, error }
   */
  async function detect(source, options = {}) {
    const fallbackFn = options.fallbackDetector;

    // Step 1: Try Scanic ML
    try {
      const mlResult = await detectMl(source, options);
      if (mlResult && mlResult.success) {
        return {
          corners: mlResult.corners,
          documentScore: mlResult.documentScore,
          geometryValid: true,
          geometryScore: mlResult.geometryScore,
          source: 'SCANIC_ML',
          error: null
        };
      }
      // ML produced invalid geometry - proceed to fallback
    } catch (mlErr) {
      // ML threw (e.g. initialization, inference, or tensor failure) - proceed to fallback
    }

    // Step 2: Fallback to existing classical detector if available
    if (typeof fallbackFn === 'function') {
      try {
        const fallbackRes = fallbackFn(source, options);
        if (fallbackRes && fallbackRes.corners && Array.isArray(fallbackRes.corners) && fallbackRes.corners.length === 4) {
          const geom = validateGeometry(fallbackRes.corners);
          if (geom.valid) {
            return {
              corners: clampCorners(fallbackRes.corners),
              documentScore: fallbackRes.confidence !== undefined ? fallbackRes.confidence : 0.55,
              geometryValid: true,
              geometryScore: Number((geom.areaRatio * 1.2).toFixed(4)),
              source: 'CURRENT_FALLBACK',
              error: null
            };
          }
        }
      } catch (fbErr) {
        // Fallback threw
      }
    }

    // Step 3: Safe default corners (used when ML fails/invalid AND classical fails/invalid/throws)
    return {
      corners: DEFAULT_CORNERS.map(p => ({ ...p })),
      documentScore: 0.5,
      geometryValid: true,
      geometryScore: 0.5,
      source: 'DEFAULT_FALLBACK',
      error: 'Both ML and classical detectors failed or returned invalid geometry'
    };
  }

  return {
    detect,
    detectMl,
    initMlSession,
    validateGeometry,
    polygonArea,
    isConvexQuad,
    clampCorners,
    DEFAULT_CORNERS,
    __test: {
      resetState,
      setRuntimeFactory: (fn) => { customRuntimeFactory = fn; },
      setInferenceSession: (sess) => { customInferenceSession = sess; },
      getSessionCreateCount: () => sessionCreateCount,
      getSessionRunCount: () => sessionRunCount,
      getInitError: () => initError,
      getInferenceSession: () => inferenceSession
    }
  };
}));
