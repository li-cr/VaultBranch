# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

在 Obsidian 中管理 Git。仅支持桌面端，需要安装 Git，并将笔记库初始化为 Git 仓库。

## 主要功能

- **Git 侧栏**：查看改动文件、暂存、提交、拉取和推送。
- **可编辑差异**：左右对比版本，直接编辑、回退单个改动块；支持手动保存和可选自动保存。
- **图片对比**：在修改区、暂存区和文件历史中对比图片，支持缩放和拖动；SVG 默认预览，可切换源码。
- **提交图与文件历史**：查看分支、合并和历史修改，跟随文件重命名。
- **分支与 Stash**：创建或切换分支，收起未提交改动并恢复指定 Stash。
- **冲突处理**：对比本地与传入内容，编辑合并结果，继续或中止 Rebase。
- **编辑辅助**：差异折叠与跳转、可选 JSON/Markdown 语法高亮、日期插入、中英文界面。
- **笔记表格兼容**：可选支持表格前无空行的阅读与实时预览，源码沿用原生表格样式。

## 当前性能 · 1.0.7

本地 Windows / Obsidian 1.15.0，与 1.0.6 对比。中位数，单位 ms；本次仅清理未使用文案，不宣称操作提速。

| 测试项目 | ms | 样本数 |
| --- | ---: | --- |
| 插件重载（缓存已预热） | 12.1 | 5 |
| 点击 → Staged / Changed 页面就绪 | 141.7 / 98.8 | 各 20 |
| Changed 1.6 MB JSON: 输入 / 换行 / 删除 | 5.1 / 4.4 / 1.0 | 各 5 |
| Changed 1.28 MB Markdown: 输入 / 换行 / 删除 | 5.5 / 3.4 / 14.1 | 各 5 |

表格兼容默认关闭。切换包含 CPU 采样；修改测量原生输入至文档更新。[环境、范围、对比及复现](https://github.com/li-cr/VaultBranch/blob/1.0.7/docs/performance/1.0.7.md) · [Tag 1.0.7](https://github.com/li-cr/VaultBranch/releases/tag/1.0.7)。

## 反馈与建议

欢迎 [提交 Issue](https://github.com/li-cr/VaultBranch/issues/new/choose)，反馈问题或提出功能请求！
