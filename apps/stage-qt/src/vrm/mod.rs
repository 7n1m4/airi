// SPDX-License-Identifier: GPL-3.0-or-later

//! VRM document model.
//!
//! Parses `.vrm` (binary glTF) with the `gltf` crate and layers the VRM
//! extension schemas (0.x and 1.0) into a single [`VrmDocument`] that the
//! geometry builder, skeleton, and engines consume.

pub mod doc;
pub mod expression;
pub mod gaze;
pub mod geometry;
pub mod idle;
pub mod lipsync;
pub mod materials;
pub mod morph;
pub mod skin;
pub mod springbone;

use doc::VrmExtensions;
use std::path::Path;

/// Parsed VRM document ready for geometry building.
#[derive(Debug)]
pub struct VrmDocument {
    /// glTF document (nodes, meshes, skins, materials, images).
    pub gltf: gltf::Document,
    /// Binary blob (accessor buffer data).
    pub blob: Vec<u8>,
    /// VRM extension data (0.x and/or 1.0).
    pub extensions: VrmExtensions,
}

impl VrmDocument {
    /// Load and parse a `.vrm` file from disk.
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let (doc, buffers, _images) = gltf::import(path)?;
        let blob = buffers.into_iter().next().map(|b| b.0).unwrap_or_default();
        let extensions = VrmExtensions::extract(&doc);
        Ok(Self {
            gltf: doc,
            blob,
            extensions,
        })
    }
}
