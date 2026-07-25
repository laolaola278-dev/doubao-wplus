// DWPLUS Speech Recognition Engine
// This file is compiled by WXT and injected into the MAIN world via
// <script src="chrome-extension://..."> to bypass page CSP restrictions.
export default defineUnlistedScript(() => {
  if ((window as any).__dwplusSpeechEngineInstalled) return;
  (window as any).__dwplusSpeechEngineInstalled = true;

  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return;

  let recognition: any = null;
  let active = false;

  function ensureRecognition(): any {
    if (recognition) return recognition;
    recognition = new SR();
    recognition.lang = navigator.language || 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        window.dispatchEvent(new CustomEvent('dwplus-speech-interim', { detail: { text: interim } }));
      }
      if (final) {
        window.dispatchEvent(new CustomEvent('dwplus-speech-final', { detail: { text: final } }));
      }
    };

    recognition.onerror = (event: any) => {
      window.dispatchEvent(new CustomEvent('dwplus-speech-error', { detail: { error: event.error } }));
      active = false;
    };

    recognition.onend = () => {
      window.dispatchEvent(new CustomEvent('dwplus-speech-ended'));
      active = false;
    };

    return recognition;
  }

  window.addEventListener('dwplus-speech-start', () => {
    try {
      const r = ensureRecognition();
      if (active) { r.stop(); }
      active = true;
      r.start();
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('dwplus-speech-error', { detail: { error: e.message } }));
      active = false;
    }
  });

  window.addEventListener('dwplus-speech-stop', () => {
    if (recognition && active) {
      recognition.stop();
      active = false;
    }
  });
});
