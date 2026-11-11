// While a dialog is open, the page does not listen for commands: the Seams Wallet records the
// sentence that signs, and those words are not a command. Each open dialog holds the listener.

import { useEffect, useSyncExternalStore } from 'react';

let holds = 0;
const listeners = new Set<() => void>();

function holdVoice(): () => void {
  holds += 1;
  listeners.forEach((listener) => listener());
  return () => {
    holds -= 1;
    listeners.forEach((listener) => listener());
  };
}

/** Holds the command listener while the component is mounted. */
export function useHoldVoice(): void {
  useEffect(() => holdVoice(), []);
}

/** True while a dialog holds the command listener. */
export function useVoiceHeld(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => holds > 0,
  );
}
