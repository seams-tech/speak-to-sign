// The note market strip inside a note card (design: pm-ui-mock.html). Parimutuel bets: the
// YES pool and the NO pool. At the close, JEV (or NEAR AI) gives the probability that the note
// holds up, and that probability splits the whole pool between the two sides.

import { useCallback, useEffect, useId, useState } from 'react';
import { IconChevronDown, IconX } from '@tabler/icons-react';
import { Modal } from '../components/Modal';
import { config, transactionUrl } from '../config';
import { findPost } from '../data/posts';
import { useDemo } from '../demoContext';
import type { Note } from '../notes/types';
import { MarketNotDeployed, marketStore } from './marketStore';
import { RESOLUTION_FEE_YOCTO, YOCTO_PER_NEAR, useMarketSigner } from './marketSigner';
import type { MarketTxResult, MarketView, Outcome, PositionView } from './types';
import './market.css';

export const MARKET_QUESTION = 'Will this note hold up?';
/** Bet and seed sizes, in NEAR tenths: 0.1, 0.5 and 1 NEAR. */
const CHIPS: { label: string; yocto: bigint }[] = [
  { label: '0.1', yocto: YOCTO_PER_NEAR / 10n },
  { label: '0.5', yocto: YOCTO_PER_NEAR / 2n },
  { label: '1', yocto: YOCTO_PER_NEAR },
];
const MINUTE = 60_000;
const DURATIONS: { label: string; ms: number }[] = [
  { label: '10 min', ms: 10 * MINUTE },
  { label: '1 hour', ms: 60 * MINUTE },
  { label: '1 day', ms: 24 * 60 * MINUTE },
  { label: '3 days', ms: 3 * 24 * 60 * MINUTE },
];
const MAX_CONTEXT_CHARS = 1_000;

type Load =
  | { kind: 'loading' }
  | { kind: 'missing'; contract: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; market: MarketView | null; position: PositionView | null };

type Notice = { tone: 'ok' | 'bad'; text: string; hash?: string };

