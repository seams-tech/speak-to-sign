use borsh::{BorshDeserialize, BorshSerialize};

/// The 64 challenge nouns. The list has no number words, no homophones, no
/// rhyming pairs and no words from the rest of the grammar. A change to the
/// list is a new renderer version.
pub const CHALLENGE_WORDS: [&str; 64] = [
    "river", "lantern", "garden", "pencil", "mirror", "castle", "rabbit", "window", "ladder",
    "basket", "candle", "hammer", "jacket", "kettle", "lemon", "magnet", "monkey", "needle",
    "parrot", "pillow", "planet", "puzzle", "rocket", "shadow", "silver", "spider", "statue",
    "tiger", "tunnel", "turtle", "valley", "violin", "wagon", "walnut", "zebra", "anchor",
    "blanket", "bottle", "camera", "cactus", "canyon", "compass", "cotton", "dragon", "falcon",
    "beacon", "glacier", "harbor", "helmet", "island", "jungle", "lizard", "meadow", "muffin",
    "oyster", "penguin", "piano", "pumpkin", "salmon", "tomato", "trumpet", "umbrella", "volcano",
    "orchard",
];

/// One word of [`CHALLENGE_WORDS`], held as its index.
///
/// Borsh writes it as one `u8` index, and decoding refuses an index of 64 or
/// more.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ChallengeWord(u8);

impl ChallengeWord {
    /// The word at `index`, if the index is below 64.
    pub fn from_index(index: u8) -> Option<Self> {
        (usize::from(index) < CHALLENGE_WORDS.len()).then_some(Self(index))
    }

    /// The index into [`CHALLENGE_WORDS`].
    pub fn index(self) -> u8 {
        self.0
    }

    /// The word.
    pub fn as_str(self) -> &'static str {
        CHALLENGE_WORDS[usize::from(self.0)]
    }
}

impl BorshSerialize for ChallengeWord {
    fn serialize<W: borsh::io::Write>(&self, writer: &mut W) -> borsh::io::Result<()> {
        self.0.serialize(writer)
    }
}

impl BorshDeserialize for ChallengeWord {
    fn deserialize_reader<R: borsh::io::Read>(reader: &mut R) -> borsh::io::Result<Self> {
        let index = u8::deserialize_reader(reader)?;
        Self::from_index(index).ok_or_else(|| {
            borsh::io::Error::new(
                borsh::io::ErrorKind::InvalidData,
                "challenge index out of range",
            )
        })
    }
}
