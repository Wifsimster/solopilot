// Unit tests for the pure consolidated-digest builder (runs against dist/).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildConsolidatedDigest,
  extractTopItems,
  embedLength,
  NOTHING_NOTABLE,
  MAX_ITEMS_PER_SECTION,
} = await import('../dist/modules/veille/consolidated-digest.js');
const { DISCORD_LIMITS } = await import('../dist/adapters/discord-notifier.js');

const DATE = '2026-09-27';

function section(i, items = [{ text: `[Item ${i}](https://example.com/${i})`, url: `https://example.com/${i}` }]) {
  return { productId: `p${i}`, productName: `Produit ${i}`, items };
}

function assertWithinLimits(messages) {
  for (const msg of messages) {
    assert.ok(msg.embeds.length >= 1, 'no empty message');
    assert.ok(msg.embeds.length <= DISCORD_LIMITS.embedsPerMessage, 'max 10 embeds');
    const total = msg.embeds.reduce((n, e) => n + embedLength(e), 0);
    assert.ok(total <= DISCORD_LIMITS.totalEmbedChars, `total ${total} <= 6000`);
    assert.ok(!msg.content || msg.content.length <= DISCORD_LIMITS.content, 'content <= 2000');
    for (const e of msg.embeds) {
      assert.ok((e.title ?? '').length <= DISCORD_LIMITS.embedTitle, 'title <= 256');
      assert.ok((e.description ?? '').length <= DISCORD_LIMITS.embedDescription, 'description <= 4096');
    }
  }
}

test('one section per product, in order, in a single message', () => {
  const messages = buildConsolidatedDigest([section(1), section(2), section(3)], { date: DATE });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].embeds.map((e) => e.title), ['Produit 1', 'Produit 2', 'Produit 3']);
  assert.match(messages[0].embeds[0].description, /\[Item 1\]\(https:\/\/example\.com\/1\)/);
  assert.match(messages[0].content, /27\/09\/2026/);
  assert.match(messages[0].content, /3 produits/);
  assertWithinLimits(messages);
});

test('product without items renders "Rien de notable"', () => {
  const messages = buildConsolidatedDigest([section(1), section(2, [])], { date: DATE });
  assert.equal(messages[0].embeds[1].description, NOTHING_NOTABLE);
  assert.equal(NOTHING_NOTABLE, 'Rien de notable');
});

test('all products empty still produce one digest', () => {
  const messages = buildConsolidatedDigest([section(1, []), section(2, [])], { date: DATE });
  assert.equal(messages.length, 1);
  assert.ok(messages[0].embeds.every((e) => e.description === NOTHING_NOTABLE));
});

test('no sections → no message', () => {
  assert.deepEqual(buildConsolidatedDigest([], { date: DATE }), []);
});

test('at most 3 items per section; bare url appended when missing from text', () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ text: `Nouvelle ${n}`, url: `https://ex.com/${n}` }));
  const [msg] = buildConsolidatedDigest([section(1, items)], { date: DATE });
  const lines = msg.embeds[0].description.split('\n');
  assert.equal(lines.length, MAX_ITEMS_PER_SECTION);
  assert.equal(lines[0], '• Nouvelle 1 — https://ex.com/1');
});

test('more than 10 sections splits into ceil(n/10) messages', () => {
  const sections = Array.from({ length: 23 }, (_, i) => section(i + 1));
  const messages = buildConsolidatedDigest(sections, { date: DATE });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((m) => m.embeds.length), [10, 10, 3]);
  assert.match(messages[0].content, /\(1\/3\)/);
  assert.match(messages[2].content, /\(3\/3\)/);
  // Order preserved across messages.
  assert.equal(messages[1].embeds[0].title, 'Produit 11');
  assertWithinLimits(messages);
});

test('more than 6000 chars splits greedily into the fewest messages', () => {
  // Each section ≈ 3 items × ~390 chars ≈ 1.2k chars → 4 fit in 6000, not 5.
  const longItems = [1, 2, 3].map((n) => ({ text: `${'x'.repeat(380)} ${n}`, url: `https://ex.com/${n}` }));
  const sections = Array.from({ length: 9 }, (_, i) => section(i + 1, longItems));
  const perEmbed = embedLength(buildConsolidatedDigest([sections[0]], { date: DATE })[0].embeds[0]);
  const perMessage = Math.floor(DISCORD_LIMITS.totalEmbedChars / perEmbed);
  const messages = buildConsolidatedDigest(sections, { date: DATE });
  assert.equal(messages.length, Math.ceil(9 / perMessage));
  assert.ok(messages.length > 1);
  assertWithinLimits(messages);
  assert.equal(messages.flatMap((m) => m.embeds).length, 9, 'no section lost');
});

test('single oversize section is truncated safely below 4096', () => {
  const huge = [
    { text: 'a'.repeat(5000), url: 'https://ex.com/huge' },
    { text: 'b'.repeat(5000) },
  ];
  const messages = buildConsolidatedDigest([section(1, huge), section(2)], { date: DATE });
  assertWithinLimits(messages);
  const desc = messages[0].embeds[0].description;
  assert.ok(desc.length <= 4096);
  assert.ok(desc.includes('https://ex.com/huge'), 'link survives item truncation');
  assert.equal(messages[0].embeds[1].title, 'Produit 2', 'next section unaffected');
});

test('oversize product name is truncated to 256 chars; mentions are neutralised', () => {
  const [msg] = buildConsolidatedDigest(
    [{ productId: 'x', productName: '@everyone '.repeat(60), items: [{ text: 'ping <@123> @here' }] }],
    { date: DATE },
  );
  assert.ok(msg.embeds[0].title.length <= 256);
  assert.ok(!/@everyone/.test(msg.embeds[0].title));
  assert.ok(!/<@123>/.test(msg.embeds[0].description) && !/@here/.test(msg.embeds[0].description));
});

test('truncation never splits a surrogate pair', () => {
  const [msg] = buildConsolidatedDigest([section(1, [{ text: '🚀'.repeat(300) }])], { date: DATE });
  assert.doesNotMatch(msg.embeds[0].description, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('extractTopItems prefers linked bullets and skips headers', () => {
  const summary = [
    '📅 VEILLE IA & TECH — 27 septembre 2026',
    '',
    '**X (TWITTER)**',
    '- Un avis sans lien',
    '- [OpenAI sort un modèle](https://x.com/a/1)',
    '',
    '**REDDIT**',
    '* Discussion https://reddit.com/r/b/2 intéressante',
    '• [HN top](https://news.ycombinator.com/3)',
    '1. [Quatrième](https://ex.com/4)',
  ].join('\n');
  const items = extractTopItems(summary);
  assert.deepEqual(items.map((i) => i.url), [
    'https://x.com/a/1',
    'https://reddit.com/r/b/2',
    'https://news.ycombinator.com/3',
  ]);
});

test('extractTopItems falls back to unlinked bullets, then to nothing', () => {
  assert.deepEqual(extractTopItems('- un\n- deux'), [{ text: 'un' }, { text: 'deux' }]);
  assert.deepEqual(extractTopItems('Pas de puces ici.'), []);
  assert.deepEqual(extractTopItems(null), []);
  assert.deepEqual(extractTopItems('- **REDDIT**'), []);
});
