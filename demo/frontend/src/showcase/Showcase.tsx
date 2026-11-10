import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconArrowRight, IconArrowUpRight, IconChevronRight } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { config } from '../config';
import { paths } from '../router';
import { EXAMPLES, PAGE_PATH, type ExampleId, type VoiceExample } from './examples';
import { BrowserChrome, DrawnFrame, FitScreen, ScaledScreen } from './frame';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';
import { MultisigScreen } from './screens';
import { ExampleWindow } from './window';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';

// Two pages, one per example: Community Notes at / and the voice multisig at /multisig/. On its
// page, the hash names the open window: #/notes (and the notes app's own pages under it) on /,
// #/multisig on /multisig/. No hash: no window.

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash);
}

function exampleFromHash(hash: string): ExampleId | null {
  const match = /^#\/(notes|multisig)(?:\/|$)/.exec(hash);
  return match ? (match[1] as ExampleId) : null;
}

// The notes window opens on the post page, where the demo starts.
const openHash = (id: ExampleId) => (id === 'notes' ? paths.timeline : `#/${id}`);

function closeWindow() {
  if (!exampleFromHash(window.location.hash)) return;
  history.pushState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * A page of the Speak-to-Sign site, in the style of the Seams Wallet site: the intro of its
 * example, the setup card and the example. `seams`: a Seams publishable key is set.
 */
export function Showcase({ seams, page }: { seams: boolean; page: ExampleId }) {
  const hash = useHash();
  // Only the page's own example opens here.
  const routed = exampleFromHash(hash) === page ? page : null;
  const [shown, setShown] = useState<ExampleId | null>(routed);
  // The sign-in dialog, with the line that says what the wallet signs here.
  const [signIn, setSignIn] = useState(false);
  const closing = shown !== null && routed !== shown;

  useEffect(() => {
    if (shown === null && routed) setShown(routed);
  }, [routed, shown]);

  const onExited = () => {
    const id = shown;
    setShown(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-example-open="${id}"]`)?.focus({ preventScroll: true }));
  };

  const open = EXAMPLES.find((example) => example.id === shown);
  const example = EXAMPLES.find((item) => item.id === page);
  if (!example) throw new Error(`The site has no example "${page}".`);
  const others = EXAMPLES.filter((item) => item.id !== page);

  return (
    <>
      <div className="ss-page" inert={shown !== null}>
        <header className="ss-nav">
          <div className="ss-nav-inner">
            <a className="ss-brand" href="/">
              <BrandMark size={24} />
              Speak-to-Sign
            </a>
            <nav className="ss-nav-pages" aria-label="Examples">
              {EXAMPLES.map((item) => (
                <a key={item.id} className="ss-nav-page" href={PAGE_PATH[item.id]} aria-current={item.id === page ? 'page' : undefined}>
                  {PAGE_LABEL[item.id]}
                </a>
              ))}
            </nav>
            <a className="ss-nav-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a className="ss-btn ss-btn-primary ss-btn-sm" href={openHash(page)}>
              Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
            </a>
          </div>
        </header>
        <main className="ss-col">
          <Intro page={page} seams={seams} onSignIn={() => setSignIn(true)} />
          <section className="ss-section ss-rule" aria-label="Example">
            <AppRow example={example} seams={seams} away={shown === example.id} />
          </section>
          {others.map((other) => (
            <OtherExample key={other.id} example={other} />
          ))}
        </main>
        <footer className="ss-footer">
          <div className="ss-footer-inner">
            <span>Speak-to-Sign by Seams · NEAR testnet only</span>
            <span className="ss-footer-links">
              {EXAMPLES.map((item) => (
                <a key={item.id} href={PAGE_PATH[item.id]}>
                  {PAGE_LABEL[item.id]}
                </a>
              ))}
              <a href={config.payPath}>Speak to pay</a>
            </span>
          </div>
        </footer>
      </div>

      {open && (
        <ExampleWindow
          key={open.id}
          id={open.id}
          title={open.title}
          tag={tagOf(open)}
          tone={open.status === 'live' ? 'live' : 'example'}
          url={open.url}
          closing={closing}
          onClose={closeWindow}
          onExited={onExited}
        >
          <WindowScreen example={open} seams={seams} />
        </ExampleWindow>
      )}

      <LiveApps page={page} seams={seams} onMultisigSignIn={() => setSignIn(true)} />
      {seams && signIn && <SignInModal onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />}
    </>
  );
}

function tagOf(example: VoiceExample): string {
  return example.status === 'live' ? 'Live on testnet' : 'Example';
}

/** The name of each page, in the nav and the footer. */
export const PAGE_LABEL: Record<ExampleId, string> = {
  notes: 'Community Notes',
  multisig: 'Voice multisig',
};

interface IntroCopy {
  title: string;
  sub: string;
  steps: { lead: string; text: string }[];
}

/** What Speak-to-Sign does on each page, in three steps. */
const INTRO: Record<ExampleId, IntroCopy> = {
  notes: {
    title: 'Sign with your voice.',
    sub: 'Speak-to-Sign lets you approve a wallet request by saying it. Your Seams Wallet signs only when the voice is yours and the words match the request.',
    steps: [
      { lead: 'Say the request.', text: 'The Wallet shows one short sentence, for example “this note is helpful”.' },
      { lead: 'A verifier checks it.', text: 'It hears that the account owner speaks, and that the words match the request.' },
      { lead: 'Your wallet signs that one call.', text: 'No confirm tap. The permission ends after two minutes.' },
    ],
  },
  multisig: {
    title: 'Moderate notes by voice.',
    sub: 'Readers reported some community notes as harmful. A NEAR multisig is the moderator: you propose to hide a note by saying it, and two admins approve. No single key can hide a note, and you cannot blind-sign what you must read aloud.',
    steps: [
      { lead: 'Say the proposal.', text: 'Pick a reported note. The page shows one sentence, for example “approve proposal twelve, hide note forty two”.' },
      { lead: 'A verifier checks it.', text: 'It hears that the account owner speaks, and that the words match the proposal.' },
      { lead: 'The admins approve.', text: 'Your wallet signs the proposal. Then two admins approve it, and the multisig hides the note.' },
    ],
  },
};

/** What Speak-to-Sign does on this page, in three steps, and the setup card. */
function Intro({ page, seams, onSignIn }: { page: ExampleId; seams: boolean; onSignIn: () => void }) {
  const copy = INTRO[page];
  return (
    <section className="ss-intro" aria-labelledby="intro-title">
      <div className="ss-intro-text">
        <h1 id="intro-title" className="ss-display">
          {copy.title}
        </h1>
        <p className="ss-sub">{copy.sub}</p>
        <ol className="ss-how">
          {copy.steps.map((step) => (
            <li key={step.lead}>
              <b>{step.lead}</b> {step.text}
            </li>
          ))}
        </ol>
      </div>
      {/* The multisig window sends a visitor here (#setup) to set up the voice and get testnet NEAR. */}
      <div className="ss-setup-card" id="setup">
        <div className="ss-setup-head">
          <h2 className="ss-setup-title">Set up</h2>
          <span className="ss-setup-sub">Optional · NEAR testnet</span>
        </div>
        {seams ? <SeamsOnboarding onSignIn={onSignIn} /> : <KeylessOnboarding />}
        <a className="ss-btn ss-btn-primary ss-setup-go" href={openHash(page)}>
          Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

/** The page's application: a title, one line and its small screen. A click on the screen opens the window. */
function AppRow({ example, seams, away }: { example: VoiceExample; seams: boolean; away: boolean }) {
  const live = example.status === 'live';
  return (
    <article className="ss-app" aria-labelledby={`app-${example.id}`}>
      <div className="ss-app-text">
        <h3 id={`app-${example.id}`}>{example.title}</h3>
        <p className="ss-app-blurb">{example.blurb}</p>
        {live && (
          <a className="ss-btn ss-btn-primary" href={openHash(example.id)}>
            Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="ss-app-screen" data-example-screen={example.id}>
        <DrawnFrame tag={tagOf(example)} tone={live ? 'live' : 'example'}>
          <BrowserChrome url={example.url}>
            <div className="ss-preview" inert>
              <SmallScreen example={example} seams={seams} away={away} />
            </div>
          </BrowserChrome>
        </DrawnFrame>
        <a className="ss-preview-open" href={openHash(example.id)} data-example-open={example.id} aria-label={`Open ${example.title}`}>
          <span className="ss-btn ss-btn-primary ss-btn-sm">
            {live ? 'Try it' : 'Open'} <IconArrowUpRight size={14} stroke={2.2} aria-hidden="true" />
          </span>
        </a>
      </div>
    </article>
  );
}

/** A link to the page of another example. */
function OtherExample({ example }: { example: VoiceExample }) {
  return (
    <section className="ss-section ss-rule ss-other" aria-labelledby={`other-${example.id}`}>
      <a className="ss-other-card" href={PAGE_PATH[example.id]}>
        <span className="ss-other-kicker">Another example</span>
        <span id={`other-${example.id}`} className="ss-other-title">
          {example.title}
        </span>
        <span className="ss-other-blurb">{example.blurb}</span>
        <span className="ss-other-go">
          Open the example <IconArrowRight size={15} stroke={2.2} aria-hidden="true" />
        </span>
      </a>
    </section>
  );
}

/** The screen in a row. `away`: the live app is in the window now. */
function SmallScreen({ example, seams, away }: { example: VoiceExample; seams: boolean; away: boolean }) {
  if (example.id === 'notes') {
    return (
      <ScaledScreen width={960} height={680}>
        <LiveSlot id="notes" active={!away} />
      </ScaledScreen>
    );
  }
  return (
    <ScaledScreen width={1120} height={700}>
      {seams ? <LiveSlot id="multisig" active={!away} /> : <MultisigScreen />}
    </ScaledScreen>
  );
}

/** The screen in the window: the notes app at its full size; the drawn screens fit the window. */
function WindowScreen({ example, seams }: { example: VoiceExample; seams: boolean }) {
  if (example.id === 'notes') return <LiveSlot id="notes" />;
  return (
    <FitScreen width={1120} height={700}>
      {seams ? <LiveSlot id="multisig" /> : <MultisigScreen />}
    </FitScreen>
  );
}
