//! Checks of `normalize_punctuated`, the reading of transcripts from a
//! model that writes numerals, punctuation and account ids (Whisper).

pub mod support;

use spoken_intent::{
    normalize, normalize_punctuated, parse_transfer, render, Network, ParseRefusal, ParseResult,
    ProposalV1, PunctuatedRefusal, SpokenAccount, SpokenBranch, SpokenRequestV1, SpokenSummary,
};
use support::{account, challenge_word, contacts, near_account, parsed};

#[test]
fn punctuated_transcripts_read_like_the_rendered_text() {
    let mut hash = [0u8; 32];
    hash[0] = 0x17;
    let rendered = render(&SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        multisig: near_account("multisig.testnet"),
        proposal_id: 999,
        proposal: ProposalV1::SetVerifierVersion { version_hash: hash },
        challenge: [challenge_word("compass"), challenge_word("meadow")],
    });
    let digits: String = rendered.display_text
        ["Approve proposal 999: set verifier version ".len()..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    assert_eq!(digits.len(), 8, "{}", rendered.display_text);
    let heard = format!("Approved Proposal 999 Set Verifier Version {digits} Compass Meadow.");
    assert_eq!(
        normalize_punctuated(&heard, &[]).expect("readable"),
        rendered.spoken
    );

    // A sound-alike spelling resolves to the one contact with the same key.
    let tokens = normalize_punctuated("Send 1,250 nir to Alice.Testnut.", &contacts());
    assert_eq!(
        tokens.as_ref().map(|t| parse_transfer(t, &contacts())),
        Ok(parsed("alice.testnet", 125_000))
    );
    assert_eq!(
        normalize_punctuated("Send 25 NEAR to carol.testnet", &contacts()),
        Err(PunctuatedRefusal::RecipientNotContact)
    );
    // The CTC text step does not read the check digits one by one.
    assert_ne!(normalize(&heard), Some(rendered.spoken));
}

/// `normalize_punctuated` and then `parse_transfer`, with `contacts()`.
fn read_punctuated(heard: &str) -> Result<ParseResult, PunctuatedRefusal> {
    normalize_punctuated(heard, &contacts()).map(|tokens| parse_transfer(&tokens, &contacts()))
}

#[test]
fn two_heard_as_to_fills_only_a_one_word_amount_slot() {
    // Whisper large-v3 on testnet: "send two near to alice dot testnet".
    assert_eq!(
        read_punctuated("Send to near to alice testnet."),
        Ok(parsed("alice.testnet", 200))
    );
    assert_eq!(
        read_punctuated("Send too near to alice.testnet"),
        Ok(parsed("alice.testnet", 200))
    );

    // Near misses that must stay refused.
    let not_transfer = Ok(ParseResult::Refused(ParseRefusal::NotTransfer));
    // No amount and no "near".
    assert_eq!(read_punctuated("Send to alice.testnet"), not_transfer);
    assert_eq!(read_punctuated("Send to alice testnet"), not_transfer);
    // No amount.
    assert_eq!(
        read_punctuated("Send near to alice testnet"),
        Ok(ParseResult::Refused(ParseRefusal::Amount))
    );
    // "to" then "near" with no "to" after it: the recipient is not a contact.
    assert_eq!(
        read_punctuated("Send to near alice testnet"),
        Err(PunctuatedRefusal::RecipientNotContact)
    );
    // A negation, a word after the verb, and a changed verb.
    assert_eq!(
        read_punctuated("Don't send to near to alice testnet"),
        not_transfer
    );
    assert_eq!(
        read_punctuated("Send not to near to alice testnet"),
        Err(PunctuatedRefusal::RecipientNotContact)
    );
    assert_eq!(
        read_punctuated("Approve to near to alice testnet"),
        not_transfer
    );
    // An added clause stays one recipient that is not a contact.
    assert_eq!(
        read_punctuated("Send to near to alice testnet and send to near to bob testnet"),
        Err(PunctuatedRefusal::RecipientNotContact)
    );
    // Other amounts are not changed.
    assert_eq!(
        read_punctuated("Send 20 near to alice testnet"),
        Ok(parsed("alice.testnet", 2_000))
    );
}

