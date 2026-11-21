---
title: プロジェクト概要
description: Project Anima の概要 — プライベートで持続的なキャラクターランタイム
---

# Project Anima

**管理されない存在。（Presence without custody）**

プラットフォームにその存在や記憶の主権を委ねることなく、記憶し、知覚し、話し、現れ、行動できる、プライベートで持続的なAIキャラクター。

アバターをまとった単なるチャットボットを超えた、真のAIコンパニオンやバーチャルキャラクターを求める人のために設計されています。

---

## 機能の集合体ではなく、「ひとりのキャラクター」として

Anima は**キャラクターランタイム**です。

キャラクターには、持ち運べる「アイデンティティ」、切り替えられる「感覚」、置き換えられる「声」、交換できる「身体」、深まり続ける「記憶」、そして可能性を拡張する「ツール」があります。それぞれの能力は独立して進化しても、それらをつなぐキャラクターの存在は途切れることなく一貫性を保ち続けます。

**会話、モデル、身体、アプリケーション、デバイスを超えて永続するひとつの存在 — それを共有するあなた自身が所有する存在です。**

---

## キャラクター・スタック（The Character Stack）

| 領域 | Anima が提供するもの |
|---|---|
| **Identity（アイデンティティ）** | ポータブルな Anima カード、キャラクタープロファイル、演技ディレクション（ACTキュー）、個別キャラクター設定 |
| **Continuity（持続性・記憶）** | 8層の記憶アーキテクチャ：短期認知（STMM）、長期テキスト日記、生涯アーカイブ、エコーチップ |
| **Perception（知覚・認識）** | 聴覚入力、画面視覚知覚、画像理解、デスクトップ状況把握、関心度ゲート |
| **Mind（知性・思考）** | 差し替え可能なクラウド/ローカルLLM、プロンプト統合、認知的ストリーミングパイプライン |
| **Voice（音声・発話）** | 音声合成（TTS）と音声認識（STT）の柔軟な切り替え、ボイスプロファイル、Audio Studio、低遅延ライブ音声 |
| **Body（身体・表現）** | Live2D、VRM（3D）、MMD、Spine レンダラー、タッチインタラクション、表情・衣装カスタマイズ |
| **Agency（自律性・行動）** | 自発性ハートビート、MCPツール、画像生成、ロールプレイ監督、自律バックグラウンドループ |
| **World（世界・環境）** | デスクトップステージ、ドッキング可能なコントロールストリップ、Web/モバイルコンパニオン、Discord Bot連携 |
| **Sovereignty（主権・プライバシー）** | ローカルファースト保存、ポータブルなキャラクターデータ、BYOS（ユーザー所有クラウド同期）、完全テレメトリフリー |

---

## はじめかた

Anima は Web とデスクトップの両方に対応しています。

<div flex gap-2 w-full justify-center text-xl>
  <div w-full flex flex-col items-center gap-2 border="2 solid gray-500/10" rounded-lg px-2 pt-6 pb-4>
    <div flex items-center gap-2 text-5xl>
      <div i-lucide:app-window />
    </div>
    <span>Web Stage</span>
    <a href="https://dasilva333.github.io/airi/web-stage/" target="_blank" decoration-none class="text-primary-900 dark:text-primary-400 text-base not-prose bg-primary-400/10 dark:bg-primary-600/10 block px-4 py-2 rounded-lg active:scale-95 transition-all duration-200 ease-in-out">
      Web Stage を開く
    </a>
  </div>
  <div w-full flex flex-col items-center gap-2 border="2 solid gray-500/10" rounded-lg px-2 pt-6 pb-4>
    <div flex items-center gap-2 text-5xl>
      <div i-lucide:laptop />
      /
      <div i-lucide:computer />
    </div>
    <span>デスクトップ（Electron）</span>
    <a href="https://github.com/dasilva333/airi/releases/latest" target="_blank" decoration-none class="text-primary-900 dark:text-primary-400 text-base not-prose bg-primary-400/10 dark:bg-primary-600/10 block px-4 py-2 rounded-lg active:scale-95 transition-all duration-200 ease-in-out">
      ダウンロード
    </a>
  </div>
</div>

* **Web Stage**: インストール不要で、最新のブラウザやモバイル端末から手軽にアクセスできます。
* **デスクトップ版**: ドッキング可能なコントロールストリップ、ローカル推論（WebGPU/WASMによるローカルLLM、Whisper、Kokoro）、視覚知覚、システムセンサー連携を備えたフルフラッグシップ体験を提供します。

<div flex gap-2 w-full flex-col justify-center text-base>
  <a href="../../../en/docs/overview/guide/tamagotchi/" w-full flex items-center gap-2 border="2 solid gray-500/10" rounded-lg px-4 py-2>
    <div w-full flex items-center gap-2>
      <div flex items-center gap-2 text-2xl>
        <div i-lucide:laptop />
      </div>
      <span>デスクトップ ガイド</span>
    </div>
    <div decoration-none class="text-gray-900 dark:text-gray-200 text-base not-prose rounded-lg active:scale-95 transition-all duration-200 ease-in-out text-nowrap">
      使い方を見る
    </div>
  </a>
  <a href="./guide/web/" w-full flex items-center gap-2 border="2 solid gray-500/10" rounded-lg px-4 py-2>
    <div w-full flex items-center gap-2>
      <div flex items-center gap-2 text-2xl>
        <div i-lucide:app-window />
      </div>
      <span>Web Stage ガイド</span>
    </div>
    <div class="text-gray-900 dark:text-gray-200 text-base not-prose rounded-lg active:scale-95 transition-all duration-200 ease-in-out text-nowrap">
      使い方を見る
    </div>
  </a>
</div>

## コントリビュート

このプロジェクトへの貢献方法は [Contributing](../contributing/) をご覧ください。

Project Anima の UI を設計・改善するための参考資料は [Design Guidelines](../contributing/design-guidelines/resources) を参照してください。
