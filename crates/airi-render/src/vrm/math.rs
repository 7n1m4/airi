// SPDX-License-Identifier: GPL-3.0-or-later

//! Minimal 3D math for the CPU skinning path (no external dependencies).
//!
//! Column-major 4×4 matrices, right-handed coordinates — same conventions as
//! glTF. Only what the engine needs is implemented; nothing here is
//! allocation-heavy or `unsafe`.

/// 3D vector.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vec3 {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
    /// Z component.
    pub z: f32,
}

impl Vec3 {
    /// Zero vector.
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };

    /// Build from the array form used across the glTF layer.
    pub fn from_array(v: [f32; 3]) -> Self {
        Self {
            x: v[0],
            y: v[1],
            z: v[2],
        }
    }

    /// Array form (for writing back into interleaved buffers).
    pub fn to_array(self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }

    /// Dot product.
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    /// Cross product.
    pub fn cross(self, o: Self) -> Self {
        Self {
            x: self.y * o.z - self.z * o.y,
            y: self.z * o.x - self.x * o.z,
            z: self.x * o.y - self.y * o.x,
        }
    }

    /// Euclidean length.
    pub fn len(self) -> f32 {
        self.dot(self).sqrt()
    }

    /// Normalized vector (returns the zero vector unchanged).
    pub fn normalized(self) -> Self {
        let l = self.len();
        if l < 1e-8 {
            Self::ZERO
        } else {
            self * (1.0 / l)
        }
    }

    /// Add.
    #[allow(clippy::should_implement_trait)] // inherent math ops; keep the existing inherent-method API
    pub fn add(self, o: Self) -> Self {
        Self {
            x: self.x + o.x,
            y: self.y + o.y,
            z: self.z + o.z,
        }
    }

    /// Subtract.
    #[allow(clippy::should_implement_trait)] // inherent math ops; keep the existing inherent-method API
    pub fn sub(self, o: Self) -> Self {
        Self {
            x: self.x - o.x,
            y: self.y - o.y,
            z: self.z - o.z,
        }
    }

    /// Scale.
    pub fn scale(self, s: f32) -> Self {
        Self {
            x: self.x * s,
            y: self.y * s,
            z: self.z * s,
        }
    }
}

impl std::ops::Add for Vec3 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Vec3::add(self, o)
    }
}
impl std::ops::Sub for Vec3 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Vec3::sub(self, o)
    }
}
impl std::ops::Mul<f32> for Vec3 {
    type Output = Self;
    fn mul(self, s: f32) -> Self {
        Vec3::scale(self, s)
    }
}

/// Quaternion (x, y, z, w).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quat {
    /// X.
    pub x: f32,
    /// Y.
    pub y: f32,
    /// Z.
    pub z: f32,
    /// W.
    pub w: f32,
}

impl Quat {
    /// Identity rotation.
    pub const IDENTITY: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    /// Build from the glTF `[x, y, z, w]` array.
    pub fn from_array(v: [f32; 4]) -> Self {
        Self {
            x: v[0],
            y: v[1],
            z: v[2],
            w: v[3],
        }
    }

    /// Array form.
    pub fn to_array(self) -> [f32; 4] {
        [self.x, self.y, self.z, self.w]
    }

    /// Rotation from axis (unit) and angle in radians.
    pub fn from_axis_angle(axis: Vec3, angle: f32) -> Self {
        let half = angle * 0.5;
        let s = half.sin();
        let a = axis.normalized();
        Self {
            x: a.x * s,
            y: a.y * s,
            z: a.z * s,
            w: half.cos(),
        }
        .normalized()
    }

