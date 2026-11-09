import React from 'react';
import { useSeams } from '@seams/wallet/react';
import { errorMessage } from './text';

export type Loaded<T> =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;

export type Outcome<T> =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'working' }>
  | Readonly<{ kind: 'result'; value: T }>
  | Readonly<{ kind: 'failed'; message: string }>;

type Connection = 'connecting' | 'ready' | 'failed';

/** Runs `load` on mount and on each `reload`. It keeps the last value while it reloads. */
export function useLoaded<T>(load: () => Promise<T>): [Loaded<T>, () => void] {
  const [state, setState] = React.useState<Loaded<T>>({ kind: 'loading' });
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setState({ kind: 'ready', value }),
      (error: unknown) => live && setState({ kind: 'failed', message: errorMessage(error) }),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  const reload = React.useCallback(() => setRound((value) => value + 1), []);
  return [state, reload];
}

/** Runs one owner action at a time and keeps its last result. */
export function useOutcome<T>(): [Outcome<T>, (run: () => Promise<T>) => Promise<T | null>] {
  const [outcome, setOutcome] = React.useState<Outcome<T>>({ kind: 'idle' });
  const start = React.useCallback(async (run: () => Promise<T>) => {
    setOutcome({ kind: 'working' });
    try {
      const value = await run();
      setOutcome({ kind: 'result', value });
      return value;
    } catch (error: unknown) {
      setOutcome({ kind: 'failed', message: errorMessage(error) });
      return null;
    }
  }, []);
  return [outcome, start];
}

/** Loads the Wallet iframe once for this page. */
export function useWalletConnection(): Connection {
  const { seams } = useSeams();
  const [connection, setConnection] = React.useState<Connection>('connecting');
  React.useEffect(() => {
    let live = true;
    setConnection('connecting');
    seams.connection.connect().then(
      () => live && setConnection('ready'),
      (error: unknown) => {
        console.error('[speak-to-pay] The Wallet iframe did not load', error);
        if (live) setConnection('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [seams]);
  return connection;
}