#[test]
fn dot_before_testnet_keeps_the_contact_match() {
    // Whisper large-v3 on testnet drops the spoken "dot".
    assert_eq!(
        read_punctuated("Send 5 near to bob testnet"),
        Ok(parsed("bob.testnet", 500))
    );
    assert_eq!(
        read_punctuated("Send 5 near to bob-1 testnet"),
        Ok(parsed("bob-1.testnet", 500))
    );
    let seams = [account("seams-v1.testnet"), account("alice.testnet")];
    let tokens = normalize_punctuated("Send 5 near to seams-v1 testnet.", &seams).expect("contact");
    assert_eq!(
        parse_transfer(&tokens, &seams),
        parsed("seams-v1.testnet", 500)
    );

    // A recipient that matches as heard keeps that match: "umidot testnet"
    // has the key of "uma dot testnet", and "umidot dot testnet" does not.
    let uma = [account("uma.testnet"), account("alice.testnet")];
    let tokens = normalize_punctuated("Send 60 near to umidot testnet.", &uma).expect("contact");
    assert_eq!(parse_transfer(&tokens, &uma), parsed("uma.testnet", 6_000));

    // Near misses that must stay refused.
    let not_contact = Err(PunctuatedRefusal::RecipientNotContact);
    // Another account, and no account before the suffix.
    assert_eq!(read_punctuated("Send 5 near to carol testnet"), not_contact);
    assert_eq!(read_punctuated("Send 5 near to testnet"), not_contact);
    // No receiver.
    assert_eq!(
        read_punctuated("Send 5 near to"),
        Err(PunctuatedRefusal::RecipientNotContact)
    );
    // A dropped "dash" matches by the loose key ("bob one" is `bob-1`).
    assert_eq!(
        read_punctuated("Send 5 near to bob 1 testnet"),
        Ok(parsed("bob-1.testnet", 500))
    );
    // An added clause after the receiver.
    assert_eq!(
        read_punctuated("Send 5 near to alice testnet and send 5 near to bob testnet"),
        not_contact
    );
    // A mainnet suffix gets no "dot", but the loose key leaves the suffix
    // out, so "alice near" is `alice.near`.
    let mainnet = [account("alice.near")];
    assert_eq!(
        normalize_punctuated("Send 5 near to alice near", &mainnet)
            .map(|tokens| parse_transfer(&tokens, &mainnet)),
        Ok(parsed("alice.near", 500))
    );
}

