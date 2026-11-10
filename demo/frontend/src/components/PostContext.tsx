// The Community Note that the post got on X, shown as on X: "Readers added context". In place of
// "Do you find this helpful?", it asks for a bet. The Bet button opens the note, as X's note
// view does, with the note market at its foot.

import { useEffect, useId, useRef, useState } from 'react';
import { IconCircleCheckFilled, IconExternalLink, IconUsers, IconX } from '@tabler/icons-react';
import { config } from '../config';
import type { Post, PostContext as Context } from '../data/posts';
import { useDemo } from '../demoContext';
import { useFunds } from '../faucet/funds';
import { useMarketSource } from '../market/contractSource';
import { amountText } from '../market/math';
import { NoteMarketStrip } from '../market/NoteMarket';
import { NEAR_CURRENCY } from '../market/types';
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

export function PostContextBox({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const context = post.context;
  if (!context) return null;
  return (
    <>
      <section className="note-card pc-card" aria-label="Readers added context">
        <header className="note-head">
          <IconUsers size={20} stroke={1.8} className="note-icon-shown" aria-hidden="true" />
          <b>Readers added context they thought people might want to know</b>
        </header>
        <div className="note-body">
          <ContextText context={context} />
        </div>
        <div className="note-foot note-rate">
          <span>Do you bet this is true or false?</span>
          <button type="button" className="btn btn-blue" onClick={() => setOpen(true)}>
            Bet
          </button>
        </div>
      </section>
      {open && <NoteDialog post={post} context={context} onClose={() => setOpen(false)} />}
    </>
  );
}

function ContextText({ context }: { context: Context }) {
  return (
    <>
      <p>{context.text}</p>
      <ol className="pc-examples">
        {context.examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ol>
    </>
  );
}

/**
 * The note view, kept short: the quoted post, the note, then the bet with two colored buttons.
 * A visitor who is not signed in taps a bet button too: the dialog turns into the sign-in, then
 * back, the faucet sends testnet USDC, and the strip places the bet. One dialog all the way.
 */
export function NoteDialog({ post, context, onClose }: { post: Post; context: Context; onClose: () => void }) {
  const { account, prepare, preparing, signingIn, hostSignIn, endSignIn } = useDemo();
  useEffect(() => hostSignIn(), [hostSignIn]);
  const source = useMarketSource();
  const funds = useFunds(account, false);
  const modal = useRef<ModalHandle>(null);
  const titleId = useId();
  const signInTitleId = useId();
  const currency = source.currency ?? NEAR_CURRENCY;
  // A tap bets the middle chip: 0.5 USDC (the market takes 0.1 USDC or more), so the faucet's
  // 2 USDC give four bets. The line under the buttons says how much.
  const stake = currency.chips[1] ?? currency.chips[0] ?? 0n;
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
    const ready = await prepare({ funds: 'bet' });
    if (!ready.ok && ready.reason) setProblem(ready.reason);
    return ready.ok;
  };
  const short = balance !== null && balance < stake;
  const line = preparing === 'funds' ? 'funds' : problem ? 'problem' : 'stake';

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
                  ) : (
                    <p className="pc-practice">
                      One tap bets {amountText(stake, currency)}. Your Seams Wallet asks you to confirm.
                      {balance !== null && <> You have {amountText(balance, currency)}.</>}
                      {short && (
                        <>
                          {' '}
                          <UsdcLink />
                        </>
                      )}
                    </p>
                  )}
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