/** The market strip of one note. */
export function NoteMarket({ note }: { note: Note }) {
  const { account, status, openSignIn } = useDemo();
  const signer = useMarketSigner();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [sheet, setSheet] = useState<{ kind: 'bet'; outcome: Outcome } | { kind: 'open' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const now = useNow(15_000);

  const refresh = useCallback(async () => {
    try {
      const market = await marketStore.marketForNote(note.id);
      const position = market && account ? await marketStore.position(market.id, account) : null;
      setLoad({ kind: 'ready', market, position });
    } catch (cause) {
      if (cause instanceof MarketNotDeployed) setLoad({ kind: 'missing', contract: cause.contractId });
      else setLoad({ kind: 'error', message: cause instanceof Error ? cause.message : 'unknown error' });
    }
  }, [note.id, account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const market = load.kind === 'ready' ? load.market : null;
  const shownStatus = market ? effectiveStatus(market, now) : null;

  // While JEV reads the note, look again every few seconds.
  useEffect(() => {
    if (shownStatus !== 'resolving') return;
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [shownStatus, refresh]);

  /** Runs one transaction, shows its outcome and reads the market again. */
  const run = async (action: () => Promise<MarketTxResult>, sentText: (result: Extract<MarketTxResult, { kind: 'sent' }>) => Notice) => {
    if (!status?.signedIn) {
      openSignIn();
      return false;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (result.kind === 'sent') setNotice(sentText(result));
      else setNotice({ tone: 'bad', text: result.reason, hash: result.kind === 'failed' ? result.transactionHash : undefined });
      await refresh();
      return result.kind === 'sent';
    } finally {
      setBusy(false);
    }
  };

  if (load.kind === 'loading') {
    return <div className="pm-strip pm-quiet">Loading the market…</div>;
  }
  if (load.kind === 'missing') {
    return <div className="pm-strip pm-quiet">Bets on notes start when the market contract {load.contract} is on testnet.</div>;
  }
  if (load.kind === 'error') {
    return <div className="pm-strip pm-quiet">The market did not load: {load.message}</div>;
  }

  const position = load.position;
  const sheets = (
    <>
      {sheet?.kind === 'bet' && market && (
        <BetSheet
          market={market}
          initial={sheet.outcome}
          onClose={() => setSheet(null)}
          onBet={async (outcome, amount) => {
            const ok = await run(
              () => signer.bet({ marketId: market.id, outcome, amount }),
              (result) => ({ tone: 'ok', text: `Your bet of ${near(amount)} on ${outcome} is in.`, hash: result.transactionHash }),
            );
            if (ok) setSheet(null);
          }}
          busy={busy}
        />
      )}
      {sheet?.kind === 'open' && (
        <OpenSheet
          note={note}
          busy={busy}
          onClose={() => setSheet(null)}
          onOpen={async (seed, durationMs) => {
            const ok = await run(
              () =>
                signer.createMarket({
                  question: MARKET_QUESTION,
                  context: marketContext(note),
                  noteId: note.id,
                  closesAtMs: Date.now() + durationMs,
                  seed,
                }),
              (result) => ({ tone: 'ok', text: 'The market is open.', hash: result.transactionHash }),
            );
            if (ok) setSheet(null);
          }}
        />
      )}
    </>
  );
  const noticeLine = notice && (
    <p className={`pm-notice ${notice.tone === 'bad' ? 'pm-notice-bad' : ''}`} role="status">
      {notice.text}
      {notice.hash && (
        <>
          {' '}
          <a className="lk" href={transactionUrl(notice.hash)} target="_blank" rel="noopener noreferrer">
            Transaction
          </a>
        </>
      )}
    </p>
  );

  if (!market) {
    return (
      <div className="pm-strip">
        <div className="pm-row pm-between">
          <span>
            <b>{MARKET_QUESTION}</b> <span className="pm-muted">Bet on it. JEV decides.</span>
          </span>
          <button type="button" className="btn btn-outline btn-xs" onClick={() => setSheet({ kind: 'open' })}>
            Open a market
          </button>
        </div>
        {noticeLine}
        {sheets}
      </div>
    );
  }

  const isCreator = account === market.creator;
  return (
    <div className="pm-strip">
      {market.resolution ? (
        <Resolved market={market} position={position} busy={busy} onClaim={() => void run(() => signer.claim(market.id), claimedNotice)} />
      ) : (
        <>
          <div className="pm-row pm-between">
            <b>{market.question}</b>
            <span className="pm-muted">{statusLine(market, shownStatus ?? market.status, now)}</span>
          </div>
          <PoolBar yesBps={market.yes_share_bps} />
          <div className="pm-row pm-between pm-gap">
            <span>
              <b className="pm-yes">{pct(market.yes_share_bps)} Yes</b> · <span className="pm-no">{pct(10_000 - market.yes_share_bps)} No</span>
            </span>
            <span className="pm-muted">
              {near(BigInt(market.total_pool))} in the pool · {market.bets} {market.bets === 1 ? 'bet' : 'bets'}
            </span>
          </div>
          {position && hasStake(position) && <p className="pm-muted pm-mine">Your bets: {stakeText(position, isCreator)}</p>}
          {shownStatus === 'open' && (
            <div className="pm-row">
              <button type="button" className="btn btn-outline btn-sm pm-btn" disabled={busy} onClick={() => setSheet({ kind: 'bet', outcome: 'yes' })}>
                Bet yes
              </button>
              <button type="button" className="btn btn-outline btn-sm pm-btn" disabled={busy} onClick={() => setSheet({ kind: 'bet', outcome: 'no' })}>
                Bet no
              </button>
            </div>
          )}
          {shownStatus === 'open' && isCreator && (
            <p className="pm-muted pm-mine">
              You opened this market.{' '}
              <button type="button" className="link-btn" disabled={busy} onClick={() => void run(() => signer.closeMarket(market.id), (r) => ({ tone: 'ok', text: 'Betting is closed.', hash: r.transactionHash }))}>
                Close betting now
              </button>
            </p>
          )}
          {shownStatus === 'closed' && (
            <div className="pm-row pm-between">
              <span className="pm-muted">Betting is closed. JEV reads the post and the note next.</span>
              <button
                type="button"
                className="btn btn-dark btn-sm"
                disabled={busy}
                onClick={() => void run(() => signer.requestResolution(market.id), resolutionNotice)}
              >
                {busy ? 'Asking JEV…' : 'Ask JEV'}
              </button>
            </div>
          )}
          {shownStatus === 'closed' && <p className="pm-muted pm-mine">Anyone can ask. The OutLayer fee is {near(RESOLUTION_FEE_YOCTO)}.</p>}
          {shownStatus === 'resolving' && (
            <div className="pm-row pm-muted">
              <span className="spinner" aria-hidden="true" /> JEV is reading the post and the note…
            </div>
          )}
        </>
      )}
      {noticeLine}
      {sheets}
    </div>
  );
}

function Resolved({ market, position, busy, onClaim }: { market: MarketView; position: PositionView | null; busy: boolean; onClaim: () => void }) {
  const resolution = market.resolution!;
  const [open, setOpen] = useState(false);
  const who = resolverName(resolution.source, resolution.provider);
  const weight = resolution.payout_yes_bps;
  const total = near(BigInt(market.total_pool));
  const split = market.refund_all
    ? 'One side had no bets, so every bet is paid back.'
    : weight === 10_000
      ? `At 90% or more, yes bets share all of ${total}.`
      : weight === 0
        ? `At 10% or less, no bets share all of ${total}.`
        : `Yes bets share ${pct(weight)} of ${total}. No bets share ${pct(10_000 - weight)}.`;
  return (
    <>
      <div className="pm-row pm-between">
        <b>
          {who}: {pct(resolution.raw_yes_bps)} this note holds up
        </b>
        <span className="pm-pill">Resolved</span>
      </div>
      <PoolBar yesBps={weight} />
      <p className="pm-muted pm-gap">{split}</p>
      {position && hasStake(position) && (
        <div className="pm-row pm-between">
          <span>
            Your bet: {stakeText(position, false)} → <b>{near(BigInt(position.payout ?? '0'))}</b>
          </span>
          {position.claimed ? (
            <span className="pm-muted">Claimed</span>
          ) : (
            <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={onClaim}>
              Claim
            </button>
          )}
        </div>
      )}
      <button type="button" className="link-btn pm-why" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconChevronDown size={14} className={open ? 'pm-turn' : undefined} aria-hidden="true" /> Why {who} decided this
      </button>
      {open && (
        <div className="pm-why-text">
          <p>{resolution.rationale}</p>
          <p className="pm-muted">
            {resolution.model ? `Model ${resolution.model}. ` : ''}
            {resolution.source === 'ai' ? `Asked by ${resolution.resolved_by} through OutLayer.` : `Resolved by ${resolution.resolved_by}.`}
          </p>
        </div>
      )}
    </>
  );
}

function BetSheet({
  market,
  initial,
  busy,
  onClose,
  onBet,
}: {
  market: MarketView;
  initial: Outcome;
  busy: boolean;
  onClose: () => void;
  onBet: (outcome: Outcome, amount: bigint) => Promise<void>;
}) {
  const titleId = useId();
  const [outcome, setOutcome] = useState<Outcome>(initial);
  const [amount, setAmount] = useState<bigint>(CHIPS[1]!.yocto);
  const yes = BigInt(market.yes_pool);
  const no = BigInt(market.no_pool);
  const side = outcome === 'yes' ? yes : no;
  // This bet alone, if the verdict is 100% its side and the pools stay as they are.
  const win = (amount * (yes + no + amount)) / (side + amount);
  const yesBps = market.yes_share_bps;
  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={busy}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
          <IconX size={20} />
        </button>
        <h2 id={titleId}>Bet on this note</h2>
      </header>
      <div className="dialog-body pm-sheet">
        <p className="pm-muted">At the close, JEV reads the post and the note, and gives the chance that the note holds up.</p>
        <div className="pm-row">
          <button type="button" className={`btn btn-outline btn-sm pm-btn ${outcome === 'yes' ? 'pm-on-yes' : ''}`} onClick={() => setOutcome('yes')} aria-pressed={outcome === 'yes'}>
            Yes · {pct(yesBps)}
          </button>
          <button type="button" className={`btn btn-outline btn-sm pm-btn ${outcome === 'no' ? 'pm-on-no' : ''}`} onClick={() => setOutcome('no')} aria-pressed={outcome === 'no'}>
            No · {pct(10_000 - yesBps)}
          </button>
        </div>
        <Chips value={amount} onChange={setAmount} />
        <p className="pm-muted">
          If JEV says 100% {outcome}, you get about <b className="pm-ink">{near(win)}</b>, if the pools stay as they are. Odds change until the close. A grey answer pays by its probability: at 70% yes, yes bets share 70% of the pool and no bets 30%.
        </p>
      </div>
      <footer className="dialog-foot pm-foot">
        <p className="pm-muted">Your Seams Wallet asks you to confirm. Spoken bets come later.</p>
        <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void onBet(outcome, amount)}>
          {busy ? 'Waiting for the Wallet…' : `Bet ${near(amount)} on ${outcome}`}
        </button>
      </footer>
    </Modal>
  );
}

function OpenSheet({ note, busy, onClose, onOpen }: { note: Note; busy: boolean; onClose: () => void; onOpen: (seed: bigint, durationMs: number) => Promise<void> }) {
  const titleId = useId();
  const [seed, setSeed] = useState<bigint>(CHIPS[0]!.yocto);
  const [duration, setDuration] = useState(DURATIONS[1]!.ms);
  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={busy}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
          <IconX size={20} />
        </button>
        <h2 id={titleId}>Open a market on this note</h2>
      </header>
      <div className="dialog-body pm-sheet">
        <p>
          <b>{MARKET_QUESTION}</b>
        </p>
        <p className="pm-muted">
          People bet yes or no. At the close, JEV reads the post and this note, and its answer splits the pool. JEV reads them as they are now, so later edits do not count.
        </p>
        <div>
          <p className="pm-label">Your seed</p>
          <Chips value={seed} onChange={setSeed} />
          <p className="pm-muted">Half goes on yes and half on no, so the odds start at 50%. The seed is paid like any other bet.</p>
        </div>
        <div>
          <p className="pm-label">Betting closes in</p>
          <div className="pm-row pm-wrap">
            {DURATIONS.map((option) => (
              <button
                key={option.ms}
                type="button"
                className={`btn btn-outline btn-xs ${duration === option.ms ? 'btn-choice-on' : ''}`}
                aria-pressed={duration === option.ms}
                onClick={() => setDuration(option.ms)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="pm-muted">You can close it earlier.</p>
        </div>
        <p className="pm-muted pm-small">Note {note.id} · contract {config.marketContract}</p>
      </div>
      <footer className="dialog-foot pm-foot">
        <p className="pm-muted">Your Seams Wallet asks you to confirm.</p>
        <button type="button" className="btn btn-dark" disabled={busy} onClick={() => void onOpen(seed, duration)}>
          {busy ? 'Waiting for the Wallet…' : `Open market · ${near(seed)}`}
        </button>
      </footer>
    </Modal>
  );
}

function Chips({ value, onChange }: { value: bigint; onChange: (yocto: bigint) => void }) {
  return (
    <div className="pm-row">
      {CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className={`btn btn-outline btn-xs ${value === chip.yocto ? 'btn-choice-on' : ''}`}
          aria-pressed={value === chip.yocto}
          onClick={() => onChange(chip.yocto)}
        >
          {chip.label}
        </button>
      ))}
      <span className="pm-amount">{near(value)}</span>
    </div>
  );
}

function PoolBar({ yesBps }: { yesBps: number }) {
  const yes = Math.max(0, Math.min(100, yesBps / 100));
  return (
    <div className="pm-bar" role="img" aria-label={`${pct(yesBps)} yes, ${pct(10_000 - yesBps)} no`}>
      <div className="pm-bar-yes" style={{ width: `${yes}%` }} />
      <div className="pm-bar-no" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}

function claimedNotice(result: Extract<MarketTxResult, { kind: 'sent' }>): Notice {
  const claimed = result.events.find((event) => event.event === 'claimed');
  const amount = typeof claimed?.data.amount === 'string' ? BigInt(claimed.data.amount) : null;
  return { tone: 'ok', text: amount === null ? 'Claimed.' : `${near(amount)} went to your wallet.`, hash: result.transactionHash };
}

function resolutionNotice(result: Extract<MarketTxResult, { kind: 'sent' }>): Notice {
  const failed = result.events.find((event) => event.event === 'resolution_failed');
  if (failed) return { tone: 'bad', text: `No answer this time: ${String(failed.data.reason)}. You can ask again.`, hash: result.transactionHash };
  const resolved = result.events.find((event) => event.event === 'market_resolved');
  return { tone: 'ok', text: resolved ? 'JEV answered.' : 'The request is out.', hash: result.transactionHash };
}

/** The status at the page's clock: an open market past its close shows as closed. */
function effectiveStatus(market: MarketView, now: number): MarketView['status'] {
  return market.status === 'open' && now >= market.closes_at_ms ? 'closed' : market.status;
}

function statusLine(market: MarketView, status: MarketView['status'], now: number): string {
  if (status === 'open') return `JEV decides · closes in ${timeLeft(market.closes_at_ms - now)}`;
  if (status === 'resolving') return 'JEV is deciding';
  return 'Betting closed';
}

function timeLeft(ms: number): string {
  if (ms < MINUTE) return 'less than a minute';
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < 24 * 60 * MINUTE) return `${Math.round(ms / (60 * MINUTE))} h`;
  return `${Math.round(ms / (24 * 60 * MINUTE))} d`;
}

function resolverName(source: 'ai' | 'admin', provider: string | null): string {
  if (source === 'admin') return 'The admin';
  return provider === 'near-ai' ? 'NEAR AI' : 'JEV';
}

function hasStake(position: PositionView): boolean {
  return BigInt(position.yes) > 0n || BigInt(position.no) > 0n;
}

function stakeText(position: PositionView, isCreator: boolean): string {
  const yes = BigInt(position.yes);
  const no = BigInt(position.no);
  const parts = [yes > 0n ? `${near(yes)} on yes` : '', no > 0n ? `${near(no)} on no` : ''].filter(Boolean);
  return parts.join(' + ') + (isCreator ? ' (with your seed)' : '');
}

/** The text that JEV reads: the post and the note, frozen when the market opens. */
export function marketContext(note: Note): string {
  const post = findPost(note.post_id);
  const text = [post ? `Post by ${post.author.name}: ${post.text}` : `Post ${note.post_id}.`, `Community note: ${note.text}`].join('\n\n');
  return [...text].slice(0, MAX_CONTEXT_CHARS).join('');
}

/** 7250 → "73%". */
function pct(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}

/** yoctoNEAR → "4.2 NEAR", with at most two decimals. */
export function near(yocto: bigint): string {
  const hundredths = (yocto * 100n) / YOCTO_PER_NEAR;
  if (yocto > 0n && hundredths === 0n) return '< 0.01 NEAR';
  const whole = hundredths / 100n;
  const cents = hundredths % 100n;
  const decimals = cents === 0n ? '' : `.${cents.toString().padStart(2, '0').replace(/0$/, '')}`;
  return `${whole}${decimals} NEAR`;
}

/** The current time, updated every `everyMs`. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
