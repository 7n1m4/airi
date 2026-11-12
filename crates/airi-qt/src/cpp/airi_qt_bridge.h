// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <QtCore/QObject>
#include <QtQuick3D/QQuick3DGeometry>
class AiriVrmGeometryShell : public QQuick3DGeometry
{
 Q_OBJECT
    QML_ELEMENT
public:
    explicit AiriVrmGeometryShell(QQuick3DObject* parent = nullptr) : QQuick3DGeometry(parent) {}
    Q_INVOKABLE void setBuffers(const QByteArray& vertexData, const QByteArray& indexData, int stride);

    /// Re-upload only the vertex buffer (per-frame CPU-skinned positions).
    /// Attribute layout and index buffer stay untouched; bounds were set
    /// with padding in `setBuffers` so they remain valid for morph deltas.
    Q_INVOKABLE void updateVertexData(const QByteArray& vertexData);
};
