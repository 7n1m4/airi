// SPDX-License-Identifier: GPL-3.0-or-later
// C ABI shell over the vendored spine-cpp runtime. See spine_shell.h.

#include "spine_shell.h"

#include <spine/Animation.h>
#include <spine/AnimationState.h>
#include <spine/AnimationStateData.h>
#include <spine/Atlas.h>
#include <spine/AtlasAttachmentLoader.h>
#include <spine/Attachment.h>
#include <spine/BlendMode.h>
#include <spine/MeshAttachment.h>
#include <spine/RegionAttachment.h>
#include <spine/Skeleton.h>
#include <spine/SkeletonBinary.h>
#include <spine/SkeletonData.h>
#include <spine/SkeletonJson.h>
#include <spine/Slot.h>
#include <spine/SlotData.h>
#include <spine/TextureRegion.h>
#include <spine/Bone.h>
#include <spine/Skin.h>
#include <spine/VertexAttachment.h>

#if defined(AIRI_SPINE_42)
#include <spine/Physics.h>
#endif


// spine-cpp expects the engine integration to provide the default
// extension factory; we use the bundled DefaultSpineExtension.
namespace spine {
SpineExtension *getDefaultExtension() {
    return new DefaultSpineExtension();
}
} // namespace spine
#include <cstring>
#include <string>
#include <vector>

struct airi_spine_session {
    spine::Atlas *atlas = nullptr;
    spine::SkeletonData *skeletonData = nullptr;
    spine::Skeleton *skeleton = nullptr;
    spine::AnimationStateData *stateData = nullptr;
    spine::AnimationState *state = nullptr;
    std::string lastError;
    std::string version;
    float boundsX = 0, boundsY = 0, boundsW = 0, boundsH = 0;
};

// Tiny RTTI helper local to the shell for spine-cpp's custom RTTI.
static bool rttiIsExact(spine::Attachment *attachment, const spine::RTTI &rtti) {
    return attachment && attachment->getRTTI().isExactly(rtti);
}