    /// Rotation mapping `from` onto `to` (both non-zero; `from == -to` picks
    /// any orthogonal axis).
    pub fn from_to(from: Vec3, to: Vec3) -> Self {
        let f = from.normalized();
        let t = to.normalized();
        let d = f.dot(t).clamp(-1.0, 1.0);
        if d > 1.0 - 1e-6 {
            return Self::IDENTITY;
        }
        if d < -1.0 + 1e-6 {
            // 180° turn: pick an arbitrary axis orthogonal to `f`.
            let axis = if f.x.abs() < 0.9 {
                Vec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                }
            } else {
                Vec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                }
            };
            let ortho = f.cross(axis).normalized();
            return Self::from_axis_angle(ortho, std::f32::consts::PI);
        }
        let axis = f.cross(t);
        let w = 1.0 + d;
        Self {
            x: axis.x,
            y: axis.y,
            z: axis.z,
            w,
        }
        .normalized()
    }

    /// Length.
    pub fn norm(self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt()
    }

    /// Normalized.
    pub fn normalized(self) -> Self {
        let n = self.norm();
        if n < 1e-8 {
            Self::IDENTITY
        } else {
            Self {
                x: self.x / n,
                y: self.y / n,
                z: self.z / n,
                w: self.w / n,
            }
        }
    }

    /// Hamilton product `self ∘ o` (apply `o` first, then `self`).
    #[allow(clippy::should_implement_trait)] // inherent math ops; keep the existing inherent-method API
    pub fn mul(self, o: Self) -> Self {
        let (x1, y1, z1, w1) = (self.x, self.y, self.z, self.w);
        let (x2, y2, z2, w2) = (o.x, o.y, o.z, o.w);
        Self {
            x: w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            y: w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            z: w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
            w: w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        }
    }

    /// Conjugate (== inverse for unit quaternions).
    pub fn conjugate(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
            z: -self.z,
            w: self.w,
        }
    }

    /// Inverse.
    pub fn inverse(self) -> Self {
        let n2 = self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w;
        if n2 < 1e-12 {
            return Self::IDENTITY;
        }
        let c = self.conjugate();
        Self {
            x: c.x / n2,
            y: c.y / n2,
            z: c.z / n2,
            w: c.w / n2,
        }
    }

    /// Rotate a vector.
    pub fn rotate_vec(self, v: Vec3) -> Vec3 {
        let qv = Self {
            x: v.x,
            y: v.y,
            z: v.z,
            w: 0.0,
        };
        let out = self.mul(qv).mul(self.conjugate());
        Vec3 {
            x: out.x,
            y: out.y,
            z: out.z,
        }
    }

    /// Rotation part of a basis-extracted 3×3 matrix (columns scaled out).
    pub fn from_mat3_columns(c0: Vec3, c1: Vec3, c2: Vec3) -> Self {
        let t = c0.x + c1.y + c2.z;
        if t > 0.0 {
            let s = (t + 1.0).sqrt() * 2.0;
            Self {
                x: (c2.y - c1.z) / s,
                y: (c0.z - c2.x) / s,
                z: (c1.x - c0.y) / s,
                w: s / 4.0,
            }
            .normalized()
        } else if c0.x > c1.y && c0.x > c2.z {
            let s = (1.0 + c0.x - c1.y - c2.z).sqrt() * 2.0;
            Self {
                x: s / 4.0,
                y: (c0.y + c1.x) / s,
                z: (c0.z + c2.x) / s,
                w: (c2.y - c1.z) / s,
            }
            .normalized()
        } else if c1.y > c2.z {
            let s = (1.0 + c1.y - c0.x - c2.z).sqrt() * 2.0;
            Self {
                x: (c0.y + c1.x) / s,
                y: s / 4.0,
                z: (c1.z + c2.y) / s,
                w: (c0.z - c2.x) / s,
            }
            .normalized()
        } else {
            let s = (1.0 + c2.z - c0.x - c1.y).sqrt() * 2.0;
            Self {
                x: (c0.z + c2.x) / s,
                y: (c1.z + c2.y) / s,
                z: s / 4.0,
                w: (c1.x - c0.y) / s,
            }
            .normalized()
        }
    }
}

impl std::ops::Mul for Quat {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        Quat::mul(self, o)
    }
}

/// Column-major 4×4 matrix.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mat4 {
    /// Column-major elements (`m[col * 4 + row]`).
    pub m: [f32; 16],
}

impl Mat4 {
    /// Identity.
    pub const IDENTITY: Self = Self {
        m: [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ],
    };

