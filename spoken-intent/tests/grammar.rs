//! Focused checks of the grammar rules: the plan's examples, amounts,
//! negations, sound-alikes and the parse/render inverse.

use spoken_intent::{
    normalize, normalize_punctuated, parse_transfer, phonetic_key, render, ChallengeWord,
    NearAccount, NearAmount, Network, ParseRefusal, ParseResult, ProposalV1, PunctuatedRefusal,
    SpokenAccount, SpokenRequestV1, UnsupportedReason, CHALLENGE_WORDS,
};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn account(id: &str) -> SpokenAccount {
    SpokenAccount::new(id).expect("speakable account")
}

fn account_transfer(receiver: &str, amount: NearAmount) -> SpokenRequestV1 {
    SpokenRequestV1::AccountTransfer {
        network: Network::Testnet,
        owner: near_account("owner.testnet"),
        receiver: account(receiver),
        amount,
    }
}

fn near_account(id: &str) -> NearAccount {
    NearAccount::new(id).expect("valid account")
}

fn contacts() -> Vec<SpokenAccount> {
    ["alice.testnet", "bob.testnet", "bob-1.testnet"]
        .into_iter()
        .map(account)
        .collect()
}

fn parse(transcript: &str) -> ParseResult {
    parse_transfer(&normalize(transcript).expect("normalizable"), &contacts())
}

#[test]
fn plan_examples_render_exactly() {
    let cases = [
        (
            "alice.testnet",
            25 * ONE_NEAR,
            "Send 25 NEAR to alice.testnet",
            "send twenty five near to alice dot testnet",
        ),
        (
            "bob-1.testnet",
            25 * ONE_NEAR / 10,
            "Send 2.5 NEAR to bob-1.testnet",
            "send two point five near to bob dash one dot testnet",
        ),
        (
            "alice.testnet",
            1_250 * ONE_NEAR,
            "Send 1,250 NEAR to alice.testnet",
            "send one thousand two hundred fifty near to alice dot testnet",
        ),
    ];
    for (receiver, yocto, display, spoken) in cases {
        let amount = NearAmount::from_yocto(yocto).expect("speakable");
        let rendered = render(&account_transfer(receiver, amount));
        assert_eq!(rendered.display_text, display);
        assert_eq!(rendered.spoken_text, spoken);
    }

    let word = |w: &str| {
        let index = CHALLENGE_WORDS
            .iter()
            .position(|c| *c == w)
            .expect("listed") as u8;
        ChallengeWord::from_index(index).expect("below 64")
    };
    let rendered = render(&SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        multisig: near_account("multisig.testnet"),
        proposal_id: 42,
        proposal: ProposalV1::Transfer {
            receiver: account("payroll.testnet"),
            amount: NearAmount::from_hundredths(1_000).expect("speakable"),
        },
        challenge: [word("river"), word("lantern")],
    });
    assert_eq!(
        rendered.display_text,
        "Approve proposal 42: send 10 NEAR to payroll.testnet. Then say: river lantern."
    );
    assert_eq!(
        rendered.spoken_text,
        "approve proposal forty two send ten near to payroll dot testnet river lantern"
    );
}

#[test]
fn amounts_are_exact_and_bounded() {
    let unsupported = Err(UnsupportedReason::AmountNotSpeakable);
    assert_eq!(NearAmount::from_yocto(ONE_NEAR / 1_000), unsupported);
    assert_eq!(NearAmount::from_yocto(0), unsupported);
    assert_eq!(
        NearAmount::from_yocto(1_000_000 * ONE_NEAR + ONE_NEAR / 100),
        unsupported
    );
    assert!(NearAmount::from_yocto(1_000_000 * ONE_NEAR).is_ok());
    assert!(NearAmount::from_yocto(ONE_NEAR / 100).is_ok());

    // Teens and tens differ; a trailing zero is not canonical.
    let thirteen = render(&account_transfer(
        "alice.testnet",
        NearAmount::from_hundredths(1_300).expect("ok"),
    ));
    let thirty = render(&account_transfer(
        "alice.testnet",
        NearAmount::from_hundredths(3_000).expect("ok"),
    ));
    assert_ne!(thirteen.spoken, thirty.spoken);
    assert_eq!(
        parse("send two point five zero near to bob dot testnet"),
        ParseResult::Refused(ParseRefusal::Amount)
    );
    assert_eq!(
        parse("send twelve hundred near to alice dot testnet"),
        ParseResult::Refused(ParseRefusal::Amount)
    );
    assert_eq!(
        parse("send zero point zero zero one near to alice dot testnet"),
        ParseResult::Refused(ParseRefusal::Amount)
    );
}

