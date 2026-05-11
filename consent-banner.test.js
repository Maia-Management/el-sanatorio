import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const scriptPath = path.resolve(process.cwd(), 'consent-banner.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

describe('Storage Helper in consent-banner.js', () => {
  let mockLocalStorage;
  let mockWindow;
  let mockDocument;

  beforeEach(() => {
    mockLocalStorage = {
      store: {},
      setItem(key, value) { this.store[key] = value.toString(); },
      getItem(key) { return this.store[key] || null; },
      removeItem(key) { delete this.store[key]; },
      clear() { this.store = {}; }
    };

    mockWindow = {
      dataLayer: [],
      gtag: function() { this.dataLayer.push(arguments); },
      location: { pathname: '/' },
      localStorage: mockLocalStorage,
      addEventListener: () => {},
      setTimeout: (fn, delay) => setTimeout(fn, delay),
      encodeURIComponent: (str) => str,
      navigator: { userAgent: 'node' }
    };

    const createEl = (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      appendChild: function(child) {
        this.children = this.children || [];
        this.children.push(child);
        return child;
      },
      setAttribute: function(name, value) { this[name] = value; },
      getAttribute: function(name) { return this[name]; },
      textContent: '',
      innerHTML: '',
      className: '',
      parentNode: {
        removeChild: function() {}
      }
    });

    mockDocument = {
      createElement: createEl,
      createTextNode: (text) => ({ text }),
      head: createEl('head'),
      body: createEl('body'),
      getElementById: () => null,
      getElementsByTagName: () => [createEl('head')],
      addEventListener: () => {},
      readyState: 'complete',
    };

    // Setting globals for the script to use
    global.window = mockWindow;
    global.document = mockDocument;
    global.localStorage = mockLocalStorage;
    // global.navigator is tricky in Node, let's try not to set it globally if not needed,
    // or use Object.defineProperty if it's already there
    try {
        Object.defineProperty(global, 'navigator', {
            value: { userAgent: 'node' },
            configurable: true
        });
    } catch (e) {
        // ignore
    }

    // Execute the script
    // Note: Since it's an IIFE, it will run and attach to window
    (function() {
        // Use a new Function to avoid leaks and provide window/document
        const fn = new Function('window', 'document', 'localStorage', scriptContent);
        fn(mockWindow, mockDocument, mockLocalStorage);
    })();
  });

  test('MaiaConsent.setConsent saves to localStorage', () => {
    const prefs = { analytics: true, ads: false };
    mockWindow.MaiaConsent.setConsent(prefs);

    const storedRaw = mockLocalStorage.getItem('maia_consent');
    assert.ok(storedRaw, 'Should have stored data in localStorage');

    const stored = JSON.parse(storedRaw);
    assert.strictEqual(stored.analytics, true);
    assert.strictEqual(stored.ads, false);
    assert.ok(stored.timestamp, 'Should have a timestamp');
    assert.strictEqual(stored.version, '1.1.0');
  });

  test('MaiaConsent.getConsent loads from localStorage', () => {
    const record = {
      version: '1.1.0',
      timestamp: Date.now(),
      analytics: false,
      ads: true
    };
    mockLocalStorage.setItem('maia_consent', JSON.stringify(record));

    const loaded = mockWindow.MaiaConsent.getConsent();
    assert.deepStrictEqual(loaded, record);
  });

  test('MaiaConsent.getConsent returns null if version mismatch', () => {
    const record = {
      version: '1.0.0', // old version
      timestamp: Date.now(),
      analytics: true,
      ads: true
    };
    mockLocalStorage.setItem('maia_consent', JSON.stringify(record));

    const loaded = mockWindow.MaiaConsent.getConsent();
    assert.strictEqual(loaded, null);
    assert.strictEqual(mockLocalStorage.getItem('maia_consent'), null, 'Should have cleared mismatched version');
  });

  test('MaiaConsent.getConsent returns null if expired', () => {
    const record = {
      version: '1.1.0',
      timestamp: Date.now() - (15552000000 + 1000), // expired (expiryMs = 15552000000)
      analytics: true,
      ads: true
    };
    mockLocalStorage.setItem('maia_consent', JSON.stringify(record));

    const loaded = mockWindow.MaiaConsent.getConsent();
    assert.strictEqual(loaded, null);
    assert.strictEqual(mockLocalStorage.getItem('maia_consent'), null, 'Should have cleared expired record');
  });

  test('Storage helper handles localStorage errors gracefully during save', () => {
    // Force setItem to throw
    mockLocalStorage.setItem = () => { throw new Error('QuotaExceededError'); };

    assert.doesNotThrow(() => {
      mockWindow.MaiaConsent.setConsent({ analytics: true, ads: true });
    }, 'Should handle localStorage throw gracefully');
  });

  test('Storage helper handles localStorage errors gracefully during load', () => {
    // Force getItem to throw
    mockLocalStorage.getItem = () => { throw new Error('SecurityError'); };
    assert.strictEqual(mockWindow.MaiaConsent.getConsent(), null, 'Should return null on load error');
  });

  test('MaiaConsent.reopenBanner clears storage', () => {
    mockLocalStorage.setItem('maia_consent', JSON.stringify({ version: '1.1.0', timestamp: Date.now() }));
    mockWindow.MaiaConsent.reopenBanner();
    assert.strictEqual(mockLocalStorage.getItem('maia_consent'), null, 'Should clear storage when reopening banner');
  });

  test('MaiaConsent.getConsent returns null if data is corrupt', () => {
    mockLocalStorage.setItem('maia_consent', 'not-json');
    const loaded = mockWindow.MaiaConsent.getConsent();
    assert.strictEqual(loaded, null, 'Should return null for corrupt data');
  });

  test('MaiaConsent.getConsent returns null if record is missing timestamp', () => {
    mockLocalStorage.setItem('maia_consent', JSON.stringify({ version: '1.1.0', analytics: true }));
    const loaded = mockWindow.MaiaConsent.getConsent();
    assert.strictEqual(loaded, null, 'Should return null if record is missing timestamp');
  });
});
