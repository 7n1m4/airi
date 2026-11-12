// SPDX-License-Identifier: GPL-3.0-or-later

#include "capture_item.h"

#include <QDir>
#include <QDateTime>
#include <QGuiApplication>
#include <QImage>
#include <QPixmap>
#include <QScreen>
#include <cstdio>

QString airi_capture_primary_screen(const QString &outDir)
{
    if (QGuiApplication::instance() == nullptr) {
        fprintf(stderr, "[airi-qt][capture] no QGuiApplication instance — cannot grab the screen\n");
        return QString();
    }
    if (!QDir().mkpath(outDir)) {
        fprintf(stderr, "[airi-qt][capture] failed to create output directory %s\n",
                qPrintable(outDir));
        return QString();
    }
    QScreen *screen = QGuiApplication::primaryScreen();
    if (screen == nullptr) {
        fprintf(stderr, "[airi-qt][capture] Qt reports no primary screen\n");
        return QString();
    }
    // grabWindow(0) = the whole screen (root window); there is no
    // window-specific capture in this shim (see the phase note).
    const QPixmap pixmap = screen->grabWindow(0);
    if (pixmap.isNull()) {
        fprintf(stderr,
                "[airi-qt][capture] grabWindow(0) returned a null pixmap — unsupported platform "
                "or the compositor denied the grab (common on Wayland)\n");
        return QString();
    }
    const QString fileName = QStringLiteral("capture-%1.png").arg(QDateTime::currentMSecsSinceEpoch());
    const QString fullPath = QDir(outDir).absoluteFilePath(fileName);
    const QImage image = pixmap.toImage();
    if (image.isNull() || !image.save(fullPath, "PNG")) {
        fprintf(stderr, "[airi-qt][capture] failed to save PNG to %s\n", qPrintable(fullPath));
        return QString();
    }
    return fullPath;
}