#[test]
fn send_slots_forgive_words_that_hold_no_value() {
    // Staging: "send zero point zero one year to seams dash v one dot testnet".
    let seams = [account("seams-v1.testnet")];
    let tokens =
        normalize_punctuated("Send 0.01 year to seams-v1.testnet.", &seams).expect("contact");
    assert_eq!(
        parse_transfer(&tokens, &seams),
        parsed("seams-v1.testnet", 1)
    );

    // Whisper large-v3 forms of the verb, the unit, the suffix and the receiver.
    for (heard, receiver, hundredths) in [
        ("Send 25 NIA to alice.testnet.", "alice.testnet", 2_500),
        ("Send 25 here to alice.testnet.", "alice.testnet", 2_500),
        ("Send 1,300 nair to bob.testnet", "bob.testnet", 130_000),
        ("Sent 25 near to alice.testnet.", "alice.testnet", 2_500),
        ("Sends 25 near to alice.testnet", "alice.testnet", 2_500),
        ("Send 25 to alice.testnet.", "alice.testnet", 2_500),
        ("Send free near to alice.testnet.", "alice.testnet", 300),
        ("Send twenty for near to bob.testnet", "bob.testnet", 2_400),
        (
            "Send 200-1587.5 near to bob.testnet.",
            "bob.testnet",
            20_158_750,
        ),
        ("Send 25 near to alice.testnode.", "alice.testnet", 2_500),
        (
            "Send 25 near to alice dot test node",
            "alice.testnet",
            2_500,
        ),
        ("Send 25 near to alice testament", "alice.testnet", 2_500),
        ("Send 25 near to alicia.testnet.", "alice.testnet", 2_500),
        ("Send 25 near to bob-1.testmode.", "bob-1.testnet", 2_500),
    ] {
        assert_eq!(
            read_punctuated(heard),
            Ok(parsed(receiver, hundredths)),
            "{heard}"
        );
    }

    // The amount is not changed: the caller compares it with the request.
    assert_eq!(
        read_punctuated("Send 26 NIA to alice.testnet"),
        Ok(parsed("alice.testnet", 2_600))
    );

    // Near misses that must stay refused.
    let is_transfer = |heard: &str| matches!(read_punctuated(heard), Ok(ParseResult::Transfer(_)));
    for heard in [
        "Send 25 dollars to alice.testnet.",
        "Send not to alice.testnet.",
        "Send near to alice.testnet.",
        "Send NIA to alice.testnet.",
        "Sent not 25 near to alice.testnet",
        "Do not send 25 NIA to alice.testnet.",
        "Approve 25 NIA to alice.testnet.",
        "Send 25 NIA to alice.testnet and send 100 NIA to bob.testnet.",
    ] {
        assert!(!is_transfer(heard), "{heard}");
    }
    let not_contact = Err(PunctuatedRefusal::RecipientNotContact);
    assert_eq!(read_punctuated("Send 25 NIA to carol.testnet"), not_contact);
    // One edit, but another first sound.
    let leo = [account("leo.testnet"), account("uma.testnet")];
    for heard in ["Send 5 near to zoe.testnet", "Send 5 near to anna.testnet"] {
        assert_eq!(
            normalize_punctuated(heard, &leo),
            Err(PunctuatedRefusal::RecipientNotContact),
            "{heard}"
        );
    }
    assert_eq!(read_punctuated("Send 25 near to testnode"), not_contact);
    assert_eq!(read_punctuated("Send 25 near to test node"), not_contact);
}

#[test]
fn account_separators_can_be_said_differently_or_left_out() {
    for (heard, receiver, hundredths) in [
        // Other words for a separator.
        (
            "Send 25 near to alice period testnet",
            "alice.testnet",
            2_500,
        ),
        (
            "Send 25 near to alice full stop testnet",
            "alice.testnet",
            2_500,
        ),
        (
            "Send 5 near to bob hyphen 1 dot testnet",
            "bob-1.testnet",
            500,
        ),
        ("Send 5 near to bob minus one testnet", "bob-1.testnet", 500),
        // Separators or the network suffix left out.
        ("Send 25 near to alice", "alice.testnet", 2_500),
        ("Send 25 near to alice dot", "alice.testnet", 2_500),
        ("Send 5 near to bob one", "bob-1.testnet", 500),
        // Amounts: "oh" for zero, "dot" for "point", and no leading zero.
        (
            "Send point oh one near to alice dot testnet",
            "alice.testnet",
            1,
        ),
        (
            "Send zero dot zero one near to alice dot testnet",
            "alice.testnet",
            1,
        ),
    ] {
        assert_eq!(
            read_punctuated(heard),
            Ok(parsed(receiver, hundredths)),
            "{heard}"
        );
    }

    let seams = [account("seams-v1.testnet")];
    let lab = [account("lab_7.testnet")];
    for (heard, contacts, receiver) in [
        (
            "Send 1 NEAR to seams v one.",
            &seams[..],
            "seams-v1.testnet",
        ),
        ("Send 1 NEAR to seams v1.", &seams[..], "seams-v1.testnet"),
        (
            "Send 1 NEAR to Seams hyphen V1 period testnet.",
            &seams[..],
            "seams-v1.testnet",
        ),
        (
            "Send 1 near to lab under score seven dot testnet",
            &lab[..],
            "lab_7.testnet",
        ),
        ("Send 1 near to lab seven", &lab[..], "lab_7.testnet"),
    ] {
        let tokens = normalize_punctuated(heard, contacts).expect(heard);
        assert_eq!(
            parse_transfer(&tokens, contacts),
            parsed(receiver, 100),
            "{heard}"
        );
    }

    // Near misses that must stay refused.
    let not_contact = Err(PunctuatedRefusal::RecipientNotContact);
    assert_eq!(read_punctuated("Send 25 near to carol"), not_contact);
    assert_eq!(
        read_punctuated("Send 25 near to mallory dot testnet"),
        not_contact
    );
    assert_eq!(
        read_punctuated("Send 25 near to alice and send 5 near to bob"),
        not_contact
    );
    let is_transfer = |heard: &str| matches!(read_punctuated(heard), Ok(ParseResult::Transfer(_)));
    for heard in [
        "Send 25 dollars to alice",
        "Do not send 25 near to alice",
        "Send near to alice",
        "Send point to alice",
    ] {
        assert!(!is_transfer(heard), "{heard}");
    }
}

