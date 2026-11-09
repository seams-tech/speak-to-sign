import { useState } from 'react';
import { IconArrowUpRight, IconCheck } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { config } from '../config';
import { EXAMPLES, type ExampleId, type VoiceExample } from './examples';
import { BrowserFrame, ScaledScreen, Waveform } from './frame';
import { MergeScreen, MultisigScreen } from './screens';

const SOURCE_URL = 'https://github.com/seams-tech/speak-to-sign';
const NOTES_PATH = '/notes/';

export function Showcase() {
  return (
    <>
      <header className="sc-header">
        <a className="sc-brand" href="/">
          <BrandMark size={28} />
          Speak-to-Sign
        </a>
        <nav className="sc-nav" aria-label="Page">
          <a href="#apps">Applications</a>
          <a href="#how">How it works</a>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Source
          </a>
          <a className="sc-btn sc-btn-dark sc-btn-sm" href={NOTES_PATH}>
            Open the demo
          </a>
        </nav>
      </header>
      <main>
        <Hero />
        <Apps />
        <How />
      </main>
      <footer className="sc-footer">
        <p>
          Speak-to-Sign by Seams. A demo for the NEAR Hackathon on NEAR testnet. Also on this site:{' '}
          <a href={NOTES_PATH}>Community Notes</a> and <a href={config.payPath}>Speak to pay</a>.
        </p>
        <p>
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            github.com/seams-tech/speak-to-sign
          </a>
        </p>
      </footer>
    </>
  );
}

function Hero() {
  return (
    <section className="sc-hero">
      <div className="sc-hero-text">
        <p className="sc-eyebrow">VoiceID · Seams Wallet · NEAR testnet</p>
        <h1>
          <span className="sc-h1-mark">
            <BrandMark size={40} />
          </span>
          Speak-to-Sign
        </h1>
        <p className="sc-lede">
          Say what you approve. An attested verifier checks that it is your voice and your words. Then your wallet signs that
          one request, with no confirm tap.
        </p>
        <div className="sc-actions">
          <a className="sc-btn sc-btn-dark" href={NOTES_PATH}>
            Try Community Notes →
          </a>
          <a className="sc-btn" href="#how">
            How a voice signs ↓
          </a>
        </div>
        <p className="sc-fine">Testnet only. You need a Seams Wallet with VoiceID and a microphone.</p>
      </div>
      <VoiceCard />
    </section>
  );
}

/** The hero figure: the Wallet's voice card for one example, with chips that switch the example. */
function VoiceCard() {
  const [id, setId] = useState<ExampleId>('notes');
  const example = EXAMPLES.find((candidate) => candidate.id === id) ?? EXAMPLES[0];
  if (!example) return null;
  return (
    <div className="sc-card sc-voice">
      <div className="sc-chips" role="group" aria-label="Example">
        {EXAMPLES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`sc-chip ${candidate.id === id ? 'sc-chip-on' : ''}`}
            aria-pressed={candidate.id === id}
            onClick={() => setId(candidate.id)}
          >
            {candidate.chip}
          </button>
        ))}
      </div>
      <div className="sc-voice-body" key={example.id}>
        <p className="sc-label">The Wallet asks you to say</p>
        <p className="sc-voice-say">“{example.say}”</p>
        <Waveform />
        <ul className="sc-checks">
          <li style={{ animationDelay: '0.5s' }}>
            <IconCheck size={16} stroke={3} /> Same speaker as your VoiceID
          </li>
          <li style={{ animationDelay: '1s' }}>
            <IconCheck size={16} stroke={3} /> The words match the request
          </li>
          <li style={{ animationDelay: '1.5s' }}>
            <IconCheck size={16} stroke={3} /> Verdict signed in the TEE, valid for 120 s
          </li>
        </ul>
        <div className="sc-signs" style={{ animationDelay: '2s' }}>
          <p className="sc-label">Then the Wallet signs</p>
          <code>{example.signs}</code>
          <span className="sc-target">{example.target}</span>
        </div>
      </div>
      <span className={`sc-status sc-status-${example.status}`}>{example.status === 'live' ? 'Live on testnet' : 'Concept'}</span>
    </div>
  );
}

