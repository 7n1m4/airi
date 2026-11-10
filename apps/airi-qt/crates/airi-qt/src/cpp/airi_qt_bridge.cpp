// SPDX-License-Identifier: GPL-3.0-or-later

#include "airi_qt_bridge.h"

#include <cstdio>
#include <cstring>
#include <limits>
#include <QVector3D>
#include <QtCore/QMessageLogContext>
#include <QtCore/QtMessageHandler>

// Qt's default message handler output is discarded on some Linux builds, so
// the app installs its own handler and prints every Qt message with the
// [airi-qt][Qt] prefix. Keeps engine/QML errors on stderr.
static void airiMessageHandler(QtMsgType, const QMessageLogContext &, const QString &msg)
{
    fprintf(stderr, "[airi-qt][Qt] %s\n", msg.toUtf8().constData());
}

extern "C" void airi_install_message_handler()
{
    qInstallMessageHandler(airiMessageHandler);
}

void AiriVrmGeometryShell::setBuffers(const QByteArray& vertexData, const QByteArray& indexData, int stride)
{
    clear();
    setVertexData(vertexData);
    if (!indexData.isEmpty()) {
        setIndexData(indexData);
        addAttribute(Attribute::IndexSemantic, 0, Attribute::U32Type);
    }
    setStride(stride);
    addAttribute(Attribute::PositionSemantic, 0, Attribute::F32Type);
    addAttribute(Attribute::NormalSemantic, 12, Attribute::F32Type);
    addAttribute(Attribute::TexCoordSemantic, 24, Attribute::F32Type);
    addAttribute(Attribute::JointSemantic, 32, Attribute::U32Type);
    addAttribute(Attribute::WeightSemantic, 48, Attribute::F32Type);
    // Generous static bounds so CPU-skinned updates stay inside the frustum:
    // scan the position attribute and pad it for morph/spring motion.
    const int strideF = stride / 4; // stride is in bytes; positions are 3x f32
    float minX = std::numeric_limits<float>::max(), minY = minX, minZ = minX;
    float maxX = std::numeric_limits<float>::lowest(), maxY = maxX, maxZ = maxX;
    const float *f = reinterpret_cast<const float *>(vertexData.constData());
    const int count = stride > 0 ? vertexData.size() / stride : 0;
    for (int i = 0; i < count; ++i) {
        const float px = f[i * strideF + 0];
        const float py = f[i * strideF + 1];
        const float pz = f[i * strideF + 2];
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (pz < minZ) minZ = pz;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        if (pz > maxZ) maxZ = pz;
    }
    if (count > 0) {
        const float pad = 0.5f; // 0.5 m: covers morph deltas + spring swing
        setBounds(QVector3D(minX - pad, minY - pad, minZ - pad),
                  QVector3D(maxX + pad, maxY + pad, maxZ + pad));
    }
}

void AiriVrmGeometryShell::updateVertexData(const QByteArray& vertexData)
{
    // Same size and layout as the buffer passed to setBuffers(); the setters
    // mark the geometry dirty so Qt re-uploads on the next frame.
    setVertexData(vertexData);
}
