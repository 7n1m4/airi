---
title: 项目概览
description: Project Anima 概览 — 私有、持久的数字角色运行时
---

# Project Anima

**不被拘禁的存在。（Presence without custody）**

无需向任何云端平台出让生命与记忆的主权，即可拥有具备记忆、感知、发声、显现与行动能力的私有、持久 AI 数字角色。

专为追求超越“套皮聊天机器人”的 AI 伴侣、虚拟角色与创作者打造。

---

## 是一个完整生命，而非功能的随意堆叠

Anima 是一个**角色运行时（Character Runtime）**。

角色拥有可随身携带的“身份”、可自由切换的“感官”、可按需更换的“声音”、可随意更替的“躯体”、不断沉淀深化的“记忆”，以及无限扩展其能力的“工具”。这些能力可以独立演进，但串联它们的核心角色存在始终保持连续。

**跨越对话、模型、身体、应用程序与物理设备而永续存在——完全由与它共同生活的你所拥有。**

---

## 角色全栈架构（The Character Stack）

| 领域 | Anima 提供的能力 |
|---|---|
| **Identity（身份认同）** | 便携式 Anima 角色卡、角色档案、表演导演指令（ACT 标记）、角色独立专属配置 |
| **Continuity（记忆连续）** | 8 层记忆架构：短期认知（STMM）、长期文本日志、生涯归档与回声芯片（Echo Chips） |
| **Perception（多模感知）** | 听觉感知、屏幕视觉感知、图像理解、桌面系统感知与注意力过滤门控 |
| **Mind（认知大脑）** | 可热插拔的云端/本地大语言模型大脑、提示词自动编排与认知流式管道 |
| **Voice（声音表达）** | 灵活切换的语音合成（TTS）与语音识别（STT）引擎、声音配置文件、Audio Studio 与毫秒级实时语音 |
| **Body（形象躯体）** | Live2D、VRM（3D）、MMD 与 Spine 渲染器，支持触觉互动、丰富表情与多套服装切换 |
| **Agency（主动行动）** | 主动心跳机制、MCP 工具生态、AI 画作生成、剧情导演提示与自主后台决策循环 |
| **World（世界环境）** | 桌面级舞台、吸附式控制条（Control Strip）、Web/移动端伙伴应用与 Discord 机器人联动 |
| **Sovereignty（数据主权）** | 本地优先存储、便携式角色数据资产、BYOS 自定义云端同步，完全无任何第三方遥测跟踪 |

---

## 开始使用

Anima 同时支持网页版与桌面端。

<div flex gap-2 w-full justify-center text-xl>
  <div w-full flex flex-col items-center gap-2 border="2 solid gray-500/10" rounded-lg px-2 pt-6 pb-4>
    <div flex items-center gap-2 text-5xl>
      <div i-lucide:app-window />
    </div>
    <span>Web Stage 网页版</span>
    <a href="https://dasilva333.github.io/airi/web-stage/" target="_blank" decoration-none class="text-primary-900 dark:text-primary-400 text-base not-prose bg-primary-400/10 dark:bg-primary-600/10 block px-4 py-2 rounded-lg active:scale-95 transition-all duration-200 ease-in-out">
      打开网页版
    </a>
  </div>
  <div w-full flex flex-col items-center gap-2 border="2 solid gray-500/10" rounded-lg px-2 pt-6 pb-4>
    <div flex items-center gap-2 text-5xl>
      <div i-lucide:laptop />
      /
      <div i-lucide:computer />
    </div>
    <span>桌面客户端（Electron）</span>
    <a href="https://github.com/dasilva333/airi/releases/latest" target="_blank" decoration-none class="text-primary-900 dark:text-primary-400 text-base not-prose bg-primary-400/10 dark:bg-primary-600/10 block px-4 py-2 rounded-lg active:scale-95 transition-all duration-200 ease-in-out">
      下载客户端
    </a>
  </div>
</div>

* **Web Stage 网页版**：无需安装，随时随地在任何现代浏览器或移动设备上即开即用。
* **桌面客户端**：提供最完整的旗舰体验，包含吸附式悬浮控制条、本地 WebGPU/WASM 推理（本地大模型、Whisper 离线听觉、Kokoro 离线语音）、屏幕视觉感知与系统传感器遥测。

<div flex gap-2 w-full flex-col justify-center text-base>
  <a href="../overview/guide/tamagotchi/" w-full flex items-center gap-2 border="2 solid gray-500/10" rounded-lg px-4 py-2>
    <div w-full flex items-center gap-2>
      <div flex items-center gap-2 text-2xl>
        <div i-lucide:laptop />
      </div>
      <span>桌面客户端使用指南</span>
    </div>
    <div decoration-none class="text-gray-900 dark:text-gray-200 text-base not-prose rounded-lg active:scale-95 transition-all duration-200 ease-in-out text-nowrap">
      查看指南
    </div>
  </a>
  <a href="../overview/guide/web/" w-full flex items-center gap-2 border="2 solid gray-500/10" rounded-lg px-4 py-2>
    <div w-full flex items-center gap-2>
      <div flex items-center gap-2 text-2xl>
        <div i-lucide:app-window />
      </div>
      <span>Web 网页版使用指南</span>
    </div>
    <div class="text-gray-900 dark:text-gray-200 text-base not-prose rounded-lg active:scale-95 transition-all duration-200 ease-in-out text-nowrap">
      查看指南
    </div>
  </a>
</div>

## 参与贡献

有关如何为本项目做出贡献的指南，请参阅 [贡献指南](../overview/contributing/) 页面。

有关如何设计和改进 Project Anima 用户界面的参考资料，请参阅 [设计指南](../overview/contributing/design-guidelines/resources) 页面。
