# VaultBranch

[English](README.md) | [简体中文](README_zh.md)

为 Obsidian 提供简洁的 Git 侧栏和提交历史图。在笔记库内查看改动、暂存文件、提交、拉取、推送、管理 Stash，以及解决文本冲突。

VaultBranch 仅支持 Obsidian 桌面端，需要另行安装 Git。插件使用现有仓库、Git 身份配置和 SSH/HTTPS 认证。用户使用插件无需另外安装 Node.js 或 npm。

## 功能

- 按目录树展示已暂存、未暂存和冲突文件。
- Commit 只提交暂存区，包括在外部工具中按行暂存的内容。
- 支持并排和统一差异视图。
- 提交历史图支持分支筛选、搜索、查看提交文件，以及从差异或笔记页面通过鼠标返回历史图。
- 多条 Stash 分别显示为图中的节点，右键可选择 Apply（恢复并保留记录）或 Pop（恢复成功后删除记录）。
- 右键普通提交，可将当前分支 Rebase 到该提交；Push 始终推送当前分支到其配置的上游。
- 冲突编辑器支持编辑结果、保存并暂存，以及继续或中止操作。
- 提交信息支持日期和主机名占位符。
- 界面颜色和控件跟随 Obsidian 当前主题。

## 安装

### 社区插件市场

社区市场提交仍待审核。上传源码或创建 GitHub Release 不代表插件已经上架；通过市场检查并发布后，才能在 Obsidian 内搜索安装。

### 从 GitHub Release 手动安装