#[test]
fn note_summaries_keep_separator_words_and_oh() {
    // The send-sentence rules must not touch a note summary: it is read
    // word for word, so "period", "dash", "oh" and "point" stay as said.
    for text in [
        "The period on the chart is wrong",
        "Oh this dash cam clip is old",
        "Point one is not in the source",
        "Full stop hyphen and minus are mixed up",
    ] {
        let request = SpokenRequestV1::CommunityNote {
            network: Network::Testnet,
            owner: near_account("owner.testnet"),
            contract: near_account("notes.testnet"),
            post_id: 7,
            note_sha256: [3; 32],
            summary: SpokenSummary::new(text).expect("speakable summary"),
        };
        let rendered = render(&request);
        assert_eq!(
            normalize_punctuated(&rendered.display_text, &[]).expect(text),
            rendered.spoken,
            "{text}"
        );
    }
}

#[test]
fn merge_approval_transcripts_match() {
    // Whisper writes the pull request number as a numeral; the send-sentence
    // rules do not apply to a merge approval.
    for (heard, pull_request, base) in [
        ("Merge pull request 42 into main.", 42, "main"),
        (" Merge pull request forty two into Main!", 42, "main"),
        ("Merge pull request 1,001 into develop.", 1_001, "develop"),
        ("merge pull request one into dev", 1, "dev"),
    ] {
        let request = SpokenRequestV1::MergeApproval {
            network: Network::Testnet,
            owner: near_account("owner.testnet"),
            contract: near_account("merges.seams-v1.testnet"),
            repo_sha256: [1; 32],
            pull_request,
            base: SpokenBranch::new(base).expect("speakable base"),
            head_commit: [2; 20],
        };
        assert_eq!(
            normalize_punctuated(heard, &contacts()).expect(heard),
            render(&request).spoken,
            "{heard}"
        );
    }
}

#[test]
fn joined_words_match_by_the_sound_of_the_sentence_end() {
    // Whisper large-v3: "to" joined with the receiver.
    let contacts = [account("ken.testnet"), account("dana.testnet")];
    for (heard, receiver, hundredths) in [
        ("Send 856 near toucane.testnet.", "ken.testnet", 85_600),
        ("Send 856 near toucane.testnut.", "ken.testnet", 85_600),
        (
            "Send 526,844.23 near today in a dot testnet.",
            "dana.testnet",
            52_684_423,
        ),
    ] {
        let tokens = normalize_punctuated(heard, &contacts).expect(heard);
        assert_eq!(
            parse_transfer(&tokens, &contacts),
            parsed(receiver, hundredths),
            "{heard}"
        );
    }

    // The sound of another account, or of no amount, is not read.
    let alice = [account("alice.testnet")];
    let refused = |heard: &str, contacts: &[SpokenAccount]| {
        !matches!(
            normalize_punctuated(heard, contacts).map(|tokens| parse_transfer(&tokens, contacts)),
            Ok(ParseResult::Transfer(_))
        )
    };
    assert!(refused("Send 856 near toucane.testnet.", &alice));
    assert!(refused("Send near toucane.testnet.", &contacts));
    assert!(refused("Send 856 near tobob.testnet.", &contacts));
}
