import React from 'react';

/** A full-width button that shows a spinner and other text while its action runs. */
export function LoadingButton(props: {
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  style?: React.CSSProperties;
}): React.JSX.Element {
  const loading = props.loading ?? false;
  const disabled = (props.disabled ?? false) || loading;
  return (
    <button
      type="button"
      className="svi-button"
      data-variant={props.variant ?? 'primary'}
      onClick={() => void props.onClick()}
      disabled={disabled}
      aria-busy={loading}
      style={props.style}
    >
      {loading ? (
        <svg className="svi-button__spinner" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="40 200"
          />
        </svg>
      ) : null}
      <span>{loading && props.loadingText ? props.loadingText : props.children}</span>
    </button>
  );
}

/** Copies `text` to the clipboard and shows a check mark for a moment. */
export function CopyButton(props: { text: string; ariaLabel: string }): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [props.text]);
  return (
    <button
      type="button"
      className="svi-copy"
      aria-label={copied ? 'Copied' : props.ariaLabel}
      onClick={() => void copy()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        )}
      </svg>
    </button>
  );
}

export type StepStatus = 'checking' | 'waiting' | 'todo' | 'working' | 'done' | 'failed';

const STATUS_LABELS: Record<StepStatus, string> = {
  checking: 'Checking',
  waiting: 'Waiting',
  todo: 'To do',
  working: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

export function StepCard(props: {
  index: number;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="svi-step"
      data-status={props.status}
      aria-labelledby={`svi-step-${props.index}`}
    >
      <header className="svi-step__head">
        <span className="svi-step__index" aria-hidden>
          {props.index}
        </span>
        <h2 className="svi-step__title" id={`svi-step-${props.index}`}>
          {props.title}
        </h2>
        <span className="svi-pill" data-status={props.status}>
          {STATUS_LABELS[props.status]}
        </span>
      </header>
      <div className="svi-step__body">{props.children}</div>
    </section>
  );
}

export function Notice(props: { tone: 'info' | 'error' | 'success'; children: React.ReactNode }) {
  return (
    <div
      className="svi-notice"
      data-tone={props.tone}
      role={props.tone === 'error' ? 'alert' : 'status'}
    >
      {props.children}
    </div>
  );
}

/** A refused or unavailable result: its reason, the text for the reason, and the detail. */
export function ReasonNotice(props: {
  result: Readonly<{ kind: 'refused' | 'unavailable'; reason: string; detail?: string }>;
  text: string;
  /** A sentence after the detail, such as what did not happen. */
  after?: string;
}): React.JSX.Element {
  const { result } = props;
  return (
    <Notice tone="error">
      {result.kind === 'refused' ? 'Refused' : 'Unavailable'} (<code>{result.reason}</code>):{' '}
      {props.text}
      {result.detail ? ` ${result.detail}` : ''}
      {props.after ? ` ${props.after}` : ''}
    </Notice>
  );
}

export function Fact(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="svi-fact">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}
