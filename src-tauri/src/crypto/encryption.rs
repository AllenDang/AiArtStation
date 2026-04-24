use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, OsRng, rand_core::RngCore},
};
use pbkdf2::pbkdf2_hmac_array;
use sha2::Sha256;
use thiserror::Error;

const SALT: &[u8] = b"ai-artstation-v1";
const PBKDF2_ITERATIONS: u32 = 100_000;
const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Invalid data format")]
    InvalidFormat,
}

/// Derive a 256-bit key from a password using PBKDF2
pub fn derive_key(password: &str) -> [u8; KEY_SIZE] {
    let machine_id = get_machine_id();
    let combined = format!("{}{}", password, machine_id);
    pbkdf2_hmac_array::<Sha256, KEY_SIZE>(combined.as_bytes(), SALT, PBKDF2_ITERATIONS)
}

/// Generate a random 12-byte nonce
pub fn generate_nonce() -> [u8; NONCE_SIZE] {
    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

/// Encrypt data using AES-256-GCM
/// Returns: nonce (12 bytes) + ciphertext
pub fn encrypt(data: &[u8], key: &[u8; KEY_SIZE]) -> Result<Vec<u8>, CryptoError> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    let nonce_bytes = generate_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt data using AES-256-GCM
/// Expects: nonce (12 bytes) + ciphertext
pub fn decrypt(data: &[u8], key: &[u8; KEY_SIZE]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < NONCE_SIZE {
        return Err(CryptoError::InvalidFormat);
    }

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;

    let nonce = Nonce::from_slice(&data[..NONCE_SIZE]);
    let ciphertext = &data[NONCE_SIZE..];

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
}

/// Get a machine-specific identifier for key derivation
fn get_machine_id() -> String {
    // Use hostname as a simple machine identifier
    // This adds an extra layer of protection - config can't be copied to another machine
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "default-machine".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let key = derive_key("test-password");
        let plaintext = b"Hello, World!";

        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = derive_key("password1");
        let key2 = derive_key("password2");
        let plaintext = b"Secret data";

        let encrypted = encrypt(plaintext, &key1).unwrap();
        let result = decrypt(&encrypted, &key2);

        assert!(result.is_err());
    }
}
