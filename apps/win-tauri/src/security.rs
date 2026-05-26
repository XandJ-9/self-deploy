use uuid::Uuid;

pub const DPAPI_REF_PREFIX: &str = "dpapi:";

pub fn new_dpapi_ref() -> String {
    format!("{DPAPI_REF_PREFIX}{}", Uuid::new_v4())
}

pub fn is_dpapi_ref(credential_ref: &str) -> bool {
    credential_ref.starts_with(DPAPI_REF_PREFIX)
}

#[cfg(windows)]
pub fn protect_secret(secret: &str) -> Result<Vec<u8>, String> {
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
pub fn unprotect_secret(cipher: &[u8]) -> Result<String, String> {
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

fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("凭据不能为空".into());
    }
    Ok(())
}