function Apps() {
  return (
    <section className="sc-section" id="apps" aria-labelledby="apps-title">
      <h2 id="apps-title">One sentence spoken, one call signed</h2>
      <p className="sc-section-lede">
        Each app shows one typed request. You read it aloud. The Wallet signs only that request, and only for two minutes.
      </p>
      <div className="sc-apps">
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
    <article className={`sc-app ${flip ? 'sc-app-flip' : ''}`} aria-labelledby={`app-${example.id}`}>
      <div className="sc-app-text">
        <div className="sc-app-title">
          <h3 id={`app-${example.id}`}>{example.title}</h3>
          <span className={`sc-status sc-status-${example.status}`}>{live ? 'Live on testnet' : 'Concept'}</span>
        </div>
        <div className="sc-card sc-prompt">
          <p className="sc-label">You say</p>
          <p className="sc-prompt-say">{example.say}</p>
        </div>
        <p className="sc-arrow" aria-hidden="true">
          ↓
        </p>
        <div className="sc-card sc-result">
          <p className="sc-label">The Wallet signs</p>
          <code>{example.signs}</code>
          <span className="sc-target">{example.target}</span>
        </div>
        <p className="sc-app-blurb">{example.blurb}</p>
        {live && example.href ? (
          <a className="sc-btn sc-btn-dark" href={example.href}>
            Open the live demo <IconArrowUpRight size={16} stroke={2} aria-hidden="true" />
          </a>
        ) : (
          <p className="sc-fine">A drawn screen. Not built yet.</p>
        )}
      </div>
      <div className="sc-app-screen">
        <BrowserFrame url={live ? `${window.location.host}${example.href ?? ''}` : example.url}>
          {example.id === 'notes' && <LiveNotesScreen />}
          {example.id === 'merge' && (
            <ScaledScreen width={1100} height={688}>
              <MergeScreen say={example.say} />
            </ScaledScreen>
          )}
          {example.id === 'multisig' && (
            <ScaledScreen width={1100} height={688}>
              <MultisigScreen say={example.say} />
            </ScaledScreen>
          )}
        </BrowserFrame>
      </div>
    </article>
  );
}

/** The real Community Notes app in a small window. A click opens it full size. */
function LiveNotesScreen() {
  return (
    <div className="sc-live">
      <ScaledScreen>
        <iframe className="sc-live-frame" src={`${NOTES_PATH}#/`} title="Community Notes demo, live preview" loading="lazy" tabIndex={-1} />
      </ScaledScreen>
      <a className="sc-live-open" href={NOTES_PATH}>
        <span className="sc-btn sc-btn-dark sc-btn-sm">
          Open the demo <IconArrowUpRight size={14} stroke={2} aria-hidden="true" />
        </span>
      </a>
    </div>
  );
}

function How() {
  return (
    <section className="sc-section" id="how" aria-labelledby="how-title">
      <h2 id="how-title">How a voice signs</h2>
      <p className="sc-section-lede">Three steps, a few seconds. You see one sentence and you say it.</p>
      <ol className="sc-steps">
        <li className="sc-card sc-step">
          <span className="sc-step-num">1</span>
          <h3>Speak</h3>
          <p>
            The Wallet turns one typed request into a short sentence. You read it aloud. The Wallet records the clip with that
            request.
          </p>
        </li>
        <li className="sc-card sc-step">
          <span className="sc-step-num">2</span>
          <h3>Verify · Biometric CAPTCHA</h3>
          <p>
            An attested verifier in a TEE compares your voice with your enrolled VoiceID and the words with the request. It signs
            a verdict that expires after 120 seconds.
          </p>
        </li>
        <li className="sc-card sc-step">
          <span className="sc-step-num">3</span>
          <h3>Sign · Spoken Lease</h3>
          <p>
            Wallet core checks the verdict against the key that it pins. Then it signs that one call from your own account. The
            lease covers nothing else.
          </p>
        </li>
      </ol>
      <p className="sc-limits">
        Limits: testnet only. A good voice clone on a compromised device can pass, because this build has no liveness check.
        A policy rule can still ask for a passkey.
      </p>
    </section>
  );
}
