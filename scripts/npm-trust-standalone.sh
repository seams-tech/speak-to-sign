#!/bin/sh
# Sets the GitHub workflow release-standalone.yml of seams-tech/speak-to-sign as the trusted
# publisher of @seams/voice-verdict, @seams/voice-capture and @seams/voice-sign on npm, so that the workflow can
# publish them with no npm token. It never touches @seams/speak-to-sign: that name belongs to the
# Seams Wallet plugin and its own workflow (release-speak-to-sign.yml).
#
# Run it in an interactive terminal, logged in to npm with an account that can write the
# packages. The first command asks for two-factor authentication in the browser. On that page,
# tick "skip two-factor authentication for the next 5 minutes": the other commands then run with
# no prompt.
#
# npm keeps one trusted publisher for each package. A package that trusts another workflow loses
# that relationship first.
set -eu

REPO=seams-tech/speak-to-sign
FILE=release-standalone.yml

for package in @seams/voice-verdict @seams/voice-capture @seams/voice-sign; do
  echo "== $package"
  existing=$(npm trust list "$package" --json 2>/dev/null || echo '[]')
  # The ids of the relationships that are not this workflow, and "same" if this workflow is
  # trusted already.
  state=$(printf '%s' "$existing" | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      let value;
      try { value = JSON.parse(text || "[]"); } catch { value = []; }
      const items = Array.isArray(value) ? value : (value.trustedPublishers ?? value.items ?? [value]);
      const out = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const file = item.file ?? item.claims?.workflow_ref?.file ?? item.workflow ?? "";
        const repo = item.repository ?? item.claims?.repository ?? "";
        if (String(file).endsWith(process.argv[1]) && (!repo || repo === process.argv[2])) out.push("same");
        else if (item.id) out.push(item.id);
      }
      console.log(out.join(" "));
    });
  ' "$FILE" "$REPO")
  case " $state " in
    *" same "*)
      echo "$package trusts $FILE already"
      continue
      ;;
  esac
  for id in $state; do
    echo "revoke the relationship $id"
    npm trust revoke --id "$id" "$package"
    sleep 2
  done
  npm trust github "$package" --file "$FILE" --repository "$REPO" --allow-publish --yes
  sleep 2
done

echo "== the trusted publishers now"
for package in @seams/voice-verdict @seams/voice-capture @seams/voice-sign; do
  echo "$package:"
  npm trust list "$package"
done
