use std::process::Command;

use uuid::Uuid;

pub const WINDOWS_REF_PREFIX: &str = "win-dpapi:";
pub const LEGACY_DPAPI_REF_PREFIX: &str = "dpapi:";
pub const MACOS_REF_PREFIX: &str = "mac-keychain:";
const MACOS_KEYCHAIN_SERVICE: &str = "SelfDeploy";

pub fn new_credential_ref() -> String {
    format!("{}{}", credential_ref_prefix(), Uuid::new_v4())
}

pub fn is_managed_ref(credential_ref: &str) -> bool {
    credential_ref.starts_with(WINDOWS_REF_PREFIX)
        || credential_ref.starts_with(LEGACY_DPAPI_REF_PREFIX)
        || credential_ref.starts_with(MACOS_REF_PREFIX)
}

#[cfg(windows)]
pub fn protect_secret(_credential_ref: &str, secret: &str) -> Result<Vec<u8>, String> {
    protect_secret_with_dpapi(secret)
}

#[cfg(target_os = "macos")]
pub fn protect_secret(credential_ref: &str, secret: &str) -> Result<Vec<u8>, String> {
    validate_secret(secret)?;
    run_security(&[
        "add-generic-password",
        "-a",
        credential_ref,
        "-s",
        MACOS_KEYCHAIN_SERVICE,
        "-w",
        secret,
        "-U",
    ])?;
    Ok(credential_ref.as_bytes().to_vec())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn protect_secret(_credential_ref: &str, _secret: &str) -> Result<Vec<u8>, String> {
    Err("当前平台尚未实现系统钥匙串凭据加密".into())
}

#[cfg(windows)]
pub fn unprotect_secret(_credential_ref: &str, cipher: &[u8]) -> Result<String, String> {
    unprotect_secret_with_dpapi(cipher)
}

#[cfg(target_os = "macos")]
pub fn unprotect_secret(credential_ref: &str, cipher: &[u8]) -> Result<String, String> {
    if cipher.is_empty() {
        return Err("Keychain 引用为空".into());
    }
    let account = String::from_utf8(cipher.to_vec())
        .map_err(|err| format!("Keychain 引用不是 UTF-8：{err}"))?;
    if account != credential_ref {
        return Err("Keychain 引用与 credential_ref 不一致".into());
    }
    run_security_with_output(&[
        "find-generic-password",
        "-a",
        credential_ref,
        "-s",
        MACOS_KEYCHAIN_SERVICE,
        "-w",
    ])
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn unprotect_secret(_credential_ref: &str, _cipher: &[u8]) -> Result<String, String> {
    Err("当前平台尚未实现系统钥匙串凭据读取".into())
}

#[cfg(windows)]
pub fn delete_platform_secret(_credential_ref: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn delete_platform_secret(credential_ref: &str) -> Result<(), String> {
    run_security(&[
        "delete-generic-password",
        "-a",
        credential_ref,
        "-s",
        MACOS_KEYCHAIN_SERVICE,
    ])
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn delete_platform_secret(_credential_ref: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn credential_ref_prefix() -> &'static str {
    WINDOWS_REF_PREFIX
}

#[cfg(target_os = "macos")]
fn credential_ref_prefix() -> &'static str {
    MACOS_REF_PREFIX
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn credential_ref_prefix() -> &'static str {
    "secret:"
}

#[cfg(windows)]
fn protect_secret_with_dpapi(secret: &str) -> Result<Vec<u8>, String> {
    use std::{ptr::null_mut, slice};
    use winapi::{
        shared::minwindef::DWORD,
        um::{
            dpapi::CryptProtectData, errhandlingapi::GetLastError, winbase::LocalFree,
            wincrypt::DATA_BLOB,
        },
    };

    validate_secret(secret)?;
    let mut bytes = secret.as_bytes().to_vec();
    let mut input = DATA_BLOB {
        cbData: bytes.len() as DWORD,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output = DATA_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("Windows DPAPI 加密失败：{}", unsafe {
            GetLastError()
        }));
    }
    let cipher = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(cipher)
}

#[cfg(windows)]
fn unprotect_secret_with_dpapi(cipher: &[u8]) -> Result<String, String> {
    use std::{ptr::null_mut, slice};
    use winapi::{
        shared::minwindef::DWORD,
        um::{
            dpapi::CryptUnprotectData, errhandlingapi::GetLastError, winbase::LocalFree,
            wincrypt::DATA_BLOB,
        },
    };

    if cipher.is_empty() {
        return Err("DPAPI 密文为空".into());
    }
    let mut bytes = cipher.to_vec();
    let mut input = DATA_BLOB {
        cbData: bytes.len() as DWORD,
        pbData: bytes.as_mut_ptr(),
    };
    let mut output = DATA_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("Windows DPAPI 解密失败：{}", unsafe {
            GetLastError()
        }));
    }
    let plain = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    String::from_utf8(plain).map_err(|err| format!("DPAPI 明文不是 UTF-8：{err}"))
}

#[cfg(target_os = "macos")]
fn run_security(args: &[&str]) -> Result<(), String> {
    let output = Command::new("security")
        .args(args)
        .output()
        .map_err(|err| format!("调用 macOS Keychain 失败：{err}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("macOS Keychain 操作失败：{stderr}"))
    }
}

#[cfg(target_os = "macos")]
fn run_security_with_output(args: &[&str]) -> Result<String, String> {
    let output = Command::new("security")
        .args(args)
        .output()
        .map_err(|err| format!("调用 macOS Keychain 失败：{err}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("macOS Keychain 读取失败：{stderr}"))
    }
}

fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("凭据不能为空".into());
    }
    Ok(())
}
