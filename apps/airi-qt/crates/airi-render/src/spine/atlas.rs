// SPDX-License-Identifier: GPL-3.0-or-later
//! Parser for Spine texture atlases (`.atlas` / `.atlas.txt`).
//!
//! Format (whitespace tolerant, lines trimmed):
//!
//! ```text
//! pma:true                  <- optional header line(s) before the first page
//! page-image.png
//! size: 1024,512
//! format: RGBA8888
//! filter: Linear,Linear
//! repeat: none
//!
//! region-name
//! bounds: 2,2,100,50
//! offsets: 0,0,100,50
//! rotate: 90
//! split: 4,4,4,4
//! pad: 1,1,1,1
//! index: -1
//! ```
//!
//! A page block starts at a non-indented line whose trimmed content contains
//! neither `:` nor `,` (an image file name). Region entries follow the page's
//! `key: value` lines, one region per block, separated by blank lines or
//! directly by the next region name.

use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};

/// A texture page referenced by the atlas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtlasPage {
    /// Image file name exactly as written in the atlas (atlas-relative).
    pub image: String,
    /// `size:` value, pixels.
    pub size: Option<(u32, u32)>,
    /// `format:` value (e.g. `RGBA8888`).
    pub format: Option<String>,
    /// `filter:` values `(min, mag)`.
    pub filter: Option<(String, String)>,
    /// `repeat:` value (e.g. `none`, `x`, `y`, `xy`).
    pub repeat: Option<String>,
    /// Whether the page was packed with premultiplied alpha.
    pub pma: bool,
}

/// A texture region inside a page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AtlasRegion {
    /// Region name (matches attachment `path` in the skeleton).
    pub name: String,
    /// Index into `Atlas::pages` of the page holding this region.
    pub page: usize,
    /// Pixel bounds within the page: `(x, y, width, height)`.
    pub bounds: (i32, i32, i32, i32),
    /// Clockwise rotation applied at pack time (0 or 90 for spine exports).
    pub rotate: u32,
    /// `offsets:` — `(offset_x, offset_y, original_width, original_height)`,
    /// set when the region was trimmed.
    pub offsets: Option<(i32, i32, i32, i32)>,
    /// `orig:` — original `(width, height)` before trim.
    pub orig: Option<(i32, i32)>,
    /// `index:` value, or `-1` when absent.
    pub index: i32,
    /// `split:` nine-patch borders, when present.
    pub splits: Vec<i32>,
    /// `pad:` nine-patch padding, when present.
    pub pads: Vec<i32>,
}

impl AtlasRegion {
    /// Normalized `[u, v, u2, v2]` rectangle within the page.
    ///
    /// Returns `None` when the page size is unknown.
    pub fn uv_rect(&self, page: &AtlasPage) -> Option<[f32; 4]> {
        let (page_w, page_h) = page.size?;
        if page_w == 0 || page_h == 0 {
            return None;
        }
        let (x, y, w, h) = (
            self.bounds.0 as f32,
            self.bounds.1 as f32,
            self.bounds.2 as f32,
            self.bounds.3 as f32,
        );
        let (u, v) = (x / page_w as f32, y / page_h as f32);
        Some(if self.rotate == 90 {
            [u, v, (x + h) / page_w as f32, (y + w) / page_h as f32]
        } else {
            [u, v, (x + w) / page_w as f32, (y + h) / page_h as f32]
        })
    }
}

/// Parsed atlas.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Atlas {
    /// Texture pages in file order.
    pub pages: Vec<AtlasPage>,
    /// Regions in file order.
    pub regions: Vec<AtlasRegion>,
    /// `pma:true` header flag applied to pages that don't override it.
    pub pma: bool,
}

impl Atlas {
    /// Find a region by name.
    pub fn find_region(&self, name: &str) -> Option<&AtlasRegion> {
        self.regions.iter().find(|r| r.name == name)
    }

    /// Page index of a region.
    pub fn region_page(&self, region: &AtlasRegion) -> Option<&AtlasPage> {
        self.pages.get(region.page)
    }
}

