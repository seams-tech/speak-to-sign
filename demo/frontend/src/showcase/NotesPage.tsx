// The Community Notes page of the Speak-to-Sign site, as one single-page app: a banner about
// voice signatures at the top, and the live notes app under it, in the page itself. The page
// has the height of the screen. The app scrolls inside it, and the banner folds to one line
// when the app scrolls, so the app gets the room.

import { useEffect, useRef, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { config } from '../config';
import { EXAMPLES, PAGE_PATH } from './examples';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';
import { PAGE_LABEL } from './Showcase';
import { SignatureCard } from './SignatureCard';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
/** The app scrolled this far: the banner folds. It opens again at the top of the app. */
const FOLD_AT_PX = 24;

export function NotesPage({ seams }: { seams: boolean }) {
  const [signIn, setSignIn] = useState(false);
  const [folded, setFolded] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  // Scroll events do not bubble, so the listener is a capture listener on the app's place. Only
  // the app's own scroller counts, not a list inside a dialog.
  useEffect(() => {
    const place = appRef.current;
    if (!place) return;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('notes-app')) return;
      if (target.scrollTop > FOLD_AT_PX) setFolded(true);
      else if (target.scrollTop === 0) setFolded(false);
    };
    place.addEventListener('scroll', onScroll, true);
    return () => place.removeEventListener('scroll', onScroll, true);
  }, []);

  const openBanner = () => {
    appRef.current?.querySelector('.notes-app')?.scrollTo({ top: 0 });
    setFolded(false);
  };

  return (
    <>
      <div className="ss-page ss-spa">
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
            <a className="ss-nav-link ss-nav-pay" href={config.payPath}>
              Speak to pay
            </a>
            <a className="ss-nav-link ss-nav-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
        </header>

        <section className="ss-banner" data-folded={folded || undefined} aria-labelledby="banner-title">
          <div className="ss-banner-fold">
            <div className="ss-banner-body" inert={folded}>
              <div className="ss-banner-main">
                <div className="ss-banner-text">
                  <h1 id="banner-title" className="ss-banner-title">
                    Sign with your voice.
                  </h1>
                  <p className="ss-banner-sub">
                    Say the request. Your Seams Wallet signs only when the voice is yours and the words match. No confirm tap, and you cannot
                    sign what you did not say.
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
            </div>
          </div>
          <button type="button" className="ss-banner-mini" onClick={openBanner} tabIndex={folded ? 0 : -1} aria-hidden={!folded}>
            <b>Sign with your voice.</b>
            <span className="ss-banner-mini-sub">Say the request. Your wallet signs only when the voice is yours and the words match.</span>
            <span className="ss-banner-mini-open">
              How it works <IconChevronDown size={14} stroke={2.2} aria-hidden="true" />
            </span>
          </button>
        </section>

        <main className="ss-spa-app" ref={appRef} aria-label="Community Notes">
          <LiveSlot id="notes" />
        </main>
      </div>

      <LiveApps page="notes" seams={seams} onMultisigSignIn={() => setSignIn(true)} />
      {seams && signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />}
    </>
  );
}