    /// Build from the glTF `[[f32; 4]; 4]` matrix (column-major nested arrays).
    pub fn from_gltf_matrix(m: [[f32; 4]; 4]) -> Self {
        let mut out = [0.0f32; 16];
        for (c, col) in m.iter().enumerate() {
            for r in 0..4 {
                out[c * 4 + r] = col[r];
            }
        }
        Self { m: out }
    }

    /// Build from a pre-flattened column-major `[f32; 16]`.
    pub fn from_column_major(m: [f32; 16]) -> Self {
        Self { m }
    }

    /// Flattened column-major array.
    pub fn to_column_major(self) -> [f32; 16] {
        self.m
    }

    /// Compose from TRS.
    pub fn compose(t: [f32; 3], r: Quat, s: [f32; 3]) -> Self {
        let q = r.normalized();
        let (x, y, z, w) = (q.x, q.y, q.z, q.w);
        let x2 = x + x;
        let y2 = y + y;
        let z2 = z + z;
        let xx = x * x2;
        let xy = x * y2;
        let xz = x * z2;
        let yy = y * y2;
        let yz = y * z2;
        let zz = z * z2;
        let wx = w * x2;
        let wy = w * y2;
        let wz = w * z2;
        let sx = s[0];
        let sy = s[1];
        let sz = s[2];
        Self {
            m: [
                (1.0 - (yy + zz)) * sx,
                (xy + wz) * sx,
                (xz - wy) * sx,
                0.0,
                //
                (xy - wz) * sy,
                (1.0 - (xx + zz)) * sy,
                (yz + wx) * sy,
                0.0,
                //
                (xz + wy) * sz,
                (yz - wx) * sz,
                (1.0 - (xx + yy)) * sz,
                0.0,
                //
                t[0],
                t[1],
                t[2],
                1.0,
            ],
        }
    }

    /// Matrix product `self * o`.
    #[allow(clippy::should_implement_trait)] // inherent math ops; keep the existing inherent-method API
    pub fn mul(self, o: Self) -> Self {
        let a = &self.m;
        let b = &o.m;
        let mut out = [0.0f32; 16];
        for col in 0..4 {
            for row in 0..4 {
                let mut acc = 0.0;
                for k in 0..4 {
                    acc += a[k * 4 + row] * b[col * 4 + k];
                }
                out[col * 4 + row] = acc;
            }
        }
        Self { m: out }
    }

    /// Transform a point (w = 1, perspective divide applied).
    pub fn transform_point(self, v: Vec3) -> Vec3 {
        let m = &self.m;
        let x = v.x;
        let y = v.y;
        let z = v.z;
        let px = m[0] * x + m[4] * y + m[8] * z + m[12];
        let py = m[1] * x + m[5] * y + m[9] * z + m[13];
        let pz = m[2] * x + m[6] * y + m[10] * z + m[14];
        let pw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if pw.abs() > 1e-8 && (pw - 1.0).abs() > 1e-6 {
            Vec3 {
                x: px / pw,
                y: py / pw,
                z: pz / pw,
            }
        } else {
            Vec3 {
                x: px,
                y: py,
                z: pz,
            }
        }
    }

    /// Transform a direction (w = 0), without normalization.
    pub fn transform_dir(self, v: Vec3) -> Vec3 {
        let m = &self.m;
        let x = v.x;
        let y = v.y;
        let z = v.z;
        Vec3 {
            x: m[0] * x + m[4] * y + m[8] * z,
            y: m[1] * x + m[5] * y + m[9] * z,
            z: m[2] * x + m[6] * y + m[10] * z,
        }
    }

    /// Translation column.
    pub fn translation(self) -> Vec3 {
        Vec3 {
            x: self.m[12],
            y: self.m[13],
            z: self.m[14],
        }
    }

    /// Rotation of the matrix (assumes the 3×3 part is a scaled rotation;
    /// columns are normalized first).
    pub fn rotation(self) -> Quat {
        let m = &self.m;
        let c0 = Vec3 {
            x: m[0],
            y: m[1],
            z: m[2],
        };
        let c1 = Vec3 {
            x: m[4],
            y: m[5],
            z: m[6],
        };
        let c2 = Vec3 {
            x: m[8],
            y: m[9],
            z: m[10],
        };
        Quat::from_mat3_columns(c0.normalized(), c1.normalized(), c2.normalized())
    }

