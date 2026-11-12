//! Community notes for the Speak-to-Sign demo.
//!
//! An author adds a note to a post. Other accounts rate the note as
//! `helpful`, `somewhat_helpful` or `not_helpful`. The Seams Wallet signs
//! both calls from the user's own account with 0 deposit, so the contract
//! pays for its storage from its own balance.
//!
//! One moderator account, the voice multisig of the demo, can hide a
//! harmful note. A hidden note keeps its id, post, author and counts, but
//! the contract removes its text and summary, and it takes no more ratings.
//! The original text stays in the `add_note` transaction on chain.
//!
//! A note and a rating are spoken requests. The contract takes one only with
//! the signed verdict of the voice verifier for exactly this note or this
//! rating, from this account (see `check_spoken`). So a key of the account
//! alone cannot add or rate a note. The contract account can turn the rule
//! off (`set_voice_required`).
//!
//! The method names and JSON shapes are fixed: Seams Wallet core and the
//! demo page use them. See `README.md`.

use near_sdk::serde::Serialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, IntoStorageKey, env, near, require};
use spoken_intent::{
    NearAccount, Network, NoteRatingV1, SpokenRequestV1, SpokenSummary, request_digest,
};

/// The maximum length of a note text, in Unicode scalar values.
pub const MAX_TEXT_CHARS: usize = 280;
/// The maximum length of a note summary, in Unicode scalar values.
pub const MAX_SUMMARY_CHARS: usize = 120;
/// `get_notes` returns at most this many notes.
pub const MAX_NOTES_PER_POST_VIEW: u32 = 50;
/// A note needs at least this many ratings of one kind to get a status.
pub const MIN_RATINGS_FOR_STATUS: u32 = 2;

/// The network of this deployment. The request digest of a verdict names it.
const NETWORK: Network = Network::Testnet;
/// The key of the Seams voice verifier on testnet, which signs each verdict.
/// The contract account can set another key (`set_voice_verifier_key`).
pub const DEFAULT_VOICE_VERIFIER_KEY: &str = "ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U";

const EVENT_STANDARD: &str = "community_notes";
const EVENT_VERSION: &str = "1.1.0";

/// The rating that one account gives to one note.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rating {
    Helpful,
    SomewhatHelpful,
    NotHelpful,
}

/// The status of a note, from its rating counts.
#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteStatus {
    Helpful,
    NotHelpful,
    NeedsMoreRatings,
}

impl NoteStatus {
    /// `helpful` when helpful >= 2 and helpful > not_helpful;
    /// `not_helpful` when not_helpful >= 2 and not_helpful > helpful;
    /// otherwise `needs_more_ratings`. `somewhat_helpful` has no effect.
    pub fn from_counts(helpful: u32, not_helpful: u32) -> Self {
        if helpful >= MIN_RATINGS_FOR_STATUS && helpful > not_helpful {
            NoteStatus::Helpful
        } else if not_helpful >= MIN_RATINGS_FOR_STATUS && not_helpful > helpful {
            NoteStatus::NotHelpful
        } else {
            NoteStatus::NeedsMoreRatings
        }
    }
}

/// A note as the contract stores it.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Note {
    pub post_id: u64,
    pub author: AccountId,
    pub text: String,
    pub summary: String,
    pub created_at_ms: u64,
    pub helpful: u32,
    pub somewhat_helpful: u32,
    pub not_helpful: u32,
}

impl Note {
    fn count_mut(&mut self, rating: Rating) -> &mut u32 {
        match rating {
            Rating::Helpful => &mut self.helpful,
            Rating::SomewhatHelpful => &mut self.somewhat_helpful,
            Rating::NotHelpful => &mut self.not_helpful,
        }
    }

    fn status(&self) -> NoteStatus {
        NoteStatus::from_counts(self.helpful, self.not_helpful)
    }

    /// `add_note` refuses an empty text, so only `hide_note` leaves one.
    fn hidden(&self) -> bool {
        self.text.is_empty()
    }

    fn view(&self, id: u64) -> NoteView {
        NoteView {
            id,
            post_id: self.post_id,
            author: self.author.clone(),
            text: self.text.clone(),
            summary: self.summary.clone(),
            created_at_ms: self.created_at_ms,
            helpful: self.helpful,
            somewhat_helpful: self.somewhat_helpful,
            not_helpful: self.not_helpful,
            status: self.status(),
            hidden: self.hidden(),
        }
    }
}

