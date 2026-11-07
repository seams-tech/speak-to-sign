//! Focused checks of the grammar rules: the plan's examples, amounts,
//! negations, sound-alikes and the parse/render inverse.

use spoken_intent::{
    normalize, normalize_punctuated, parse_transfer, phonetic_key, render, ChallengeWord,
    NearAmount, Network, ParseRefusal, ParseResult, ProposalV1, PunctuatedRefusal, SpokenAccount,
    SpokenRequestV1, UnsupportedReason, CHALLENGE_WORDS,
};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn account(id: &str) -> SpokenAccount {
    SpokenAccount::new(id).expect("speakable account")
}

fn vault_transfer(receiver: &str, amount: NearAmount) -> SpokenRequestV1 {
    SpokenRequestV1::VaultTransfer {
        network: Network::Testnet,
        vault: account("voice-vault.testnet"),
        owner: account("owner.testnet"),
        receiver: account(receiver),
        amount,
        nonce: 1,
    }
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
        let rendered = render(&vault_transfer(receiver, amount));
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
        multisig: account("multisig.testnet"),
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
    let thirteen = render(&vault_transfer(
        "alice.testnet",
        NearAmount::from_hundredths(1_300).expect("ok"),
    ));
    let thirty = render(&vault_transfer(
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
        let request = vault_transfer(parsed.receiver.as_str(), parsed.amount);
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
        multisig: account("multisig.testnet"),
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
