// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <QtQuick/QQuickItem>
#include <QtQuick/QSGGeometryNode>
#include <QtQuick/QSGTexture>
#include <QtQuick/QSGTextureMaterial>
#include <QtQuick/QSGTransformNode>
#include <QHash>
#include <QImage>
#include <QString>
#include <QElapsedTimer>
#include <QTimer>
#include <QVector>

// QQuickItem that renders the process-wide spine session (see spine_rt.rs)
// as textured triangles on a 2D scene-graph node. One subtree is rebuilt per
// frame from the session's draw commands; per-page textures and images are
// cached on the item.
class SpineItem : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(int maxFps READ maxFps WRITE setMaxFps NOTIFY maxFpsChanged)
    Q_PROPERTY(double renderScale READ renderScale WRITE setRenderScale NOTIFY renderScaleChanged)
    Q_PROPERTY(double offsetX READ offsetX WRITE setOffsetX NOTIFY offsetXChanged)
    Q_PROPERTY(double offsetY READ offsetY WRITE setOffsetY NOTIFY offsetYChanged)
    Q_PROPERTY(bool loaded READ loaded NOTIFY loadedChanged)

public:
    explicit SpineItem(QQuickItem *parent = nullptr);
    ~SpineItem() override;

    int maxFps() const { return m_maxFps; }
    void setMaxFps(int fps);
    double renderScale() const { return m_renderScale; }
    void setRenderScale(double scale);
    double offsetX() const { return m_offsetX; }
    void setOffsetX(double x);
    double offsetY() const { return m_offsetY; }
    void setOffsetY(double y);
    bool loaded() const;

    // Invalidate cached page images/textures (call after a new bundle load).
    Q_INVOKABLE void invalidateTextures();

signals:
    void maxFpsChanged();
    void renderScaleChanged();
    void offsetXChanged();
    void offsetYChanged();
    void loadedChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *data) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    void syncTexturesFromRt(); // GUI thread: reload page images from bundle
    void rebuildNode(QSGTransformNode *root); // render thread
    struct rt_vertex { float x, y, u, v; };
    struct rt_draw { int page_index; int blend_mode; float alpha; quint32 vertex_offset, vertex_count, index_offset, index_count; };

    QTimer m_timer;
    QElapsedTimer m_clock;
    int m_maxFps = 0;         // 0 = unthrottled (Vue default)
    double m_renderScale = 1.0;
    double m_offsetX = 0.0;
    double m_offsetY = 0.0;
    bool m_texturesDirty = true;
    bool m_wasLoaded = false;
    qint64 m_lastTickNs = 0;

    QHash<int, QImage> m_pageImages;      // GUI-side image cache
    QHash<int, QSGTexture *> m_textures;  // render-side texture cache
    QVector<rt_vertex> m_vertices;
    QVector<quint16> m_indices;
    QVector<rt_draw> m_draws;
};
