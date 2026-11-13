// SPDX-License-Identifier: GPL-3.0-or-later
//! Generic model-bundle loader for AIRI model packages (Spine `.zip` today,
//! VRM bundles later).
//!
//! [`ModelBundle::open`] reads a `.zip` archive, locates the entries it
//! knows, and extracts them into an app-wide cache under
//! `<platform-data>/airi-slint/model-cache/<slug>-<hash>/`.
//!
//! The cache always lives in the platform data directory. It is an app
//! cache, not profile state: `--profile` is intentionally NOT honored here.
//!
//! The cache key is `sha256` of the canonical (as-read) zip bytes plus a
//! filesystem-friendly slug of the archive file name. A bundle is considered
//! cached once `.complete` and `manifest.json` exist in its directory; the
//! extraction goes through a temporary sibling directory and a rename so a
//! crashed extraction never poisons the cache.

use anyhow::{anyhow, bail, Context};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// One extracted member of the bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleEntry {
    /// Path of the member inside the zip (forward slashes).
    pub zip_path: String,
    /// Absolute path of the extracted file on disk.
    pub extracted_path: PathBuf,
    /// Size in bytes.
    pub len: u64,
}

/// A model package extracted (or cache-hit) on disk.
#[derive(Debug, Clone)]
pub struct ModelBundle {
    /// Directory holding the extracted entries.
    pub root: PathBuf,
    /// Directory contents as recorded in the manifest.
    pub entries: Vec<BundleEntry>,
    /// Hex-encoded sha256 of the archive bytes.
    pub hash: String,
    /// Whether this open reused the on-disk cache.
    pub cache_hit: bool,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    hash: String,
    source_name: String,
    entries: Vec<ManifestEntry>,
}

#[derive(Serialize, Deserialize)]
struct ManifestEntry {
    zip_path: String,
    file_name: String,
    len: u64,
}

const MARKER: &str = ".complete";
const MANIFEST: &str = "manifest.json";

impl ModelBundle {
    /// Open a model bundle zip: hash it, reuse the extraction cache when
    /// present, otherwise extract into a fresh cache directory and mark it
    /// complete.
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("model")
            .to_string();
        Self::open_bytes(&bytes, &name)
    }

    /// Same as [`ModelBundle::open`] but from in-memory bytes. `name` is only
    /// used for the cache slug.
    pub fn open_bytes(bytes: &[u8], name: &str) -> anyhow::Result<Self> {
        let cache_root = model_cache_root()?;
        Self::open_bytes_with_root(bytes, name, &cache_root)
    }

    /// Same as [`ModelBundle::open_bytes`] but extracts into an explicit
    /// cache root instead of the platform data dir. Used by tests; the
    /// public contract (platform data dir, never `--profile`) is unchanged.
    pub fn open_bytes_with_root(
        bytes: &[u8],
        name: &str,
        cache_root: &Path,
    ) -> anyhow::Result<Self> {
        let hash = hex_sha256(bytes);
        let slug = slugify(name);
        let dest = cache_root.join(format!("{slug}-{}", &hash[..16]));

        if dest.join(MARKER).is_file() && dest.join(MANIFEST).is_file() {
            match Self::from_cache(&dest, &hash) {
                Ok(bundle) => return Ok(bundle),
                Err(_) => {
                    // Corrupt/incomplete cache entry — re-extract.
                    let _ = fs::remove_dir_all(&dest);
                }
            }
        }

        let entries = extract_to_temp_then_rename(bytes, cache_root, &dest, &hash, name)?;
        Ok(ModelBundle {
            root: dest,
            entries,
            hash,
            cache_hit: false,
        })
    }

    fn from_cache(dest: &Path, hash: &str) -> anyhow::Result<Self> {
        let manifest_bytes = fs::read(dest.join(MANIFEST)).context("read manifest")?;
        let manifest: Manifest =
            serde_json::from_slice(&manifest_bytes).context("parse manifest")?;
        if manifest.hash != hash {
            bail!(
                "manifest hash mismatch (cache entry for {})",
                manifest.source_name
            );
        }
        let mut entries = Vec::with_capacity(manifest.entries.len());
        for entry in manifest.entries {
            let extracted = safe_join(dest, &entry.file_name)
                .ok_or_else(|| anyhow!("manifest entry escapes cache dir: {}", entry.file_name))?;
            if !extracted.is_file() {
                bail!("cached entry missing: {}", entry.file_name);
            }
            entries.push(BundleEntry {
                zip_path: entry.zip_path,
                extracted_path: extracted,
                len: entry.len,
            });
        }
        Ok(ModelBundle {
            root: dest.to_path_buf(),
            entries,
            hash: hash.to_string(),
            cache_hit: true,
        })
    }

    /// All entries whose zip path ends with one of `exts` (case-insensitive,
    /// leading dot optional).
    pub fn find(&self, exts: &[&str]) -> Vec<&BundleEntry> {
        self.entries
            .iter()
            .filter(|entry| {
                let lower = entry.zip_path.to_lowercase();
                exts.iter().any(|ext| {
                    let ext = ext.trim_start_matches('.').to_lowercase();
                    lower.ends_with(&format!(".{ext}"))
                })
            })
            .collect()
    }

    /// First entry matching `ext`, if any.
    pub fn find_first(&self, ext: &str) -> Option<&BundleEntry> {
        self.find(&[ext]).into_iter().next()
    }

    /// Read an entry's bytes from disk.
    pub fn read_entry(&self, entry: &BundleEntry) -> anyhow::Result<Vec<u8>> {
        Ok(fs::read(&entry.extracted_path)?)
    }
}