/// A note as the view methods return it. A hidden note has an empty `text`
/// and `summary`, and `hidden` is true.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoteView {
    pub id: u64,
    pub post_id: u64,
    pub author: AccountId,
    pub text: String,
    pub summary: String,
    pub created_at_ms: u64,
    pub helpful: u32,
    pub somewhat_helpful: u32,
    pub not_helpful: u32,
    pub status: NoteStatus,
    pub hidden: bool,
}

/// The storage prefixes. New keys go at the end: the prefix of a key is its
/// position.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Notes,
    PostNoteCounts,
    PostNotes,
    Ratings,
    /// The moderator account, outside the contract state, so that an
    /// upgrade of a deployed contract needs no state migration.
    Moderator,
    /// The 32 bytes of the voice verifier key. Absent: the default key.
    VoiceVerifierKey,
    /// One byte, 0, when a note and a rating need no verdict. Absent: they
    /// need one.
    VoiceNotRequired,
    /// The prefix of the marker of a used verdict: the prefix, then the
    /// SHA-256 of the verdict JSON.
    UsedVerdicts,
}

#[near(contract_state)]
pub struct CommunityNotes {
    /// The id of the newest note. The first note gets id 1.
    last_note_id: u64,
    notes: LookupMap<u64, Note>,
    /// The number of notes on each post.
    post_note_counts: LookupMap<u64, u32>,
    /// (post id, index on the post) to note id, oldest first.
    post_notes: LookupMap<(u64, u32), u64>,
    /// (note id, rater) to rating.
    ratings: LookupMap<(u64, AccountId), Rating>,
}

impl Default for CommunityNotes {
    fn default() -> Self {
        Self {
            last_note_id: 0,
            notes: LookupMap::new(StorageKey::Notes),
            post_note_counts: LookupMap::new(StorageKey::PostNoteCounts),
            post_notes: LookupMap::new(StorageKey::PostNotes),
            ratings: LookupMap::new(StorageKey::Ratings),
        }
    }
}

#[near]
impl CommunityNotes {
    /// Adds a note to a post and returns the id of the new note. The author
    /// is the predecessor account. The call takes no deposit: the contract
    /// pays for the storage.
    ///
    /// `verdict_json` and `signature_b64` are the verdict of the author's
    /// spoken summary, as the voice verifier gave it, byte for byte, and the
    /// standard base64 of its signature. The request digest names the author,
    /// this contract, the post, the SHA-256 of the text and the summary, so
    /// a verdict for any other note does not pass.
    pub fn add_note(
        &mut self,
        post_id: u64,
        text: String,
        summary: String,
        verdict_json: Option<String>,
        signature_b64: Option<String>,
    ) -> u64 {
        check_length("text", &text, MAX_TEXT_CHARS);
        check_length("summary", &summary, MAX_SUMMARY_CHARS);
        let author = env::predecessor_account_id();
        check_spoken("note", verdict_json, signature_b64, || {
            SpokenRequestV1::CommunityNote {
                network: NETWORK,
                owner: near_account(&author),
                contract: near_account(&env::current_account_id()),
                post_id,
                note_sha256: env::sha256_array(text.as_bytes()),
                summary: SpokenSummary::new(&summary).unwrap_or_else(|_| {
                    env::panic_str("the summary is not a summary that a person can say")
                }),
            }
        });

        self.last_note_id = self
            .last_note_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("no note ids are left"));
        let note_id = self.last_note_id;

