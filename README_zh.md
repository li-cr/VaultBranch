# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

在 Obsidian 中管理 Git。仅支持桌面端，需要安装 Git，并将笔记库初始化为 Git 仓库。

## 主要功能

- **Git 侧栏**：查看改动文件、暂存、提交、拉取和推送。
- **可编辑差异**：左右对比版本，直接编辑、回退单个改动块；支持手动保存和可选自动保存。
- **图片对比**：在修改区、暂存区和文件历史中预览对比图片，支持滚轮缩放和拖动查看。
- **提交图与文件历史**：查看分支、合并和历史修改，跟随文件重命名。
- **分支与 Stash**：创建或切换分支，收起未提交改动并恢复指定 Stash。
- **冲突处理**：对比本地与传入内容，编辑合并结果，继续或中止 Rebase。
- **编辑辅助**：差异折叠与跳转、可选 JSON/Markdown 语法高亮、日期插入、中英文界面。

## 当前性能 · 1.0.3

本地 Windows / Obsidian 1.15.0，与 1.0.2 对比。下表为中位数，单位 ms；本次不宣称提速。

| 测试项目 | ms | 样本数 |
| --- | ---: | --- |
| 插件重载（缓存已预热） | 20.9 | 5 |
| 点击 → Staged 页面就绪 | 165.2 | 20 |
| 点击 → Changed 页面就绪 | 114.7 | 20 |
| Changed 1.6 MB JSON：输入 / 换行 / 删除 | 6.0 / 6.4 / 3.0 | 各 5 |
| Changed 1.28 MB Markdown：输入 / 换行 / 删除 | 4.7 / 7.5 / 5.6 | 各 5 |

文件切换包含 CPU 采样开销；正文修改测量原生输入至文档更新。[环境、范围及复现步骤](https://github.com/li-cr/VaultBranch/blob/1.0.3/docs/performance/1.0.3.md) · [Tag 1.0.3](https://github.com/li-cr/VaultBranch/releases/tag/1.0.3)。

## 反馈与建议

欢迎 [提交 Issue](https://github.com/li-cr/VaultBranch/issues/new/choose)，反馈问题或提出功能请求！
