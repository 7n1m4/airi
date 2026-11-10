// SPDX-License-Identifier: GPL-3.0-or-later
#include "stage_qt_bridge.h"

void VrmGeometryShell::setBuffers(const QByteArray& vertexData,
                                  const QByteArray& indexData,
                                  int stride)
{
    clear();
    setVertexData(vertexData);
    if (!indexData.isEmpty())
        setIndexData(indexData);
    setStride(stride);
    // Attribute layout (mirrors src/vrm/geometry.rs interleaving):
    //   pos 3f, normal 3f, uv 2f, joints 4f, weights 4f = 16 f32 = 64 bytes
    //   offsets are in bytes within one vertex.
    addAttribute(Attribute::PositionSemantic, 0, Attribute::F32Type);
    addAttribute(Attribute::NormalSemantic, 12, Attribute::F32Type);
    addAttribute(Attribute::TexCoordSemantic, 24, Attribute::F32Type);
    addAttribute(Attribute::JointSemantic, 32, Attribute::U32Type);
    addAttribute(Attribute::WeightSemantic, 48, Attribute::F32Type);
}
