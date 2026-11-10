# Bridge Pattern (P0 Spike)

## Status
Spike result: **cxx-qt 0.10 does not support Rust subclassing QAbstractListModel.**

Evidence:
- `cxx_qt::bridge` requires Rust QObjects to derive from `QObject`; there is no supported path to override `QAbstractListModel::roleNames`/`data`/`rowCount` from Rust in 0.10.
- The generated vtable/constructor surface for `QAbstractListModel` is not exposed in a way that cxx-qt can emit safely.
- stage-qt's existing pattern uses a C++ shell (`src/cpp/stage_qt_bridge.h/.cpp`) for the one Qt Quick 3D class cxx-qt could not express (`VrmGeometryShell`), confirming the same limitation class.

## Decision
Use the planned fallback: **`QList<QObject*>` per-message QObjects appended on delta-complete + incremental signals**, never rebuild the whole list on every chunk.

Concretely:

1. Each chat message is a `ChatMessageEntry` QObject (Rust `#[qobject]`) with properties: `id`, `role`, `content`, `createdAt`.
2. Streaming deltas update the **current** assistant message object's `content` property directly.
3. On delta completion (message finished / persisted), append the new message object to a `QObjectList` property (`messagesModel`), or incrementally append into a `QList<QObject*>` model wrapper exposed to QML.
4. QML uses `Repeater` bound to the `QObjectList`, or `ListView` with a simple model; each delegate is a `ChatMessageDelegate` item.
5. For streaming text updates, emit `chunkAppended(chunkText)` (or update `content` property) — never diff/rebuild indices.

## Why not QAbstractListModel from Rust
- cxx-qt 0.10 lacks attribute-macro support for QAbstractListModel subclassing with full role/invokable contract.
- The generated headers for custom models would require hand-written C++ and manual vtable wiring — at that point you lose the point of staying in Rust.

## Why not QListModel alias from Rust
- No stable API for cxx-qt to append/remove `QObject*` from a `QQmlListProperty` with change notifications without C++ help.

## Recommended P1 shape
```qml
// ChatPanel.qml
Repeater {
    model: chatController.messagesModel
    delegate: ChatMessageDelegate { entry: modelData }
}
```

```rust
#[qobject]
#[qml_element]
#[qproperty(QObjectList, messages_model)]
type ChatController = super::ChatControllerRust;

impl qobject::ChatController {
    #[qinvokable]
    fn append_message_retained(self: Pin<&mut Self>, json: QString) { /* create entry, append, notify */ }
    #[qinvokable]
    fn apply_delta(self: Pin<&mut Self>, text: QString) { /* mutate last entry in-place */ }
}
```

## Test strategy
Integration test (Python or harness QML) can instantiate `ChatController`, append fake deltas, and assert `messages_model.count()` increments and last entry's `content` grows.

## Fallback trigger checklist
If QAbstractListModel becomes supported in a future cxx-qt release, swap to that for virtualized rows. Until then, per-message QObject list is the lowest-risk, highest-compatibility pattern for Qt 6.
