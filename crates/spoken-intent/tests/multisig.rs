//! Checks of the multisig commitment and the request digest of a multisig
//! approval, which the voice multisig contract computes from its own state.

pub mod support;

use spoken_intent::{
    multisig_approval_digest, multisig_commitment, request_digest, Network, ProposalV1,
    SpokenRequestV1,
};
use support::{account, near, near_account, MULTISIG_SALT};

fn transfer(hundredths: u64) -> ProposalV1 {
    ProposalV1::Transfer {
        receiver: account("grants.testnet"),
        amount: near(hundredths),
    }
}

fn approval(owner: &str, proposal: ProposalV1, salt: [u8; 32]) -> SpokenRequestV1 {
    SpokenRequestV1::MultisigApproval {
        network: Network::Testnet,
        owner: near_account(owner),
        multisig: near_account("team.testnet"),
        proposal_id: 7,
        proposal,
        salt,
    }
}

#[test]
fn the_digest_binds_the_commitment_and_not_the_proposal() {
    let multisig = near_account("team.testnet");
    let commitment = multisig_commitment(&multisig, 7, &transfer(2_500), &MULTISIG_SALT);
    assert_eq!(
        request_digest(&approval("alice.testnet", transfer(2_500), MULTISIG_SALT)),
        multisig_approval_digest(
            Network::Testnet,
            &near_account("alice.testnet"),
            &multisig,
            7,
            &commitment,
        ),
    );
}

#[test]
fn each_field_changes_the_digest() {
    let base = request_digest(&approval("alice.testnet", transfer(2_500), MULTISIG_SALT));
    let others = [
        approval("bob.testnet", transfer(2_500), MULTISIG_SALT),
        approval("alice.testnet", transfer(250), MULTISIG_SALT),
        approval("alice.testnet", transfer(2_500), [0x5b; 32]),
    ];
    for other in others {
        assert_ne!(request_digest(&other), base, "{other:?}");
    }
}

#[test]
fn the_salt_changes_the_commitment() {
    let multisig = near_account("team.testnet");
    assert_ne!(
        multisig_commitment(&multisig, 7, &transfer(2_500), &MULTISIG_SALT),
        multisig_commitment(&multisig, 7, &transfer(2_500), &[0; 32]),
    );
    assert_ne!(
        multisig_commitment(&multisig, 7, &transfer(2_500), &MULTISIG_SALT),
        multisig_commitment(&multisig, 8, &transfer(2_500), &MULTISIG_SALT),
    );
}
