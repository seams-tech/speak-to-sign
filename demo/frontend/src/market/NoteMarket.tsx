// The note market UI: one strip inside a community note card, and the bet sheet.
// Place <NoteMarketStrip> as the last row of a note card (see README.md). It renders nothing
// when the note has no market.

import { useCallback, useEffect, useId, useState } from 'react';
import { IconChartBar, IconChevronDown, IconMicrophone, IconScale, IconX } from '@tabler/icons-react';
import { Modal } from '../components/Modal';
import type { SignResult } from '../signer/notesSigner';
import {
  betSentence,
  chipText,
  estimatePayout,
  nearText,
  payoutWeightBps,
  percentText,
  positionPayout,
  timeLeftText,
  yesShareBps,
} from './math';
import { BET_CHIPS, type MarketPosition, type MarketSource, type NoteMarket, type OddsPoint, type Side } from './types';
import './market.css';

const EMPTY_POSITION: MarketPosition = { yes: 0n, no: 0n, claimed: false };

/** A line under the strip: the result of a bet, or an error. */
interface Notice {
  text: string;
  isError: boolean;
}

export function NoteMarketStrip({
  noteId,
  source,
  account,
  onSignIn,
}: {
  noteId: number;
  source: MarketSource;
  /** The signed-in NEAR account, if any. */
  account?: string;
  /** Opens the page's sign-in dialog. */
  onSignIn: () => void;
}) {
  const [market, setMarket] = useState<NoteMarket | null>(null);
  const [position, setPosition] = useState<MarketPosition>(EMPTY_POSITION);
  const [history, setHistory] = useState<OddsPoint[]>([]);
  const [betSide, setBetSide] = useState<Side | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** A claim or a JEV request waits for the Wallet. */
  const [busy, setBusy] = useState<'claim' | 'ask' | null>(null);

  const load = useCallback(async () => {
    const next = await source.getMarketForNote(noteId);
    setMarket(next);
    if (!next) return;
    setHistory(await source.getOddsHistory(next.id));
    setPosition(account ? await source.getPosition(next.id, account) : EMPTY_POSITION);
  }, [source, noteId, account]);

  useEffect(() => {
    load().catch((cause: unknown) =>
      setNotice({ text: `Cannot read the market: ${cause instanceof Error ? cause.message : String(cause)}`, isError: true }),
    );
  }, [load]);

  // While a JEV request waits for its answer, read the market again every 5 s.
  const resolving = market?.status === 'resolving';
  useEffect(() => {
    if (!resolving) return;
    const timer = setInterval(() => void load().catch(() => undefined), 5_000);
    return () => clearInterval(timer);
  }, [resolving, load]);

  if (!market) return notice ? <p className="nm-strip nm-error">{notice.text}</p> : null;

  const openBet = (side: Side) => {
    setNotice(null);
    if (!account) onSignIn();
    else setBetSide(side);
  };

  const failed = (result: Exclude<SignResult, { kind: 'sent' }>) =>
    setNotice({ text: result.kind === 'cancelled' ? 'You closed the Wallet. Nothing was signed.' : result.reason, isError: true });

  const claim = async () => {
    const amount = position.payout ?? positionPayout(market, position);
    setNotice(null);
    setBusy('claim');
    const result = await source.claim(market.id);
    setBusy(null);
    if (result.kind !== 'sent') return failed(result);
    setNotice({ text: `You got ${nearText(amount)}.`, isError: false });
    await load();
  };

  const askJev = async (request: (marketId: number) => Promise<SignResult>) => {
    setNotice(null);
    if (!account) return onSignIn();
    setBusy('ask');
    const result = await request(market.id);
    setBusy(null);
    if (result.kind !== 'sent') return failed(result);
    await load();
  };

  const share = yesShareBps(market.yesPool, market.noPool);
  const pool = market.yesPool + market.noPool;
  const staked = position.yes + position.no;

  return (
    <div className="nm-strip" onClick={(event) => event.stopPropagation()}>
      {market.status === 'resolved' ? (
        <Resolved market={market} position={position} account={account} claiming={busy === 'claim'} onClaim={() => void claim()} />
      ) : (
        <>
          <div className="nm-row">
            <span className="nm-title">
              <IconChartBar size={16} stroke={1.8} aria-hidden="true" />
              <b>{market.question}</b>
            </span>
            <span className="nm-muted">
              {market.status === 'open'
                ? `JEV decides · ${timeLeftText(market.closesAtMs)}`
                : market.status === 'resolving'
                  ? 'JEV is reading the note…'
                  : 'Betting closed · waiting for JEV'}
            </span>
          </div>
          <SplitBar yesBps={share} />
          <div className="nm-row">
            <span>
              <b className="nm-yes">{percentText(share)} yes</b> · <span className="nm-no">{percentText(10_000 - share)} no</span>
            </span>
            <span className="nm-muted">
              {nearText(pool, 1)} · {market.bets} {market.bets === 1 ? 'bet' : 'bets'}
            </span>
          </div>
          {history.length > 1 && <Sparkline points={history} />}
          {market.status === 'open' && (
            <>
              <p className="nm-muted nm-small">Odds change until the close.</p>
              <div className="nm-buttons">
                <button type="button" className="btn btn-outline btn-sm nm-bet" onClick={() => openBet('yes')}>
                  Bet yes
                </button>
                <button type="button" className="btn btn-outline btn-sm nm-bet" onClick={() => openBet('no')}>
                  Bet no
                </button>
              </div>
            </>
          )}
          {market.status === 'closed' && source.requestResolution && (
            <div className="nm-buttons">
              <button
                type="button"
                className="btn btn-outline btn-sm nm-bet"
                disabled={busy === 'ask'}
                onClick={() => source.requestResolution && void askJev(source.requestResolution.bind(source))}
              >
                <IconScale size={16} stroke={1.8} aria-hidden="true" />
                {busy === 'ask' ? 'Asking JEV…' : 'Ask JEV now'}
              </button>
            </div>
          )}
          {staked > 0n && (
            <p className="nm-muted nm-small">
              Your bets:{' '}
              {[position.yes > 0n && `${nearText(position.yes)} on yes`, position.no > 0n && `${nearText(position.no)} on no`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </>
      )}
      {notice && (
        <p className={notice.isError ? 'nm-error' : 'nm-done'} role={notice.isError ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      {betSide && (
        <BetSheet
          market={market}
          initialSide={betSide}
          source={source}
          onClose={() => setBetSide(null)}
          onDone={(text) => {
            setBetSide(null);
            setNotice({ text, isError: false });
            void load();
          }}
        />
      )}
    </div>
  );
}

function Resolved({
  market,
  position,
  account,
  claiming,
  onClaim,
}: {
  market: NoteMarket;
  position: MarketPosition;
  account?: string;
  claiming: boolean;
  onClaim: () => void;
}) {
  const verdict = market.verdictBps ?? 5_000;
  const weight = payoutWeightBps(market);
  const pool = market.yesPool + market.noPool;
  const staked = position.yes + position.no;
  const refund = market.yesPool === 0n || market.noPool === 0n;
  const payout = position.payout ?? positionPayout(market, position);
  return (
    <>
      <div className="nm-row">
        <span className="nm-title">
          <IconScale size={16} stroke={1.8} aria-hidden="true" />
          <b>JEV: {percentText(verdict)} this note holds up</b>
        </span>
        <span className="nm-pill">Resolved</span>
      </div>
      <SplitBar yesBps={weight} />
      <p className="nm-muted nm-small">
        {refund
          ? 'One side had no bets, so every bet is refunded.'
          : `Yes bets share ${percentText(weight)} of ${nearText(pool, 1)}. No bets share ${percentText(10_000 - weight)}.`}
        {!refund && weight !== verdict && ` JEV was sure enough, so its ${percentText(verdict)} counts as ${percentText(weight)}.`}
      </p>
      {account && staked > 0n && (
        <div className="nm-row nm-payout">
          <span>
            Your bets: {nearText(staked)} → <b>{nearText(payout)}</b>
          </span>
          {position.claimed ? (
            <span className="nm-muted">Claimed</span>
          ) : payout === 0n ? (
            <span className="nm-muted">Nothing to claim</span>
          ) : (
            <button type="button" className="btn btn-dark btn-sm" onClick={onClaim} disabled={claiming}>
              {claiming ? 'Claiming…' : 'Claim'}
            </button>
          )}
        </div>
      )}
      {market.rationale && (
        <details className="nm-why">
          <summary>
            <IconChevronDown size={14} stroke={2} aria-hidden="true" /> Why JEV decided this
          </summary>
          <p>{market.rationale}</p>
        </details>
      )}
    </>
  );
}

function SplitBar({ yesBps }: { yesBps: number }) {
  const yes = Math.max(0, Math.min(100, yesBps / 100));
  return (
    <div className="nm-bar" role="img" aria-label={`${Math.round(yes)}% yes, ${Math.round(100 - yes)}% no`}>
      <span className="nm-bar-yes" style={{ width: `${yes}%` }} />
      <span className="nm-bar-no" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}

/**
 * A small odds chart: the YES share after each bet, with the 50% line. The vertical scale fits
 * the data (at least 30 points wide, and it always holds 50%), so small moves stay visible.
 */
function Sparkline({ points }: { points: OddsPoint[] }) {
  const width = 200;
  const height = 28;
  const values = points.map((point) => point.yesBps);
  let low = Math.min(5_000, ...values);
  let high = Math.max(5_000, ...values);
  const spread = Math.max(3_000, high - low);
  const middle = (low + high) / 2;
  low = Math.max(0, middle - spread / 2 - 300);
  high = Math.min(10_000, middle + spread / 2 + 300);
  const y = (bps: number) => (height - ((bps - low) / (high - low)) * height).toFixed(1);
  const step = width / Math.max(1, points.length - 1);
  const path = points.map((point, index) => `${(index * step).toFixed(1)},${y(point.yesBps)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const label =
    first && last ? `Yes share went from ${percentText(first.yesBps)} to ${percentText(last.yesBps)} over ${points.length} bets` : '';
  return (
    <svg className="nm-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" y1={y(5_000)} x2={width} y2={y(5_000)} className="nm-spark-mid" />
      <polyline points={path} className="nm-spark-line" />
    </svg>
  );
}

function BetSheet({
  market,
  initialSide,
  source,
  onClose,
  onDone,
}: {
  market: NoteMarket;
  initialSide: Side;
  source: MarketSource;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState<bigint>(BET_CHIPS[1] ?? 0n);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = yesShareBps(market.yesPool, market.noPool);
  const win = estimatePayout(market, side, amount, side === 'yes' ? 10_000 : 0);

  const place = async () => {
    setBusy(true);
    setError(null);
    const result = await source.bet({ marketId: market.id, side, amount });
    setBusy(false);
    if (result.kind === 'sent') onDone(`Your bet of ${nearText(amount)} on ${side} is in.`);
    else if (result.kind === 'cancelled') setError('You closed the Wallet. Nothing was signed.');
    else setError(result.reason);
  };

  return (
    <Modal labelledBy={titleId} onClose={onClose} locked={busy}>
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
          <IconX size={20} />
        </button>
        <h2 id={titleId}>Bet on this note</h2>
      </header>
      <div className="dialog-body nm-sheet">
        <p className="nm-muted">At the close, JEV reads the post, the note and its sources. A grey answer pays by its probability.</p>
        <div className="nm-buttons" role="group" aria-label="Side">
          {(['yes', 'no'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={side === choice}
              className={`btn btn-outline nm-side ${side === choice ? `nm-side-on nm-side-${choice}` : ''}`}
              onClick={() => setSide(choice)}
            >
              {choice === 'yes' ? 'Yes' : 'No'} · {percentText(choice === 'yes' ? share : 10_000 - share)}
            </button>
          ))}
        </div>
        <div className="nm-buttons" role="group" aria-label="Amount">
          {BET_CHIPS.map((chip) => (
            <button
              key={chip.toString()}
              type="button"
              aria-pressed={amount === chip}
              className={`btn btn-outline btn-sm nm-chip ${amount === chip ? 'btn-choice-on' : ''}`}
              onClick={() => setAmount(chip)}
            >
              {chipText(chip)} NEAR
            </button>
          ))}
        </div>
        <p>
          Win about <b>{nearText(win)}</b> if JEV says {side} fully, and the pool stays as it is.
        </p>
        {source.signsByVoice && (
          <div className="nm-say">
            <span className="nm-muted">
              <IconMicrophone size={14} stroke={2} aria-hidden="true" /> Say this to sign
            </span>
            <b>“{betSentence(side, amount)}”</b>
          </div>
        )}
        {error && (
          <p className="nm-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-foot dialog-foot-end">
        <button type="button" className="btn btn-dark" onClick={() => void place()} disabled={busy}>
          {busy ? 'Waiting for the Wallet…' : source.signsByVoice ? 'Say it to bet' : `Bet ${nearText(amount)} on ${side}`}
        </button>
      </div>
    </Modal>
  );
}
