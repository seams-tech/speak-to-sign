// Dev-only preview of the note market UI with the mock source: an open market, a closed one
// and a resolved one, each inside an X-style note card. Open /market-preview.html in `pnpm dev`.

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconUsers } from '@tabler/icons-react';
import { createMockMarketSource } from './mockSource';
import { NoteMarketStrip } from './NoteMarket';
import { USDC_CURRENCY, YOCTO_PER_NEAR } from './types';
import '../styles.css';

const ACCOUNT = 'you.testnet';

function Preview() {
  const [version, setVersion] = useState(0);
  // `?signedout` starts signed out: an action asks for the sign-in, which "succeeds" after 1.5 s
  // (as the page's sign-in and faucet would), and the action then runs. `?signedout=void` uses a
  // sign-in without a promise: the action runs when the account arrives.
  const signedOut = new URLSearchParams(window.location.search).get('signedout');
  const [account, setAccount] = useState<string | undefined>(() => (signedOut === null ? ACCOUNT : undefined));
  const signIn = (): void | Promise<boolean> => {
    if (signedOut === 'void') {
      setTimeout(() => setAccount(ACCOUNT), 800);
      return;
    }
    return new Promise<boolean>((resolve) =>
      setTimeout(() => {
        setAccount(ACCOUNT);
        resolve(true);
      }, 1_500),
    );
  };
  const source = useMemo(() => {
    // `?usdc` shows the markets in USDC, as the contract has them.
    const usdc = new URLSearchParams(window.location.search).has('usdc');
    const mock = createMockMarketSource({
      noteIds: [1, 2, 3, 5],
      delayMs: 600,
      currency: usdc ? USDC_CURRENCY : undefined,
      account: ACCOUNT,
      // `?voice`: a bet needs a spoken sentence (the mock accepts every recording).
      spokenBets: new URLSearchParams(window.location.search).has('voice'),
    });
    mock.close(2);
    // Note 3: a bet of 0.5 NEAR on yes, then JEV says 72%.
    void mock.getMarketForNote(3).then(async () => {
      await mock.bet({ marketId: 3, side: 'yes', amount: usdc ? 5n * USDC_CURRENCY.chips[0]! : YOCTO_PER_NEAR / 2n });
      mock.resolve(
        3,
        7_200,
        'The note cites the club’s annual report, which gives other numbers. One cost in the note is from an older report, so the verdict is not 100%.',
      );
      setVersion((v) => v + 1);
    });
    return mock;
  }, []);

  return (
    // `.notes-app` is a size container with height 100% (the page's notes window), so the
    // preview gives it the window height.
    <div className="notes-app" style={{ height: '100vh' }}>
      <div style={{ maxWidth: 600, margin: '24px auto', padding: '0 16px' }}>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Preview with mock data. The Wallet confirm and the transaction take 0.6 s each.
        </p>
        {[
          { id: 1, label: 'Open market' },
          { id: 2, label: 'Betting closed. Press "Ask JEV now" (JEV says 93%, which pays as 100%)' },
          { id: 3, label: 'Resolved by JEV, with your bet' },
          { id: 4, label: 'No market yet: "Open a market" opens one at once; then you are the creator, so "Close betting and ask JEV now" shows' },
          { id: 5, label: 'One-tap bets (directBet): the bar moves when the bet goes out', direct: true },
        ].map(({ id, label, direct }) => (
          <div key={`${id}-${version}`} style={{ marginBottom: 24 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>{label}</p>
            <section className="note-card">
              <header className="note-head">
                <IconUsers size={20} stroke={1.8} className="note-icon-shown" aria-hidden="true" />
                <b>Readers added context they thought people might want to know</b>
              </header>
              <div className="note-body">The club’s annual report gives other numbers. The post leaves out the costs of the new stadium.</div>
              <NoteMarketStrip
                noteId={id}
                source={source}
                account={account}
                onSignIn={signIn}
                directBet={direct ?? false}
                context="Post: Claude Code found 145,763 deleted photos. Note: the account posts AI-written text every day."
              />
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');
createRoot(root).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