        let index = self.post_note_counts.get(&post_id).copied().unwrap_or(0);
        let next_index = index
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("this post has the maximum number of notes"));
        self.post_notes.insert((post_id, index), note_id);
        self.post_note_counts.insert(post_id, next_index);

        emit(
            "note_added",
            NoteAdded {
                note_id,
                post_id,
                author: &author,
            },
        );
        self.notes.insert(
            note_id,
            Note {
                post_id,
                author,
                text,
                summary,
                created_at_ms: env::block_timestamp_ms(),
                helpful: 0,
                somewhat_helpful: 0,
                not_helpful: 0,
            },
        );
        note_id
    }

    /// Rates a note for the predecessor account. A later call from the same
    /// account replaces its earlier rating. The author cannot rate their own
    /// note.
    ///
    /// `verdict_json` and `signature_b64` are the verdict of the spoken
    /// rating, as for `add_note`. The request digest names the rater, this
    /// contract, the note and the rating.
    pub fn rate_note(
        &mut self,
        note_id: u64,
        rating: Rating,
        verdict_json: Option<String>,
        signature_b64: Option<String>,
    ) {
        let account_id = env::predecessor_account_id();
        let note = self
            .notes
            .get_mut(&note_id)
            .unwrap_or_else(|| env::panic_str(&format!("note {note_id} does not exist")));
        require!(
            note.author != account_id,
            "the author cannot rate their own note"
        );
        require!(!note.hidden(), "this note is hidden");
        check_spoken("rating", verdict_json, signature_b64, || {
            SpokenRequestV1::NoteRating {
                network: NETWORK,
                owner: near_account(&account_id),
                contract: near_account(&env::current_account_id()),
                note_id,
                rating: match rating {
                    Rating::Helpful => NoteRatingV1::Helpful,
                    Rating::SomewhatHelpful => NoteRatingV1::SomewhatHelpful,
                    Rating::NotHelpful => NoteRatingV1::NotHelpful,
                },
            }
        });

        let previous_rating = self.ratings.insert((note_id, account_id.clone()), rating);
        if let Some(previous) = previous_rating {
            let count = note.count_mut(previous);
            *count = count.saturating_sub(1);
        }
        *note.count_mut(rating) += 1;

        emit(
            "note_rated",
            NoteRated {
                note_id,
                account_id: &account_id,
                rating,
                previous_rating,
                status: note.status(),
            },
        );
    }

    /// Hides a harmful note: removes its text and summary. Only the
    /// moderator can call it. `proposal_id` is the multisig proposal that
    /// decided it, for the event.
    pub fn hide_note(&mut self, note_id: u64, proposal_id: Option<u64>) {
        let caller = env::predecessor_account_id();
        require!(
            Some(&caller) == self.get_moderator().as_ref(),
            "only the moderator can hide a note"
        );
        let note = self
            .notes
            .get_mut(&note_id)
            .unwrap_or_else(|| env::panic_str(&format!("note {note_id} does not exist")));
        require!(!note.hidden(), "this note is already hidden");
        note.text.clear();
        note.summary.clear();
        emit(
            "note_hidden",
            NoteHidden {
                note_id,
                post_id: note.post_id,
                moderator: &caller,
                proposal_id,
            },
        );
    }

    /// Sets the moderator, the one account that can hide a note. Only the
    /// contract account can call it.
    #[private]
    pub fn set_moderator(&mut self, account_id: AccountId) {
        env::storage_write(
            &StorageKey::Moderator.into_storage_key(),
            account_id.as_bytes(),
        );
    }

    pub fn get_moderator(&self) -> Option<AccountId> {
        env::storage_read(&StorageKey::Moderator.into_storage_key())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|text| text.parse().ok())
    }

    /// Sets the key of the voice verifier that signs each verdict,
    /// `ed25519:<base58 of 32 bytes>`. Only the contract account can call it.
    #[private]
    pub fn set_voice_verifier_key(&mut self, verifier_public_key: String) {
        let key = verdict::parse_ed25519_key(&verifier_public_key).unwrap_or_else(|| {
            env::panic_str("verifier_public_key must be ed25519:<base58 of 32 bytes>")
        });
        env::storage_write(&StorageKey::VoiceVerifierKey.into_storage_key(), &key);
    }

    /// Says if a note and a rating need a voice verdict. They do by default.
    /// Only the contract account can call it: it is the way to keep the
    /// notes open if the voice verifier is down.
    #[private]
    pub fn set_voice_required(&mut self, required: bool) {
        let key = StorageKey::VoiceNotRequired.into_storage_key();
        if required {
            env::storage_remove(&key);
        } else {
            env::storage_write(&key, &[0]);
        }
    }

    /// The voice rule: if a note and a rating need a verdict, and the key
    /// that must sign it.
    pub fn get_voice_config(&self) -> VoiceConfigView {
        VoiceConfigView {
            required: voice_required(),
            verifier_public_key: verdict::format_ed25519_key(&voice_verifier_key()),
        }
    }

    /// The notes on a post, newest first, at most 50.
    pub fn get_notes(&self, post_id: u64) -> Vec<NoteView> {
        let count = self.post_note_counts.get(&post_id).copied().unwrap_or(0);
        let first = count.saturating_sub(MAX_NOTES_PER_POST_VIEW);
        (first..count)
            .rev()
            .filter_map(|index| self.post_notes.get(&(post_id, index)).copied())
            .filter_map(|note_id| self.get_note(note_id))
            .collect()
    }

    pub fn get_note(&self, note_id: u64) -> Option<NoteView> {
        self.notes.get(&note_id).map(|note| note.view(note_id))
    }

    pub fn get_rating(&self, note_id: u64, account_id: AccountId) -> Option<Rating> {
        self.ratings.get(&(note_id, account_id)).copied()
    }
}

