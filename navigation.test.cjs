const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const html = readFileSync(`${__dirname}/index.html`, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const navigationScript = scripts.at(-1)[1];

function setup(viewportHeight = 900) {
  const handlers = {};
  const frames = [];
  const sections = ['work', 'how', 'experience', 'team', 'contact'].map((id, i) => ({
    id,
    top: 700 + i * 600,
    getBoundingClientRect() { return { top: this.top }; },
  }));
  const links = sections.slice(0, -1).map(section => ({
    hash: `#${section.id}`,
    attributes: {},
    classList: { toggle(name, value) { this[name] = value; } },
    getAttribute() { return this.hash; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn) { this[type] = fn; },
  }));
  const topLink = { addEventListener(type, fn) { this[type] = fn; } };
  const document = {
    documentElement: { scrollHeight: 4000, clientHeight: viewportHeight },
    getElementById: id => sections.find(section => section.id === id),
    querySelectorAll: selector => selector.startsWith('.nav-link') ? links
      : selector.startsWith('main') ? sections : [topLink],
  };
  const window = {
    scrollY: 0,
    location: { hash: '' },
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  runInNewContext(navigationScript, {
    document, window,
    requestAnimationFrame: fn => frames.push(fn),
    getComputedStyle: () => ({ scrollPaddingTop: '84px' }),
  });
  function flush() { while (frames.length) frames.shift()(); }
  function scrollTo(y) {
    window.scrollY = y;
    sections.forEach((section, i) => { section.top = 700 + i * 600 - y; });
    handlers.scroll();
    flush();
  }
  function active() {
    return links.filter(link => link.classList.active).map(link => link.hash);
  }
  flush();
  return { handlers, sections, links, topLink, window, flush, scrollTo, active };
}

test('scrolling selects the section below the header, not the viewport midpoint', () => {
  const s = setup();
  s.scrollTo(1300 - 84);
  assert.deepEqual(s.active(), ['#how']);
  assert.equal(s.links[1].attributes['aria-current'], 'location');
  s.scrollTo(1900 - 84);
  assert.deepEqual(s.active(), ['#experience']);
  assert.equal(s.links[1].attributes['aria-current'], undefined);
});

test('click selection survives intermediate sections during smooth scrolling', () => {
  const s = setup();
  s.scrollTo(2500 - 84);
  s.links[1].click({ button: 0 });
  assert.deepEqual(s.active(), ['#how']);
  s.scrollTo(1900 - 84);
  assert.deepEqual(s.active(), ['#how']);
  s.scrollTo(1300 - 84);
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#how']);
});

test('hero, Contact and Back to top clear the active tab', () => {
  const s = setup();
  s.scrollTo(1300 - 84);
  s.scrollTo(3100 - 84);
  assert.deepEqual(s.active(), []);
  s.scrollTo(2500 - 84);
  s.topLink.click();
  s.scrollTo(0);
  assert.deepEqual(s.active(), []);
});

test('manual scroll interruption releases a clicked section', () => {
  for (const [type, event] of [['wheel', {}], ['touchstart', {}], ['keydown', { key: 'Home' }]]) {
    const s = setup();
    s.links[1].click({ button: 0 });
    s.handlers[type](event);
    s.scrollTo(1900 - 84);
    assert.deepEqual(s.active(), ['#experience']);
  }
});

test('modified clicks do not change the current tab', () => {
  const s = setup();
  s.scrollTo(700 - 84);
  s.links[1].click({ button: 0, ctrlKey: true });
  assert.deepEqual(s.active(), ['#work']);
});

test('initial hashes and history/page restoration use the current scroll position', () => {
  const s = setup();
  s.scrollTo(1216);
  s.window.location.hash = '#how';
  s.handlers.hashchange();
  s.flush();
  assert.deepEqual(s.active(), ['#how']);
  s.scrollTo(0);
  s.handlers.pageshow();
  s.flush();
  assert.deepEqual(s.active(), []);
});

test('clicked targets stay selected when a tall viewport clamps the final scroll', () => {
  const s = setup(1800);
  s.links[3].click({ button: 0 });
  s.scrollTo(1800);
  assert.deepEqual(s.active(), ['#team']);
  s.scrollTo(2200);
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#team']);
  s.handlers.wheel();
  s.scrollTo(2100);
  assert.deepEqual(s.active(), ['#experience']);
});

test('a clamped hash target is selected on direct entry or history restoration', () => {
  const s = setup(1800);
  s.scrollTo(2200);
  s.window.location.hash = '#team';
  s.handlers.hashchange();
  s.flush();
  assert.deepEqual(s.active(), ['#team']);
});

test('an early scrollend cannot cancel the next clicked destination', () => {
  const s = setup(1800);
  s.scrollTo(1900 - 84);
  s.links[3].click({ button: 0 });
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#team']);
  s.window.location.hash = '#team';
  s.handlers.hashchange();
  s.flush();
  s.scrollTo(2200);
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#team']);
});

test('history can update the hash before restoring a clamped scroll position', () => {
  const s = setup(1800);
  s.scrollTo(1900 - 84);
  s.window.location.hash = '#team';
  s.handlers.hashchange();
  s.flush();
  assert.deepEqual(s.active(), ['#experience']);
  s.scrollTo(2200);
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#team']);
});

test('history restoring away from the anchor follows the visible section', () => {
  const s = setup(1800);
  s.scrollTo(1900 - 84);
  s.window.location.hash = '#team';
  s.handlers.pageshow();
  s.flush();
  s.handlers.scrollend();
  s.flush();
  assert.deepEqual(s.active(), ['#experience']);
  s.handlers.wheel();
  s.scrollTo(2200);
  assert.deepEqual(s.active(), ['#experience']);
});
