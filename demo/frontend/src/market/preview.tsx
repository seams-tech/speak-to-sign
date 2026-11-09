// Dev-only preview of the note market UI with the mock source: an open market, a closed one
// and a resolved one, each inside an X-style note card. Open /market-preview.html in `pnpm dev`.

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IconUsers } from '@tabler/icons-react';
import { createMockMarketSource } from './mockSource';
import { NoteMarketStrip } from './NoteMarket';
import { YOCTO_PER_NEAR } from './types';
import '../styles.css';

const ACCOUNT = 'you.testnet';

function Preview() {
  const [version, setVersion] = useState(0);
  const source = useMemo(() => {
    const mock = createMockMarketSource({ noteIds: [1, 2, 3], delayMs: 600 });
    mock.close(2);
    // Note 3: a bet of 0.5 NEAR on yes, then JEV says 72%.
    void mock.getMarketForNote(3).then(async () => {
      await mock.bet({ marketId: 3, side: 'yes', amount: YOCTO_PER_NEAR / 2n });
      mock.resolve(
        3,
        7_200,
        'The note cites a fact-check that traces the post to an account that posts AI-written text daily, with different numbers each time. The claim about thumbnails is partly true, so the verdict is not 100%.',
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
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Preview with mock data. Bets and claims take 0.6 s.</p>
        {[
          { id: 1, label: 'Open market' },
          { id: 2, label: 'Betting closed. Press "Ask JEV now" (JEV says 93%, which pays as 100%)' },
          { id: 3, label: 'Resolved by JEV, with your bet' },
          { id: 4, label: 'No market yet: open one with a seed' },
        ].map(({ id, label }) => (
          <div key={`${id}-${version}`} style={{ marginBottom: 24 }}>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>{label}</p>
            <section className="note-card">
              <header className="note-head">
                <IconUsers size={20} stroke={1.8} className="note-icon-shown" aria-hidden="true" />
                <b>Readers added context they thought people might want to know</b>
              </header>
              <div className="note-body">The account posts AI-written text every day to farm engagement. The numbers change each time.</div>
              <NoteMarketStrip
                noteId={id}
                source={source}
                account={ACCOUNT}
                onSignIn={() => undefined}
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
