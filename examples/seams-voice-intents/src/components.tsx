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
