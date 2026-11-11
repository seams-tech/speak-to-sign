// The note view of the demo post's context: the note that the post got on X, then the note
// market with two bet buttons. The timeline opens it from the post's card (its Bet button, or a
// click on the card).

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { IconCircleCheckFilled, IconExternalLink, IconX } from '@tabler/icons-react';
import { config } from '../config';
import type { Post, PostContext as Context } from '../data/posts';
import { useDemo } from '../demoContext';
import { useFunds } from '../faucet/funds';
import { useMarketSource } from '../market/contractSource';
import { amountText } from '../market/math';
import { NoteMarketStrip, type BetRequest } from '../market/NoteMarket';
import { useBetVoice } from '../market/SayBet';
import { NEAR_CURRENCY, type Currency, type Side } from '../market/types';
import { MediaThumb } from './Media';
import { Modal, type ModalHandle } from './Modal';
import { Morph, MorphView } from './Morph';
import { SignInStep } from './SignInModal';


/**
 * The context is not a note on the notes contract, so its market has a fixed note id. On
 * pm-notes.seams-v1.testnet, `get_market_for_note(0)` gives its market: "Is this note true?",
 * in USDC (market 9 now, open until 18 Nov 2026 23:59 UTC).
 */
export const CONTEXT_MARKET_NOTE_ID = 0;

/**
 * The note view, kept short: the quoted post, the note, then the bet: a slider for its amount
 * and two colored buttons.
 * A visitor who is not signed in taps a bet button too: the dialog turns into the sign-in, then
 * back, the faucet sends testnet USDC, and the strip places the bet. One dialog all the way.
 */
