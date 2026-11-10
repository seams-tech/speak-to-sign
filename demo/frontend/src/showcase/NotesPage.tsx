// The Community Notes page of the Speak-to-Sign site, as one single-page app: a dark hero about
// voice signatures (with the setup steps), and the live notes app on a white sheet under it.
// The page has one bar, the nav: the notes app's own top line is hidden here.
//
// The page scrolls by the height of the hero. The nav stays in place. The hero stays too, and the
// sheet moves up over it like a sheet of paper, while the hero goes back a little, blurs and
// dims. When the sheet is at the nav ("docked"), the notes app scrolls inside the sheet.

import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { config } from '../config';
import { EXAMPLES, PAGE_PATH } from './examples';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';
import { PAGE_LABEL } from './Showcase';
import { SignatureCard } from './SignatureCard';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';

export function NotesPage({ seams }: { seams: boolean }) {
  const [signIn, setSignIn] = useState(false);
  const [docked, setDocked] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);

  // The page's scroll position drives the hero (--cover: 0 = open, 1 = covered) and the dock.
  useEffect(() => {
    const page = pageRef.current;
    const hero = heroRef.current;
    if (!page || !hero) return;
    // The work is two style writes, so it runs in the scroll event itself. A frame callback
    // does not run while the tab is in the background, and the sheet would not dock then.
    const update = () => {
      const distance = page.scrollHeight - page.clientHeight;
      const cover = distance > 0 ? Math.min(1, Math.max(0, page.scrollTop / distance)) : 1;
      hero.style.setProperty('--cover', cover.toFixed(3));
      // One pixel of slack: a zoomed page stops a fraction before the end.
      setDocked(distance <= 0 || page.scrollTop >= distance - 1);
    };
    update();
    page.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      page.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // A post opens: the sheet goes up, so the post has the whole screen.
  useEffect(() => {
    const onHash = () => {
      const page = pageRef.current;
      if (page && /^#\/notes\/post\//.test(window.location.hash)) page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <div className="ss-page ss-spa" ref={pageRef}>
        <header className="ss-nav">
          <div className="ss-nav-inner">
            <a className="ss-brand" href="/">
              <BrandMark size={24} />
              Speak-to-Sign
            </a>
            <nav className="ss-nav-pages" aria-label="Examples">
              {EXAMPLES.map((item) => (
                <a key={item.id} className="ss-nav-page" href={PAGE_PATH[item.id]} aria-current={item.id === 'notes' ? 'page' : undefined}>
                  {PAGE_LABEL[item.id]}
                </a>
              ))}
            </nav>
            <span className="ss-nav-chip">Testnet</span>
            <a className="ss-nav-link ss-nav-pay" href={config.payPath}>
              Speak to pay
            </a>
            <a className="ss-nav-link ss-nav-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
        </header>

        <section className="ss-hero" ref={heroRef} aria-labelledby="hero-title">
          <div className="ss-hero-inner">
            <div className="ss-hero-text">
              <p className="ss-hero-kicker">Seams voice signatures</p>
              <h1 id="hero-title" className="ss-hero-title">
                Sign with your voice.
              </h1>
              <p className="ss-hero-sub">
                Say the request. Your Seams Wallet signs only when the voice is yours and the words match. No confirm tap, and you cannot sign
                what you did not say.
              </p>
            </div>
            <SignatureCard />
          </div>
          {/* The multisig page sends a visitor here (#setup) to set up the voice and get testnet NEAR. */}
          <div className="ss-setup-strip" id="setup">
            <span className="ss-setup-strip-label">
              Set up <span className="ss-setup-strip-sub">optional · NEAR testnet</span>
            </span>
            {seams ? <SeamsOnboarding onSignIn={() => setSignIn(true)} /> : <KeylessOnboarding />}
          </div>
        </section>

        <main className="ss-sheet" data-docked={docked || undefined} aria-label="Community Notes">
          <div className="ss-sheet-app">
            <LiveSlot id="notes" />
          </div>
        </main>
      </div>

      <LiveApps page="notes" seams={seams} onMultisigSignIn={() => setSignIn(true)} />
      {seams && signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />}
    </>
  );
}
