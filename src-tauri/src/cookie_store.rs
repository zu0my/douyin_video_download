use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use keyring::{Entry, Error as KeyringError};
use rand::RngCore;

const SERVICE: &str = "douyin-video-download";
const MASTER_KEY_USER: &str = "cookie-master-key-v1";
const VERSION: &str = "v1";

pub fn encrypt_cookie(value: &str) -> anyhow::Result<String> {
    encrypt_with_key(value, &master_key()?)
}

pub fn decrypt_cookie(value: &str) -> anyhow::Result<String> {
    decrypt_with_key(value, &master_key()?)
}

fn master_key() -> anyhow::Result<[u8; 32]> {
    let entry = Entry::new(SERVICE, MASTER_KEY_USER)?;
    match entry.get_password() {
        Ok(encoded) => decode_master_key(&encoded),
        Err(KeyringError::NoEntry) => {
            let mut key = [0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            entry.set_password(&URL_SAFE_NO_PAD.encode(key))?;
            Ok(key)
        }
        Err(error) => Err(error.into()),
    }
}

fn decode_master_key(encoded: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded)?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Cookie 主密钥长度无效"))
}

fn encrypt_with_key(value: &str, key: &[u8; 32]) -> anyhow::Result<String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("无法初始化 Cookie 加密器"))?;
    let mut nonce_bytes = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), value.as_bytes())
        .map_err(|_| anyhow::anyhow!("Cookie 加密失败"))?;
    Ok(format!(
        "{VERSION}:{}:{}",
        URL_SAFE_NO_PAD.encode(nonce_bytes),
        URL_SAFE_NO_PAD.encode(ciphertext)
    ))
}

fn decrypt_with_key(value: &str, key: &[u8; 32]) -> anyhow::Result<String> {
    let mut parts = value.splitn(3, ':');
    let version = parts.next().unwrap_or_default();
    let nonce = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Cookie 密文缺少 nonce"))?;
    let ciphertext = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("Cookie 密文缺少正文"))?;
    if version != VERSION {
        anyhow::bail!("不支持的 Cookie 密文版本");
    }
    let nonce = URL_SAFE_NO_PAD.decode(nonce)?;
    if nonce.len() != 12 {
        anyhow::bail!("Cookie 密文 nonce 长度无效");
    }
    let ciphertext = URL_SAFE_NO_PAD.decode(ciphertext)?;
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| anyhow::anyhow!("无法初始化 Cookie 解密器"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| anyhow::anyhow!("Cookie 密文校验失败"))?;
    String::from_utf8(plaintext).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypts_and_decrypts_cookie() {
        let key = [7_u8; 32];
        let encrypted = encrypt_with_key("sessionid=secret; msToken=token", &key).unwrap();
        assert!(encrypted.starts_with("v1:"));
        assert_ne!(encrypted, "sessionid=secret; msToken=token");
        assert_eq!(
            decrypt_with_key(&encrypted, &key).unwrap(),
            "sessionid=secret; msToken=token"
        );
    }

    #[test]
    fn rejects_unencrypted_cookie() {
        let key = [7_u8; 32];
        assert!(decrypt_with_key("sessionid=plaintext", &key).is_err());
    }
}
