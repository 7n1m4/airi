// SPDX-License-Identifier: GPL-3.0-or-later

//! Rust ↔ Qt bridge objects (`#[cxx_qt::bridge]`).
//!
//! - [`StageApp`] — application controller exposed to QML (properties +
//!   invokables only; heavy logic lives in `protocol`/`vrm` modules).
//! - [`VrmGeometry`] — `QQuick3DGeometry` subclass exposing staged buffers.
//!
//! The C++ base type `QQuick3DGeometry` is declared as an opaque extern
//! (no `#[qobject]`), so cxx-qt generates `QObject`-level constructors that
//! fail to compile against `QQuick3DGeometry(QQuick3DObject*)`. To get a
//! working QML element we instead use the pre-decided fallback from the plan:
//! the C++ shell `VrmGeometryShell` (`src/cpp/stage_qt_bridge.h`), which
//! derives from `QQuick3DGeometry` correctly. `VrmGeometryShell` is registered
//! to QML by cxx-qt from the C++ side (see `src/cpp/stage_qt_bridge.cpp`).
//!
//! The Rust-side [`VrmGeometry`] QObject is kept for the staged-buffer API
//! but is NOT registered to QML; QML uses `VrmGeometryShell`.

/// cxx-qt bridge definitions.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!(<QtQuick3D/QQuick3DGeometry>);
        /// Base class for VrmGeometry (opaque to Rust; shell derives it).
        type QQuick3DGeometry;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qbytearray.h");
        /// QByteArray from cxx-qt-lib.
        type QByteArray = cxx_qt_lib::QByteArray;

        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Application controller exposed to QML.
        #[qobject]
        #[qml_element]
        #[namespace = "stage_app"]
        #[qproperty(QString, status)]
        #[qproperty(QString, model_id)]
        #[qproperty(bool, ready)]
        type StageApp = super::StageAppRust;
    }

    extern "RustQt" {
        /// Called when the QML scene is ready (no-op yet; protocol in step 2).
        #[qinvokable]
        fn scene_ready(self: Pin<&mut StageApp>);
    }

    extern "RustQt" {
        /// Staged-geometry helper (not QML-registered; buffer staging only).
        #[qobject]
        #[namespace = "vrm_geometry"]
        type VrmGeometry = super::VrmGeometryRust;
    }
}

use std::pin::Pin;
use cxx_qt_lib::{QByteArray, QString};

/// Rust storage for `StageApp`.
#[derive(Default)]
pub struct StageAppRust {
    /// Short status line shown in the placeholder window.
    status: QString,
    /// Active model id (empty until `stage:vrm:load`).
    model_id: QString,
    /// Whether a model finished loading.
    ready: bool,
}

impl qobject::StageApp {
    /// Invokable marker for QML `onCompleted`.
    pub fn scene_ready(self: Pin<&mut Self>) {
        self.set_status(QString::from("StageApp ready"));
    }
}

/// Rust storage for `VrmGeometry` (buffer staging only; not QML-registered).
#[derive(Default)]
pub struct VrmGeometryRust {
    /// Interleaved vertex buffer (16 f32/vertex).
    pub vertex_bytes: Vec<u8>,
    /// u32 index buffer.
    pub index_bytes: Vec<u8>,
    /// Morph target buffer (position+normal deltas per slot).
    pub target_bytes: Vec<u8>,
    /// Vertex stride in bytes.
    pub stride: i32,
    /// Number of morph slots.
    pub morph_count: i32,
}

impl qobject::VrmGeometry {
    /// Convert staged f32 vertex floats to raw bytes (helper for the C++
    /// shell path; the Rust geometry builder calls this before pushing).
    pub fn pack_f32_vertices(&self, verts: &[f32]) -> Vec<u8> {
        let mut out = Vec::with_capacity(verts.len() * 4);
        for v in verts {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    /// Pack u32 indices to raw bytes.
    pub fn pack_u32_indices(&self, idx: &[u32]) -> Vec<u8> {
        let mut out = Vec::with_capacity(idx.len() * 4);
        for i in idx {
            out.extend_from_slice(&i.to_le_bytes());
        }
        out
    }

    /// `QByteArray` convenience (unused; kept for the bridge surface).
    pub fn as_qbytearray(bytes: &[u8]) -> QByteArray {
        QByteArray::from(bytes)
    }
}
