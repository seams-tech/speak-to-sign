// The demo pull request. It is not a real pull request: nothing in the repository changes.
// The voice approval of it is a real transaction on the merge approvals contract.

export interface DemoCommit {
  sha: string;
  message: string;
}

export interface DemoPullRequest {
  repo: string;
  number: number;
  title: string;
  author: string;
  reviewer: string;
  base: string;
  branch: string;
  body: string;
  commits: DemoCommit[];
  additions: number;
  deletions: number;
  files: number;
}

export const DEMO_PULL_REQUEST: DemoPullRequest = {
  repo: 'seams-tech/speak-to-sign',
  number: 412,
  title: 'Fix fee rounding in transfer',
  author: 'alice',
  reviewer: 'bob',
  base: 'main',
  branch: 'fix/fee-rounding',
  body: 'Rounds the fee down to the nearest yoctoNEAR, and adds a test for a 1 yocto transfer.',
  commits: [
    { sha: '3b7e0d41c2a95f6e8d7c1b0a9f8e7d6c5b4a3f21', message: 'Round the fee down to the nearest yoctoNEAR' },
    { sha: '5a1f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a20', message: 'Add a test for a 1 yocto transfer' },
    { sha: '9c1e2fa4b7d0c3e5f6a8b9c0d1e2f3a4b5c6d7e8', message: 'Explain the rounding in the transfer docs' },
  ],
  additions: 18,
  deletions: 6,
  files: 5,
};

/** The newest commit: the one that the approval names. */
export function headCommit(pr: DemoPullRequest): string {
  return pr.commits[pr.commits.length - 1]?.sha ?? '';
}
