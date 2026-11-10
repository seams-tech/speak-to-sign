//! Checks of the rendered text: examples, exact amounts and the parse/render
//! inverse.

pub mod support;

use spoken_intent::{
    normalize, parse_transfer, render, NearAmount, Network, ParseRefusal, ParseResult, ProposalV1,
    SpokenRequestV1, UnsupportedReason,
};
use support::{account, contacts, near, near_account, parse, MULTISIG_SALT, ONE_NEAR};

fn account_transfer(receiver: &str, amount: NearAmount) -> SpokenRequestV1 {
    SpokenRequestV1::AccountTransfer {
        network: Network::Testnet,
        owner: near_account("owner.testnet"),
        receiver: account(receiver),
        amount,
    }
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

    let rendered = render(&SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        owner: near_account("owner.testnet"),
        multisig: near_account("multisig.testnet"),
        proposal_id: 42,
        proposal: ProposalV1::Transfer {
            receiver: account("payroll.testnet"),
            amount: near(1_000),
        },
        salt: MULTISIG_SALT,
    });
    assert_eq!(
        rendered.display_text,
        "Approve proposal 42: send 10 NEAR to payroll.testnet"
    );
    assert_eq!(
        rendered.spoken_text,
        "approve proposal forty two send ten near to payroll dot testnet"
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
    let thirteen = render(&account_transfer("alice.testnet", near(1_300)));
    let thirty = render(&account_transfer("alice.testnet", near(3_000)));
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
