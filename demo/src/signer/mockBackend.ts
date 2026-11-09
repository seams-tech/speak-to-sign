// Mock mode: an in-memory notes contract and a mock signer that share state.
// The status rule and the refusals copy community-notes/src/lib.rs.

import { MIN_RATINGS_FOR_STATUS, type Note, type NoteStatus, type NotesStore } from '../notes/types';
import { checkSummary } from '../summaryRules';
import type { NotesSigner, Rating, SignResult, SignerStatus } from './notesSigner';

export type MockOutcome = 'sent' | 'refused' | 'cancelled' | 'unavailable';

export const MOCK_ACCOUNTS = ['alice.testnet', 'bob.testnet', 'carol.testnet'] as const;

export interface MockControls {
  readonly accounts: readonly string[];
  account(): string;
  setAccount(accountId: string): void;
  /** The result of the next sign request. It goes back to `sent` after one use. */
  outcome(): MockOutcome;
  setOutcome(outcome: MockOutcome): void;
  subscribe(listener: () => void): () => void;
}

interface StoredNote {
  id: number;
  post_id: number;
  author: string;
  text: string;
  summary: string;
  created_at_ms: number;
  ratings: Map<string, Rating>;
}

const NOTE_DELAY_MS = 1600;
const RATING_DELAY_MS = 1300;
const VIEW_DELAY_MS = 120;
const MAX_TEXT_CHARS = 280;
const MAX_SUMMARY_CHARS = 120;

export class MockBackend {
  private notes: StoredNote[] = [];
  private lastNoteId = 0;
  private currentAccount: string = MOCK_ACCOUNTS[0];
  private nextOutcome: MockOutcome = 'sent';
  private readonly listeners = new Set<() => void>();

  constructor() {
    const hour = 3_600_000;
    this.seed(2, 'maple.testnet', Date.now() - 5 * hour,
      'The forecast for Saturday is 31°C, not 41°C. The record for Northfield is 38°C, from 2019. northfield-weather.example/forecast',
      'The forecast is thirty one degrees not forty one',
      { 'ash.testnet': 'helpful', 'birch.testnet': 'helpful', 'elm.testnet': 'helpful', 'fir.testnet': 'somewhat_helpful' });
    this.seed(3, 'cedar.testnet', Date.now() - 9 * hour,
      "The maker's own test shows two days of normal use. Five days is only in low power mode. orbit-labs.example/battery",
      'Two days in normal use and five only in low power mode',
      { 'oak.testnet': 'helpful' });
  }

  readonly store: NotesStore = {
    getNotes: async (postId) => {
      await sleep(VIEW_DELAY_MS);
      return this.notes
        .filter((note) => note.post_id === postId)
        .sort((a, b) => b.id - a.id)
        .map(toView);
    },
    getRating: async (noteId, accountId) => {
      await sleep(VIEW_DELAY_MS);
      return this.notes.find((note) => note.id === noteId)?.ratings.get(accountId) ?? null;
    },
  };

  readonly signer: NotesSigner = {
    status: async (): Promise<SignerStatus> => ({
      signedIn: true,
      accountId: this.currentAccount,
      voiceReady: true,
    }),

    requestNote: async ({ postId, text, summary }) => {
      await sleep(NOTE_DELAY_MS);
      const forced = this.takeForcedOutcome();
      if (forced) return forced;
      const check = checkSummary(summary);
      if (!check.ok) {
        const broken = check.rules.filter((rule) => !rule.ok).map((rule) => rule.label.toLowerCase());
        return { kind: 'refused', reason: `The summary breaks a word rule: ${broken.join('; ')}.` };
      }
      if ([...text.trim()].length === 0 || [...text].length > MAX_TEXT_CHARS) {
        return { kind: 'refused', reason: 'The note must have 1 to 280 characters.' };
      }
      if ([...summary].length > MAX_SUMMARY_CHARS) {
        return { kind: 'refused', reason: 'The summary must have 120 characters or fewer.' };
      }
      this.lastNoteId += 1;
      this.notes.push({
        id: this.lastNoteId,
        post_id: postId,
        author: this.currentAccount,
        text: text.trim(),
        summary: summary.trim(),
        created_at_ms: Date.now(),
        ratings: new Map(),
      });
      this.emit();
      return { kind: 'sent', transactionHash: fakeHash() };
    },

    requestRating: async ({ noteId, rating }) => {
      await sleep(RATING_DELAY_MS);
      const forced = this.takeForcedOutcome();
      if (forced) return forced;
      const note = this.notes.find((candidate) => candidate.id === noteId);
      if (!note) {
        return { kind: 'refused', reason: 'This note does not exist.' };
      }
      if (note.author === this.currentAccount) {
        return { kind: 'refused', reason: 'You wrote this note. Another account must rate it.' };
      }
      note.ratings.set(this.currentAccount, rating);
      this.emit();
      return { kind: 'sent', transactionHash: fakeHash() };
    },
  };

  readonly controls: MockControls = {
    accounts: MOCK_ACCOUNTS,
    account: () => this.currentAccount,
    setAccount: (accountId) => {
      this.currentAccount = accountId;
      this.emit();
    },
    outcome: () => this.nextOutcome,
    setOutcome: (outcome) => {
      this.nextOutcome = outcome;
      this.emit();
    },
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  private takeForcedOutcome(): SignResult | null {
    const outcome = this.nextOutcome;
    if (outcome === 'sent') return null;
    this.nextOutcome = 'sent';
    this.emit();
    switch (outcome) {
      case 'refused':
        return { kind: 'refused', reason: `The voice did not match the voice enrolled for ${this.currentAccount}.` };
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'unavailable':
        return { kind: 'unavailable', reason: 'Seams Wallet did not answer.' };
    }
  }

  private seed(postId: number, author: string, createdAtMs: number, text: string, summary: string, ratings: Record<string, Rating>) {
    this.lastNoteId += 1;
    this.notes.push({
      id: this.lastNoteId,
      post_id: postId,
      author,
      text,
      summary,
      created_at_ms: createdAtMs,
      ratings: new Map(Object.entries(ratings)),
    });
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

function toView(note: StoredNote): Note {
  let helpful = 0;
  let somewhatHelpful = 0;
  let notHelpful = 0;
  for (const rating of note.ratings.values()) {
    if (rating === 'helpful') helpful += 1;
    else if (rating === 'somewhat_helpful') somewhatHelpful += 1;
    else notHelpful += 1;
  }
  return {
    id: note.id,
    post_id: note.post_id,
    author: note.author,
    text: note.text,
    summary: note.summary,
    created_at_ms: note.created_at_ms,
    helpful,
    somewhat_helpful: somewhatHelpful,
    not_helpful: notHelpful,
    status: statusFromCounts(helpful, notHelpful),
  };
}

function statusFromCounts(helpful: number, notHelpful: number): NoteStatus {
  if (helpful >= MIN_RATINGS_FOR_STATUS && helpful > notHelpful) return 'helpful';
  if (notHelpful >= MIN_RATINGS_FOR_STATUS && notHelpful > helpful) return 'not_helpful';
  return 'needs_more_ratings';
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function fakeHash(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(44));
  return Array.from(bytes, (byte) => BASE58[byte % BASE58.length]).join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
