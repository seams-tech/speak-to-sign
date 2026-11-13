// Unit tests of the voice commands: the command of a set of scores and the amount in a sentence
// (src/voice/command.ts), the JEV request and its answer (functions/lib/jevCommand.ts), and the
// score of the "Controversial" tab (src/x/controversy.ts), and the "close" sentence of an open
// dialog (src/voice/hold.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jevCommandRequest, readJevCommand, screenText } from '../functions/lib/jevCommand.ts';
import { commandRequest, decideCommand, readScores, ruleScores, spokenScroll, spokenSide, spokenUsdc, type CommandScores, type Screen } from '../src/voice/command.ts';
import { closeRequest, transactionHashOf, viewTransactionRequest } from '../src/voice/hold.ts';
import { controversy, countOf } from '../src/x/controversy.ts';

const USDC = 1_000_000n;

// Post 20 has no note, so the note of post 30 is "note 2".
const SCREEN: Screen = {
  posts: [
    { postId: 10, author: 'Ann', text: 'The bridge closes for a year.', note: 'One lane closes for two weeks.' },
    { postId: 20, author: 'Bob', text: 'The team won 140 to 90.' },
    { postId: 30, author: 'Cy', text: 'Water on the equator of Mars.', note: 'The paper reports minerals, not water.' },
  ],
  focusedPostId: 20,
};

const NONE: CommandScores = {
  show: { fresh: 0, controversial: 0, open: 0, decided: 0 },
  move: { next: 0, previous: 0 },
  goTo: 0,
  writeNote: 0,
  rate: { helpful: 0, somewhat_helpful: 0, not_helpful: 0 },
  bet: 0,
  openMarket: 0,
  betNo: 0,
  post: [0, 0, 0],
  note: [0, 0, 0],
};

test('decideCommand takes the surest action, and nothing below the limit', () => {
  assert.deepEqual(decideCommand({ ...NONE, show: { ...NONE.show, controversial: 0.96 } }, SCREEN, ''), { kind: 'show', tab: 'controversial' });
  assert.deepEqual(decideCommand({ ...NONE, bet: 0.5, writeNote: 0.4 }, SCREEN, ''), { kind: 'none' });
  assert.deepEqual(decideCommand(NONE, SCREEN, 'what a nice day'), { kind: 'none' });
});

test('"this one" is the focused post, and a named post wins over it', () => {
  assert.deepEqual(decideCommand({ ...NONE, writeNote: 0.94 }, SCREEN, ''), { kind: 'write_note', postId: 20 });
  assert.deepEqual(decideCommand({ ...NONE, writeNote: 0.94, post: [0.1, 0.2, 0.9] }, SCREEN, ''), { kind: 'write_note', postId: 30 });
  assert.deepEqual(decideCommand({ ...NONE, writeNote: 0.94 }, { ...SCREEN, focusedPostId: null }, ''), { kind: 'no_target', action: 'write_note' });
});

test('a bet goes to the named note, with the side and the spoken amount', () => {
  const scores = { ...NONE, bet: 0.84, betNo: 0.95, note: [0.04, 0, 0.97] };
  assert.deepEqual(decideCommand(scores, SCREEN, 'I do not think the second community note is true, bet $1 on no'), {
    kind: 'bet',
    postId: 30,
    side: 'no',
    amount: USDC,
  });
  // No note named: the note of the focused post. Post 20 has none, so there is no bet.
  assert.deepEqual(decideCommand({ ...NONE, bet: 0.9 }, SCREEN, 'bet on yes'), { kind: 'no_target', action: 'bet' });
  assert.deepEqual(decideCommand({ ...NONE, bet: 0.9 }, { ...SCREEN, focusedPostId: 10 }, 'bet on yes'), {
    kind: 'bet',
    postId: 10,
    side: 'yes',
    amount: null,
  });
});