/// Panics if `value` is empty, only white space, or longer than `max`
/// Unicode scalar values.
fn check_length(field: &str, value: &str, max: usize) {
    if value.trim().is_empty() {
        env::panic_str(&format!("{field} must not be empty"));
    }
    let count = value.chars().count();
    if count > max {
        env::panic_str(&format!(
            "{field} has {count} characters; the maximum is {max}"
        ));
    }
}

/// The voice rule, as `get_voice_config` gives it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoiceConfigView {
    pub required: bool,
    pub verifier_public_key: String,
}

/// True unless the contract account turned the voice rule off.
fn voice_required() -> bool {
    !env::storage_has_key(&StorageKey::VoiceNotRequired.into_storage_key())
}

/// The key that signs each verdict: the one that the contract account set,
/// or the default.
fn voice_verifier_key() -> [u8; 32] {
    env::storage_read(&StorageKey::VoiceVerifierKey.into_storage_key())
        .and_then(|bytes| bytes.try_into().ok())
        .or_else(|| verdict::parse_ed25519_key(DEFAULT_VOICE_VERIFIER_KEY))
        .unwrap_or_else(|| env::panic_str("the voice verifier key is not valid"))
}

/// Panics unless the call has the verdict of its own spoken request: signed
/// by the voice verifier, an `accept`, not expired, and for the digest of
/// `request`. A verdict passes once. `what` is "note" or "rating", for the
/// panic text. Without the voice rule, the check does nothing.
fn check_spoken(
    what: &str,
    verdict_json: Option<String>,
    signature_b64: Option<String>,
    request: impl FnOnce() -> SpokenRequestV1,
) {
    if !voice_required() {
        return;
    }
    let (Some(verdict_json), Some(signature_b64)) = (verdict_json, signature_b64) else {
        env::panic_str(&format!(
            "say the {what}: it needs verdict_json and signature_b64 from the voice verifier"
        ));
    };
    verdict::check_verdict(
        &voice_verifier_key(),
        &request_digest(&request()),
        &verdict_json,
        &signature_b64,
    );
    let mut used = StorageKey::UsedVerdicts.into_storage_key();
    used.extend_from_slice(&env::sha256_array(verdict_json.as_bytes()));
    if env::storage_write(&used, &[1]) {
        env::panic_str("this verdict was used before");
    }
}

fn near_account(account: &AccountId) -> NearAccount {
    NearAccount::new(account.as_str())
        .unwrap_or_else(|_| env::panic_str("the account id is not valid for spoken-intent"))
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct NoteAdded<'a> {
    note_id: u64,
    post_id: u64,
    author: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct NoteRated<'a> {
    note_id: u64,
    account_id: &'a AccountId,
    rating: Rating,
    previous_rating: Option<Rating>,
    status: NoteStatus,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct NoteHidden<'a> {
    note_id: u64,
    post_id: u64,
    moderator: &'a AccountId,
    #[serde(skip_serializing_if = "Option::is_none")]
    proposal_id: Option<u64>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: [T; 1],
}

/// Logs a NEP-297 event: `EVENT_JSON:{"standard":"community_notes",...}`.
fn emit<T: Serialize>(event: &str, data: T) {
    let log = EventLog {
        standard: EVENT_STANDARD,
        version: EVENT_VERSION,
        event,
        data: [data],
    };
    let json = near_sdk::serde_json::to_string(&log)
        .unwrap_or_else(|_| env::panic_str("cannot serialize the event"));
    env::log_str(&format!("EVENT_JSON:{json}"));
}

#[cfg(test)]
mod tests;
mod verdict;
