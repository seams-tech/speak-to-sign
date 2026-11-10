// A plain recorder for this example only. It is not a library.
//
// The capture library of this repository is `@seams/voice-capture` (speech detection, the end
// at a pause, a quality check). It is not on this branch yet. When it is, this file goes away
// and the page uses `recordVoice` and `pcm16Wav` of that package.

const SAMPLE_RATE = 16_000;
const MAX_MS = 8_000;

/** Starts a recording. `stop()` gives a 16 kHz mono PCM16 WAV as standard base64. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
  const end = () => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const timer = setTimeout(end, MAX_MS);
  recorder.start();
  return {
    async stop() {
      clearTimeout(timer);
      end();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const encoded = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      return base64(wav(await resample(encoded)));
    },
  };
}

/** Decodes the recording and resamples it to 16 kHz mono, at most 8 s. */
async function resample(encoded) {
  const decoder = new AudioContext();
  let decoded;
  try {
    decoded = await decoder.decodeAudioData(encoded);
  } finally {
    await decoder.close();
  }
  const length = Math.min(Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), (MAX_MS / 1000) * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

/** A WAV with a 44-byte header: 16 kHz, mono, PCM16. */
function wav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, Math.round(value < 0 ? value * 32_768 : value * 32_767), true);
  });
  return bytes;
}

function base64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
