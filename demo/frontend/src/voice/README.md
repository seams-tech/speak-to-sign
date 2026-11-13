# Voice commands

The microphone button of the voice bar turns the commands on and off. So does Cmd+K (Ctrl+K on
Windows and Linux). With the bar on, the visitor says what the page must do:

- "Show me controversial posts."
- "Scroll to the third post." "Next post." "Go back."
- "Rate the first note as helpful." "This note is not helpful."
- "Open a market on this note."
- "I don't think this one is true, add a community note."
- "I don't think the second community note is true, bet $1 on no."

A command only moves the page. It changes the tab, opens the write dialog or
opens the bet. It signs nothing. The note or the bet is signed by the spoken
request in the Seams Wallet, where the verifier checks the voice and the
words. So a wrong command cannot sign.

## How one sentence runs

1. `listen.ts` gives the words while the visitor speaks (the browser's Web
   Speech API: Chrome and Safari). If Chrome's on-device model for English is
   installed, the audio stays on the device, and Chrome gets the command words
   and the authors on the screen as `phrases`, so that it prefers them over
   words that sound the same. Chrome takes `phrases` only on the device. Without
   the model, the bar offers to install it (one download), and it uses the
   browser's speech service until then.
2. `VoiceBar.tsx` shows the words on one line (`Transcript.tsx`): the newest
   words bright at the right, the sentences before them grey, fading out at
   the left. It sends each new piece of the sentence to `classify.ts`.
3. `POST /api/voice-command` asks JEV one Noul question for each fact: each
   tab, "add a note", "bet", "the bet is on no", and one for each post and
   note on the screen (`functions/lib/jevCommand.ts`). JEV answers all of them
   in one call.
4. `decideCommand` in `command.ts` makes one command from the probabilities.
   The amount of a bet comes from the words (`spokenUsdc`). So does its side
   (`spokenSide`), when the words name only one side.
5. The timeline runs the command (`runCommand` in `src/x/Timeline.tsx`). The
   bar shows a line only when the command cannot run, or when the sentence
   has no command. At its right end, it shows how long the sentence took to
   classify ("359 ms"). Its tooltip names the classifier (JEV or the word
   rules) and where the words came from (the device or the speech service).

A command that only shows posts runs on an unfinished sentence. A command
that opens a signing step waits for the end of the sentence.

## What the visitor can point at

- "This one" is the post at the centre of the view. It has a faint blue tint. If
  the centre is between two posts, "this one" is the next post (the lower
  one). "Next post" and "scroll to the third post" bring a post to the centre.
- While a dialog shows the result of a transaction ("Note posted"), "view
  transaction" opens that transaction on the explorer in a new tab. The card
  with the "View transaction" link is in the Wallet's frame, so the page opens
  the same transaction itself. The browser can stop a new tab that no click
  asked for: allow pop-ups for the site.
- "Try again" presses the dialog's own **Try again** after a failure, and
  "done" closes a dialog, as "close" does.
- "Show more" or "read the note" opens the whole text of the note of "this
  one", or of a named note ("read the second note"). "Show less" closes it.
- "Scroll to the top" goes to the top of the timeline.
- "Show my bets" goes to **Your bets** in the right column, and to the post of
  the newest market there. The box shows only for an account with a bet.
- "What can I say?" or "help" shows the list of the commands above the bar.
  With a dialog open, the list has the sentences for the dialog. The list goes
  with the next sentence.
- "Stop listening" turns the bar off, as a click on the microphone does. The
  bar hears it with a dialog open too.
- With no dialog open, "view transaction" or "click the transaction link"
  opens the newest transaction of "Signed by voice" in the right column.
- "Scroll down a little bit" and "scroll up a little bit" move the page by half
  of the view. The page stops before "this one" becomes another post, so a long
  post shows its note and its market, and stays "this one". The page's own
  words rule decides this command, with no call to the classifier.
- 8 posts have a number, in a grey chip at the right of the post's head. Their
  notes have their own numbers ("Note 2"), so "the second note" is the second
  note on the screen. The numbers stay while "this one" is among the 8 posts.
  When it leaves them, the numbers start again one post above it.
- A bet needs a note with an open market. "Open a market on this note" starts one. A bet on a
  note with no market opens the market first, and the bet comes next. The owner says "Open a
  prediction market on this note" in the Wallet: the open is a spoken transaction too.
- While the sentence is not finished, the page already brings the post of a note or a bet into
  view.

## Limits

- The browser sends the command audio to its own speech service. The audio of
  a signature does not go there: the Seams Wallet records it.
- The bar does not listen while a dialog is open, so the sentence that signs
  is not read as a command.
- Only the visible tab listens. Chrome gives its speech service to one
  recognition at a time, so two tabs that listen stop each other. If a
  recognition ends six times in a row with no audio, the bar stops and says
  that the speech service is busy.
- With no speech recognition (Firefox, or a refused microphone), the bar
  takes a typed command.
- With no answer from the route, word rules in `command.ts` read the sentence
  (`ruleScores`). They know only the demo's sentences: they are a fallback,
  not a second classifier.
- The route needs `TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`.