/// Spine-specific view over a [`ModelBundle`]: locates the skeleton, atlas
/// and texture pages that the Spine runtime consumes.
#[derive(Debug, Clone)]
pub struct SpineBundleLayout {
    /// Path of the skeleton file inside the bundle.
    pub skeleton_zip_path: String,
    /// Whether the skeleton is binary (`.skel`) or JSON (`.json`).
    pub skeleton_binary: bool,
    /// Path of the atlas file inside the bundle.
    pub atlas_zip_path: String,
    /// Full classification of texture pages (zip paths), as located in the bundle.
    pub texture_zip_paths: Vec<String>,
}

impl ModelBundle {
    /// Locate the spine entry points (`*.atlas`, `*.json`|`*.skel`, textures).
    ///
    /// When multiple skeletons exist (multi-variant zips) the first one in
    /// sorted zip order is picked; variant selection is a UI concern, not the
    /// loader's.
    pub fn spine_layout(&self) -> Option<SpineBundleLayout> {
        let atlas = self.find_first("atlas").or_else(|| {
            self.entries
                .iter()
                .find(|e| e.zip_path.to_lowercase().ends_with(".atlas.txt"))
        })?;

        let skeleton_json = self
            .entries
            .iter()
            .filter(|e| e.zip_path.to_lowercase().ends_with(".json"))
            .find(|e| !is_manifest_json(&e.zip_path));
        let skeleton_skel = self.find_first("skel");

        // Prefer .skel when both exist (matches editor exports containing
        // both), otherwise fall back to the JSON skeleton.
        let (skeleton_zip_path, skeleton_binary) = match (skeleton_skel, skeleton_json) {
            (Some(skel), _) => (skel.zip_path.clone(), true),
            (None, Some(json)) => (json.zip_path.clone(), false),
            (None, None) => return None,
        };

        let textures: Vec<String> = self
            .entries
            .iter()
            .filter(|e| {
                let lower = e.zip_path.to_lowercase();
                [".png", ".webp", ".jpg", ".jpeg"]
                    .iter()
                    .any(|ext| lower.ends_with(ext))
            })
            .map(|e| e.zip_path.clone())
            .collect();

        Some(SpineBundleLayout {
            skeleton_zip_path,
            skeleton_binary,
            atlas_zip_path: atlas.zip_path.clone(),
            texture_zip_paths: textures,
        })
    }

    /// Convenience: zip-path → extracted path map for all entries (used to
    /// resolve atlas-relative page paths and texture loads).
    pub fn path_map(&self) -> BTreeMap<String, PathBuf> {
        self.entries
            .iter()
            .map(|e| (e.zip_path.clone(), e.extracted_path.clone()))
            .collect()
    }
}

