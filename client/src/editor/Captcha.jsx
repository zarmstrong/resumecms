import { useEffect, useRef, useState } from 'react';

const SCRIPT_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
  recaptcha: 'https://www.google.com/recaptcha/api.js',
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function widgetApi(provider) {
  return provider === 'turnstile' ? window.turnstile : window.grecaptcha;
}

// Renders a Cloudflare Turnstile or Google reCAPTCHA v2 widget. Both expose
// the same render(container, { sitekey, callback }) shape, so one component
// covers either provider.
export function Captcha({ provider, siteKey, onToken, resetKey }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScriptReady(false);
    loadScript(SCRIPT_URLS[provider]).then(() => {
      if (!cancelled) setScriptReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current) return undefined;
    const api = widgetApi(provider);
    if (!api) return undefined;

    let cancelled = false;
    function renderWidget() {
      if (cancelled || !containerRef.current) return;
      widgetIdRef.current = api.render(containerRef.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    }

    // reCAPTCHA finishes initializing asynchronously after its script loads;
    // ready() waits for that. Turnstile's render() is safe to call right away.
    if (typeof api.ready === 'function') {
      api.ready(renderWidget);
    } else {
      renderWidget();
    }

    return () => {
      cancelled = true;
      // reCAPTCHA v2 has no remove() — unmounting the container node is
      // enough cleanup for it. Turnstile does support explicit removal.
      if (typeof api.remove === 'function' && widgetIdRef.current != null) {
        try {
          api.remove(widgetIdRef.current);
        } catch {
          // widget's container may already be gone
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, provider, siteKey]);

  useEffect(() => {
    if (!scriptReady || widgetIdRef.current == null) return;
    widgetApi(provider)?.reset(widgetIdRef.current);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="ed-captcha" />;
}