export function NoteDialog({
  post,
  context,
  bet,
  onClose,
}: {
  post: Post;
  context: Context;
  /** A bet that the visitor asked for by voice: the dialog opens and places it. */
  bet?: { side: Side; amount: bigint | null };
  onClose: () => void;
}) {
  const { account, prepare, preparing, signingIn, hostSignIn, endSignIn } = useDemo();
  useEffect(() => hostSignIn(), [hostSignIn]);
  const source = useMarketSource();
  const betVoice = useBetVoice(source);
  const funds = useFunds(account, false);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const signInTitleId = useId();
  const currency = source.currency ?? NEAR_CURRENCY;
  // A tap bets the slider's amount: 0.1 to 1 USDC (the market takes 0.1 USDC or more), 0.1 at
  // first, so the faucet's 2 USDC give twenty bets.
  const [stakeTenths, setStakeTenths] = useState(() =>
    bet?.amount ? Math.max(1, Math.min(MAX_STAKE_TENTHS, Number(bet.amount / tenthOf(currency)))) : 1,
  );
  const [betRequest] = useState<BetRequest | undefined>(() => (bet ? { seq: 1, side: bet.side, place: true } : undefined));
  const stake = tenthOf(currency) * BigInt(stakeTenths);
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!account || !source.getBalance) {
      setBalance(null);
      return;
    }
    let current = true;
    source.getBalance(account).then(
      (value) => current && setBalance(value),
      () => current && setBalance(null),
    );
    return () => {
      current = false;
    };
    // A new USDC balance in the page's funds (the faucet, a note) reads the market's again.
  }, [account, source, funds.balance?.usdc]);

  // Sign in, then the faucet when the account has less than a bet needs. True when the strip
  // can place the bet.
  // When a step fails (the faucet, for example), the line under the buttons says why: the strip
  // drops the tapped bet without a word.
  const [problem, setProblem] = useState<string | null>(null);
  const readyToBet = async () => {
    setProblem(null);
    // A spoken bet also needs the bettor's voice set up.
    const ready = await prepare({ funds: 'bet', voice: source.signsByVoice || betVoice !== null });
    if (!ready.ok && ready.reason) setProblem(ready.reason);
    return ready.ok;
  };
  const short = balance !== null && balance < stake;
  // Under the buttons: the faucet at work, a problem, or the link to more USDC. Else nothing.
  const line = preparing === 'funds' ? 'funds' : problem ? 'problem' : short ? 'short' : 'none';

  return (
    <Modal
      labelledBy={signingIn ? signInTitleId : titleId}
      onClose={onClose}
      locked={false}
      handle={modal}
      onOutside={signingIn ? () => endSignIn(false) : undefined}
    >
      <Morph view={signingIn ? 'signin' : 'note'} flex>
        {/* Kept while the sign-in shows: the strip waits there to place the tapped bet. */}
        <MorphView name="note" keep>
          <header className="dialog-head">
            <button type="button" className="icon-btn" onClick={() => modal.current?.close()} aria-label="Close">
              <IconX size={20} />
            </button>
            <h2 id={titleId}>Note</h2>
          </header>
          <div className="dialog-body">
            <div className="pc-note">
              <div className="pc-post pc-post-row">
                {post.media && <MediaThumb kind={post.media} />}
                <div className="pc-post-main">
                  <div className="pc-post-head">
                    <b>{post.author.name}</b>
                    <span className="muted">
                      @{post.author.handle} · {post.age}
                    </span>
                  </div>
                  <p className="pc-post-text">{post.text}</p>
                </div>
              </div>
              <div className="pc-status">
                <p className="pc-status-row">
                  <IconCircleCheckFilled size={18} className="pc-ok" aria-hidden="true" />
                  <b>Rated helpful on X</b>
                </p>
                <p className="pc-note-text">{context.text}</p>
              </div>
              <div className="pc-bet">
                <b className="pc-bet-title">Is this note true?</b>
                <NoteMarketStrip
                  noteId={CONTEXT_MARKET_NOTE_ID}
                  source={source}
                  account={account}
                  onSignIn={readyToBet}
                  directBet={stake}
                  openBet={betRequest}
                  stakeControl={<StakeSlider tenths={stakeTenths} currency={currency} onChange={setStakeTenths} />}
                  placeholder
                />
                <Morph view={line}>
                  {line === 'funds' ? (
                    <p className="pc-practice pc-busy" role="status">
                      <span className="spinner" aria-hidden="true" /> Getting testnet USDC for your bets from the faucet…
                    </p>
                  ) : line === 'problem' ? (
                    <p className="pc-practice pc-problem" role="alert">
                      {problem} <UsdcLink />
                    </p>
                  ) : line === 'short' ? (
                    <p className="pc-practice">
                      <UsdcLink />
                    </p>
                  ) : null}
                </Morph>
              </div>
            </div>
          </div>
        </MorphView>
        {signingIn && (
          <MorphView name="signin">
            <SignInStep titleId={signInTitleId} onSignedIn={() => endSignIn(true)} onBack={() => endSignIn(false)} />
          </MorphView>
        )}
      </Morph>
    </Modal>
  );
}

/** The most tenths that the bet slider goes to: 1 USDC. */
const MAX_STAKE_TENTHS = 10;

/** A tenth of one unit of the currency (0.1 USDC), in base units. */
function tenthOf(currency: Currency): bigint {
  return 10n ** BigInt(currency.decimals) / 10n;
}

/** The amount of one bet: a slider from 0.1 to 1, in steps of 0.1, with the amount at its right. */
function StakeSlider({ tenths, currency, onChange }: { tenths: number; currency: Currency; onChange: (tenths: number) => void }) {
  const id = useId();
  const text = amountText(tenthOf(currency) * BigInt(tenths), currency);
  return (
    <div className="pc-stake">
      <div className="pc-stake-row">
        <label htmlFor={id}>Your bet</label>
        <output htmlFor={id} className="pc-stake-value">
          {text}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="pc-stake-range"
        min={1}
        max={MAX_STAKE_TENTHS}
        step={1}
        value={tenths}
        aria-valuetext={text}
        style={{ '--p': (tenths - 1) / (MAX_STAKE_TENTHS - 1) } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/**
 * Where to get more testnet USDC. The page's faucet runs by itself once per account (after
 * sign-in, or at the first bet), so an account that is short has had it already.
 */
function UsdcLink() {
  return (
    <a className="lk" href={config.usdcFaucetUrl} target="_blank" rel="noopener noreferrer">
      Get test USDC (network: NEAR testnet)
      <IconExternalLink size={12} stroke={1.8} aria-hidden="true" />
    </a>
  );
}
