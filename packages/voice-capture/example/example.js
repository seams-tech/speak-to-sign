// The example of @seams/voice-capture: one sentence on the phrase card, and three enrollment
// phrases. It imports the built single-file package, so it needs no bundler.

import { configureVoiceCapture, pcm16Wav, SAMPLE_RATE } from '../browser/index.js';
import { openPhraseCard } from '../browser/card.js';

configureVoiceCapture({ assetBase: '../assets/' });

const ENROLLMENT_PHRASES = [
  'My voice is my signature for this wallet.',
  'I send money only when I say so.',
  'Seams, please learn how I sound today.',
];

const log = document.querySelector('#log');
const parent = document.querySelector('#card');
const detector = () => (document.querySelector('#level').checked ? 'level' : 'model');

/** Shows one sentence, records it and returns its WAV, or null when the person closed the card. */
async function recordSentence(sentence, signal) {
  const surface = openPhraseCard({ sentence, signal, detector: detector(), frame: { parent } });
  try {
    const recording = await surface.record();
    if (recording.kind === 'cancelled') return null;
    const seconds = recording.samples.length / SAMPLE_RATE;
    const wav = pcm16Wav(recording.samples);
    // The caller owns the samples: clear them after use.
    recording.samples.fill(0);
    // An application sends the WAV to its verifier here, and shows the answer on the same card.
    void surface.show({
      kind: 'check',
      label: 'Checking',
      caption: 'Your application checks the recording',
      details: ['This example checks nothing.'],
      segments: ['done', 'run'],
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await surface.show({
      kind: 'result',
      label: '',
      headline: 'Recorded',
      caption: sentence,
      detail: `${seconds.toFixed(1)} s, ${wav.length} bytes of WAV`,
      action: { label: 'Done' },
      line: 'seal',
    });
    return { seconds, bytes: wav.length };
  } finally {
    surface.close();
  }
}

document.querySelector('#sentence').addEventListener('click', async () => {
  const result = await recordSentence('Send two NEAR to alice.testnet', new AbortController().signal);
  log.textContent = result
    ? `One sentence: ${result.seconds.toFixed(1)} s, ${result.bytes} bytes.`
    : 'The recording was cancelled.';
});

document.querySelector('#enroll').addEventListener('click', async () => {
  const lines = [];
  for (const phrase of ENROLLMENT_PHRASES) {
    const result = await recordSentence(phrase, new AbortController().signal);
    if (!result) {
      lines.push('The enrollment was cancelled.');
      break;
    }
    lines.push(`"${phrase}": ${result.seconds.toFixed(1)} s, ${result.bytes} bytes.`);
  }
  log.textContent = lines.join('\n');
});