test('the words of a bet choose its side, and the score decides when they do not', () => {
  assert.equal(spokenSide('bet no on this post'), 'no');
  assert.equal(spokenSide('but knowing this post'), 'no');
  assert.equal(spokenSide('bet one dollar on yes'), 'yes');
  assert.equal(spokenSide('yeah bet fifty cents'), 'yes');
  assert.equal(spokenSide('bet on the second note'), null);
  assert.equal(spokenSide('no way this is true, bet yes'), null);
  // "Note" and "know" are not "no".
  assert.equal(spokenSide('I know, bet on the note'), null);
  const focused = { ...SCREEN, focusedPostId: 10 };
  // A weak score for "no" and clear words: the words win.
  assert.equal((decideCommand({ ...NONE, bet: 0.86, betNo: 0.45 }, focused, 'but knowing this post') as { side: string }).side, 'no');
  assert.equal((decideCommand({ ...NONE, bet: 0.9, betNo: 0.7 }, focused, 'bet yes on this one') as { side: string }).side, 'yes');
  assert.equal((decideCommand({ ...NONE, bet: 0.9, betNo: 0.8 }, focused, 'bet on the first note') as { side: string }).side, 'no');
});

test('a new market goes to the named note, or to the note of the focused post', () => {
  assert.deepEqual(decideCommand({ ...NONE, openMarket: 0.9, note: [0, 0, 0.9] }, SCREEN, ''), { kind: 'open_market', postId: 30 });
  assert.deepEqual(decideCommand({ ...NONE, openMarket: 0.9 }, { ...SCREEN, focusedPostId: 10 }, ''), { kind: 'open_market', postId: 10 });
  assert.deepEqual(decideCommand({ ...NONE, openMarket: 0.9 }, SCREEN, ''), { kind: 'no_target', action: 'open_market' });
});

test('a rating goes to the named note, and a move needs no post', () => {
  assert.deepEqual(decideCommand({ ...NONE, rate: { ...NONE.rate, not_helpful: 0.9 }, note: [0.9, 0, 0] }, SCREEN, ''), { kind: 'rate', postId: 10, rating: 'not_helpful' });
  assert.deepEqual(decideCommand({ ...NONE, rate: { ...NONE.rate, helpful: 0.9 } }, SCREEN, ''), { kind: 'no_target', action: 'rate' });
  assert.deepEqual(decideCommand({ ...NONE, move: { next: 0.9, previous: 0.1 } }, SCREEN, ''), { kind: 'move', to: 'next' });
  // A named post wins over the direction.
  assert.deepEqual(decideCommand({ ...NONE, move: { next: 0.9, previous: 0.1 }, post: [0.9, 0, 0] }, SCREEN, ''), { kind: 'go', postId: 10 });
  assert.deepEqual(decideCommand({ ...NONE, goTo: 0.9, post: [0, 0, 0.8] }, SCREEN, ''), { kind: 'go', postId: 30 });
  assert.deepEqual(decideCommand({ ...NONE, goTo: 0.9 }, SCREEN, ''), { kind: 'no_target', action: 'go' });
});

test('a small scroll comes from the words, and it keeps the post', () => {
  assert.equal(spokenScroll('Now scroll down just a little bit'), 'down');
  assert.equal(spokenScroll('Scroll up a bit.'), 'up');
  assert.equal(spokenScroll('go down half a page'), 'down');
  assert.equal(spokenScroll('Scroll down slightly'), 'down');
  // "Scroll down" alone is the next post, and a bet is not a scroll.
  assert.equal(spokenScroll('Scroll down.'), null);
  assert.equal(spokenScroll('Bet a little bit on yes'), null);
  assert.equal(spokenScroll('This note is a bit down on the facts'), null);
  const run = (transcript: string) => decideCommand(ruleScores(commandRequest(transcript, SCREEN)), SCREEN, transcript);
  assert.deepEqual(run('Now scroll down just a little bit'), { kind: 'scroll', to: 'down' });
  assert.deepEqual(run('Scroll up a little.'), { kind: 'scroll', to: 'up' });
  assert.deepEqual(run('Scroll down.'), { kind: 'move', to: 'next' });
  // The classifier reads "scroll down" as the next post: the words win.
  assert.deepEqual(decideCommand({ ...NONE, move: { next: 0.95, previous: 0 } }, SCREEN, 'scroll down a little bit'), { kind: 'scroll', to: 'down' });
  // A named post wins over the small scroll.
  assert.deepEqual(run('Scroll down a little to the third post.'), { kind: 'go', postId: 30 });
});

