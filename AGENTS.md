# VaultBranch 开发说明

## 项目与目录

- 本仓库是 Obsidian 桌面 Git 插件 VaultBranch 的正式源码，远程仓库为 `li-cr/VaultBranch`。
- `src/main.js`：Obsidian 生命周期、设置、侧栏、提交图和冲突界面。
- `src/git.js`：Git 命令、状态解析、提交图数据、Stash 和冲突操作。
- `src/i18n.js`：中文与英文文案；使用 `t("文案")` 或带插值的标签模板，新增提示需补英文翻译。
- 差异页的工作区编辑显示完整文本，使用 Obsidian `vault.process` 保存；保留暂存区、原始换行和外部修改检查，不将差异补丁当成完整文件写回。刷新或切换语言时保留编辑草稿。
- `styles.css`：界面样式；使用 Obsidian 主题变量和限定在插件视图内的选择器，不使用 `!important`，保持界面简洁。
- `tests/git.test.cjs`：使用临时仓库和本地 bare remote 的 Git 集成测试。
- `scripts/build.cjs`：打包入口；`scripts/validate.cjs`：清单、版本和源码检查。
- 根目录 `main.js`、`dist/`、`node_modules/` 是生成内容，不直接修改或提交。

旧的 `.obsidian/plugins/my-git/` 是本地原型和旧安装目录，不是后续开发的源码入口。以后从本仓库构建并安装 `vaultbranch`，不需要重建 `my-git`。旧目录可能包含个人 `data.json` 和仅在本地保存的 UI 调试脚本；清理前保留需要的内容，并确认旧插件已停用、新插件可用。不要把这些个人文件发布到源码仓库。

## 实现约定

- 使用现有 CommonJS JavaScript 和 esbuild，保持实现简洁，避免无必要的依赖或框架。
- 支持 Windows、Linux、macOS 桌面端；路径使用 `node:path`，默认从 PATH 调用 `git`，不硬编码个人路径或假定可执行文件一定叫 `git.exe`。
- Obsidian 桌面端提供 Node.js 运行环境，用户需要另行安装 Git；当前实现不支持移动端。
- Git 使用 `execFile`、参数数组、`shell: false`，不拼接 shell 命令。保留超时、输出大小限制和错误处理。
- `fs` 用于仓库文件和 Git 元数据，包括位于笔记库外的 linked worktree 元数据。保留路径校验，如实说明系统权限能力，不通过改名或包装隐藏扫描警告。
- Commit 只提交已有暂存区，不自动执行 `add` 或 `commit -a`；Push 不自动强推。
- 撤销仅恢复未暂存内容，保留暂存区；未跟踪文件通过 Obsidian 移入回收站。文件行操作按“暂存/取消暂存 → 撤销 → 状态”排列，不额外显示打开文件按钮。
- Pull、Rebase 和 Stash 恢复保持现有工作区检查；Rebase 保留界面确认和继续/中止流程。
- Stash 操作按提交哈希识别选中条目，删除前重新解析编号；恢复冲突时保留 Stash，避免误删其他记录。
- 冲突界面使用用户能理解的“本地/传入”等描述，并区分 Rebase 的语义。
- 不提交凭据、私人笔记、个人配置 `data.json` 或调试输出。

## 开发与验证

安装依赖并运行：

```sh
npm ci
npm run check
npm test
npm run build
```

Windows PowerShell 若拦截 `npm.ps1`，使用 `npm.cmd`。按改动范围验证：文档修改检查内容和 `git diff --check`；源码修改运行检查和构建；Git 行为修改运行集成测试。新增测试应覆盖实际行为或回归风险。

Git 测试只使用隔离临时仓库和本地 remote，不在用户笔记库制造冲突、创建/删除 Stash、Rebase 或推送测试提交。测试仓库可命名为 `note_test`，但不要硬编码开发者本机的绝对路径。报告时区分本地测试、CI 测试与 Obsidian 实机测试，不把 Ubuntu Git 测试称为 Linux Obsidian 界面测试。

## 本地查看效果与迁移

1. 运行 `npm run build`。
2. 将 `dist/vaultbranch/` 中的 `main.js`、`manifest.json`、`styles.css` 放进测试笔记库的 `.obsidian/plugins/vaultbranch/`，不要覆盖其 `data.json`。
3. 重新加载 VaultBranch，检查控制台错误，并查看受影响界面；可用时使用 Obsidian CLI 的 `plugin:reload`、`dev:errors` 和 DOM/截图工具。
4. 从 My Git 迁移时，先停用旧插件；如需保留偏好，在新插件停用时将旧 `data.json` 复制到新目录，再启用 VaultBranch。避免两个插件同时管理同一仓库。

提交历史和 Stash 属于笔记库的 Git 仓库，不在插件安装目录。移除旧安装目录前仍需确认没有把仓库或其他文件一起选中。移动、重命名和删除笔记库文件时，遵循运行环境的 Obsidian 文件操作要求。

## Git 与发布

- 只提交本仓库的相关改动，不在外层笔记库执行批量暂存或提交，不覆盖用户已有修改。
- 每次完成项目更新（包括代码、样式和文档）后，都要递增版本、提交并推送 `main`，创建并推送对应的新版本标签，等待 GitHub Release 发布成功。
- 发布时同步 `manifest.json`、`package.json`、`package-lock.json`、`versions.json`，更新 `RELEASE_NOTES.md`。
- 标签必须与清单版本完全相同，不带 `v`。现有标签和 Release 不强制覆盖。
- `.github/workflows/release.yml` 负责检查、测试、构建、来源证明和发布。Release 自定义附件只包含 `main.js`、`manifest.json`、`styles.css`，不添加插件 ZIP。
- 保留三个安装文件的 GitHub artifact attestations 生成与验证。发布后确认工作流成功、附件能下载且内容与构建一致，再报告发布完成。
- 完成后告知用户发布版本和链接，并明确提醒手动更新：Obsidian 设置 → 第三方插件 → 检查更新 → 更新 VaultBranch。
- 本地界面验证部署到 `note_test` 测试库；当前笔记库由用户通过设置手动更新，不自动覆盖其插件安装文件。
- GitHub Release 与 Obsidian 社区市场审核是两件事；未经确认不要声称已经上架或能搜索到。
