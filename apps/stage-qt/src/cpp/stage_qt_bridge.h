// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

// Thin C++ shell helpers for the stage-qt app.
//
// The Rust-defined `VrmGeometry` QObject works in Rust but cxx-qt could not
// be made to generate a `QQuick3DGeometry(QQuick3DObject*)`-compatible
// constructor from Rust (see `src/cxxqt_object.rs`). The pre-decided fallback
// is this C++ shell: a `QQuick3DGeometry` subclass with the same public
// surface, registered to QML directly. Rust pushes buffers through the
// free helpers / invokables below.

#include <QtCore/QObject>
#include <QtQuick3D/QQuick3DGeometry>

class VrmGeometryShell : public QQuick3DGeometry
{
    Q_OBJECT
    QML_ELEMENT
public:
    explicit VrmGeometryShell(QQuick3DObject* parent = nullptr) : QQuick3DGeometry(parent) {}

    Q_PROPERTY(QString materialName READ materialName WRITE setMaterialName NOTIFY materialNameChanged)
    QString materialName() const { return m_materialName; }
    void setMaterialName(const QString& name)
    {
        if (m_materialName == name)
            return;
        m_materialName = name;
        Q_EMIT materialNameChanged();
    }

    Q_PROPERTY(int morphCount READ morphCount WRITE setMorphCount NOTIFY morphCountChanged)
    int morphCount() const { return m_morphCount; }
    void setMorphCount(int n) { m_morphCount = n; Q_EMIT morphCountChanged(); }

    /// Fill the geometry from raw bytes (Rust side: `VrmGeometry::apply_buffers`
    /// equivalent; called from QML/Rust on model load).
    Q_INVOKABLE void setBuffers(const QByteArray& vertexData,
                                const QByteArray& indexData,
                                int stride);

Q_SIGNALS:
    void materialNameChanged();
    void morphCountChanged();

private:
    QString m_materialName;
    int m_morphCount = 0;
};