test('spokenUsdc reads digits and words, in whole cents', () => {
  const cases: [string, bigint | null][] = [
    ['bet $1 on no', USDC],
    ['bet one dollar on no', USDC],
    ['bet 1 dollar on no', USDC],
    ['put $0.50 on yes', USDC / 2n],
    ['bet half a dollar on yes', USDC / 2n],
    ['bet fifty cents on yes', USDC / 2n],
    ['bet 10 cents', USDC / 10n],
    ['bet 0.5 usdc on market nine', USDC / 2n],
    ['bet two bucks', 2n * USDC],
    ['bet 1 on the first post', USDC],
    ['bet one on no', USDC],
    ['bet 1 USD on the first post', USDC],
    ['bet one-dollar on yes', USDC],
    ['bet 1$ on yes', USDC],
    ['bet a lot on yes', null],
    ['bet on the 2nd note', null],
    ['bet on the first post', null],
    ['bet on no', null],
    ['the second note is not true', null],
  ];
  for (const [text, amount] of cases) assert.equal(spokenUsdc(text), amount, text);
});

test('the word rules know the three sentences of the demo', () => {
  const run = (transcript: string) => decideCommand(ruleScores(commandRequest(transcript, SCREEN)), SCREEN, transcript);
  assert.deepEqual(run('Show me controversial posts.'), { kind: 'show', tab: 'controversial' });
  assert.deepEqual(run("I don't think this one is true, add a community note."), { kind: 'write_note', postId: 20 });
  assert.deepEqual(run("I don't think the second community note is true, bet $1 on no"), { kind: 'bet', postId: 30, side: 'no', amount: USDC });
  assert.deepEqual(run('Open a market on the first note.'), { kind: 'open_market', postId: 10 });
  assert.deepEqual(run('Rate the first note as helpful.'), { kind: 'rate', postId: 10, rating: 'helpful' });
  assert.deepEqual(run('The second note is not helpful.'), { kind: 'rate', postId: 30, rating: 'not_helpful' });
  assert.deepEqual(run('The first note is somewhat helpful.'), { kind: 'rate', postId: 10, rating: 'somewhat_helpful' });
  assert.deepEqual(run('Next post.'), { kind: 'move', to: 'next' });
  assert.deepEqual(run('Scroll down to the third post.'), { kind: 'go', postId: 30 });
  assert.deepEqual(run('Go to the first post.'), { kind: 'go', postId: 10 });
  assert.deepEqual(run('Go back.'), { kind: 'move', to: 'previous' });
  assert.deepEqual(run('Show me the open markets.'), { kind: 'show', tab: 'open' });
  assert.deepEqual(run('what a nice day'), { kind: 'none' });
});

test('the JEV request numbers the notes apart from the posts, and its answer gives the scores', () => {
  const request = commandRequest('bet one dollar on no on the second note', SCREEN);
  assert.match(screenText(request), /Post 3 by Cy: .* Note 2 \(the community note on post 3\)/);
  assert.match(screenText(request), /Post 2 by Bob: .* It has no note\./);
  const body = jevCommandRequest(request, 'jev-test') as { model: string; state: { transcript: string }; questions: Record<string, { type: string }> };
  assert.equal(body.model, 'jev-test');
  assert.equal(body.state.transcript, request.transcript);
  assert.deepEqual(
    Object.keys(body.questions).sort(),
    ['bet', 'bet_no', 'go_to', 'move_next', 'move_previous', 'note_1', 'note_3', 'open_market', 'post_1', 'post_2', 'post_3', 'rate_helpful', 'rate_not_helpful', 'rate_somewhat_helpful', 'show_controversial', 'show_decided', 'show_fresh', 'show_open', 'write_note'],
  );

  const answers = Object.fromEntries(Object.keys(body.questions).map((key) => [key, { type: 'noul', noul: key === 'note_3' ? 0.97 : key.startsWith('bet') ? 0.9 : 0.05 }]));
  const scores = readJevCommand({ answers }, request);
  assert.deepEqual(scores?.note, [0.05, 0, 0.97]);
  assert.deepEqual(decideCommand(scores!, SCREEN, request.transcript), { kind: 'bet', postId: 30, side: 'no', amount: USDC });
  // The page reads the route's answer with the same shape.
  assert.deepEqual(readScores(JSON.parse(JSON.stringify(scores)), 3), scores);
  assert.equal(readScores(JSON.parse(JSON.stringify(scores)), 2), null);

  const { bet: _, ...withoutBet } = answers;
  assert.equal(readJevCommand({ answers: withoutBet }, request), null);
  assert.equal(readJevCommand({ answers: { ...answers, bet: { type: 'noul', noul: 1.5 } } }, request), null);
  assert.equal(readJevCommand(null, request), null);
});

