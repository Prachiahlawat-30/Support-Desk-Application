import { useEffect, useState } from 'react';

// One shared timer for every live countdown on the page: components re-render about once
// a minute, and immediately when the tab becomes visible again. Nothing is fetched.
const TICK_MS = 60_000;
const listeners = new Set();
let timer = null;

function tick() {
  const now = Date.now();
  listeners.forEach((listener) => listener(now));
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') tick();
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

/** The current time in milliseconds, updated about once a minute. */
export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => subscribe(setNow), []);
  return now;
}
