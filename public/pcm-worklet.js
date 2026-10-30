// Audio worklet for real-time voice: forwards raw microphone frames to the
// page, which downsamples them to 16 kHz PCM for the voice provider. Served
// as a static file so the Content-Security-Policy can stay script-src 'self'.
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("navi-capture", Capture);
