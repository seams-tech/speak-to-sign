//! The policy step. It runs after the speaker and word checks pass, and it
//! can only tighten the decision: a rule turns an accept into a step-up,
//! which the Wallet answers with a fresh passkey. A plain-English policy
//! engine plugs in here later; for now one fixed rule stands in for it.
use spoken_intent::SpokenRequestV1;

/// One policy rule. `id` goes into the signed verdict, `text` into the
/// unsigned output for the Wallet to show.
#[derive(Debug, PartialEq, Eq)]
pub struct Rule {
    pub id: &'static str,
    pub text: &'static str,
}

/// The decision of the policy step.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    StepUp(&'static Rule),
}

/// The stub rule: a voice payment above this many yoctoNEAR (10 NEAR) needs
/// a passkey.
const STEP_UP_ABOVE_YOCTO: u128 = 10 * 10u128.pow(24);

pub const STUB_AMOUNT_RULE: Rule =
    Rule { id: "stub_voice_amount_above_10_near", text: "A voice payment above 10 NEAR needs a passkey." };

/// Applies the rules to a request whose voice and words already passed.
pub fn decide(request: &SpokenRequestV1) -> Decision {
    match request {
        SpokenRequestV1::AccountTransfer { amount, .. } if amount.yocto() > STEP_UP_ABOVE_YOCTO => {
            Decision::StepUp(&STUB_AMOUNT_RULE)
        }
        _ => Decision::Allow,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use spoken_intent::{NearAccount, NearAmount, Network, SpokenAccount, SpokenBranch};

    fn transfer(hundredths: u64) -> SpokenRequestV1 {
        SpokenRequestV1::AccountTransfer {
            network: Network::Testnet,
            owner: NearAccount::new("owner.testnet").unwrap(),
            receiver: SpokenAccount::new("alice.testnet").unwrap(),
            amount: NearAmount::from_hundredths(hundredths).unwrap(),
        }
    }

    #[test]
    fn above_ten_near_steps_up() {
        assert_eq!(decide(&transfer(1_000)), Decision::Allow);
        assert_eq!(decide(&transfer(1_001)), Decision::StepUp(&STUB_AMOUNT_RULE));
        assert_eq!(decide(&transfer(1)), Decision::Allow);
    }

    #[test]
    fn a_merge_approval_is_allowed() {
        let merge = SpokenRequestV1::MergeApproval {
            network: Network::Testnet,
            owner: NearAccount::new("owner.testnet").unwrap(),
            contract: NearAccount::new("merges.testnet").unwrap(),
            repo_sha256: [1; 32],
            pull_request: 42,
            base: SpokenBranch::new("main").unwrap(),
            head_commit: [2; 20],
        };
        assert_eq!(decide(&merge), Decision::Allow);
    }
}