fn is_manifest_json(zip_path: &str) -> bool {
    let lower = zip_path.to_lowercase();
    let base = lower.rsplit('/').next().unwrap_or(&lower);
    matches!(
        base,
        "model0.json" | "package.json" | "index.json" | "manifest.json" | "spine.project.json"
    )
}

fn extract_to_temp_then_rename(
    bytes: &[u8],
    cache_root: &Path,
    dest: &Path,
    hash: &str,
    source_name: &str,
) -> anyhow::Result<Vec<BundleEntry>> {
    fs::create_dir_all(cache_root).context("create model-cache root")?;

    let tmp = cache_root.join(format!(".tmp-{}-{}", std::process::id(), &hash[..16]));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).context("create temp extraction dir")?;

    let result = (|| -> anyhow::Result<Vec<BundleEntry>> {
        let reader = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(reader).context("not a readable zip archive")?;

        let mut entries = Vec::new();
        let mut used_names = BTreeMap::<String, usize>::new();
        for index in 0..archive.len() {
            let mut member = archive.by_index(index).context("read zip member")?;
            if member.is_dir() {
                continue;
            }
            let raw_name = member
                .name()
                .context("read zip member name")?
                .as_ref()
                .replace('\\', "/");
            let Some(zip_path) = sanitize_zip_path(&raw_name) else {
                continue; // skip absolute / parent-escaping members
            };
            let flat = flatten_name(&zip_path, &mut used_names);
            let target = tmp.join(&flat);
            let mut out = fs::File::create(&target)
                .with_context(|| format!("create {}", target.display()))?;
            let len = std::io::copy(&mut member, &mut out).context("extract zip member")?;
            entries.push(BundleEntry {
                zip_path,
                extracted_path: dest.join(&flat), // final location after rename
                len,
            });
        }

        // Rewrite paths to the final (renamed) directory.
        let manifest = Manifest {
            hash: hash.to_string(),
            source_name: source_name.to_string(),
            entries: entries
                .iter()
                .map(|e| ManifestEntry {
                    zip_path: e.zip_path.clone(),
                    file_name: e
                        .extracted_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default()
                        .to_string(),
                    len: e.len,
                })
                .collect(),
        };
        fs::write(tmp.join(MANIFEST), serde_json::to_vec_pretty(&manifest)?)
            .context("write manifest")?;
        fs::write(tmp.join(MARKER), hash.as_bytes()).context("write marker")?;
        Ok(entries)
    })();

    match result {
        Ok(entries) => {
            // Swap into place. If the destination already exists (another
            // process won the race), discard the temp dir and use theirs.
            match fs::rename(&tmp, dest) {
                Ok(()) => Ok(entries),
                Err(_) if dest.join(MARKER).is_file() => {
                    let _ = fs::remove_dir_all(&tmp);
                    ModelBundle::from_cache(dest, hash).map(|b| b.entries)
                }
                Err(error) => {
                    let _ = fs::remove_dir_all(&tmp);
                    Err(error).context("install model-cache entry")
                }
            }
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&tmp);
            Err(error)
        }
    }
}