#[test]
fn speech_to_text_forms_normalize_to_the_rendered_tokens() {
    let expected = normalize("send one thousand two hundred fifty near to alice dot testnet");
    for transcript in [
        "Send 1,250 NEAR to alice.testnet.",
        "send 1250 near to alice dot testnet",
        "send one thousand two hundred and fifty near to alice dot testnet",
    ] {
        assert_eq!(normalize(transcript), expected, "{transcript}");
    }
    assert_eq!(
        normalize("send a hundred near to alice dot testnet"),
        normalize("send one hundred near to alice dot testnet")
    );
    assert_eq!(
        normalize("send twenty-five near to alice.testnet"),
        normalize("send twenty five near to alice dot testnet")
    );
    assert_eq!(normalize("send $25 to alice.testnet"), None);
}

#[test]
fn negations_and_added_clauses_are_refused() {
    let not_transfer = ParseResult::Refused(ParseRefusal::NotTransfer);
    assert_eq!(
        parse("do not send twenty five near to alice dot testnet"),
        not_transfer
    );
    assert_eq!(parse("Don't send 25 NEAR to alice.testnet"), not_transfer);
    assert_eq!(parse("never send 25 NEAR to alice.testnet"), not_transfer);
    assert_eq!(
        parse("send 25 NEAR to alice.testnet and send 100 NEAR to bob.testnet"),
        ParseResult::Refused(ParseRefusal::TrailingWords)
    );
    assert_eq!(
        parse("send 25 NEAR to alice.testnet not"),
        ParseResult::Refused(ParseRefusal::TrailingWords)
    );
    assert_eq!(
        parse("send 25 NEAR to alicia.testnet"),
        ParseResult::Refused(ParseRefusal::UnknownRecipient)
    );
}

#[test]
fn accepted_parses_render_back_to_the_same_tokens() {
    for transcript in [
        "send twenty five near to alice dot testnet",
        "send 2.5 NEAR to bob-1.testnet",
        "send 0.05 near to bob.testnet",
        "send 1,000,000 near to alice.testnet",
        "send 999,999.99 near to bob.testnet",
    ] {
        let tokens = normalize(transcript).expect("normalizable");
        let ParseResult::Transfer(parsed) = parse_transfer(&tokens, &contacts()) else {
            panic!("refused: {transcript}");
        };
        let request = account_transfer(parsed.receiver.as_str(), parsed.amount);
        assert_eq!(render(&request).spoken, tokens, "{transcript}");
    }
}

#[test]
fn sound_alike_accounts_are_confusable() {
    let confusable =
        |a: &str, b: &str| phonetic_key(&account(a)).is_confusable_with(&phonetic_key(&account(b)));
    assert!(confusable("alice.testnet", "alicia.testnet"));
    assert!(confusable("jon.testnet", "john.testnet"));
    assert!(confusable("rob.testnet", "bob.testnet"));
    assert!(confusable("payroll.testnet", "payrolls.testnet"));
    assert!(confusable("philip.testnet", "filip.testnet"));
    assert!(!confusable("alice.testnet", "bob.testnet"));
    assert!(!confusable("alice.testnet", "alice.near"));
}

