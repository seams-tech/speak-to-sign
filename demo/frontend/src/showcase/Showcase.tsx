import { IconArrowUpRight, IconChevronRight } from '@tabler/icons-react';
import { BrandMark } from '../components/BrandMark';
import { config } from '../config';
import { EXAMPLES, type VoiceExample } from './examples';
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
          <a className="ss-nav-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a className="ss-btn ss-btn-primary ss-btn-sm" href={NOTES_PATH}>
            Try the demo <IconChevronRight size={15} stroke={2.4} aria-hidden="true" />
          </a>
        </div>
      </header>
      <main className="ss-col">
        <Hero />
        <Apps />
      </main>
      <footer className="ss-footer">
        <div className="ss-footer-inner">
          <span>Speak-to-Sign by Seams · NEAR testnet only</span>
          <span className="ss-footer-links">
            <a href={NOTES_PATH}>Community Notes</a>
            <a href={config.payPath}>Speak to pay</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section className="ss-hero" aria-labelledby="hero-title">
      <div className="ss-hero-main">
        <h1 id="hero-title" className="ss-display">
          Say what you approve.
          <br />
          Your wallet signs it.
        </h1>
        <p className="ss-sub">A verifier checks your voice and your words. Then your wallet signs that one request.</p>
        <div className="ss-ctas">
          <a className="ss-btn ss-btn-primary ss-btn-lg" href={NOTES_PATH}>
            Try the demo <IconChevronRight size={16} stroke={2.4} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="ss-hero-demo">
        <div className="ss-grain" aria-hidden="true" />
        <div className="ss-hero-stage">
          <WalletVoiceCard say="this note is helpful" />
        </div>
      </div>
    </section>
  );
}

function Apps() {
  return (
    <section className="ss-section ss-rule" aria-labelledby="apps-title">
      <h2 id="apps-title" className="ss-display ss-section-title">
        One sentence, one signature.
      </h2>
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
    <article className={`ss-app ${flip ? 'ss-app-flip' : ''}`} aria-labelledby={`app-${example.id}`}>
      <div className="ss-app-text">
        <h3 id={`app-${example.id}`}>{example.title}</h3>
        <p className="ss-app-blurb">{example.blurb}</p>
        {live && example.href && (
          <a className="ss-btn ss-btn-primary" href={example.href}>
            Open the demo <IconArrowUpRight size={15} stroke={2.2} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="ss-app-screen">
        <DrawnFrame tag={live ? 'Live on testnet' : 'Example'} tone={live ? 'live' : 'example'}>
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
