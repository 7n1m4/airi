// SPDX-License-Identifier: GPL-3.0-or-later
#include "spine_item.h"

#include <QElapsedTimer>
#include <QGuiApplication>
#include <QImage>
#include <QQuickWindow>
#include <QSGGeometry>
#include <QSGGeometryNode>
#include <QMatrix4x4>

#include <cstring>
#include <limits>
#include <vector>

// C ABI into the shared spine runtime state (spine_rt.rs).
extern "C" {
int airi_spine_rt_loaded(void);
void airi_spine_rt_advance(float dt_seconds);
void airi_spine_rt_bounds(float *x, float *y, float *width, float *height);
size_t airi_spine_rt_page_count(void);
const char *airi_spine_rt_page_image(size_t index);
void airi_spine_rt_collect_counts(size_t *out_vertices, size_t *out_indices, size_t *out_draws);
const char *airi_spine_rt_page_image(size_t index);
void airi_spine_rt_collect_counts(size_t *out_vertices, size_t *out_indices, size_t *out_draws);
const char *airi_spine_rt_bundle_root(void);
struct rt_vertex_ffi { float x, y, u, v; };
struct rt_draw_ffi { int page_index; int blend_mode; float alpha; unsigned int vertex_offset, vertex_count, index_offset, index_count; };
int airi_spine_rt_collect(rt_vertex_ffi *out_vertices, size_t vertex_cap,
                          unsigned short *out_indices, size_t index_cap,
                          rt_draw_ffi *out_draws, size_t draw_cap);
}


SpineItem::SpineItem(QQuickItem *parent)
    : QQuickItem(parent)
{
    setFlag(ItemHasContents, true);
    m_clock.start();
    connect(&m_timer, &QTimer::timeout, this, [this]() {
        if (loaded()) update();
    });
    m_timer.setInterval(16); // ~60 Hz placeholder; setMaxFps() refines it
    m_timer.start();
}

SpineItem::~SpineItem()
{
    qDeleteAll(m_textures);
    m_textures.clear();
}

void SpineItem::setMaxFps(int fps)
{
    fps = qBound(0, fps, 240);
    if (fps == m_maxFps) return;
    m_maxFps = fps;
    m_timer.setInterval(fps > 0 ? qMax(1, 1000 / fps) : 16);
    emit maxFpsChanged();
}

void SpineItem::setRenderScale(double scale)
{
    scale = qBound(0.1, scale, 4.0);
    if (qFuzzyCompare(scale, m_renderScale)) return;
    m_renderScale = scale;
    update();
    emit renderScaleChanged();
}

void SpineItem::setOffsetX(double x)
{
    if (qFuzzyCompare(x, m_offsetX)) return;
    m_offsetX = x;
    update();
    emit offsetXChanged();
}

void SpineItem::setOffsetY(double y)
{
    if (qFuzzyCompare(y, m_offsetY)) return;
    m_offsetY = y;
    update();
    emit offsetYChanged();
}

bool SpineItem::loaded() const
{
    return airi_spine_rt_loaded() != 0;
}

void SpineItem::invalidateTextures()
{
    m_texturesDirty = true;
    m_pageImages.clear();
    qDeleteAll(m_textures);
    m_textures.clear();
    update();
}

void SpineItem::geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry)
{
    QQuickItem::geometryChange(newGeometry, oldGeometry);
    update();
}

void SpineItem::syncTexturesFromRt()
{
    m_pageImages.clear();
    const size_t pages = airi_spine_rt_page_count();
    const char *root = airi_spine_rt_bundle_root();
    for (size_t i = 0; i < pages; ++i) {
        const char *image = airi_spine_rt_page_image(i);
        if (!image || !*image) continue;
        QString rel = QString::fromUtf8(image);
        QString full = QString::fromUtf8(root) + QLatin1Char('/') + rel;
        QImage img(full);
        if (img.isNull()) {
            qWarning("[airi-qt][spine] texture missing: %s", qPrintable(full));
            continue;
        }
        // Scene graph blends with premultiplied alpha; convert so straight
        // atlases don't fringe.
        img = img.convertToFormat(QImage::Format_ARGB32_Premultiplied);
        m_pageImages.insert(int(i), img);
    }
    m_texturesDirty = false;
}