#[test]
fn punctuated_transcripts_read_like_the_rendered_text() {
    let word = |w: &str| {
        let index = CHALLENGE_WORDS
            .iter()
            .position(|c| *c == w)
            .expect("listed") as u8;
        ChallengeWord::from_index(index).expect("below 64")
    };
    let mut hash = [0u8; 32];
    hash[0] = 0x17;
    let rendered = render(&SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        multisig: near_account("multisig.testnet"),
        proposal_id: 999,
        proposal: ProposalV1::SetVerifierVersion { version_hash: hash },
        challenge: [word("compass"), word("meadow")],
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
        Ok(ParseResult::Transfer(spoken_intent::ParsedTransfer {
            receiver: account("alice.testnet"),
            amount: NearAmount::from_hundredths(125_000).expect("speakable"),
        }))
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

fn transfer_of(receiver: &str, hundredths: u64) -> Result<ParseResult, PunctuatedRefusal> {
    Ok(ParseResult::Transfer(spoken_intent::ParsedTransfer {
        receiver: account(receiver),
        amount: NearAmount::from_hundredths(hundredths).expect("speakable"),
    }))
}

#[test]
fn two_heard_as_to_fills_only_a_one_word_amount_slot() {
    // Whisper large-v3 on testnet: "send two near to alice dot testnet".
    assert_eq!(
        read_punctuated("Send to near to alice testnet."),
        transfer_of("alice.testnet", 200)
    );
    assert_eq!(
        read_punctuated("Send too near to alice.testnet"),
        transfer_of("alice.testnet", 200)
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
        transfer_of("alice.testnet", 2_000)
    );
}

#[test]
fn dot_before_testnet_keeps_the_contact_match() {
    // Whisper large-v3 on testnet drops the spoken "dot".
    assert_eq!(
        read_punctuated("Send 5 near to bob testnet"),
        transfer_of("bob.testnet", 500)
    );
    assert_eq!(
        read_punctuated("Send 5 near to bob-1 testnet"),
        transfer_of("bob-1.testnet", 500)
    );
    let seams = [account("seams-v1.testnet"), account("alice.testnet")];
    let tokens = normalize_punctuated("Send 5 near to seams-v1 testnet.", &seams).expect("contact");
    assert_eq!(
        parse_transfer(&tokens, &seams),
        ParseResult::Transfer(spoken_intent::ParsedTransfer {
            receiver: account("seams-v1.testnet"),
            amount: NearAmount::from_hundredths(500).expect("speakable"),
        })
    );

    // A recipient that matches as heard keeps that match: "umidot testnet"
    // has the key of "uma dot testnet", and "umidot dot testnet" does not.
    let uma = [account("uma.testnet"), account("alice.testnet")];
    let tokens = normalize_punctuated("Send 60 near to umidot testnet.", &uma).expect("contact");
    assert_eq!(
        parse_transfer(&tokens, &uma),
        ParseResult::Transfer(spoken_intent::ParsedTransfer {
            receiver: account("uma.testnet"),
            amount: NearAmount::from_hundredths(6_000).expect("speakable"),
        })
    );

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
        transfer_of("bob-1.testnet", 500)
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
        Ok(ParseResult::Transfer(spoken_intent::ParsedTransfer {
            receiver: account("alice.near"),
            amount: NearAmount::from_hundredths(500).expect("speakable"),
        }))
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
        ParseResult::Transfer(spoken_intent::ParsedTransfer {
            receiver: account("seams-v1.testnet"),
            amount: NearAmount::from_hundredths(1).expect("speakable"),
        })
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
            transfer_of(receiver, hundredths),
            "{heard}"
        );
    }

    // The amount is not changed: the caller compares it with the request.
    assert_eq!(
        read_punctuated("Send 26 NIA to alice.testnet"),
        transfer_of("alice.testnet", 2_600)
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
            transfer_of(receiver, hundredths),
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
            ParseResult::Transfer(spoken_intent::ParsedTransfer {
                receiver: account(receiver),
                amount: NearAmount::from_hundredths(100).expect("speakable"),
            }),
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
            summary: spoken_intent::SpokenSummary::new(text).expect("speakable summary"),
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
            ParseResult::Transfer(spoken_intent::ParsedTransfer {
                receiver: account(receiver),
                amount: NearAmount::from_hundredths(hundredths).expect("speakable"),
            }),
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

#[test]
fn unspeakable_accounts_are_refused() {
    let unsupported = Err(UnsupportedReason::AccountNotSpeakable);
    let implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    assert_eq!(SpokenAccount::new(implicit), unsupported);
    assert_eq!(
        SpokenAccount::new(&format!("0x{}", "ab".repeat(20))),
        unsupported
    );
    assert_eq!(SpokenAccount::new("Alice.testnet"), unsupported);
    assert_eq!(SpokenAccount::new("alice..testnet"), unsupported);
}

#[test]
fn an_implicit_owner_is_valid_and_not_said() {
    let implicit = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";
    let eth = format!("0x{}", "ab".repeat(20));
    for owner in [implicit, eth.as_str()] {
        let request = SpokenRequestV1::AccountTransfer {
            network: Network::Testnet,
            owner: near_account(owner),
            receiver: account("alice.testnet"),
            amount: NearAmount::from_hundredths(50).expect("speakable"),
        };
        assert_eq!(
            render(&request).spoken_text,
            "send zero point five near to alice dot testnet"
        );
        let bytes = borsh::to_vec(&request).expect("serializes");
        assert_eq!(
            borsh::from_slice::<SpokenRequestV1>(&bytes).expect("decodes"),
            request
        );
    }
    assert!(NearAccount::new("Alice.testnet").is_err());
    assert!(NearAccount::new("alice..testnet").is_err());
    assert!(NearAccount::new("a").is_err());
}