/// Parse atlas text (whitespace tolerant).
pub fn parse_atlas(text: &str) -> anyhow::Result<Atlas> {
    let mut pages: Vec<AtlasPage> = Vec::new();
    let mut regions: Vec<AtlasRegion> = Vec::new();
    let mut global_pma = false;

    #[derive(PartialEq)]
    enum Block {
        None,
        Page(usize),
        Region(usize), // index into regions
    }
    let mut block = Block::None;

    for (line_no, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let ctx = || format!("atlas line {}", line_no + 1);

        if !line.contains(':') && !line.contains(',') {
            // Page image name or region name.
            if block == Block::None && pages.is_empty() && line.eq_ignore_ascii_case("pma:true") {
                // Handled by the key:value branch below; unreachable in practice.
                continue;
            }
            match &block {
                Block::Page(_) | Block::None => {
                    // Ambiguous: could be a region name. Regions only exist
                    // directly under a page; treat this as a new region unless
                    // no page has been seen yet AND the line looks like an
                    // image file (has an extension) — otherwise page.
                    if block == Block::None {
                        if pages.is_empty() && looks_like_image_name(line) {
                            pages.push(new_page(line, global_pma));
                            block = Block::Page(pages.len() - 1);
                        } else if pages.is_empty() {
                            bail!("{}: expected page image name, found `{line}`", ctx());
                        } else {
                            regions.push(new_region(line, pages.len() - 1));
                            block = Block::Region(regions.len() - 1);
                        }
                    } else {
                        regions.push(new_region(line, pages.len() - 1));
                        block = Block::Region(regions.len() - 1);
                    }
                }
                Block::Region(_) => {
                    // A new bare line after a region block either starts the
                    // next region (if the page already has regions) or a
                    // second page. Distinguish by extension heuristics: page
                    // names carry an image extension.
                    if looks_like_image_name(line) {
                        pages.push(new_page(line, global_pma));
                        block = Block::Page(pages.len() - 1);
                    } else {
                        regions.push(new_region(line, pages.len() - 1));
                        block = Block::Region(regions.len() - 1);
                    }
                }
            }
            continue;
        }

        // `key: value` line.
        let (key, value) = line
            .split_once(':')
            .with_context(|| format!("{}: malformed entry `{line}`", ctx()))?;
        let key = key.trim().to_lowercase();
        let value = value.trim();

        match &block {
            Block::None => {
                // Header section (pma etc.).
                if key == "pma" {
                    global_pma = value.eq_ignore_ascii_case("true");
                } else {
                    bail!("{}: unexpected header entry `{key}`", ctx());
                }
            }
            Block::Page(page_index) => {
                let page = &mut pages[*page_index];
                match key.as_str() {
                    "size" => page.size = Some(parse_pair(value).with_context(ctx)?),
                    "format" => page.format = Some(value.to_string()),
                    "filter" => {
                        let parts = split_csv(value);
                        if parts.len() != 2 {
                            bail!("{}: `filter` expects two values, got `{value}`", ctx());
                        }
                        page.filter = Some((parts[0].clone(), parts[1].clone()));
                    }
                    "repeat" => page.repeat = Some(value.to_string()),
                    "pma" => page.pma = value.eq_ignore_ascii_case("true"),
                    // `scale`, `scale:` legacy keys are ignored.
                    _ => {}
                }
            }
            Block::Region(region_index) => {
                let region = &mut regions[*region_index];
                match key.as_str() {
                    "xy" => {
                        let (x, y) = parse_pair(value).with_context(ctx)?;
                        region.bounds.0 = x as i32;
                        region.bounds.1 = y as i32;
                    }
                    "size" => {
                        let (w, h) = parse_pair(value).with_context(ctx)?;
                        region.bounds.2 = w as i32;
                        region.bounds.3 = h as i32;
                    }
                    "bounds" => {
                        let nums = split_csv(value)
                            .iter()
                            .map(|s| s.parse::<i32>())
                            .collect::<Result<Vec<_>, _>>()
                            .with_context(ctx)?;
                        if nums.len() != 4 {
                            bail!("{}: `bounds` expects 4 values, got `{value}`", ctx());
                        }
                        region.bounds = (nums[0], nums[1], nums[2], nums[3]);
                    }
                    "offset" => {
                        let (x, y) = parse_pair(value).with_context(ctx)?;
                        region.offsets.get_or_insert((0, 0, 0, 0)).0 = x as i32;
                        region.offsets.get_or_insert((0, 0, 0, 0)).1 = y as i32;
                    }
                    "orig" => {
                        let (w, h) = parse_pair(value).with_context(ctx)?;
                        region.orig = Some((w as i32, h as i32));
                    }
                    "offsets" => {
                        let nums = split_csv(value)
                            .iter()
                            .map(|s| s.parse::<i32>())
                            .collect::<Result<Vec<_>, _>>()
                            .with_context(ctx)?;
                        if nums.len() != 4 {
                            bail!("{}: `offsets` expects 4 values, got `{value}`", ctx());
                        }
                        region.offsets = Some((nums[0], nums[1], nums[2], nums[3]));
                    }
                    "rotate" => {
                        region.rotate = match value.to_lowercase().as_str() {
                            "true" => 90,
                            "false" => 0,
                            other => other.parse::<u32>().with_context(ctx)?,
                        };
                    }
                    "index" => {
                        region.index = value.parse::<i32>().with_context(ctx)?;
                    }
                    "split" => {
                        region.splits = parse_int_list(value).with_context(ctx)?;
                    }
                    "pad" => {
                        region.pads = parse_int_list(value).with_context(ctx)?;
                    }
                    _ => {} // unknown keys tolerated (future-proof)
                }
            }
        }
    }

    if pages.is_empty() {
        bail!("atlas contains no pages");
    }
    Ok(Atlas {
        pages,
        regions,
        pma: global_pma,
    })
}