namespace {

struct SessionDraw {
    std::vector<airi_spine_vertex> vertices;
    std::vector<uint16_t> indices;
    std::vector<airi_spine_draw> draws;
};

struct AttachmentPaint {
    spine::TextureRegion *textureRegion;   // always an AtlasRegion in practice
    float alpha; // skeleton * slot * attachment
    int32_t blendMode;
};

bool resolvePaint(spine::Skeleton &skeleton, spine::Slot &slot, spine::Attachment *attachment, AttachmentPaint *out) {
    float alpha = skeleton.getColor().a * slot.getColor().a;
    if (rttiIsExact(attachment, spine::RegionAttachment::rtti)) {
        auto *regionAttachment = static_cast<spine::RegionAttachment *>(attachment);
        alpha *= regionAttachment->getColor().a;
        out->textureRegion = regionAttachment->getRegion();
    } else if (rttiIsExact(attachment, spine::MeshAttachment::rtti)) {
        auto *mesh = static_cast<spine::MeshAttachment *>(attachment);
        alpha *= mesh->getColor().a;
        out->textureRegion = mesh->getRegion();
    } else {
        return false; // boundingbox / clipping / point / path are not drawable
    }
    if (!out->textureRegion || alpha <= 0.0f) return false;
    out->alpha = alpha;
    out->blendMode = (int32_t) slot.getData().getBlendMode();
    return true;
}

void appendDraw(std::vector<airi_spine_vertex> &vertices,
                std::vector<uint16_t> &indices,
                std::vector<airi_spine_draw> &draws,
                const AttachmentPaint &paint,
                uint32_t vertexOffset,
                uint32_t vertexCount,
                uint32_t indexOffset,
                uint32_t indexCount) {
    airi_spine_draw draw{};
    // Atlas-created texture regions are AtlasRegion instances; page index is
    // how the renderer pairs draws with extracted texture files.
    draw.page_index = static_cast<spine::AtlasRegion *>(paint.textureRegion)->page->index;
    draw.blend_mode = paint.blendMode;
    draw.alpha = paint.alpha;
    draw.vertex_offset = vertexOffset;
    draw.vertex_count = vertexCount;
    draw.index_offset = indexOffset;
    draw.index_count = indexCount;
    draws.push_back(draw);
    (void) vertices;
    (void) indices;
}

void buildSessionDraws(airi_spine_session *session, SessionDraw *out) {
    out->vertices.clear();
    out->indices.clear();
    out->draws.clear();
    if (!session || !session->skeleton || !session->atlas) return;

    spine::Skeleton &skeleton = *session->skeleton;
    const auto &drawOrder = skeleton.getDrawOrder();
    for (size_t i = 0; i < drawOrder.size(); ++i) {
        spine::Slot *slot = drawOrder[i];
        if (!slot) continue;
        spine::Attachment *attachment = slot->getAttachment();
        if (!attachment) continue;
        if (!slot->getBone().isActive()) continue;

        AttachmentPaint paint{};
        if (!resolvePaint(skeleton, *slot, attachment, &paint)) continue;

        const uint32_t baseVertex = (uint32_t) out->vertices.size();
        const uint32_t baseIndex = (uint32_t) out->indices.size();

        if (rttiIsExact(attachment, spine::RegionAttachment::rtti)) {
            // Vertex buffer layout matches spine-cpp's software renderer:
            // world vertices [BR, BL, UL, UR] zipped with getUVs() as-is;
            // quad indices [0,1,2, 2,3,0].
            auto *regionAttachment = static_cast<spine::RegionAttachment *>(attachment);
            float worldVerts[8];
            regionAttachment->computeWorldVertices(*slot, worldVerts, 0, 2);
            auto &uvs = regionAttachment->getUVs();
            if (uvs.size() < 8) continue;

            for (int v = 0; v < 4; ++v) {
                airi_spine_vertex outVertex{};
                outVertex.x = worldVerts[v * 2 + 0];
                outVertex.y = worldVerts[v * 2 + 1];
                outVertex.u = uvs[v * 2 + 0];
                outVertex.v = uvs[v * 2 + 1];
                out->vertices.push_back(outVertex);
            }
            const uint16_t tris[6] = {0, 1, 2, 2, 3, 0};
            for (uint16_t t : tris) out->indices.push_back((uint16_t) (t + baseVertex));

            appendDraw(out->vertices, out->indices, out->draws, paint,
                       baseVertex, 4, baseIndex, 6);
        } else if (rttiIsExact(attachment, spine::MeshAttachment::rtti)) {
            auto *mesh = static_cast<spine::MeshAttachment *>(attachment);
            spine::Vector<float> worldVerts;
            const size_t worldValues = mesh->getWorldVerticesLength();
            worldVerts.setSize(worldValues, 0.0f);
            mesh->computeWorldVertices(*slot, 0, worldValues, worldVerts.buffer(), 0, 2);
            auto &uvs = mesh->getUVs();
            auto &triangles = mesh->getTriangles();
            const size_t vertexCount = worldValues / 2;
            if (vertexCount == 0 || uvs.size() < vertexCount * 2 || triangles.size() == 0) continue;

            for (size_t v = 0; v < vertexCount; ++v) {
                airi_spine_vertex outVertex{};
                outVertex.x = worldVerts[v * 2 + 0];
                outVertex.y = worldVerts[v * 2 + 1];
                outVertex.u = uvs[v * 2 + 0];
                outVertex.v = uvs[v * 2 + 1];
                out->vertices.push_back(outVertex);
            }
            for (size_t t = 0; t < triangles.size(); ++t) {
                out->indices.push_back((uint16_t) (triangles[t] + baseVertex));
            }

            appendDraw(out->vertices, out->indices, out->draws, paint,
                       baseVertex, (uint32_t) vertexCount, baseIndex, (uint32_t) triangles.size());
        }
        // Clipping attachments are intentionally not honored yet; slots keep
        // drawing with their normal triangles. See docs/phase-notes/p4-spine.md.
    }
}

} // namespace

static std::string toStdString(const spine::String &s) {
    const char *buf = s.buffer();
    return buf ? std::string(buf) : std::string();
}

extern "C" airi_spine_session *airi_spine_create(void) {
    return new airi_spine_session();
}

