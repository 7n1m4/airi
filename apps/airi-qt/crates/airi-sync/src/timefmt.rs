// SPDX-License-Identifier: GPL-3.0-or-later
//! UTC timestamp helpers for snapshot ids.
//!
//! std-only civil-from-days conversion (Howard Hinnant's algorithm); no
//! chrono/time dependency is pulled in for one formatter.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Days from civil date (algorithm from
/// <https://howardhinnant.github.io/date_algorithms.html#civil_from_days>).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Render a unix millisecond timestamp as `(year, month, day, hour, minute)`
/// in UTC.
fn utc_parts(created_unix_ms: i64) -> (i64, u32, u32, u32, u32) {
    let total_secs = created_unix_ms.div_euclid(1000);
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    (
        y,
        m,
        d,
        (secs_of_day / 3600) as u32,
        ((secs_of_day % 3600) / 60) as u32,
    )
}

/// Deterministic-per-process unique suffix: 4 lowercase hex chars derived
/// from a sha256 of (time nanos, pid, atomic counter). Not a security
/// boundary — it only needs to disambiguate snapshots created in the same
/// minute.
fn unique_suffix() -> String {
    use sha2::{Digest, Sha256};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(counter.to_le_bytes());
    let digest = hasher.finalize();
    format!("{:02x}{:02x}", digest[0], digest[1])
}

/// Build a snapshot id of the form `YYYYMMDDTHHMMZ-a1b2` (UTC).
///
/// Uniqueness within the same minute comes from [`unique_suffix`]; callers
/// that hit a filesystem collision should regenerate (the creator does so
/// in a short retry loop).
pub(crate) fn snapshot_id(created_unix_ms: i64) -> String {
    let (y, month, day, hour, minute) = utc_parts(created_unix_ms);
    format!(
        "{y:04}{month:02}{day:02}T{hour:02}{minute:02}Z-{}",
        unique_suffix()
    )
}