fn sanitize_zip_path(name: &str) -> Option<String> {
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => continue,
            ".." => return None,
            p if p.contains(':') || p.contains('\0') => return None,
            p => parts.push(p),
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// Flatten a zip path into a unique cache file name (keeps the basename,
/// disambiguates collisions). Entries are re-paired to zip paths through the
/// manifest, so flat naming does not lose information.
fn flatten_name(zip_path: &str, used: &mut BTreeMap<String, usize>) -> String {
    let base = zip_path.rsplit('/').next().unwrap_or(zip_path);
    let base = sanitize_file_name(base);
    let count = used.entry(base.clone()).or_insert(0);
    let flat = if *count == 0 {
        base.clone()
    } else {
        let stem = base.trim_end_matches('.');
        match base.rsplit_once('.') {
            Some((stem, ext)) => format!("{stem}-{}.{ext}", *count),
            None => format!("{stem}-{}", *count),
        }
    };
    *count += 1;
    flat
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn safe_join(root: &Path, file_name: &str) -> Option<PathBuf> {
    if file_name.contains('/')
        || file_name.contains('\\')
        || file_name == ".."
        || file_name.is_empty()
    {
        return None;
    }
    Some(root.join(file_name))
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = slug.trim_matches('-');
    let trimmed = if trimmed.is_empty() { "model" } else { trimmed };
    trimmed.chars().take(48).collect()
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// `<platform-data>/airi-slint/model-cache`. Not profile-scoped on purpose: the
/// extraction cache is app state, not user state.
///
/// The cache always lives in the platform data directory and never honors
/// `--profile`; it holds extracted copies of shipped model data, keyed by
/// archive hash.
pub fn model_cache_root() -> anyhow::Result<PathBuf> {
    let base = dirs::data_dir().context("failed to resolve platform data directory")?;
    Ok(base.join("airi-slint").join("model-cache"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (name, data) in entries {
                writer.start_file(*name, options).expect("start zip member");
                writer.write_all(data).expect("write zip member");
            }
            writer.finish().expect("finish zip");
        }
        buf.into_inner()
    }

    fn test_root(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("airi-bundle-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn synthetic_zip() -> Vec<u8> {
        build_zip(&[
            ("dummy.atlas", b"spineboy.png\nsize:64,64\nformat:RGBA8888\nfilter:Linear,Linear\n\nbody\nbounds:2,2,60,60\nrotate:0\n"),
            ("skeleton.json", br#"{"skeleton":{"spine":"4.2.18"},"bones":[{"name":"root"}],"animations":{"idle":{"bones":{}}}}"#),
            ("tex.png", &[]),
        ])
    }

    #[test]
    fn bundle_extracts_and_locations_entries() {
        let zip = synthetic_zip();
        let bundle =
            ModelBundle::open_bytes_with_root(&zip, "synthetic-test", &test_root("extract"))
                .expect("open bundle");
        assert!(!bundle.cache_hit);
        let atlas = bundle.find_first("atlas").expect("atlas entry");
        assert_eq!(atlas.zip_path, "dummy.atlas");
        let skel = bundle.find_first("json").expect("skeleton entry");
        assert_eq!(skel.zip_path, "skeleton.json");
        let png = bundle.find_first("png").expect("png entry");
        assert_eq!(png.zip_path, "tex.png");
        assert!(bundle.root.join("dummy.atlas").is_file());
        let layout = bundle.spine_layout().expect("spine layout");
        assert_eq!(layout.skeleton_zip_path, "skeleton.json");
        assert!(!layout.skeleton_binary);
        assert_eq!(layout.texture_zip_paths, vec!["tex.png".to_string()]);
    }

    #[test]
    fn second_open_hits_cache() {
        let zip = synthetic_zip();
        let cache_dir = test_root("cache");
        let first = ModelBundle::open_bytes_with_root(&zip, "synthetic-cache-test", &cache_dir)
            .expect("first open");
        let second = ModelBundle::open_bytes_with_root(&zip, "synthetic-cache-test", &cache_dir)
            .expect("second open");
        assert!(!first.cache_hit);
        assert!(second.cache_hit);
        assert_eq!(first.root, second.root);
        assert_eq!(first.entries.len(), second.entries.len());
    }

    #[test]
    fn corrupt_zip_errors_cleanly() {
        let result = ModelBundle::open_bytes_with_root(
            b"this is not a zip",
            "synthetic-corrupt-test",
            &test_root("corrupt"),
        );
        assert!(result.is_err());
        let message = format!("{:#}", result.err().unwrap());
        assert!(message.contains("zip"), "unexpected error: {message}");
    }

    #[test]
    fn zip_slip_members_are_rejected() {
        let zip = build_zip(&[
            ("../evil.txt", b"nope"),
            ("ok.atlas", b"ok-page\nsize:1,1\n"),
        ]);
        let bundle =
            ModelBundle::open_bytes_with_root(&zip, "synthetic-slip-test", &test_root("slip"))
                .expect("open");
        assert_eq!(bundle.entries.len(), 1);
        assert_eq!(bundle.entries[0].zip_path, "ok.atlas");
    }
}
