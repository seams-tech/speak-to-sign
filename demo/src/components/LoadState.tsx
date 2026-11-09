import { useDemo } from '../demoContext';

export function LoadState() {
  const { loading, loadError, reload } = useDemo();
  if (loadError) {
    return (
      <div className="load-error" role="alert">
        <span>Could not read notes from NEAR testnet: {loadError}</span>
        <button type="button" className="btn btn-outline btn-sm" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="loading" role="status">
        <span className="spinner" aria-hidden="true" /> Loading notes
      </div>
    );
  }
  return null;
}