    /// Affine inverse (3×3 + translation). Returns identity for a singular
    /// 3×3 part rather than producing NaNs.
    pub fn inverse_affine(self) -> Self {
        let m = &self.m;
        // Columns of the 3×3 block.
        let c0 = Vec3 {
            x: m[0],
            y: m[1],
            z: m[2],
        };
        let c1 = Vec3 {
            x: m[4],
            y: m[5],
            z: m[6],
        };
        let c2 = Vec3 {
            x: m[8],
            y: m[9],
            z: m[10],
        };
        // Determinant of the 3×3 block.
        let det = c0.dot(c1.cross(c2));
        if det.abs() < 1e-12 {
            return Self::IDENTITY;
        }
        let inv_det = 1.0 / det;
        // Rows of the adjugate (inverse columns).
        let r0 = c1.cross(c2) * inv_det;
        let r1 = c2.cross(c0) * inv_det;
        let r2 = c0.cross(c1) * inv_det;
        let inv3 = [
            r0.x, r1.x, r2.x, 0.0, // column 0
            r0.y, r1.y, r2.y, 0.0, // column 1
            r0.z, r1.z, r2.z, 0.0, // column 2
        ];
        let t = Vec3 {
            x: m[12],
            y: m[13],
            z: m[14],
        };
        let it0 = -(inv3[0] * t.x + inv3[4] * t.y + inv3[8] * t.z);
        let it1 = -(inv3[1] * t.x + inv3[5] * t.y + inv3[9] * t.z);
        let it2 = -(inv3[2] * t.x + inv3[6] * t.y + inv3[10] * t.z);
        Self {
            m: [
                inv3[0], inv3[1], inv3[2], 0.0, //
                inv3[4], inv3[5], inv3[6], 0.0, //
                inv3[8], inv3[9], inv3[10], 0.0, //
                it0, it1, it2, 1.0,
            ],
        }
    }
}

impl std::ops::Mul for Mat4 {
    type Output = Self;
    fn mul(self, o: Self) -> Self {
        Mat4::mul(self, o)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_roundtrip_point() {
        let m = Mat4::compose([1.0, 2.0, 3.0], Quat::IDENTITY, [2.0, 2.0, 2.0]);
        let p = m.transform_point(Vec3::from_array([1.0, 1.0, 1.0]));
        assert!((p.x - 3.0).abs() < 1e-6 && (p.y - 4.0).abs() < 1e-6 && (p.z - 5.0).abs() < 1e-6);
    }

    #[test]
    fn inverse_affine_recovers_original() {
        let q = Quat::from_axis_angle(Vec3::from_array([0.0, 1.0, 0.0]), 0.7);
        let m = Mat4::compose([0.3, -1.2, 4.0], q, [1.5, 0.8, 1.2]);
        let inv = m.inverse_affine();
        let id = m.mul(inv);
        for i in 0..16 {
            let expect = if i % 5 == 0 { 1.0 } else { 0.0 };
            assert!((id.m[i] - expect).abs() < 1e-4, "column {i}: {}", id.m[i]);
        }
    }

    #[test]
    fn quat_from_to_rotates_vector() {
        let from = Vec3::from_array([0.0, 1.0, 0.0]);
        let to = Vec3::from_array([1.0, 0.0, 0.0]);
        let q = Quat::from_to(from, to);
        let out = q.rotate_vec(from).normalized();
        assert!((out.x - 1.0).abs() < 1e-5 && out.y.abs() < 1e-5 && out.z.abs() < 1e-5);
    }

    #[test]
    fn quat_from_to_opposite_vectors() {
        let from = Vec3::from_array([1.0, 0.0, 0.0]);
        let to = Vec3::from_array([-1.0, 0.0, 0.0]);
        let q = Quat::from_to(from, to);
        let out = q.rotate_vec(from);
        assert!((out.x + 1.0).abs() < 1e-5 && out.y.abs() < 1e-5 && out.z.abs() < 1e-5);
    }
}
