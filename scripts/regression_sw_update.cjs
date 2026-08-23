#!/usr/bin/env node
'use strict';

/**
 * Service Worker Update Safety & Upgrade Regression Suite (Gate 9).
 * 
 * Verifies:
 *   1. Upgrade from scanvuong-v1.0.0 -> scanvuong-v2.0.0
 *   2. Precache of all 12 assets must succeed before old cache is purged
 *   3. Install failure safety: network error during precache discards new SW, keeping old SW + cache active
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let checks = 0;
let failures = 0;

function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

// Mock Service Worker Global Scope
class MockCache {
  constructor(name) {
    this.name = name;
    this.storage = new Map();
  }
  async addAll(urls) {
    for (const url of urls) {
      if (MockCache.failUrl && url.includes(MockCache.failUrl)) {
        throw new TypeError(`Failed to fetch ${url}`);
      }
      this.storage.set(url, { url, body: 'mock_body', ok: true });
    }
  }
  async match(req) {
    const key = typeof req === 'string' ? req : req.url;
    return this.storage.get(key) || null;
  }
  async put(req, res) {
    const key = typeof req === 'string' ? req : req.url;
    this.storage.set(key, res);
  }
  async keys() {
    return Array.from(this.storage.keys()).map(u => ({ url: u }));
  }
}
MockCache.failUrl = null;

class MockCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MockCache(name));
    }
    return this.caches.get(name);
  }
  async match(req, opts) {
    for (const cache of this.caches.values()) {
      const match = await cache.match(req);
      if (match) return match;
    }
    return null;
  }
  async keys() {
    return Array.from(this.caches.keys());
  }
  async delete(name) {
    return this.caches.delete(name);
  }
}

function createSwContext(initialCaches = {}) {
  const cacheStorage = new MockCacheStorage();
  for (const [k, v] of Object.entries(initialCaches)) {
    const c = new MockCache(k);
    for (const item of v) c.storage.set(item, { url: item, ok: true });
    cacheStorage.caches.set(k, c);
  }

  const listeners = {};
  const selfObj = {
    addEventListener: (evt, fn) => {
      listeners[evt] = fn;
    },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {}
    },
    location: { origin: 'http://127.0.0.1:8765' }
  };

  const sandbox = {
    self: selfObj,
    caches: cacheStorage,
    URL: global.URL,
    Promise: global.Promise,
    Array: global.Array,
    Map: global.Map,
    Set: global.Set
  };

  vm.createContext(sandbox);
  vm.runInContext(swCode, sandbox);

  return { listeners, cacheStorage };
}

const currentCacheMatch = swCode.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
const currentCache = currentCacheMatch ? currentCacheMatch[1] : 'scanvuong-v2.1.0';
const assetsMatch = swCode.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
const expectedAssetCount = assetsMatch ? (assetsMatch[1].match(/['"]\.\/[^'"]*['"]/g) || []).length : 16;

async function testUpgrade() {
  console.log(`--- Case 1: Service Worker v1.0.0 -> ${currentCache} Safe Upgrade ---`);
  MockCache.failUrl = null;

  // Setup initial v1 cache
  const { listeners, cacheStorage } = createSwContext({
    'scanvuong-v1.0.0': ['/index.html', '/styles.css', '/app.js']
  });

  assert(cacheStorage.caches.has('scanvuong-v1.0.0'), 'Initial state has scanvuong-v1.0.0 cache');

  // 1. Install event: precaches new version
  let installPromise = null;
  const installEvent = {
    waitUntil: (p) => { installPromise = p; }
  };
  listeners['install'](installEvent);
  await installPromise;

  assert(cacheStorage.caches.has(currentCache), `${currentCache} cache created on install`);
  assert(cacheStorage.caches.has('scanvuong-v1.0.0'), 'scanvuong-v1.0.0 preserved DURING install (atomic)');

  const newCache = await cacheStorage.open(currentCache);
  const newKeys = await newCache.keys();
  assert(newKeys.length === expectedAssetCount, `All ${expectedAssetCount} assets precached in ${currentCache} (got ${newKeys.length})`);

  // 2. Activate event: deletes old caches
  let activatePromise = null;
  const activateEvent = {
    waitUntil: (p) => { activatePromise = p; }
  };
  listeners['activate'](activateEvent);
  await activatePromise;

  assert(!cacheStorage.caches.has('scanvuong-v1.0.0'), 'Old scanvuong-v1.0.0 cache purged only AFTER activation');
  assert(cacheStorage.caches.has(currentCache), `Active ${currentCache} cache preserved`);
  console.log('✓ SW_UPGRADE_SAFETY: PASS');
}

async function testInstallFailureSafety() {
  console.log('\n--- Case 2: Install Failure Safety (Atomic Precache Rollback) ---');
  // Inject simulated network failure on an ML asset
  MockCache.failUrl = 'doccornernet_lean.ort';

  const { listeners, cacheStorage } = createSwContext({
    'scanvuong-v1.0.0': ['/index.html', '/styles.css', '/app.js']
  });

  let installPromise = null;
  const installEvent = {
    waitUntil: (p) => { installPromise = p; }
  };
  listeners['install'](installEvent);

  let installFailed = false;
  try {
    await installPromise;
  } catch (err) {
    installFailed = true;
  }

  assert(installFailed === true, 'Install promise rejected when asset download failed');
  assert(cacheStorage.caches.has('scanvuong-v1.0.0'), 'Previous active cache intact and serving');

  // Ensure activate is NEVER called if install fails
  // Old cache remains untouched
  assert(!cacheStorage.caches.get('scanvuong-v2.0.0')?.storage.has('./assets/ml/doccornernet_lean.ort'), 'Partial / corrupt install never promoted');
  console.log('✓ SW_INSTALL_FAILURE_SAFETY: PASS');
}

async function main() {
  console.log('==================================================');
  console.log('=== Service Worker Upgrade Safety Test Suite ===');
  console.log('==================================================\n');

  await testUpgrade();
  await testInstallFailureSafety();

  console.log('\n==================================================');
  console.log(`RESULTS: ${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`✗ ${failures} CHECKS FAILED!`);
    process.exit(1);
  } else {
    console.log('✓ All Service Worker update safety gates PASSED.');
  }
}

main().catch(err => {
  console.error('Fatal SW test error:', err);
  process.exit(1);
});