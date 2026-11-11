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
   Speech API: Chrome and Safari).
2. `VoiceBar.tsx` sends each new piece of the sentence to `classify.ts`.
3. `POST /api/voice-command` asks JEV one Noul question for each fact: each
   tab, "add a note", "bet", "the bet is on no", and one for each post and
   note on the screen (`functions/lib/jevCommand.ts`). JEV answers all of them
   in one call.
4. `decideCommand` in `command.ts` makes one command from the probabilities.
   The amount of a bet comes from the words (`spokenUsdc`).
5. The timeline runs the command (`runCommand` in `src/x/Timeline.tsx`).

A command that only shows posts runs on an unfinished sentence. A command
that opens a signing step waits for the end of the sentence.

## What the visitor can point at

- The first 8 posts of the tab have a number. Their notes have their own
  numbers ("Note 2"), so "the second note" is the second note on the screen.
- "This one" is the post at the top of the view. It has a blue edge.
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
- With no answer from the route, word rules in `command.ts` know the three
  sentences above (`ruleScores`).
- The route needs `TYPESAFE_API_KEY` or `NEAR_AI_API_KEY`.