test('the controversy score counts the ratio, the rating split and the market balance', () => {
  assert.deepEqual(['1.2K', '3M', '950', '1,204', '', undefined, 'n/a'].map(countOf), [1200, 3_000_000, 950, 1204, 0, 0, 0]);
  const post = (replies: string, likes: string) => ({ stats: { replies, likes, reposts: '0', bookmarks: '0', views: '0' } }) as Parameters<typeof controversy>[0];
  const note = (helpful: number, notHelpful: number) => ({ helpful, somewhat_helpful: 0, not_helpful: notHelpful }) as Parameters<typeof controversy>[1];
  const market = (yes: bigint, no: bigint, status = 'open') => ({ yesPool: yes, noPool: no, status }) as Parameters<typeof controversy>[2];
  assert.equal(controversy({} as Parameters<typeof controversy>[0], undefined, null), 0);
  assert.equal(controversy(post('500', '1K'), undefined, null), 0.5);
  assert.equal(controversy(post('3K', '1K'), undefined, null), 1);
  assert.equal(controversy(post('0', '0'), note(2, 2), null), 1);
  assert.equal(controversy(post('0', '0'), note(4, 0), null), 0);
  assert.equal(controversy(post('0', '0'), undefined, market(5n, 5n)), 1);
  assert.equal(controversy(post('0', '0'), undefined, market(5n, 5n, 'resolved')), 0);
  assert.equal(controversy(post('1K', '1K'), note(1, 1), market(1n, 3n)), 2.5);
});

test('"view transaction" is a short sentence, and the hash comes from each result form', () => {
  for (const text of ['View transaction', 'view the transaction.', 'Now open the transaction', 'Okay, show me the transaction', 'View transaction please', 'Click the transaction link on the right column', 'click the transaction link']) {
    assert.equal(viewTransactionRequest(text), true, text);
  }
  for (const text of ['transaction', 'I view this transaction as a mistake in the long history of the bank', 'close', 'view the quote', 'write a note about the transaction', '']) {
    assert.equal(viewTransactionRequest(text), false, text);
  }
  // With no dialog, the same words are a command of the page, and the classifier's scores do not count.
  assert.deepEqual(decideCommand(NONE, SCREEN, 'Click the transaction link on the right column'), { kind: 'view_transaction' });
  assert.deepEqual(decideCommand({ ...NONE, writeNote: 0.9 }, SCREEN, 'view transaction'), { kind: 'view_transaction' });
  assert.equal(transactionHashOf({ result: { transactionHash: 'A1' } }), 'A1');
  assert.equal(transactionHashOf({ transactionHash: 'B2' }), 'B2');
  assert.equal(transactionHashOf({ transactionId: 'C3' }), 'C3');
  assert.equal(transactionHashOf({ ok: false, error: 'refused' }), null);
  assert.equal(transactionHashOf(undefined), null);
});

test('closeRequest takes only a short sentence that asks to close', () => {
  // A speech-to-text model can write "modal" as "Moodle": a close sentence counts by its first word.
  for (const text of ['close', 'Close this post.', 'close the dialog', 'Close the Moodle', 'okay close it', 'Cancel', 'never mind', 'Clothes this post']) {
    assert.equal(closeRequest(text), true, text);
  }
  for (const text of ['I am close to the stadium', 'write a note on this post', 'this post is close to the truth', 'close this post and bet one dollar on no', '']) {
    assert.equal(closeRequest(text), false, text);
  }
});
