// The note market UI: one strip inside a community note card, and the bet sheet.
// Place <NoteMarketStrip> as the last row of a note card (see README.md). It renders nothing
// when the note has no market.
//
// The flow has as few steps as the contract allows: "Open a market" opens one at once (1 USDC,
// 3 minutes), the creator closes the betting and asks JEV in one transaction, and an action that
// starts while signed out runs after the sign-in.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconChartBar, IconChevronDown, IconScale, IconX } from '@tabler/icons-react';
import type { ModalHandle } from '../components/Modal';
import { Morph } from '../components/Morph';
import { WalletDialog } from '../components/WalletDialog';
import type { SignResult } from '../signer/notesSigner';
import {
  amountText,
  chipText,
  estimatePayout,
  jevSentence,
  payoutWeightBps,
  percentText,
  positionPayout,
  timeLeftText,
  yesShareBps,
} from './math';
import {
  MARKET_QUESTION,
  NEAR_CURRENCY,
  type BetVerdict,
  type Currency,
  type MarketPosition,
  type MarketSource,
  type MarketStatus,
  type NoteMarket,
  type OddsPoint,
  type Side,
  type SignStage,
} from './types';
import { SayBet, useBetVoice } from './SayBet';
import './market.css';

const EMPTY_POSITION: MarketPosition = { yes: 0n, no: 0n, claimed: false };
const MINUTE = 60_000;
/** How long a new market takes bets. The creator can close it earlier. */
const DURATIONS: readonly { label: string; ms: number }[] = [
  { label: '3 min', ms: 3 * MINUTE },
  { label: '1 hour', ms: 60 * MINUTE },
  { label: '1 day', ms: 24 * 60 * MINUTE },
  { label: '3 days', ms: 3 * 24 * 60 * MINUTE },
];
/** "Open a market" in one tap: the first seed chip and the first duration. */
const DEFAULT_DURATION_MS = 3 * MINUTE;
/** An action started while signed out runs after a sign-in within this time. */
const INTENT_MS = 2 * MINUTE;
/** How often the strip reads the market again: while JEV decides, and otherwise. */
const RESOLVING_POLL_MS = 3_000;
const LIVE_POLL_MS = 10_000;

/** A line under the strip: the result of an action, or an error. */
interface Notice {
  text: string;
  isError: boolean;
}

type Action =
  | { kind: 'open'; seed: bigint; durationMs: number }
  | { kind: 'bet'; side: Side; verdict?: BetVerdict }
  | { kind: 'ask' }
  | { kind: 'close-ask' }
  | { kind: 'claim' };

/** The action that waits for the Wallet, and its stage. */
interface Busy {
  kind: Action['kind'];
  stage: SignStage;
  side?: Side;
}

/** A bet that went out and is not in the market's view yet. The strip shows it at once. */
interface PendingBet {
  side: Side;
  amount: bigint;
}

/** The look of a tapped button while the page signs the visitor in (and funds the wallet). */
const SETTING_UP = 'Setting up your wallet…';

function isPromise<T>(value: unknown): value is Promise<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/**
 * A request to the strip to start a bet: a click on the post's card, or a voice command. Each
 * new `seq` is one request.
 */
export interface BetRequest {
  seq: number;
  /** Default: yes. */
  side?: Side;
  /** The stake of the bet sheet. Default: the sheet's middle chip. */
  amount?: bigint;
  /** Place the bet at once: the bettor asked for exactly this bet (a voice command). */
  place?: boolean;
  /**
   * Open a market first when the note has none. With `side`, the bet follows when the new
   * market is there.
   */
  open?: boolean;
}

