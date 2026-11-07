use alloc::string::String;

use crate::SpokenAccount;

/// A reduced sound form of a spoken account. Two accounts whose keys are
/// equal or one edit apart can sound alike, so a contract refuses the second
/// one as a contact or member.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PhoneticKey(String);

impl PhoneticKey {
    /// The key: uppercase ASCII letters.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// True if the keys are equal or one insertion, deletion or
    /// substitution apart.
    pub fn is_confusable_with(&self, other: &PhoneticKey) -> bool {
        at_most_one_edit(self.0.as_bytes(), other.0.as_bytes())
    }
}

/// Computes the key from the spoken words of the account ("alice dot
/// testnet"), so digits and separators count as their words.
///
/// For each word:
/// - a run of vowels (`a e i o u y`) becomes `A`, and a final `e` after a
///   consonant is silent;
/// - `ph` and `v` become `F`; `c` before `e`, `i` or `y`, `z` and `s` become
///   `S`; any other `c`, `k` and `q` become `K`; `x` becomes `KS`; `g`
///   before `e`, `i` or `y` becomes `J`;
/// - `h` is silent unless it starts the word.
///
/// The words are joined, and each run of one letter becomes one letter.
pub fn phonetic_key(account: &SpokenAccount) -> PhoneticKey {
    let mut raw = String::new();
    for token in account.spoken_tokens() {
        encode_word(token.as_str().as_bytes(), &mut raw);
    }
    let mut key = String::with_capacity(raw.len());
    for c in raw.chars() {
        if !key.ends_with(c) {
            key.push(c);
        }
    }
    PhoneticKey(key)
}

fn is_vowel(byte: u8) -> bool {
    matches!(byte, b'a' | b'e' | b'i' | b'o' | b'u' | b'y')
}

fn encode_word(word: &[u8], out: &mut String) {
    let mut index = 0;
    while index < word.len() {
        let byte = word[index];
        let next = word.get(index + 1).copied();
        let soft = matches!(next, Some(b'e' | b'i' | b'y'));
        let is_last = index + 1 == word.len();
        match byte {
            b'e' if is_last && index > 0 && !is_vowel(word[index - 1]) => {}
            _ if is_vowel(byte) => out.push('A'),
            b'p' if next == Some(b'h') => {
                out.push('F');
                index += 1;
            }
            b'v' => out.push('F'),
            b'c' if soft => out.push('S'),
            b'c' | b'k' | b'q' => out.push('K'),
            b's' | b'z' => out.push('S'),
            b'x' => out.push_str("KS"),
            b'g' if soft => out.push('J'),
            b'h' if index > 0 => {}
            _ => out.push(char::from(byte.to_ascii_uppercase())),
        }
        index += 1;
    }
}

fn at_most_one_edit(a: &[u8], b: &[u8]) -> bool {
    let (shorter, longer) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if longer.len() - shorter.len() > 1 {
        return false;
    }
    let prefix = shorter
        .iter()
        .zip(longer)
        .take_while(|(left, right)| left == right)
        .count();
    if shorter.len() == longer.len() {
        // Equal, or one substitution at `prefix`.
        prefix == shorter.len() || shorter[prefix + 1..] == longer[prefix + 1..]
    } else {
        // One insertion into `shorter` at `prefix`.
        shorter[prefix..] == longer[prefix + 1..]
    }
}
