// Every example renders on the one Speak-to-Sign page, so a render error in one of them would
// blank the whole page. The guard keeps such an error inside its own window: that window says
// so, and the other examples, the intro and the setup card keep working.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** The example's name, for the console. */
  name: string;
  children: ReactNode;
}

export class ExampleGuard extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`The ${this.props.name} example stopped:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="ss-guard" role="alert">
        <b>This example stopped working.</b>
        <span>The rest of the page still works.</span>
        <code className="ss-guard-error">{error.message}</code>
        <button type="button" className="ss-btn ss-btn-sm ss-guard-retry" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