export function NoteMarketStrip({
  noteId,
  source,
  account,
  onSignIn,
  context,
  directBet = false,
  stakeControl,
  placeholder = false,
  openBet,
}: {
  noteId: number;
  source: MarketSource;
  /** The signed-in NEAR account, if any. */
  account?: string;
  /**
   * Opens the page's sign-in dialog, and the action that asked for it runs after the sign-in.
   * With a promise, the action runs only when it resolves true (for example: signed in, and the
   * faucet's USDC arrived), and false drops it. Without one, the action runs when `account`
   * arrives, within 2 minutes.
   */
  onSignIn: () => void | Promise<boolean>;
  /**
   * The post and the note as JEV reads them, for a new market. With it and
   * `source.createMarket`, a note without a market shows "Open a market".
   */
  context?: string;
  /**
   * With it, "Bet yes" and "Bet no" place one bet at once: the Wallet's own confirm is the only
   * step, with no bet sheet on top. `true` bets the sheet's default stake (the middle chip); an
   * amount (base units) bets that.
   */
  directBet?: boolean | bigint;
  /**
   * A control for the amount of a direct bet (for example, a slider), shown just above "Bet yes"
   * and "Bet no" while the market is open, and while it is read the first time.
   */
  stakeControl?: ReactNode;
  /**
   * While the market is read the first time, show the strip's shapes (the odds bar, the odds line
   * and the two bet buttons) grey and pulsing, in place of nothing. For a place where the market
   * is known to exist, so that nothing appears and then goes away.
   */
  placeholder?: boolean;
  /**
   * Starts a bet while the market is open. It opens the bet sheet, or with `directBet` and
   * `place` it places the one-tap bet.
   */
  openBet?: BetRequest;
}) {
  const currency = source.currency ?? NEAR_CURRENCY;
  const [market, setMarket] = useState<NoteMarket | null>(null);
  const [position, setPosition] = useState<MarketPosition>(EMPTY_POSITION);
  const [history, setHistory] = useState<OddsPoint[]>([]);
  const [betSide, setBetSide] = useState<Side | null>(null);
  /** How the open bet sheet starts, when a request (`openBet`) opened it. */
  const [sheetStart, setSheetStart] = useState<BetRequest | null>(null);
  // The spoken bet, when the contract needs it. A one-tap bet then shows its "say it" step in
  // the strip, in place of the two buttons.
  const voice = useBetVoice(source);
  const [saying, setSaying] = useState<Side | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [pendingBet, setPendingBet] = useState<PendingBet | null>(null);
  /** The first read of the market has answered (or failed). */
  const [loaded, setLoaded] = useState(false);
  /** The note has no market, and a new one can open: show "Open a market". */
  const [canOpen, setCanOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  /** The open sheet starts with the sign-in: "Open a market" was tapped while signed out. */
  const [openSignInFirst, setOpenSignInFirst] = useState(false);
  /** The action that waits for the sign-in. */
  const [intent, setIntent] = useState<{ action: Action; atMs: number } | null>(null);
  /** The action whose button waits for the page's sign-in promise. */
  const [waiting, setWaiting] = useState<{ kind: Action['kind']; side?: Side } | null>(null);
  /** The YES share when JEV's answer arrived in this view, for the reveal. */
  const [revealFrom, setRevealFrom] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  /** The market of the last read, to see JEV's answer arrive. */
  const lastMarket = useRef<NoteMarket | null>(null);
  const load = useCallback(async () => {
    const next = await source.getMarketForNote(noteId);
    const previous = lastMarket.current;
    if (previous && next && previous.status !== 'resolved' && next.status === 'resolved') {
      setRevealFrom(yesShareBps(previous.yesPool, previous.noPool));
    }
    lastMarket.current = next;
    setMarket(next);
    if (!next) {
      setCanOpen(context !== undefined && source.createMarket !== undefined && (source.canOpenMarkets ? await source.canOpenMarkets() : true));
      return;
    }
    setHistory(await source.getOddsHistory(next.id));
    setPosition(account ? await source.getPosition(next.id, account) : EMPTY_POSITION);
  }, [source, noteId, account, context]);

  useEffect(() => {
    load()
      .catch((cause: unknown) =>
        setNotice({ text: `Cannot read the market: ${cause instanceof Error ? cause.message : String(cause)}`, isError: true }),
      )
      .finally(() => setLoaded(true));
  }, [load]);

  // Read the market again while it is live: other people bet, and JEV can answer for someone else.
  const liveStatus = market?.status;
  useEffect(() => {
    if (!liveStatus || liveStatus === 'resolved') return;
    const every = liveStatus === 'resolving' ? RESOLVING_POLL_MS : LIVE_POLL_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load().catch(() => undefined);
    }, every);
    return () => clearInterval(timer);
  }, [liveStatus, load]);

  // While bets are open, the countdown ticks each second, and the close shows at once.
  useEffect(() => {
    if (liveStatus !== 'open') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [liveStatus]);

  /** The stake of a one-tap bet. */
  const directAmount = typeof directBet === 'bigint' ? directBet : (currency.chips[1] ?? currency.chips[0] ?? 0n);

  /** Runs one action. Signed out, it asks for the sign-in and runs after it. */
  const run = async (action: Action): Promise<string | null> => {
    setNotice(null);
    // The sheets open at once, also signed out: each one shows the sign-in as its own step.
    if (action.kind === 'bet' && !directBet) {
      setSheetStart(null);
      setBetSide(action.side);
      return null;
    }
    if (action.kind === 'open' && !account) {
      setOpenSignInFirst(true);
      setOpening(true);
      return null;
    }
    if (!account) {
      const asked = onSignIn();
      if (!isPromise(asked)) {
        setIntent({ action, atMs: Date.now() });
        return null;
      }
      setWaiting({ kind: action.kind, side: action.kind === 'bet' ? action.side : undefined });
      const ready = await asked.catch(() => false);
      // Ready: the button keeps its look until the action starts (the effect below).
      if (ready) setIntent({ action, atMs: Date.now() });
      else setWaiting(null);
      return null;
    }
    const start = (stage: SignStage = 'confirm') =>
      setBusy({ kind: action.kind, stage, side: action.kind === 'bet' ? action.side : undefined });
    const progress = (stage: SignStage) => setBusy((current) => current && { ...current, stage });
    // A closed or rejected Wallet window is the visitor's own choice: no note, and '' (not null),
    // so a sheet stays open.
    const fail = (result: Exclude<SignResult, { kind: 'sent' }>) => {
      if (result.kind === 'cancelled') {
        setNotice(null);
        return '';
      }
      setNotice({ text: result.reason, isError: true });
      return result.reason;
    };

    if (action.kind === 'open') {
      if (!source.createMarket || context === undefined) return null;
      start();
      const result = await source.createMarket(
        { noteId, question: MARKET_QUESTION, context, closesAtMs: Date.now() + action.durationMs, seed: action.seed },
        progress,
      );
      if (result.kind !== 'sent') {
        setBusy(null);
        return fail(result);
      }
      await load().catch(() => undefined);
      setBusy(null);
      setNotice({ text: `The market is open. JEV decides in ${durationText(action.durationMs)}.`, isError: false });
      return null;
    }
    if (!market) return null;

    if (action.kind === 'bet') {
      const amount = directAmount;
      // The bettor says the bet first. The verdict of the recording comes back in `action`.
      if (voice && !action.verdict) {
        setSaying(action.side);
        return null;
      }
      start();
      const result = await source.bet({ marketId: market.id, side: action.side, amount, verdict: action.verdict }, (stage) => {
        progress(stage);
        if (stage === 'sent') setPendingBet({ side: action.side, amount });
      });
      if (result.kind !== 'sent') {
        setBusy(null);
        setPendingBet(null);
        return fail(result);
      }
      await load().catch(() => undefined);
      setBusy(null);
      setPendingBet(null);
      setNotice({ text: `Your bet of ${amountText(amount, currency)} on ${action.side} is in.`, isError: false });
      return null;
    }

    if (action.kind === 'ask' || action.kind === 'close-ask') {
      const request = action.kind === 'ask' ? source.requestResolution : source.closeAndRequestResolution;
      if (!request) return null;
      start();
      const result = await request.call(source, market.id, progress);
      await load().catch(() => undefined);
      setBusy(null);
      return result.kind === 'sent' ? null : fail(result);
    }

    const amount = position.payout ?? positionPayout(market, position);
    start();
    const result = await source.claim(market.id, progress);
    if (result.kind !== 'sent') {
      setBusy(null);
      return fail(result);
    }
    await load().catch(() => undefined);
    setBusy(null);
    setNotice({ text: `${amountText(amount, currency)} went to your wallet.`, isError: false });
    return null;
  };

  // After the sign-in, run the action that asked for it.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!account || !intent) return;
    setIntent(null);
    setWaiting(null);
    if (Date.now() - intent.atMs <= INTENT_MS) void runRef.current(intent.action);
  }, [account, intent]);

  // A request (`openBet`) starts a bet while the market takes bets. A request from before the
  // first read of the market waits for it. Each request runs once.
  const handledBet = useRef(0);
  /** The bet that waits for the market that its request opens. */
  const betAfterOpen = useRef<{ request: BetRequest; atMs: number } | null>(null);
  useEffect(() => {
    const waiting = betAfterOpen.current;
    if (!waiting || !market) return;
    betAfterOpen.current = null;
    if (Date.now() - waiting.atMs > INTENT_MS || market.status !== 'open' || Date.now() >= market.closesAtMs) return;
    setSheetStart(waiting.request);
    setBetSide(waiting.request.side ?? 'yes');
  }, [market]);
  useEffect(() => {
    if (!openBet || openBet.seq === handledBet.current || !loaded) return;
    if (openBet.open) {
      // "Open a market", with the first seed, as the button of the strip does.
      const seed = (currency.seedChips ?? currency.chips)[0] ?? 0n;
      if (!market && canOpen) {
        handledBet.current = openBet.seq;
        betAfterOpen.current = openBet.side ? { request: openBet, atMs: Date.now() } : null;
        void runRef.current({ kind: 'open', seed, durationMs: DEFAULT_DURATION_MS });
        return;
      }
      // The note has a market already: only a bet is left to do.
      if (!market || !openBet.side) return;
    }
    if (!market) return;
    handledBet.current = openBet.seq;
    if (market.status !== 'open' || Date.now() >= market.closesAtMs) return;
    const side = openBet.side ?? 'yes';
    if (directBet) {
      if (openBet.place) void runRef.current({ kind: 'bet', side });
      return;
    }
    setSheetStart(openBet);
    setBetSide(side);
  }, [openBet, market, directBet, loaded, canOpen]);

  if (!market && !loaded && placeholder) {
    return (
      <div className="nm-strip nm-loading" aria-busy="true" onClick={(event) => event.stopPropagation()}>
        <span className="nm-bar" aria-hidden="true" />
        {/* Each grey bar holds a blank text line, so the row is as high as the odds line. */}
        <div className="nm-row" aria-hidden="true">
          <span className="nm-sk" style={{ width: 120 }}>
            {'\u200b'}
          </span>
          <span className="nm-sk" style={{ width: 100 }}>
            {'\u200b'}
          </span>
        </div>
        {stakeControl}
        <div className="nm-buttons">
          <button type="button" className="btn btn-outline btn-sm nm-bet" disabled>
            Bet yes
          </button>
          <button type="button" className="btn btn-outline btn-sm nm-bet" disabled>
            Bet no
          </button>
        </div>
        <span className="sr-only" role="status">
          Reading the market
        </span>
      </div>
    );
  }

  const noticeLine = notice && (
    <p className={notice.isError ? 'nm-error' : 'nm-done'} role={notice.isError ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );

  if (!market) {
    if (!canOpen || context === undefined || !source.createMarket) {
      return notice ? <p className="nm-strip nm-error">{notice.text}</p> : null;
    }
    const seed = (currency.seedChips ?? currency.chips)[0] ?? 0n;
    const openStage = busy?.kind === 'open' ? busy.stage : null;
    const openBusy = openStage !== null;
    return (
      <div className="nm-strip" onClick={(event) => event.stopPropagation()}>
        <div className="nm-row">
          <span className="nm-title">
            <IconChartBar size={16} stroke={1.8} aria-hidden="true" />
            <b>{MARKET_QUESTION}</b>
          </span>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={openBusy || waiting !== null}
            onClick={() => void run({ kind: 'open', seed, durationMs: DEFAULT_DURATION_MS })}
          >
            {openStage ? openStageText(openStage, source.signsByVoice) : waiting?.kind === 'open' ? SETTING_UP : 'Open a market'}
          </button>
        </div>
        <p className="nm-muted nm-small">
          Seed {amountText(seed, currency)} · people bet for {durationText(DEFAULT_DURATION_MS)} · then JEV decides.{' '}
          <button
            type="button"
            className="link-btn nm-small"
            disabled={openBusy || waiting !== null}
            onClick={() => {
              setOpenSignInFirst(false);
              setOpening(true);
            }}
          >
            Change
          </button>
        </p>
        {noticeLine}
        {opening && (
          <OpenSheet
            currency={currency}
            signsByVoice={source.signsByVoice}
            account={account}
            busyStage={openStage}
            signInFirst={openSignInFirst}
            onSignIn={onSignIn}
            onClose={() => setOpening(false)}
            onOpen={(chosenSeed, durationMs) => run({ kind: 'open', seed: chosenSeed, durationMs })}
          />
        )}
      </div>
    );
  }

  // The view shows a bet that went out at once, before the market's view has it.
  const yesPool = market.yesPool + (pendingBet?.side === 'yes' ? pendingBet.amount : 0n);
  const noPool = market.noPool + (pendingBet?.side === 'no' ? pendingBet.amount : 0n);
  const bets = market.bets + (pendingBet ? 1 : 0);
  const mine = {
    yes: position.yes + (pendingBet?.side === 'yes' ? pendingBet.amount : 0n),
    no: position.no + (pendingBet?.side === 'no' ? pendingBet.amount : 0n),
  };
  // The view's status is at its last read. An open market past its close is closed.
  const now = Math.max(nowMs, Date.now());
  const status: MarketStatus = market.status === 'open' && now >= market.closesAtMs ? 'closed' : market.status;
  const share = yesShareBps(yesPool, noPool);
  const weight = payoutWeightBps(market);
  const askStage = busy?.kind === 'ask' || busy?.kind === 'close-ask' ? busy.stage : null;
  const asking = askStage !== null;
  const isCreator = account !== undefined && account === market.creator;
  const staked = mine.yes + mine.no;

  return (
    <div className="nm-strip" onClick={(event) => event.stopPropagation()}>
      {status === 'resolved' ? (
        <ResolvedTitle market={market} revealFrom={revealFrom} />
      ) : (
        <div className="nm-row">
          <span className="nm-title">
            <IconChartBar size={16} stroke={1.8} aria-hidden="true" />
            <b>{market.question}</b>
          </span>
          <span className="nm-muted" aria-live="off">
            {status === 'open'
              ? `JEV decides · ${timeLeftText(market.closesAtMs, now)}`
              : status === 'resolving' || asking
                ? 'JEV is deciding'
                : 'Betting closed'}
          </span>
        </div>
      )}
      {/* One bar for every state, so it slides from the odds to JEV's split when JEV answers. */}
      <SplitBar yesBps={status === 'resolved' ? weight : share} pending={pendingBet !== null} />
      {status === 'resolved' ? (
        <Resolved
          market={market}
          position={position}
          account={account}
          currency={currency}
          reveal={revealFrom !== null}
          claimStage={busy?.kind === 'claim' ? busy.stage : null}
          onClaim={() => void run({ kind: 'claim' })}
        />
      ) : (
        <>
          <div className="nm-row">
            <span>
              <b className="nm-yes">{percentText(share)} yes</b> · <span className="nm-no">{percentText(10_000 - share)} no</span>
            </span>
            <span className="nm-muted">
              {amountText(yesPool + noPool, currency, 1)} · {bets} {bets === 1 ? 'bet' : 'bets'}
            </span>
          </div>
          {history.length > 1 && <Sparkline points={history} />}
          {(asking || status === 'resolving') && <JevWorking stage={askStage ?? 'sent'} />}
          {status === 'open' && !asking && saying && voice && account && market && (
            <SayBet
              voice={voice}
              account={account}
              bet={{ marketId: market.id, side: saying, amount: directAmount }}
              onCancel={() => setSaying(null)}
              onVerdict={(verdict) => {
                const side = saying;
                setSaying(null);
                void run({ kind: 'bet', side, verdict });
              }}
            />
          )}
          {status === 'open' && !asking && !(saying && voice && account) && (
            <>
              {stakeControl}
              <div className="nm-buttons">
                {(['yes', 'no'] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className="btn btn-outline btn-sm nm-bet"
                    disabled={busy !== null || waiting !== null}
                    onClick={() => void run({ kind: 'bet', side })}
                  >
                    {busy?.kind === 'bet' && busy.side === side
                      ? betStageText(busy.stage, source)
                      : waiting?.kind === 'bet' && waiting.side === side
                        ? SETTING_UP
                        : side === 'yes'
                          ? 'Bet yes'
                          : 'Bet no'}
                  </button>
                ))}
              </div>
              {isCreator && source.closeAndRequestResolution ? (
                <button type="button" className="btn btn-outline btn-sm nm-ask" disabled={busy !== null} onClick={() => void run({ kind: 'close-ask' })}>
                  <IconScale size={16} stroke={1.8} aria-hidden="true" />
                  Close betting and ask JEV now
                </button>
              ) : (
                <p className="nm-muted nm-small">Odds change until the close. Then anyone can ask JEV.</p>
              )}
            </>
          )}
          {status === 'closed' && !asking && source.requestResolution && (
            <button type="button" className="btn btn-outline btn-sm nm-ask" disabled={waiting !== null} onClick={() => void run({ kind: 'ask' })}>
              <IconScale size={16} stroke={1.8} aria-hidden="true" />
              {waiting?.kind === 'ask' ? SETTING_UP : 'Ask JEV now'}
            </button>
          )}
          {staked > 0n && (
            <p className="nm-muted nm-small">
              Your bets:{' '}
              {[mine.yes > 0n && `${amountText(mine.yes, currency)} on yes`, mine.no > 0n && `${amountText(mine.no, currency)} on no`]
                .filter(Boolean)
                .join(' · ')}
              {pendingBet && ' (arriving)'}
            </p>
          )}
        </>
      )}
      {noticeLine}
      {betSide && (
        <BetSheet
          market={market}
          initialSide={betSide}
          initialAmount={sheetStart?.amount}
          autoPlace={sheetStart?.place}
          source={source}
          account={account}
          onSignIn={onSignIn}
          onClose={() => setBetSide(null)}
          onDone={(text) => {
            // The sheet closes itself with its close animation.
            setNotice({ text, isError: false });
            void load().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

/** "Confirm in the Wallet…" before the approval, then `afterwards`. */
function stageText(stage: SignStage, afterwards: string): string {
  return stage === 'confirm' ? 'Confirm in the Wallet…' : afterwards;
}

/** The stages of a bet. A source that signs by voice has no confirm: the bettor says the bet. */
function betStageText(stage: SignStage, source: MarketSource): string {
  return stage === 'confirm' && source.signsByVoice ? 'Say your bet in the Wallet…' : stageText(stage, 'Placing your bet…');
}

/** The stages of a new market. A source that signs by voice has no confirm here either. */
function openStageText(stage: SignStage, signsByVoice: boolean): string {
  return stage === 'confirm' && signsByVoice ? 'Say it in the Wallet…' : stageText(stage, 'Opening…');
}

/** "3 minutes", "1 hour", "3 days". */
function durationText(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The line while JEV decides: first the Wallet's confirm, then the OutLayer run. */
function JevWorking({ stage }: { stage: SignStage }) {
  return (
    <div className="nm-jev" role="status">
      <span className="nm-spinner" aria-hidden="true" />
      <span>
        <b>{stage === 'confirm' ? 'Confirm in the Wallet' : 'JEV is reading the post and the note…'}</b>
        <span className="nm-muted">
          {stage === 'confirm' ? 'Then JEV decides, in about 10 seconds.' : 'OutLayer runs JEV on NEAR AI. It takes about 10 seconds.'}
        </span>
      </span>
    </div>
  );
}

/** "JEV: 72% this note holds up". The number counts up from the odds when JEV just answered. */
function ResolvedTitle({ market, revealFrom }: { market: NoteMarket; revealFrom: number | null }) {
  const verdict = market.verdictBps ?? 5_000;
  const shown = useCountUp(verdict, revealFrom);
  return (
    <div className="nm-row">
      <span className="nm-title">
        <IconScale size={16} stroke={1.8} aria-hidden="true" />
        <b>JEV: {percentText(shown)} this note holds up</b>
      </span>
      <span className="nm-pill">Resolved</span>
    </div>
  );
}

/** Counts from `from` to `target` in 0.9 s, or shows `target` at once (no `from`, or less motion). */
function useCountUp(target: number, from: number | null): number {
  const [value, setValue] = useState(from ?? target);
  useEffect(() => {
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (from === null || still) {
      setValue(target);
      return;
    }
    const startMs = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - startMs) / 900);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, from]);
  return value;
}

function Resolved({
  market,
  position,
  account,
  currency,
  reveal,
  claimStage,
  onClaim,
}: {
  market: NoteMarket;
  position: MarketPosition;
  account?: string;
  currency: Currency;
  /** JEV just answered in this view: the result slides in. */
  reveal: boolean;
  claimStage: SignStage | null;
  onClaim: () => void;
}) {
  const verdict = market.verdictBps ?? 5_000;
  const weight = payoutWeightBps(market);
  const pool = market.yesPool + market.noPool;
  const staked = position.yes + position.no;
  const refund = market.yesPool === 0n || market.noPool === 0n;
  const payout = position.payout ?? positionPayout(market, position);
  return (
    <div className={reveal ? 'nm-reveal' : undefined}>
      <p className="nm-verdict">{jevSentence(verdict)}</p>
      <p className="nm-muted nm-small">
        {refund
          ? 'One side had no bets, so every bet is refunded.'
          : `Yes bets share ${percentText(weight)} of ${amountText(pool, currency, 1)}. No bets share ${percentText(10_000 - weight)}.`}
        {!refund && weight !== verdict && ` JEV was sure enough, so its ${percentText(verdict)} counts as ${percentText(weight)}.`}
      </p>
      {account && staked > 0n && (
        <div className="nm-row nm-payout">
          <span>
            You bet {amountText(staked, currency)} · you get <b>{amountText(payout, currency)}</b>
          </span>
          {position.claimed ? (
            <span className="nm-muted">In your wallet</span>
          ) : payout === 0n ? (
            <span className="nm-muted">Nothing to claim</span>
          ) : (
            <button type="button" className="btn btn-dark btn-sm" onClick={onClaim} disabled={claimStage !== null}>
              {claimStage ? stageText(claimStage, 'Claiming…') : `Claim ${amountText(payout, currency)}`}
            </button>
          )}
        </div>
      )}
      {market.rationale && (
        <details className="nm-why">
          <summary>
            <IconChevronDown size={14} stroke={2} aria-hidden="true" /> How JEV decided
          </summary>
          <p>{market.rationale}</p>
        </details>
      )}
    </div>
  );
}

function SplitBar({ yesBps, pending = false }: { yesBps: number; pending?: boolean }) {
  const yes = Math.max(0, Math.min(100, yesBps / 100));
  return (
    <div className={pending ? 'nm-bar nm-bar-pending' : 'nm-bar'} role="img" aria-label={`${Math.round(yes)}% yes, ${Math.round(100 - yes)}% no`}>
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

/**
 * One dialog for one flow: the sheet, with the Wallet's cards as steps of the same dialog
 * (WalletDialog).
 */
function SheetDialog({
  titleId,
  locked,
  onClose,
  children,
}: {
  titleId: string;
  /** True while the Wallet works on the sheet's transaction. */
  locked: boolean;
  onClose: () => void;
  /** The sheet. `close` plays the dialog's close animation. */
  children: (close: () => void) => ReactNode;
}) {
  const modal = useRef<ModalHandle>(null);
  return (
    <WalletDialog titleId={titleId} onClose={onClose} locked={locked} handle={modal}>
      {children(() => modal.current?.close())}
    </WalletDialog>
  );
}

/**
 * Signs in from inside a sheet, then runs the sheet's action with the fresh props (the source of
 * a signed-in account). `start` asks; the action runs in an effect when `account` is there.
 */
function useSignInThen(account: string | undefined, onSignIn: () => void | Promise<boolean>, action: () => Promise<void>) {
  const [waiting, setWaiting] = useState(false);
  const [ready, setReady] = useState(false);
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  });
  useEffect(() => {
    if (!ready || !account) return;
    setReady(false);
    setWaiting(false);
    void actionRef.current();
  }, [ready, account]);
  const start = async () => {
    setWaiting(true);
    const asked = onSignIn();
    // Without a promise, the action runs when the account arrives.
    const ok = isPromise<boolean>(asked) ? await asked.catch(() => false) : true;
    if (ok) setReady(true);
    else setWaiting(false);
  };
  return { waiting, start };
}

function BetSheet({
  market,
  initialSide,
  initialAmount,
  autoPlace = false,
  source,
  account,
  onSignIn,
  onClose,
  onDone,
}: {
  market: NoteMarket;
  initialSide: Side;
  /** Default: the middle chip. */
  initialAmount?: bigint;
  /** Place the bet as soon as the sheet opens: the bettor asked for exactly this bet. */
  autoPlace?: boolean;
  source: MarketSource;
  account?: string;
  onSignIn: () => void | Promise<boolean>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const currency = source.currency ?? NEAR_CURRENCY;
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState<bigint>(initialAmount ?? currency.chips[1] ?? 0n);
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!account || !source.getBalance) {
      setBalance(null);
      return;
    }
    source.getBalance(account).then(setBalance, () => setBalance(null));
  }, [account, source]);
  const short = balance !== null && balance < amount;
  const [stage, setStage] = useState<SignStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const share = yesShareBps(market.yesPool, market.noPool);
  const win = estimatePayout(market, side, amount, side === 'yes' ? 10_000 : 0);

  const voice = useBetVoice(source);
  const place = async (close: () => void, verdict?: BetVerdict) => {
    setStage('confirm');
    setError(null);
    const result = await source.bet({ marketId: market.id, side, amount, verdict }, setStage);
    setStage(null);
    if (result.kind === 'sent') close();
    if (result.kind === 'sent') onDone(`Your bet of ${amountText(amount, currency)} on ${side} is in.`);
    // A closed or rejected Wallet window needs no note: the sheet stays as it was.
    else if (result.kind !== 'cancelled') setError(result.reason);
  };
  const closeRef = useRef<() => void>(() => undefined);
  // With a spoken bet, the sign-in ends at the "say it" step: nothing is placed without a voice.
  const signIn = useSignInThen(account, onSignIn, () => (voice ? Promise.resolve() : place(closeRef.current)));
  const autoPlaced = useRef(false);
  useEffect(() => {
    if (!autoPlace || autoPlaced.current) return;
    autoPlaced.current = true;
    void (account ? place(closeRef.current) : signIn.start());
    // Once, when the sheet opens.
  }, []);

  return (
    <SheetDialog titleId={titleId} locked={stage !== null} onClose={onClose}>
      {(close) => {
        closeRef.current = close;
        return (
          <>
            <header className="dialog-head">
              <button type="button" className="icon-btn" onClick={close} aria-label="Close" disabled={stage !== null}>
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
                {currency.chips.map((chip) => (
                  <button
                    key={chip.toString()}
                    type="button"
                    aria-pressed={amount === chip}
                    className={`btn btn-outline btn-sm nm-chip ${amount === chip ? 'btn-choice-on' : ''}`}
                    onClick={() => setAmount(chip)}
                  >
                    {chipText(chip, currency)} {currency.symbol}
                  </button>
                ))}
              </div>
              <p>
                Win about <b>{amountText(win, currency)}</b> if JEV says {side} fully, and the pool stays as it is.
              </p>
              <Morph view={account ? (short ? 'short' : 'balance') : 'signed-out'}>
                {!account ? (
                  <p className="nm-muted">You sign in first. A new wallet gets test USDC from the faucet.</p>
                ) : (
                  balance !== null && (
                    <p className={short ? 'nm-error' : 'nm-muted'}>
                      You have {amountText(balance, currency)}.
                      {short && currency.symbol === 'USDC' && ' Get test USDC at faucet.circle.com (network: Near Testnet).'}
                    </p>
                  )
                )}
              </Morph>
              {error && (
                <p className="nm-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            {voice && account && stage === null ? (
              // The bettor says the bet. Its verdict goes with the bet, and the Wallet then sends it.
              <div className="dialog-foot">
                <SayBet voice={voice} account={account} bet={{ marketId: market.id, side, amount }} disabled={short} onVerdict={(verdict) => void place(close, verdict)} />
              </div>
            ) : (
              <div className="dialog-foot dialog-foot-end">
                <button
                  type="button"
                  className="btn btn-dark"
                  onClick={() => void (account ? place(close) : signIn.start())}
                  disabled={stage !== null || signIn.waiting || short}
                >
                  <Morph view={stage ?? (signIn.waiting ? 'signin' : 'idle')}>
                    {stage
                      ? betStageText(stage, source)
                      : signIn.waiting
                        ? SETTING_UP
                        : voice
                          ? 'Sign in to say your bet'
                          : `Bet ${amountText(amount, currency)} on ${side}`}
                  </Morph>
                </button>
              </div>
            )}
          </>
        );
      }}
    </SheetDialog>
  );
}

/**
 * Opens a market with another seed or close time. `onOpen` gives an error text, or null. With
 * `signInFirst` (a tap on "Open a market" while signed out), the sheet starts with the sign-in
 * and then opens the market with its defaults, all in this one dialog.
 */
function OpenSheet({
  currency,
  signsByVoice,
  account,
  busyStage,
  signInFirst,
  onSignIn,
  onClose,
  onOpen,
}: {
  currency: Currency;
  /** The owner says a sentence to open the market, in place of a confirm. */
  signsByVoice: boolean;
  account?: string;
  busyStage: SignStage | null;
  signInFirst: boolean;
  onSignIn: () => void | Promise<boolean>;
  onClose: () => void;
  /** Null when the market is open, '' when the visitor closed the Wallet, else the problem. */
  onOpen: (seed: bigint, durationMs: number) => Promise<string | null>;
}) {
  const titleId = useId();
  const seedChips = currency.seedChips ?? currency.chips;
  const [seed, setSeed] = useState<bigint>(seedChips[0] ?? 0n);
  const [duration, setDuration] = useState(DEFAULT_DURATION_MS);
  const [error, setError] = useState<string | null>(null);
  const busy = busyStage !== null;

  const closeRef = useRef<() => void>(() => undefined);
  const open = async () => {
    setError(null);
    const problem = await onOpen(seed, duration);
    // null: the market is open. '': the visitor closed the Wallet, so the sheet stays, quiet.
    if (problem === null) closeRef.current();
    else if (problem) setError(problem);
  };
  const signIn = useSignInThen(account, onSignIn, open);
  // "Open a market" while signed out: the sign-in comes first, once.
  const started = useRef(false);
  useEffect(() => {
    if (!signInFirst || account || started.current) return;
    started.current = true;
    void signIn.start();
  });

  return (
    <SheetDialog titleId={titleId} locked={busy} onClose={onClose}>
      {(close) => {
        closeRef.current = close;
        return (
          <>
            <header className="dialog-head">
              <button type="button" className="icon-btn" onClick={close} aria-label="Close" disabled={busy}>
                <IconX size={20} />
              </button>
              <h2 id={titleId}>Open a market on this note</h2>
            </header>
            <div className="dialog-body nm-sheet">
              <p>
                <b>{MARKET_QUESTION}</b>
              </p>
              <p className="nm-muted">
                People bet yes or no. At the close, JEV reads the post and this note as they are now, and its answer splits the pool.
              </p>
              <div>
                <p className="nm-small">
                  <b>Your seed</b>: half goes on yes and half on no, so the odds start at 50%. It is paid like any other bet.
                </p>
                <div className="nm-buttons" role="group" aria-label="Seed">
                  {seedChips.map((chip) => (
                    <button
                      key={chip.toString()}
                      type="button"
                      aria-pressed={seed === chip}
                      className={`btn btn-outline btn-sm nm-chip ${seed === chip ? 'btn-choice-on' : ''}`}
                      onClick={() => setSeed(chip)}
                    >
                      {chipText(chip, currency)} {currency.symbol}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="nm-small">
                  <b>Betting closes in</b> (you can close it earlier and ask JEV at once)
                </p>
                <div className="nm-buttons" role="group" aria-label="Betting closes in">
                  {DURATIONS.map((option) => (
                    <button
                      key={option.ms}
                      type="button"
                      aria-pressed={duration === option.ms}
                      className={`btn btn-outline btn-sm nm-chip ${duration === option.ms ? 'btn-choice-on' : ''}`}
                      onClick={() => setDuration(option.ms)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && (
                <p className="nm-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-foot dialog-foot-end">
              <button type="button" className="btn btn-dark" onClick={() => void (account ? open() : signIn.start())} disabled={busy || signIn.waiting}>
                <Morph view={busyStage ?? (signIn.waiting ? 'signin' : 'idle')}>
                  {busyStage ? openStageText(busyStage, signsByVoice) : signIn.waiting ? SETTING_UP : `Open market · ${amountText(seed, currency)}`}
                </Morph>
              </button>
            </div>
          </>
        );
      }}
    </SheetDialog>
  );
}
