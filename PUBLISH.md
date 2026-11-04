# 发布与更新（npm）

包名：**`cortico-world-private-companion`**（2026-10-29 查过 npm 上 404，可用）。
npm 上的名字与 Coopanion 市场展示名互不影响：卡片显示 `cortico.displayName`「我会永远陪着你」。

## 发布流程

```powershell
cd "D:\文档\past_projects\coo-companion\packages\cortico-world-private-companion"

# 0) 确认登录的是自己的账号
npm whoami            # 没登录会报错，先 npm login（浏览器/OTP）

# 1) 发布前自检：prepublishOnly 也会做同样的事
npm test              # 83 个用例
npm run describe      # 重新生成 describe.json（工具/事件清单）
npm pack --dry-run    # 看文件清单：src/ assets/ describe.json ENV_PROMPT.md README LICENSE CHANGELOG

# 2) 版本号：package.json 里手工写，不要跑 npm version
#    确认 version 与即将创建的 Git tag 一致（例如 0.4.3 / v0.4.3）

# 3) 发布到官方 registry
npm publish --access public

# 4) 验证
npm view cortico-world-private-companion version
npm view cortico-world-private-companion dist.tarball
```

首次发布必须走 `registry.npmjs.org`；国内镜像（npmmirror）是**只读镜像**，发布后约 1–10 分钟同步。
本机直连 npmjs 很慢（实测 35–41 KiB/s），但包约 200 KB，发布本身够用；不要因此把 registry 改成镜像。

**发布后的一分钟别慌**：`npm publish` 会提示 “being processed”，此时 `npm view <pkg> version` 可能只看到
`0.0.0-stage`（npm 的暂存占位，353 B），`latest` 还没指过去。实测约 1 分钟后 `dist-tags.latest` 变成 `0.4.3`，
`versions` 里同时留着 `0.0.0-stage`——这是正常的，**不要重复 publish**。

## 之后每次更新

1. 改代码 → `npm test` 全绿。
2. `CHANGELOG.md` 加一段（版本号、改了什么、有没有配置/数据格式变化）。
3. 手工改 `package.json` 的 `version`（不要再跑 `npm version`，它会自动跳版本并生成不带 `v` 的 tag）。
4. `git add` / `git commit`，一个版本一个提交。
5. `npm publish --access public`，验证 registry 后再打 `vX.Y.Z` 注解 tag。
6. `git push origin main` + `git push origin vX.Y.Z`（绝不用 `--force`）。
7. Coopanion 侧二选一：
   - **市场页**：重启 Coopanion 让 `market-catalog.json` 刷新，设置 → 扩展里点更新；
   - **命令**：把 `D:\Coopanion\data\extensions\package.json` 里
     `"cortico-world-private-companion": "link:..."` 改成 `"^0.4.3"`，然后
     `node "D:\Coopanion\resources\app\node_modules\pnpm\bin\pnpm.cjs" install --no-frozen-lockfile`，重启 Coopanion。

> 扩展是 ESM，运行期不热替换；任何代码更新都要重启进程。

## 不覆盖历史

- 已推送的 commit 不做 rebase / amend / `push -f`；
- 一个版本 = 一次提交 + 一个 `vX.Y.Z` 注解 tag；
- tag 推上去后不移动；发错了用 `npm deprecate`，再发 patch；
- 打 tag 前先 `git status -sb` 和 `git ls-remote origin` 对齐。

## 版本策略

| 改动 | 版本 |
| --- | --- |
| 修 bug、改文案、调默认值 | patch |
| 新工具 / 新事件 / 新配置项（向后兼容） | minor |
| 配置键改名、数据文件结构变化、工具名变化 | major（CHANGELOG 写迁移步骤） |

数据在用户的 `data/private-companion/`：升级不要删它；真要改结构，在新版本里读旧格式并迁移，别让用户手动改 JSON。

## 不要做的事

- **不要 `npm unpublish`**：npm 有 24 小时窗口、之后只能 `deprecate`；Coopanion 市场还会缓存旧版本。
  发错了就 `npm deprecate cortico-world-private-companion@0.4.3 "原因"` 再发新版。
- 不要把本机绝对路径、备份 zip、`test/`、`tools/` 打进包（`files` 字段已经挡住）。
- 不要动 `cortico.api`（当前 6）：那是 Coopanion 的扩展契约版本，不是本包的版本。

## 回滚

```powershell
npm deprecate cortico-world-private-companion@0.1.1 "回退到 0.1.0：主动频率计算有误"
npm version 0.1.2 && npm publish
```

Coopanion 侧把依赖改回 `^0.4.3`，重装并重启即可（数据目录不受影响）。
