import { useState } from 'react';
import { IconArrowUpRight, IconCheck, IconChevronRight } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { config } from '../config';
import { EXAMPLES, type ExampleId, type VoiceExample } from './examples';
import { BrowserChrome, DrawnFrame, ScaledScreen, WalletVoiceCard } from './frame';
import { MergeScreen, MultisigScreen } from './screens';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
const NOTES_PATH = '/notes/';

/** The Speak-to-Sign page, in the style of the Seams Wallet site. */
export function Showcase() {
  return (
    <div className="ss-page">
      <header className="ss-nav">
        <div className="ss-nav-inner">
          <a className="ss-brand" href="/">
            <BrandMark size={24} />
            Speak-to-Sign
          </a>
          <nav className="ss-nav-links" aria-label="Page">
            <a href="#apps">Applications</a>
            <a href="#how">How it works</a>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          </nav>
          <a className="ss-btn ss-btn-primary ss-btn-sm" href={NOTES_PATH}>
            Open the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
          </a>
        </div>
      </header>
      <main className="ss-col">
        <Hero />
        <Apps />
        <How />
        <Limits />
      </main>
      <footer className="ss-footer">
        <div className="ss-footer-inner">
          <span className="ss-brand ss-brand-sm">
            <BrandMark size={18} />
            Speak-to-Sign by Seams
          </span>
          <span>A demo for the NEAR Hackathon, on NEAR testnet.</span>
          <span className="ss-footer-links">
            <a href={NOTES_PATH}>Community Notes</a>
            <a href={config.payPath}>Speak to pay</a>
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  const [id, setId] = useState<ExampleId>('notes');
  const example = EXAMPLES.find((candidate) => candidate.id === id) ?? EXAMPLES[0];
  if (!example) return null;
  return (
    <section className="ss-hero" aria-labelledby="hero-title">
      <div className="ss-hero-main">
        <p className="ss-kicker">Seams · Speak-to-Sign</p>
        <h1 id="hero-title" className="ss-display">
          Say what you approve.
          <br />
          Your wallet signs it.
        </h1>
        <p className="ss-sub">
          An attested verifier checks that it is your voice and your words. Then your Seams Wallet signs that one request from
          your own account, with no confirm tap.
        </p>
        <div className="ss-ctas">
          <a className="ss-btn ss-btn-primary ss-btn-lg" href={NOTES_PATH}>
            Try Community Notes <IconChevronRight size={16} stroke={2.4} aria-hidden="true" />
          </a>
          <a className="ss-btn ss-btn-outline ss-btn-lg" href="#how">
            How a voice signs <IconChevronRight size={16} stroke={2.4} aria-hidden="true" />
          </a>
        </div>
        <div className="ss-forks">
          <a href="#app-notes">
            <i className="ss-fork-dot ss-fork-live" /> Community Notes
          </a>
          <a href="#app-merge">
            <i className="ss-fork-dot" /> Pull requests
          </a>
          <a href="#app-multisig">
            <i className="ss-fork-dot" /> Multisig
          </a>
        </div>
        <p className="ss-note">Testnet only. You need a Seams Wallet with VoiceID and a microphone.</p>
      </div>
      <div className="ss-hero-demo">
        <div className="ss-grain" aria-hidden="true" />
        <div className="ss-hero-stage" key={example.id}>
          <WalletVoiceCard say={example.say} />
          <div className="ss-hero-result">
            <ul className="ss-checks">
              <li>
                <IconCheck size={14} stroke={3} /> Same speaker as your VoiceID
              </li>
              <li>
                <IconCheck size={14} stroke={3} /> The words match the request
              </li>
              <li>
                <IconCheck size={14} stroke={3} /> Verdict signed in the TEE, valid for 120 s
              </li>
            </ul>
            <p className="ss-mini-label">Then the Wallet signs</p>
            <code>{example.signs}</code>
          </div>
        </div>
        <div className="ss-switch" role="group" aria-label="Example">
          {EXAMPLES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`ss-switch-chip ${candidate.id === id ? 'ss-switch-on' : ''}`}
              aria-pressed={candidate.id === id}
              onClick={() => setId(candidate.id)}
            >
              <i className={`ss-fork-dot ${candidate.status === 'live' ? 'ss-fork-live' : ''}`} />
              {candidate.chip}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Apps() {
  return (
    <section className="ss-section ss-rule" id="apps" aria-labelledby="apps-title">
      <div className="ss-section-head">
        <p className="ss-kicker">Applications</p>
        <h2 id="apps-title" className="ss-display">
          One sentence spoken,
          <br />
          one call signed.
        </h2>
        <p className="ss-sub">
          Each app shows one typed request. You read it aloud. The Wallet signs only that request, and only for two minutes.
        </p>
      </div>
      <div className="ss-apps">
        {EXAMPLES.map((example, index) => (
          <AppRow key={example.id} example={example} flip={index % 2 === 1} />
        ))}
      </div>
    </section>
  );
}

function AppRow({ example, flip }: { example: VoiceExample; flip: boolean }) {
  const live = example.status === 'live';
  return (
    <article className={`ss-app ${flip ? 'ss-app-flip' : ''}`} id={`app-${example.id}`} aria-labelledby={`app-${example.id}-title`}>
      <div className="ss-app-text">
        <p className={`ss-tag ${live ? 'ss-tag-live' : ''}`}>{live ? 'Live on NEAR testnet' : 'Concept'}</p>
        <h3 id={`app-${example.id}-title`}>{example.title}</h3>
        <p className="ss-app-blurb">{example.blurb}</p>
        <div className="ss-flow">
          <div className="ss-flow-step">
            <p className="ss-mini-label">You say</p>
            <p className="ss-flow-say">“{example.say}”</p>
          </div>
          <div className="ss-flow-step">
            <p className="ss-mini-label">The Wallet signs</p>
            <code>{example.signs}</code>
            <span className="ss-flow-target">{example.target}</span>
          </div>
        </div>
        {live && example.href ? (
          <a className="ss-btn ss-btn-primary" href={example.href}>
            Open the live demo <IconArrowUpRight size={15} stroke={2.2} aria-hidden="true" />
          </a>
        ) : (
          <p className="ss-note">A drawn example. Not built yet.</p>
        )}
      </div>
      <div className="ss-app-screen">
        <DrawnFrame tag={live ? 'Live demo · NEAR testnet' : 'Example · drawn screen'} tone={live ? 'live' : 'example'}>
          <BrowserChrome url={live ? `${window.location.host}${example.href ?? ''}` : example.url}>
            {example.id === 'notes' && <LiveNotesScreen />}
            {example.id === 'merge' && (
              <ScaledScreen width={1120} height={700}>
                <MergeScreen say={example.say} />
              </ScaledScreen>
            )}
            {example.id === 'multisig' && (
              <ScaledScreen width={1120} height={700}>
                <MultisigScreen say={example.say} />
              </ScaledScreen>
            )}
          </BrowserChrome>
        </DrawnFrame>
      </div>
    </article>
  );
}

/** The real Community Notes app (an X-style page) in a small window. A click opens it full size. */
function LiveNotesScreen() {
  return (
    <div className="ss-live">
      <ScaledScreen width={1280} height={800}>
        <iframe className="ss-live-frame" src={`${NOTES_PATH}#/`} title="Community Notes demo, live preview" loading="lazy" tabIndex={-1} />
      </ScaledScreen>
      <a className="ss-live-open" href={NOTES_PATH} aria-label="Open the Community Notes demo">
        <span className="ss-btn ss-btn-primary ss-btn-sm">
          Open the demo <IconArrowUpRight size={14} stroke={2.2} aria-hidden="true" />
        </span>
      </a>
    </div>
  );
}

const STEPS = [
  {
    title: 'Speak',
    pitch: null,
    text: 'The Wallet turns one typed request into a short sentence. You read it aloud, and the Wallet records the clip with that request.',
  },
  {
    title: 'Verify',
    pitch: 'Biometric CAPTCHA',
    text: 'An attested verifier in a TEE compares your voice with your enrolled VoiceID, and the words with the request. It signs a verdict that expires after 120 seconds.',
  },
  {
    title: 'Sign',
    pitch: 'Spoken Lease',
    text: 'Wallet core checks the verdict against the key that it pins. Then it signs that one call from your own account. The lease covers nothing else.',
  },
];

function How() {
  return (
    <section className="ss-section ss-rule" id="how" aria-labelledby="how-title">
      <div className="ss-section-head">
        <p className="ss-kicker">How it works</p>
        <h2 id="how-title" className="ss-display">
          How a voice signs
        </h2>
        <p className="ss-sub">Three steps, a few seconds. You see one sentence, and you say it.</p>
      </div>
      <ol className="ss-pillars">
        {STEPS.map((step, index) => (
          <li key={step.title} className="ss-pillar">
            <span className="ss-pillar-num">0{index + 1}</span>
            <h3>{step.title}</h3>
            {step.pitch && <p className="ss-pitch">{step.pitch}</p>}
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Limits() {
  return (
    <section className="ss-section ss-section-tight ss-rule" aria-labelledby="limits-title">
      <div className="ss-limits">
        <p className="ss-kicker" id="limits-title">
          Limits
        </p>
        <p>
          Testnet only. A good voice clone on a compromised device can pass, because this build has no liveness check. A policy
          rule can still ask for a passkey.
        </p>
      </div>
    </section>
  );
}
