// The Community Notes page of the Speak-to-Sign site, as one single-page app: a hero about
// voice signatures (with the setup steps), and the live notes app on a sheet under it.
// The page has one bar, the nav, with the name and GitHub: the notes app's own top line is
// hidden here. When the sheet covers the hero, the setup steps show in the nav.
//
// The hero has a moving grain field of the Seams site (./grain, the GrainField of seams-monorepo).
// The nav's brand pill holds the name and the theme picker (ThemePicker): Light mode (the
// default) and Dark mode. A theme sets the hero's field and the notes app's colours.
// The page has three layers: the ground (the field, behind the nav and the hero), the nav, and
// one scroll area that starts under the nav. In the scroll area, the hero's text stays in place
// and the sheet moves up over it like a sheet of paper, while the hero goes back a little, blurs
// and dims. The same scroll then goes on down the feed: the notes app does not scroll itself
// here. Nothing that scrolls can come behind the nav, so the nav always shows the field.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconBrandGithub } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { NearMark, NearWordmark } from './nearMarks';
import { SeamsMark, SeamsWordmark } from './seamsMarks';
import { GrainField } from './grain/GrainField';
import { grainFieldSource } from './grain/fields';
import { fieldScrim, THEMES, useTheme } from './theme';
import { ThemePicker } from './ThemePicker';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
const NEAR_URL = 'https://near.org';
const SEAMS_URL = 'https://wallet.seams.sh/';
/** The part of the way at which the hero's setup strip is out of sight. */
const COVERED_AT = 0.6;
/** The hero field moves at half the site pace, as on the Seams home page. */
const HERO_FIELD_PACE = 0.5;

export function NotesPage({ seams }: { seams: boolean }) {
  const [signIn, setSignIn] = useState(false);
  // The sheet covers most of the hero: the setup steps show in the nav.
  const [covered, setCovered] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  // The sheet is at the nav or past it: only the nav's strip of the field shows.
  const [docked, setDocked] = useState(false);
  const theme = useTheme();
  const field = THEMES[theme].field;
  const fieldStyle = { '--field-base': grainFieldSource(field).base, '--field-scrim': fieldScrim(field) } as CSSProperties;

  // The theme is on the root element: the notes app's dialogs open on document.body. It is set
  // before the first paint, so a dark theme never shows a white flash.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  /** How far the scroll area scrolls until the sheet is at the nav. */
  const coverDistance = () => sheetRef.current?.offsetTop ?? 0;

  // The scroll position drives the hero (--cover: 0 = open, 1 = covered).
  useEffect(() => {
    const scroller = scrollRef.current;
    const hero = heroRef.current;
    if (!scroller || !hero) return;
    // The work is one style write, so it runs in the scroll event itself. A frame callback does
    // not run while the tab is in the background.
    const update = () => {
      const distance = coverDistance();
      const cover = distance > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / distance)) : 1;
      hero.style.setProperty('--cover', cover.toFixed(3));
      setCovered(cover >= COVERED_AT);
      setDocked(cover >= 0.999);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // The ground is as high as the nav and the hero. The hero's height follows its content.
  useEffect(() => {
    const page = pageRef.current;
    const hero = heroRef.current;
    if (!page || !hero) return;
    const measure = () => page.style.setProperty('--hero-h', `${hero.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  // A new page of the app (a post, or back to the timeline) starts at the top of the sheet. A
  // post that opens while the hero shows moves the sheet up, so the post has the whole screen.
  useEffect(() => {
    const onHash = () => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const top = coverDistance();
      if (scroller.scrollTop > top) scroller.scrollTo({ top });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <div className="ss-page ss-spa" ref={pageRef} style={fieldStyle}>
        <div className="ss-ground" aria-hidden="true">
          {/* While the sheet is at the nav, only the nav's strip of the field shows: it holds still. */}
          <GrainField field={field} pace={HERO_FIELD_PACE} playing={!docked} />
          {/* NEAR's N, big and faint, behind the right side of the hero. */}
          <NearMark className="ss-ground-near" />
        </div>
        <header className="ss-nav">
          <div className="ss-nav-inner">
            {/* One pill: the name, then the round picture of the hero's field, which opens the theme menu. */}
            <div className="ss-brand-pill">
              <a className="ss-brand" href="/">
                <BrandMark size={24} />
                Speak-to-Sign
              </a>
              <ThemePicker />
            </div>
            {/* The setup steps again, for the time that the sheet covers the hero and its strip.
                They show until every step is done, so the wallet setup is always in reach. */}
            <div className="ss-nav-setup" data-shown={covered || undefined} inert={!covered} aria-label="Set up">
              {seams ? <SeamsOnboarding onSignIn={() => setSignIn(true)} /> : <KeylessOnboarding />}
            </div>
            <a className="ss-near" href={NEAR_URL} target="_blank" rel="noopener noreferrer" aria-label="Built on NEAR">
              <span className="ss-near-words">Built on</span>
              <NearWordmark />
            </a>
            <a className="ss-seams" href={SEAMS_URL} target="_blank" rel="noopener noreferrer" aria-label="Seams Wallet">
              <SeamsWordmark className="ss-seams-wordmark" />
              <SeamsMark className="ss-seams-mark" />
            </a>
            <a className="ss-nav-link ss-nav-source" href={SOURCE_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
              <IconBrandGithub size={17} stroke={1.9} aria-hidden="true" />
              <span>GitHub</span>
            </a>
          </div>
        </header>

        <div className="ss-scroll" ref={scrollRef}>
        <section className="ss-hero" ref={heroRef} aria-labelledby="hero-title">
          <div className="ss-hero-inner">
            <div className="ss-hero-text">
              <h1 id="hero-title" className="ss-hero-title">
                Sign with your voice.
              </h1>
              <p className="ss-hero-sub">
                Say the request. Your Seams Wallet signs only when the voice is yours and the words match. No confirm tap, and you cannot sign
                what you did not say.
              </p>
            </div>
          </div>
          {/* The multisig page sends a visitor here (#setup) to set up the voice and get testnet NEAR. */}
          <div className="ss-setup-strip" id="setup" aria-label="Set up">
            {seams ? <SeamsOnboarding onSignIn={() => setSignIn(true)} /> : <KeylessOnboarding />}
          </div>
        </section>

        <main className="ss-sheet" ref={sheetRef} aria-label="Community Notes">
          <div className="ss-sheet-app">
            <LiveSlot id="notes" />
          </div>
        </main>
        </div>
      </div>

      <LiveApps page="notes" seams={seams} onMultisigSignIn={() => setSignIn(true)} />
      {seams && signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />}
    </>
  );
}