1. 安装 Git，初始化或克隆一个以笔记库为根目录的 Git 仓库。
2. 创建 `<笔记库>/.obsidian/plugins/vaultbranch/` 目录。
3. 从同一个 [Release](https://github.com/li-cr/VaultBranch/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，放进该目录。
4. 打开 Obsidian 设置 → 第三方插件，启用 **VaultBranch**。

Release 安装附件只有这三个文件，与 Obsidian 插件安装器的要求一致。

使用 BRAT 时，可以添加仓库 `li-cr/VaultBranch` 安装已发布的版本。

## 使用

从左侧功能区或命令面板打开 VaultBranch。点击文件旁的 `+` 暂存改动，点击 `−` 取消暂存。Commit 只使用已有暂存区，不会自动暂存其他改动。在提交输入框中按 Ctrl+Enter（macOS 为 Cmd+Enter）提交。

Pull 默认使用 Rebase，要求工作区干净，也不能有未跟踪文件。可以先用 Stash 收起改动，执行 Pull 后再恢复选中的 Stash。Stash 可以包含已跟踪、已暂存和未跟踪的改动，不包含被 Git 忽略的文件。恢复 Stash 同样要求工作区干净；发生冲突时会保留 Stash 记录。

点击历史图标打开提交图。左键点击一行可查看改动文件和操作按钮，右键打开操作菜单。选择 `stash` 筛选项可查看已保存的 Stash。Stash 编号可能随操作变化，因此恢复时按所选记录的提交哈希识别。

Rebase 会重写当前分支独有的提交，提交哈希可能改变。执行前需要干净的工作区和界面确认。发生冲突后，在侧栏解决冲突，再继续或中止。VaultBranch 不执行强制推送。

冲突编辑器显示本地/传入版本、共同祖先和可编辑的结果；Rebase 时使用上游/本地的对应语义。编辑完成后保存并暂存。二进制文件、删除冲突，以及超过 2 MB 的预览需使用外部工具处理。目前不支持按冲突块操作或按行暂存。

## 设置

| 设置 | 默认值 |
| --- | --- |
| Git 可执行文件 | 从 PATH 查找 |
| Pull 方式 | Rebase |
| 刷新间隔 | 5 秒 |
| 历史记录每页数量 | 100 条提交 |
| 启动时打开侧栏 | 开启 |
| 提交信息前缀 | `{{date}} {{hostname}} : ` |
| 日期格式 | `YYYY-MM-DD HH:mm:ss` |
| 自定义主机名 | 留空，使用当前计算机的主机名 |

设置保存在 `<笔记库>/.obsidian/plugins/vaultbranch/data.json`。清空提交前缀即可只使用手动输入的信息。日期在提交时生成，格式使用 Obsidian 的 Moment API。

设置页会显示 Git 是否跟踪 `data.json`。如果该文件被忽略，点击“允许跟踪”会向笔记库的 `.gitignore` 添加针对性的例外规则。改动需要你自行暂存和提交，插件不会自动暂存。

换电脑时，复制或克隆笔记库并安装 VaultBranch。Git 路径留空可使用新电脑 PATH 中的 Git；自定义主机名留空可使用新电脑的主机名。Git 身份和认证需在新电脑上单独配置。

### 从本地 My Git 原型迁移

VaultBranch 使用独立的插件 ID。启用 VaultBranch 前，先停用 **My Git**，避免同时出现两个 Git 侧栏。

如需保留原有偏好，在 VaultBranch 停用时，将 `.obsidian/plugins/my-git/data.json` 复制到 `.obsidian/plugins/vaultbranch/data.json`，然后启用 VaultBranch。不需要旧偏好时可以不复制，插件会使用默认设置。

已有提交和 Stash 属于 Git 仓库，两个插件都能访问，无需迁移。确认新插件可用并保留需要的配置、本地脚本后，即可移除旧的 My Git 安装目录。

## 隐私与网络访问

VaultBranch 没有分析统计或遥测，也不使用独立后端。Git 数据保存在你的仓库中。Fetch、Pull 和 Push 通过本机 Git 与仓库配置的远程地址通信。读取本机主机名仅用于提交信息模板，也可以手动覆盖。发布文件中不包含凭据。

### 为什么市场提示文件系统访问和命令执行警告

VaultBranch 通过本机 Git 工作，市场能力扫描会检测到以下模块：

- `node:fs/promises`：读取仓库文件和 Git 操作元数据（包括隐藏文件），写入冲突解决结果，并在你明确选择允许跟踪设置时修改 `.gitignore`。使用 Git linked worktree 时，Git 元数据可能位于笔记库之外。
- `node:child_process`：通过 `execFile` 启动本机 Git，使用参数数组，以笔记库为工作目录，并设置 `shell: false`。提交信息和路径不会拼接成 shell 命令。可选的可执行文件设置是 Git 路径，不是 shell 命令。

这些能力使用与 Obsidian 相同的系统权限，不构成操作系统沙箱。Git 也会使用你的仓库配置、钩子、凭据助手和远程地址。请使用你信任的仓库与 Git 配置。这两类警告符合当前实现，插件会如实说明其用途。

### 验证发布文件来源

从 `0.2.1` 开始，带版本标签的发布会为 `main.js`、`manifest.json` 和 `styles.css` 生成 GitHub artifact attestations（构建来源证明），将文件摘要与源码仓库及发布构建关联起来。下载后可以用 GitHub CLI 验证：

```sh
gh attestation verify main.js --repo li-cr/VaultBranch
gh attestation verify manifest.json --repo li-cr/VaultBranch
gh attestation verify styles.css --repo li-cr/VaultBranch
```

来源证明用于确认构建来源，不会消除文件系统或进程执行权限，也不代表对插件安全性的认证。

## 开发

```sh
npm ci
npm run check
npm test
npm run build
```

Windows PowerShell 如果拦截 `npm.ps1`，使用 `npm.cmd` 运行以上命令。

源码位于 `src/`。构建会将 Git 服务打包进单个 CommonJS `main.js`，仅保留 Obsidian API 和 Node.js 内置模块为外部依赖。`dist/vaultbranch/` 包含可安装的插件文件。测试使用隔离的临时仓库和本地 bare remote，`npm test` 不会访问 GitHub。

本地查看效果时，将构建后的 `main.js`、`manifest.json` 和 `styles.css` 复制到测试笔记库的 `.obsidian/plugins/vaultbranch/`，保留已有的 `data.json`，然后重新加载插件。

推送与 `manifest.json` 版本完全相同的标签（例如 `0.2.1`，不带 `v`）会触发发布工作流。工作流执行检查、测试和构建，生成来源证明，并且只发布三个 Obsidian 安装文件。它使用仓库自动提供的 GitHub Actions token 和短期 OIDC 身份，不需要个人发布 token。

社区市场提交流程见 [SUBMISSION.md](SUBMISSION.md)，开发约定见 [AGENTS.md](AGENTS.md)。

## 许可证与致谢

[MIT](LICENSE)，© 2026 li-cr。简洁侧栏参考了 Obsidian Git，历史图布局参考了 VS Code Git Graph 扩展。VaultBranch 是独立插件，与上述项目或 Obsidian 没有关联或隶属关系。