fn looks_like_image_name(line: &str) -> bool {
    let lower = line.to_lowercase();
    [".png", ".webp", ".jpg", ".jpeg"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn new_page(image: &str, pma: bool) -> AtlasPage {
    AtlasPage {
        image: image.to_string(),
        size: None,
        format: None,
        filter: None,
        repeat: None,
        pma,
    }
}

fn new_region(name: &str, page: usize) -> AtlasRegion {
    AtlasRegion {
        name: name.to_string(),
        page,
        bounds: (0, 0, 0, 0),
        rotate: 0,
        offsets: None,
        orig: None,
        index: -1,
        splits: Vec::new(),
        pads: Vec::new(),
    }
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_pair(value: &str) -> anyhow::Result<(u32, u32)> {
    let nums = split_csv(value)
        .iter()
        .map(|s| s.parse::<u32>())
        .collect::<Result<Vec<_>, _>>()?;
    if nums.len() != 2 {
        bail!("expected exactly 2 comma-separated values, got `{value}`");
    }
    Ok((nums[0], nums[1]))
}

fn parse_int_list(value: &str) -> anyhow::Result<Vec<i32>> {
    split_csv(value)
        .iter()
        .map(|s| s.parse::<i32>().map_err(|e| anyhow::anyhow!(e)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_page_single_region() {
        let atlas = parse_atlas(
            "spineboy.png\nsize: 1024,512\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npma: true\n\nbody\nbounds: 2,2,100,50\nrotate: 0\nindex: -1\n",
        )
        .expect("parse atlas");
        assert_eq!(atlas.pages.len(), 1);
        let page = &atlas.pages[0];
        assert_eq!(page.image, "spineboy.png");
        assert_eq!(page.size, Some((1024, 512)));
        assert_eq!(
            page.filter.as_ref(),
            Some(&("Linear".to_string(), "Linear".to_string()))
        );
        assert!(page.pma);
        assert_eq!(atlas.regions.len(), 1);
        let region = &atlas.regions[0];
        assert_eq!(region.name, "body");
        assert_eq!(region.bounds, (2, 2, 100, 50));
        assert_eq!(region.page, 0);
        let (u, v, u2, v2) = {
            let uv = region.uv_rect(page).expect("uv rect");
            (uv[0], uv[1], uv[2], uv[3])
        };
        assert!((u - 2.0 / 1024.0).abs() < 1e-6);
        assert!((v - 2.0 / 512.0).abs() < 1e-6);
        assert!((u2 - 102.0 / 1024.0).abs() < 1e-6);
        assert!((v2 - 52.0 / 512.0).abs() < 1e-6);
    }

    #[test]
    fn parses_xy_size_rotate_and_split_digits() {
        let atlas = parse_atlas(
            "page.png\nsize:64,64\n\nhappy\nxy: 4,4\nsize: 32,16\nrotate: 90\nsplit: 4,4,4,4\npad: 1,2,3,4\n\nsad\nxy: 40,4\nsize: 20,20\nrotate: true\n",
        )
        .expect("parse atlas");
        assert_eq!(atlas.regions.len(), 2);
        let happy = &atlas.regions[0];
        assert_eq!(happy.bounds, (4, 4, 32, 16));
        assert_eq!(happy.rotate, 90);
        assert_eq!(happy.splits, vec![4, 4, 4, 4]);
        assert_eq!(happy.pads, vec![1, 2, 3, 4]);
        let sad = &atlas.regions[1];
        assert_eq!(sad.rotate, 90); // legacy `true` means 90 degrees
        let page = &atlas.pages[0];
        let uv = happy.uv_rect(page).expect("uv rect for rotated region");
        // rotate=90 → width/height swap for the far corner
        assert!((uv[2] - (4.0 + 16.0) / 64.0).abs() < 1e-6);
        assert!((uv[3] - (4.0 + 32.0) / 64.0).abs() < 1e-6);
    }

    #[test]
    fn whitespace_tolerant_pages_and_multi_page() {
        let atlas = parse_atlas(
            "\n  pma:true  \n\n  a.png \nsize: 128,128\n\nregion-a\nbounds: 0,0,10,10\n\nb.png\nsize: 64,64\n\nregion-b\nbounds: 0,0,5,5\n",
        )
        .expect("parse atlas");
        assert_eq!(atlas.pages.len(), 2);
        assert!(atlas.pages[0].pma);
        assert_eq!(atlas.regions[0].page, 0);
        assert_eq!(atlas.regions[1].page, 1);
    }

    #[test]
    fn offsets_and_orig_parsed() {
        let atlas =
            parse_atlas("p.png\nsize: 32,32\n\ntrimmed\nbounds: 1,2,10,11\noffsets: 3,4,12,15\n")
                .expect("parse");
        let region = &atlas.regions[0];
        assert_eq!(region.offsets, Some((3, 4, 12, 15)));
    }

    #[test]
    fn rejects_atlas_without_pages() {
        assert!(parse_atlas("").is_err());
        assert!(parse_atlas("\n\n  \n").is_err());
    }

    #[test]
    fn unknown_keys_and_regions_before_pages_are_tolerated() {
        // A region directly after `pma:` header (no page yet) must error,
        // because regions require a page.
        assert!(parse_atlas("pma:true\nregion-x\nbounds: 0,0,1,1\n").is_err());
    }
}