extern "C" void airi_spine_destroy(airi_spine_session *session) {
    if (!session) return;
    delete session->state;
    delete session->stateData;
    delete session->skeleton;
    delete session->skeletonData;
    delete session->atlas;
    delete session;
}

extern "C" int32_t airi_spine_load(airi_spine_session *session,
                                   const uint8_t *skel, size_t skel_len, int32_t skel_is_binary,
                                   const char *atlas_text, size_t atlas_len) {
    if (!session || !skel || skel_len == 0 || !atlas_text) {
        if (session) session->lastError = "airi_spine_load: null argument";
        return 0;
    }
    session->lastError.clear();

    // Fresh load; drop any previous runtime state.
    delete session->state;
    delete session->stateData;
    delete session->skeleton;
    delete session->skeletonData;
    delete session->atlas;
    session->state = nullptr;
    session->stateData = nullptr;
    session->skeleton = nullptr;
    session->skeletonData = nullptr;
    session->atlas = nullptr;

    auto *atlas = new spine::Atlas(atlas_text, (int) atlas_len, "", nullptr, /* createTexture */ false);
    if (atlas->getRegions().size() == 0) {
        session->lastError = "atlas parsed but contains no regions";
        session->atlas = atlas; // keep for destroy symmetry; counts remain 0
        return 0;
    }
    session->atlas = atlas;

    spine::AtlasAttachmentLoader attachmentLoader(atlas);

    spine::SkeletonData *skeletonData = nullptr;
    if (skel_is_binary) {
        spine::SkeletonBinary binary(&attachmentLoader);
        skeletonData = binary.readSkeletonData(skel, (int) skel_len);
        if (!skeletonData) {
            const char *err = binary.getError().buffer();
            session->lastError = err && *err ? err : "SkeletonBinary failed to parse skeleton";
            return 0;
        }
    } else {
        // SkeletonJson requires NUL-terminated input.
        std::string json((const char *) skel, skel_len);
        spine::SkeletonJson jsonReader(&attachmentLoader);
        skeletonData = jsonReader.readSkeletonData(json.c_str());
        if (!skeletonData) {
            const char *err = jsonReader.getError().buffer();
            session->lastError = err && *err ? err : "SkeletonJson failed to parse skeleton";
            return 0;
        }
    }
    session->skeletonData = skeletonData;
    session->version = toStdString(skeletonData->getVersion());
    session->boundsX = skeletonData->getX();
    session->boundsY = skeletonData->getY();
    session->boundsW = skeletonData->getWidth();
    session->boundsH = skeletonData->getHeight();

    auto *skeleton = new spine::Skeleton(skeletonData);
    skeleton->setToSetupPose();
    session->skeleton = skeleton;

    session->stateData = new spine::AnimationStateData(skeletonData);
    session->stateData->setDefaultMix(0.2f);
    session->state = new spine::AnimationState(session->stateData);
    return 1;
}

extern "C" const char *airi_spine_last_error(airi_spine_session *session) {
    return session ? session->lastError.c_str() : "";
}

extern "C" const char *airi_spine_version(airi_spine_session *session) {
    return session ? session->version.c_str() : "";
}

extern "C" void airi_spine_bounds(airi_spine_session *session, float *x, float *y, float *width, float *height) {
    if (!session) return;
    if (x) *x = session->boundsX;
    if (y) *y = session->boundsY;
    if (width) *width = session->boundsW;
    if (height) *height = session->boundsH;
}

extern "C" size_t airi_spine_skin_count(airi_spine_session *session) {
    if (!session || !session->skeletonData) return 0;
    return session->skeletonData->getSkins().size();
}

extern "C" const char *airi_spine_skin_name(airi_spine_session *session, size_t index) {
    if (!session || !session->skeletonData) return "";
    auto &skins = session->skeletonData->getSkins();
    if (index >= skins.size()) return "";
    return skins[index]->getName().buffer();
}

