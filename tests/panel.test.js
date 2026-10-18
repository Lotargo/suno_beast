const test = require('node:test');
const assert = require('node:assert/strict');
const { create: sessions } = require('../extension/panel-session');
const { create: hostPanel } = require('../extension/panel-host');

test('only the registered extension iframe/document in its own tab can use panel commands', () => {
  let seq = 0;
  const registry = sessions(file => `chrome-extension://test/${file}`, () => `opaque-${++seq}`);
  const session = registry.open(7);
  const sender = { tab: { id: 7 }, frameId: 2, documentId: 'document-a', url: session.url };
  assert.equal(registry.accepts(sender), true);
  for (const patch of [{ tab: { id: 8 } }, { frameId: 0 }, { frameId: 3 }, { documentId: 'recreated-frame' }, { url: 'https://suno.com/me' }, { url: 'chrome-extension://test/popup.html?panel=fake' }]) assert.equal(registry.accepts({ ...sender, ...patch }), false);
  registry.close(7); assert.equal(registry.accepts(sender), false);
  const next = registry.open(7); assert.notEqual(next.url, session.url); assert.equal(registry.accepts(sender), false);
});

function hostHarness() {
  let listener, restored = 0;
  const elements = [], events = new Map();
  const doc = { activeElement: { isConnected: true, focus() { restored++; } },
    getElementById: id => elements.find(e => e.id === id && e.isConnected),
    createElement(tag) {
      return { tag, children: [], isConnected: false, addEventListener() {},
        append(child) { this.children.push(child); },
        attachShadow(options) { this.mode = options.mode; return this.shadow = { children: [], append(child) { this.children.push(child); } }; },
        remove() { this.isConnected = false; }
      };
    },
    documentElement: { append(element) { element.isConnected = true; elements.push(element); } },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); }
  };
  const runtime = { id: 'test', getURL: file => `chrome-extension://test/${file}`, onMessage: { addListener(fn) { listener = fn; }, removeListener() { listener = null; } } };
  const panel = hostPanel({ runtime }, doc, { CSSStyleSheet: class { replaceSync() {} } });
  const send = (type, url, sender = { id: 'test' }, forceOpen = false) => { let response; listener({ type, url, forceOpen }, sender, data => { response = data; }); return response; };
  return { panel, elements, events, send, get restored() { return restored; } };
}
test('floating host opens/closes one isolated iframe and restores focus without controlling the recorder', () => {
  const h = hostHarness(), url = 'chrome-extension://test/popup.html?panel=opaque&tab=7';
  assert.equal(h.send('toggle-panel', url).open, true);
  assert.equal(h.send('toggle-panel', url, { id: 'test' }, true).open, true, 'a restarted worker replaces an orphaned panel on the first click');
  assert.equal(h.elements[0].isConnected, false);
  assert.equal(h.elements.at(-1).mode, 'closed'); assert.equal(h.elements.at(-1).shadow.children[0].src, url);
  assert.equal(h.send('toggle-panel', url).open, false); assert.equal(h.restored, 2);
  assert.equal(h.send('toggle-panel', url).open, true);
  h.events.get('keydown')({ key: 'Escape', stopPropagation() {} });
  assert.equal(h.elements.at(-1).isConnected, false);
  h.panel.dispose(); assert.equal(h.events.size, 0);
});
test('page senders and arbitrary iframe URLs cannot create a panel', () => {
  const h = hostHarness();
  assert.equal(h.send('toggle-panel', 'chrome-extension://test/popup.html?panel=x', { id: 'test', tab: { id: 7 } }), undefined);
  assert.equal(h.send('toggle-panel', 'chrome-extension://test/popup.html?panel=x', { id: 'other' }), undefined);
  assert.match(h.send('toggle-panel', 'https://evil.test/popup.html?panel=x').error, /Недопустимая/);
  assert.equal(h.elements.length, 0); h.panel.dispose();
});
