import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconArrowUpRight, IconChevronRight } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { SignInModal } from '../components/SignInModal';
import { config } from '../config';
import { paths, START_POST_ID } from '../router';
import { EXAMPLES, type ExampleId, type VoiceExample } from './examples';
import { BrowserChrome, DrawnFrame, FitScreen, ScaledScreen } from './frame';
import { LiveApps, LiveSlot } from './live';
import { KeylessOnboarding, SeamsOnboarding } from './Onboarding';
import { MergeScreen, MultisigScreen } from './screens';
import { ExampleWindow } from './window';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
const MERGE_INTRO =
  'Your merge approval is signed from your own NEAR testnet account. Use a passkey to sign in, or create a new wallet.';
const MULTISIG_INTRO =
  'Your proposals and approvals are signed from your own NEAR testnet account. Use a passkey to sign in, or create a new wallet.';
const SETUP_INTRO = 'Create a Seams Wallet with a passkey, or sign in to yours. It is a NEAR testnet account.';

// One page. The hash names the open window: #/notes (and the notes app's own pages under it),
// #/merge or #/multisig. No hash: no window.

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function useHash(): string {
  return useSyncExternalStore(subscribeHash, () => window.location.hash);
}

function exampleFromHash(hash: string): ExampleId | null {
  const match = /^#\/(notes|merge|multisig)(?:\/|$)/.exec(hash);
  return match ? (match[1] as ExampleId) : null;
}

// The notes window opens on the post page, where the demo starts.
const openHref = (id: ExampleId) => (id === 'notes' ? paths.post(START_POST_ID) : `#/${id}`);

function closeWindow() {
  if (!exampleFromHash(window.location.hash)) return;
  history.pushState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** The Speak-to-Sign page, in the style of the Seams Wallet site. `seams`: a Seams publishable key is set. */
export function Showcase({ seams }: { seams: boolean }) {
  const hash = useHash();
  const routed = exampleFromHash(hash);
  const [shown, setShown] = useState<ExampleId | null>(routed);
  // The sign-in dialog, with the line that says what the wallet signs here.
  const [signIn, setSignIn] = useState<string | null>(null);
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
  const merge = EXAMPLES.find((example) => example.id === 'merge');

  return (
    <>
      <div className="ss-page" inert={shown !== null}>
        <header className="ss-nav">
          <div className="ss-nav-inner">
            <a className="ss-brand" href="/">
              <BrandMark size={24} />
              Speak-to-Sign
            </a>
            <a className="ss-nav-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a className="ss-btn ss-btn-primary ss-btn-sm" href={openHref('notes')}>
              Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
            </a>
          </div>
        </header>
        <main className="ss-col">
          <Intro seams={seams} onSignIn={() => setSignIn(SETUP_INTRO)} />
          <Apps seams={seams} shown={shown} />
        </main>
        <footer className="ss-footer">
          <div className="ss-footer-inner">
            <span>Speak-to-Sign by Seams · NEAR testnet only</span>
            <span className="ss-footer-links">
              <a href={openHref('notes')}>Community Notes</a>
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

      <LiveApps
        seams={seams}
        mergeSay={merge?.say ?? ''}
        onMergeSignIn={() => setSignIn(MERGE_INTRO)}
        onMultisigSignIn={() => setSignIn(MULTISIG_INTRO)}
      />
      {seams && signIn && <SignInModal intro={signIn} onClose={() => setSignIn(null)} onSignedIn={() => setSignIn(null)} />}
    </>
  );
}

function tagOf(example: VoiceExample): string {
  return example.status === 'live' ? 'Live on testnet' : 'Example';
}

/** What Speak-to-Sign is, in three steps, and the setup card. */
function Intro({ seams, onSignIn }: { seams: boolean; onSignIn: () => void }) {
  return (
    <section className="ss-intro" aria-labelledby="intro-title">
      <div className="ss-intro-text">
        <h1 id="intro-title" className="ss-display">
          Sign with your voice.
        </h1>
        <p className="ss-sub">
          Speak-to-Sign lets you approve a wallet request by saying it. Your Seams Wallet signs only when the voice is
          yours and the words match the request.
        </p>
        <ol className="ss-how">
          <li>
            <b>Say the request.</b> The Wallet shows one short sentence, for example “this note is helpful”.
          </li>
          <li>
            <b>A verifier checks it.</b> It hears that the account owner speaks, and that the words match the request.
          </li>
          <li>
            <b>Your wallet signs that one call.</b> No confirm tap. The permission ends after two minutes.
          </li>
        </ol>
      </div>
      <div className="ss-setup-card">
        <div className="ss-setup-head">
          <h2 className="ss-setup-title">Set up</h2>
          <span className="ss-setup-sub">Once · NEAR testnet</span>
        </div>
        {seams ? <SeamsOnboarding onSignIn={onSignIn} /> : <KeylessOnboarding />}
        <a className="ss-btn ss-btn-primary ss-setup-go" href={openHref('notes')}>
          Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function Apps({ seams, shown }: { seams: boolean; shown: ExampleId | null }) {
  return (
    <section className="ss-section ss-rule" aria-label="Examples">
      <div className="ss-apps">
        {EXAMPLES.map((example, index) => (
          <AppRow key={example.id} example={example} flip={index % 2 === 1} seams={seams} away={shown === example.id} />
        ))}
      </div>
    </section>
  );
}

/** One application: a title, one line and its small screen. A click on the screen opens the window. */
function AppRow({ example, flip, seams, away }: { example: VoiceExample; flip: boolean; seams: boolean; away: boolean }) {
  const live = example.status === 'live';
  return (
    <article className={`ss-app ${flip ? 'ss-app-flip' : ''}`} aria-labelledby={`app-${example.id}`}>
      <div className="ss-app-text">
        <h3 id={`app-${example.id}`}>{example.title}</h3>
        <p className="ss-app-blurb">{example.blurb}</p>
        {live && (
          <a className="ss-btn ss-btn-primary" href={openHref(example.id)}>
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
        <a className="ss-preview-open" href={openHref(example.id)} data-example-open={example.id} aria-label={`Open ${example.title}`}>
          <span className="ss-btn ss-btn-primary ss-btn-sm">
            {live ? 'Try it' : 'Open'} <IconArrowUpRight size={14} stroke={2.2} aria-hidden="true" />
          </span>
        </a>
      </div>
    </article>
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
      {example.id === 'merge' && (seams ? <LiveSlot id="merge" active={!away} /> : <MergeScreen say={example.say} />)}
      {example.id === 'multisig' && (seams ? <LiveSlot id="multisig" active={!away} /> : <MultisigScreen />)}
    </ScaledScreen>
  );
}

/** The screen in the window: the notes app at its full size; the drawn screens fit the window. */
function WindowScreen({ example, seams }: { example: VoiceExample; seams: boolean }) {
  if (example.id === 'notes') return <LiveSlot id="notes" />;
  return (
    <FitScreen width={1120} height={700}>
      {example.id === 'merge' && (seams ? <LiveSlot id="merge" /> : <MergeScreen say={example.say} />)}
      {example.id === 'multisig' && (seams ? <LiveSlot id="multisig" /> : <MultisigScreen />)}
    </FitScreen>
  );
}
