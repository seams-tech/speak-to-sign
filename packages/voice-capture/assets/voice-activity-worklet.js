class VoiceActivityFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.frame[this.offset++] = sample;
      if (this.offset === 512) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(512);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-activity-frames', VoiceActivityFrames);
