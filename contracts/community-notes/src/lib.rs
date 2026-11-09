//! Community notes for the Speak-to-Sign demo.
//!
//! An author adds a note to a post. Other accounts rate the note as
//! `helpful`, `somewhat_helpful` or `not_helpful`. The Seams Wallet signs
//! both calls from the user's own account with 0 deposit, so the contract
//! pays for its storage from its own balance.
//!
//! The method names and JSON shapes are fixed: Seams Wallet core and the
//! demo page use them. See `README.md`.

use near_sdk::serde::Serialize;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, env, near, require};

/// The maximum length of a note text, in Unicode scalar values.
pub const MAX_TEXT_CHARS: usize = 280;
/// The maximum length of a note summary, in Unicode scalar values.
pub const MAX_SUMMARY_CHARS: usize = 120;
/// `get_notes` returns at most this many notes.
pub const MAX_NOTES_PER_POST_VIEW: u32 = 50;
/// A note needs at least this many ratings of one kind to get a status.
pub const MIN_RATINGS_FOR_STATUS: u32 = 2;

const EVENT_STANDARD: &str = "community_notes";
const EVENT_VERSION: &str = "1.0.0";

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
        }
    }
}

/// A note as the view methods return it.
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
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Notes,
    PostNoteCounts,
    PostNotes,
    Ratings,
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
    pub fn add_note(&mut self, post_id: u64, text: String, summary: String) -> u64 {
        check_length("text", &text, MAX_TEXT_CHARS);
        check_length("summary", &summary, MAX_SUMMARY_CHARS);
        let author = env::predecessor_account_id();

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
    pub fn rate_note(&mut self, note_id: u64, rating: Rating) {
        let account_id = env::predecessor_account_id();
        let note = self
            .notes
            .get_mut(&note_id)
            .unwrap_or_else(|| env::panic_str(&format!("note {note_id} does not exist")));
        require!(
            note.author != account_id,
            "the author cannot rate their own note"
        );

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
