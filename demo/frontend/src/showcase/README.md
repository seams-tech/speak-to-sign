# The Community Notes page

`NotesPage.tsx` is the page at `/`. `main.tsx` starts it, and `live.tsx` holds
the notes app with its signer. It has three layers:

- **The nav**, the one bar of the page, 44 pixels high: at the left one pill
  with the name and the gradient picker; at the right GitHub, one pill with
  three links ("Built on NEAR", NEAR AI and OutLayer), and the Seams pill, in
  the same glass pills. The Seams pill opens the sign-in (signed out) or the
  Wallet's settings drawer (signed in); in a build with no Seams key, it is a
  link to wallet.seams.sh. Its
  content is as wide as the notes app's layout (1220 pixels), so its two
  ends line up with the app's edges. It stays at the top and has no ground of its own: it lies over the
  top of the hero. When the sheet covers the hero, that strip of the hero
  stays in sight, so the nav keeps the hero's gradient. The notes app's own top line is hidden on this page. When
  the sheet covers the hero, the setup steps show in the nav, until every
  step is done. The next step is the primary action: a white pill with a
  black button. A done step is a green check, and a later step is glass.
  A screen narrower than 1200 pixels shows only the next step.
- **The hero**, about voice signatures, on a moving grain field of the Seams
  site: the title, one sentence, and the setup
  steps as one strip (`#setup`). The field is the `GrainField` of
  seams-monorepo (`packages/grain-field-ts`, copied into
  `src/showcase/grain/`): one WebGL shader that smooths a 12 × 12 colour
  grid, flows it and adds grain. The page has two themes, and each has
  one of the site's gradients: Light mode (Apricot Beam) and
  Dark mode (Onyx Black, with X's black, Lights out). The theme picker
  (`ThemePicker.tsx`, `theme.ts`), in the nav's brand pill, is a round button with a picture of the field. It opens a menu of
  three choices, each with a picture: the two themes, and System (the default), which follows the
  system's light or dark setting (`prefers-color-scheme`) and changes when it changes.
  The arrow keys change the theme as they move.
  The choice stays in this browser (`localStorage`), and `?theme=light`,
  `?theme=dark` or `?theme=system` picks one for a link. The page puts the theme (light or dark)
  on the root element as `data-theme`. The
  dark colours are tokens in `src/styles.css`, for the notes app, its dialogs
  and the sheet; the hero and the nav do not change. A light field gets a soft dark shade
  on the left (`--field-scrim`), so the white text stays readable. NEAR's N
  mark (`nearMarks.tsx`, as on tatchi.xyz) lies big and faint over the field
  at the right, turned 30 degrees, behind the hero's text.
- **The sheet**, with the notes app in the page itself, not in a window. The
  sheet has the theme's plain ground (white in Light mode), also at the sides
  of the app.

The page is the one scroll area. The hero stays in place, and the sheet moves
up over it like paper. While the sheet covers it, the hero goes back a little,
blurs and dims (`--cover`, set from the scroll position). The same scroll then
goes on down the feed: on this page the notes app does not scroll itself
(`.ss-sheet .notes-app` in `showcase.css`), so one gesture is enough. The
app's sticky parts (the tabs, the navigation, the right column) stick under
the nav, and the phone's bottom bar sticks to the bottom of the screen. The
scroll area (`.ss-scroll`) starts under the nav, and the field is a layer of
its own behind the nav and the hero (`.ss-ground`). So nothing that scrolls
can come behind the nav, with no script: the nav always shows the field, and
the scroll area's round top corners are the sheet's corners at the nav. A post
that opens starts at the top of the sheet.

The app opens on the timeline. Its right column (`src/x/VoiceFeed.tsx`) has a
search box for the look only, and "Signed by voice": the newest notes with the sentence that each
author said, shown only when there is a note. "Home" in the app's navigation opens the timeline.