QSGNode *SpineItem::updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *)
{
    auto *root = static_cast<QSGTransformNode *>(oldNode);

    const bool isLoaded = loaded();
    if (isLoaded != m_wasLoaded) {
        m_wasLoaded = isLoaded;
        emit loadedChanged();
        if (isLoaded) invalidateTextures();
    }

    if (!isLoaded) {
        // Not loaded: drop any geometry.
        if (root) {
            root->removeAllChildNodes();
            delete root;
        }
        return nullptr;
    }

    const qint64 now = m_clock.nsecsElapsed();
    float dt = float(now - m_lastTickNs) / 1e9f;
    m_lastTickNs = now;
    if (dt > 0.25f) dt = 0.25f; // clamp after tab switches
    airi_spine_rt_advance(dt);

    if (m_texturesDirty) {
        syncTexturesFromRt(); // TODO(render-thread): QImage loads belong on GUI thread
    }

    // Lazily create GPU textures for loaded images (render-thread ok).
    for (auto it = m_pageImages.constBegin(); it != m_pageImages.constEnd(); ++it) {
        if (!m_textures.contains(it.key()) && window()) {
            m_textures.insert(it.key(), window()->createTextureFromImage(it.value()));
        }
    }

    if (!root) {
        root = new QSGTransformNode;
    }
    root->removeAllChildNodes();

    // Position: fit the skeleton bounds into the item, centered, then apply
    // user offsets. y-axis is flipped (spine y-up → Qt y-down).
    float bx = 0, by = 0, bw = 1, bh = 1;
    airi_spine_rt_bounds(&bx, &by, &bw, &bh);
    const double w = width();
    const double h = height();
    const double fit = (bw > 0.1f && bh > 0.1f)
        ? qMin(w / double(bw), h / double(bh)) * 0.9
        : 1.0;
    const double s = fit * m_renderScale;
    QMatrix4x4 matrix;
    matrix.translate(float(w * 0.5 + m_offsetX), float(h * 0.5 + m_offsetY));
    matrix.scale(float(s), float(-s));
    matrix.translate(-(bx + bw * 0.5f), -(by + bh * 0.5f));
    root->setMatrix(matrix);

    // Collect draw data.
    size_t vc = 0, ic = 0, dc = 0;
    airi_spine_rt_collect_counts(&vc, &ic, &dc);
    if (vc == 0 || dc == 0) return root;

    m_vertices.resize(int(vc));
    m_indices.resize(int(ic));
    m_draws.resize(int(dc));
    airi_spine_rt_collect(reinterpret_cast<rt_vertex_ffi *>(m_vertices.data()), size_t(m_vertices.size()),
                          reinterpret_cast<unsigned short *>(m_indices.data()), size_t(m_indices.size()),
                          reinterpret_cast<rt_draw_ffi *>(m_draws.data()), size_t(m_draws.size()));

    // Static attribute set for position+texcoord (4 floats, 16 bytes).
    static const QSGGeometry::Attribute attrs[] = {
        QSGGeometry::Attribute::create(0, 2, QSGGeometry::FloatType),
        QSGGeometry::Attribute::create(1, 2, QSGGeometry::FloatType),
    };
    static const QSGGeometry::AttributeSet attrSet{ 2, int(4 * sizeof(float)), attrs };

    for (int di = 0; di < m_draws.size(); ++di) {
        const rt_draw &draw = m_draws[di];
        QSGTexture *tex = m_textures.value(draw.page_index, nullptr);
        if (!tex) continue;

        auto *geometry = new QSGGeometry(attrSet, int(draw.vertex_count), int(draw.index_count));
        geometry->setDrawingMode(QSGGeometry::DrawTriangles);
        geometry->setVertexDataPattern(QSGGeometry::DynamicPattern);
        geometry->setIndexDataPattern(QSGGeometry::DynamicPattern);

        auto *dstVerts = reinterpret_cast<rt_vertex *>(geometry->vertexData());
        std::memcpy(dstVerts, m_vertices.constData() + draw.vertex_offset, draw.vertex_count * sizeof(rt_vertex));

        auto *dstIdx = geometry->indexDataAsUShort();
        std::memcpy(dstIdx, m_indices.constData() + draw.index_offset, draw.index_count * sizeof(unsigned short));

        auto *material = new QSGTextureMaterial;
        material->setTexture(tex);
        material->setFiltering(QSGTexture::Linear);
        material->setMipmapFiltering(QSGTexture::None);
        material->setHorizontalWrapMode(QSGTexture::ClampToEdge);
        material->setVerticalWrapMode(QSGTexture::ClampToEdge);

        auto *node = new QSGGeometryNode;
        node->setFlag(QSGNode::OwnedByParent);
        node->setFlag(QSGGeometryNode::OwnsGeometry);
        node->setFlag(QSGGeometryNode::OwnsMaterial);
        node->setGeometry(geometry);
        node->setMaterial(material);
        root->appendChildNode(node);
    }

    return root;
}
