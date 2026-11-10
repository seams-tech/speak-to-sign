// The Seams pill at the right of the nav. Signed in, it opens the Seams Wallet's settings as the
// SDK's drawer (AccountMenuButton, presentation "drawer": the SDK draws only the drawer, and the
// page owns the button and the open state). Signed out it opens the sign-in, as there are no
// settings yet. It needs SeamsWebProvider above it; a build with no Seams key keeps the link.

import { useState } from 'react';
import { AccountMenuButton, useSeams } from '@seams/wallet/react';
import { config } from '../config';
import { SeamsPillLogo } from './seamsMarks';

export function SeamsSettingsPill({ onSignIn }: { onSignIn: () => void }) {
  const { loginState } = useSeams();
  const [open, setOpen] = useState(false);
  const signedIn = loginState.isLoggedIn && loginState.access === 'wallet';
  const nearAccountId = signedIn ? loginState.nearAccountId : null;

  return (
    <>
      <button
        type="button"
        className="ss-seams"
        aria-label={signedIn ? 'Seams Wallet settings' : 'Sign in to Seams Wallet'}
        aria-haspopup="dialog"
        aria-expanded={signedIn ? open : undefined}
        onClick={() => (signedIn ? setOpen(true) : onSignIn())}
      >
        <SeamsPillLogo />
      </button>
      {signedIn && (
        <AccountMenuButton
          presentation="drawer"
          isMenuOpen={open}
          onMenuOpenChange={setOpen}
          nearAccountId={nearAccountId}
          nearExplorerBaseUrl={config.explorerUrl}
        />
      )}
    </>
  );
}