extern "C" int32_t airi_spine_set_skin(airi_spine_session *session, const char *name) {
    if (!session || !session->skeleton || !session->skeletonData || !name) return 0;
    spine::String skinName(name);
    // Skeleton::setSkin silently no-ops on unknown names; validate first so
    // the bridge can report honestly.
    if (!session->skeletonData->findSkin(skinName)) return 0;
    session->skeleton->setSkin(skinName);
    session->skeleton->setSlotsToSetupPose();
    return 1;
}

extern "C" size_t airi_spine_animation_count(airi_spine_session *session) {
    if (!session || !session->skeletonData) return 0;
    return session->skeletonData->getAnimations().size();
}

extern "C" const char *airi_spine_animation_name(airi_spine_session *session, size_t index, float *duration_out) {
    if (!session || !session->skeletonData) return "";
    auto &animations = session->skeletonData->getAnimations();
    if (index >= animations.size()) return "";
    spine::Animation *animation = animations[index];
    if (duration_out) *duration_out = animation->getDuration();
    return animation->getName().buffer();
}

extern "C" int32_t airi_spine_set_animation(airi_spine_session *session, size_t track, const char *name, int32_t loop) {
    if (!session || !session->state || !session->skeletonData || !name) return 0;
    if (!session->skeletonData->findAnimation(spine::String(name))) return 0;
    session->state->setAnimation(track, spine::String(name), loop != 0);
    return 1;
}

extern "C" void airi_spine_set_empty_animation(airi_spine_session *session, size_t track, float mix_duration) {
    if (!session || !session->state) return;
    session->state->setEmptyAnimation(track, mix_duration);
}

extern "C" void airi_spine_set_default_mix(airi_spine_session *session, float seconds) {
    if (!session || !session->stateData) return;
    session->stateData->setDefaultMix(seconds);
}

extern "C" void airi_spine_update(airi_spine_session *session, float delta_seconds) {
    if (!session || !session->state || !session->skeleton) return;
    session->state->update(delta_seconds);
    session->state->apply(*session->skeleton);
#if defined(AIRI_SPINE_42)
    session->skeleton->updateWorldTransform(spine::Physics_Update);
#else
    session->skeleton->updateWorldTransform();
#endif
}

extern "C" size_t airi_spine_page_count(airi_spine_session *session) {
    if (!session || !session->atlas) return 0;
    return session->atlas->getPages().size();
}

extern "C" const char *airi_spine_page_image(airi_spine_session *session, size_t index) {
    if (!session || !session->atlas) return "";
    auto &pages = session->atlas->getPages();
    if (index >= pages.size()) return "";
    return pages[index]->texturePath.buffer();
}

extern "C" int32_t airi_spine_page_pma(airi_spine_session *session, size_t index) {
    if (!session || !session->atlas) return 0;
    auto &pages = session->atlas->getPages();
    if (index >= pages.size()) return 0;
    return pages[index]->pma ? 1 : 0;
}

extern "C" void airi_spine_draw_counts(airi_spine_session *session,
                                        size_t *out_vertices,
                                        size_t *out_indices,
                                        size_t *out_draws) {
    SessionDraw draws;
    buildSessionDraws(session, &draws);
    if (out_vertices) *out_vertices = draws.vertices.size();
    if (out_indices) *out_indices = draws.indices.size();
    if (out_draws) *out_draws = draws.draws.size();
}

extern "C" int32_t airi_spine_collect_draws(airi_spine_session *session,
                                             airi_spine_vertex *out_vertices, size_t vertex_cap,
                                             uint16_t *out_indices, size_t index_cap,
                                             airi_spine_draw *out_draws, size_t draw_cap) {
    SessionDraw draws;
    buildSessionDraws(session, &draws);
    if (draws.vertices.size() > vertex_cap || draws.indices.size() > index_cap || draws.draws.size() > draw_cap) {
        return 0;
    }
    if (!draws.vertices.empty()) std::memcpy(out_vertices, draws.vertices.data(), draws.vertices.size() * sizeof(airi_spine_vertex));
    if (!draws.indices.empty()) std::memcpy(out_indices, draws.indices.data(), draws.indices.size() * sizeof(uint16_t));
    if (!draws.draws.empty()) std::memcpy(out_draws, draws.draws.data(), draws.draws.size() * sizeof(airi_spine_draw));
    return 1;
}

