// The Community Notes page of the Speak-to-Sign site, as one single-page app: a hero about
// voice signatures (with the setup steps), and the live notes app on a white sheet under it.
// The page has one bar, the nav, with the name and GitHub: the notes app's own top line is
// hidden here. When the sheet covers the hero, the setup steps show in the nav.
//
// The hero has a moving grain field of the Seams site (./grain, the GrainField of seams-monorepo).
// The nav's picker (FieldPicker) chooses one of its 14 gradients; the default is the field of the
// Seams home hero.
// The page is the one scroll area. The nav stays in place. The hero stays too, and the sheet
// moves up over it like a sheet of paper, while the hero goes back a little, blurs and dims.
// The same scroll then goes on down the feed: the notes app does not scroll itself here.

import { useEffect, useRef, useState } from 'react';
import { IconBrandGithub } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { FieldPicker } from './FieldPicker';
import { GrainField } from './grain/GrainField';
import { grainFieldSource } from './grain/fields';
import { fieldScrim, useHeroField } from './heroField';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';
import { SignatureCard } from './SignatureCard';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
/** The part of the way at which the hero's setup strip is out of sight. */
const COVERED_AT = 0.6;
/** The hero field moves at half the site pace, as on the Seams home page. */
const HERO_FIELD_PACE = 0.5;

export function NotesPage({ seams }: { seams: boolean }) {
  const [signIn, setSignIn] = useState(false);
  // The sheet covers most of the hero: the setup steps show in the nav.
  const [covered, setCovered] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  // The sheet is at the nav or past it: only the nav's strip of the field shows.
  const [docked, setDocked] = useState(false);
  const field = useHeroField();
  const fieldStyle = { '--field-base': grainFieldSource(field).base, '--field-scrim': fieldScrim(field) } as CSSProperties;

  /** How far the page scrolls until the sheet is at the nav. */
  const coverDistance = () => {
    const page = pageRef.current;
    const sheet = sheetRef.current;
    if (!page || !sheet) return 0;
    const nav = page.querySelector<HTMLElement>('.ss-nav');
    return Math.max(0, sheet.offsetTop - (nav?.offsetHeight ?? 0));
  };

  // The page's scroll position drives the hero (--cover: 0 = open, 1 = covered).
  useEffect(() => {
    const page = pageRef.current;
    const hero = heroRef.current;
    if (!page || !hero) return;
    // The work is one style write, so it runs in the scroll event itself. A frame callback does
    // not run while the tab is in the background.
    const update = () => {
      const distance = coverDistance();
      const cover = distance > 0 ? Math.min(1, Math.max(0, page.scrollTop / distance)) : 1;
      hero.style.setProperty('--cover', cover.toFixed(3));
      setCovered(cover >= COVERED_AT);
      setDocked(cover >= 0.999);
      // The nav has no ground of its own: the top of the hero shows behind it. When the feed
      // scrolls on, the sheet would go up behind the nav and hide that strip. So the part of
      // the sheet above the nav's lower edge is cut off, with the sheet's round corners.
      const sheet = sheetRef.current;
      const nav = page.querySelector<HTMLElement>('.ss-nav');
      if (sheet && nav) {
        const above = nav.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top;
        sheet.style.clipPath = above > 0 ? `inset(${above.toFixed(1)}px 0 0 0 round var(--sheet-r) var(--sheet-r) 0 0)` : '';
      }
    };
    update();
    page.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      page.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // A new page of the app (a post, or back to the timeline) starts at the top of the sheet. A
  // post that opens while the hero shows moves the sheet up, so the post has the whole screen.
  useEffect(() => {
    const onHash = () => {
      const page = pageRef.current;
      if (!page) return;
      const top = coverDistance();
      if (page.scrollTop > top) page.scrollTo({ top });
      else if (/^#\/notes\/post\//.test(window.location.hash)) page.scrollTo({ top, behavior: 'smooth' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <div className="ss-page ss-spa" ref={pageRef} style={fieldStyle}>
        <header className="ss-nav">
          <div className="ss-nav-inner">
            <a className="ss-brand" href="/">
              <BrandMark size={24} />
              Speak-to-Sign
            </a>
            {/* The setup steps again, for the time that the sheet covers the hero and its strip.
                They show until every step is done, so the wallet setup is always in reach. */}
            <div className="ss-nav-setup" data-shown={covered || undefined} inert={!covered} aria-label="Set up">
              {seams ? <SeamsOnboarding onSignIn={() => setSignIn(true)} /> : <KeylessOnboarding />}
            </div>
            <FieldPicker />
            <a className="ss-nav-link ss-nav-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
              <IconBrandGithub size={17} stroke={1.9} aria-hidden="true" />
              <span>GitHub</span>
            </a>
          </div>
        </header>

        <section className="ss-hero" ref={heroRef} aria-labelledby="hero-title">
          {/* While the sheet is at the nav, only the nav's strip of the field shows: it holds still. */}
          <GrainField field={field} pace={HERO_FIELD_PACE} playing={!docked} />
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

        <main className="ss-sheet" ref={sheetRef} aria-label="Community Notes">
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
