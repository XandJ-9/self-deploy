# 09 · 双平台双框架仓库组织方案

## 目标

在单仓内同时支持两条产品主线：

- Windows：Tauri + Rust
- macOS：Electron + Node

并保持一套可复用的业务模型、协议定义与渲染层。

## 目标结构

```text
apps/
  win-tauri/
  mac-electron/
  shared-renderer/
packages/
  domain/
  ipc-contract/
  platform-adapter/
  testkit/
docs/
.github/workflows/
```

## 阶段计划

### 阶段 1（已完成）：骨架与命名统一

- 增加 `apps/*` 与 `packages/*` 目录骨架
- 根脚本补充平台语义别名：
  - `dev:win` / `build:win` / `package:win`
  - `dev:mac` / `build:mac` / `package:mac`
- README 增加双平台导航与入口说明

### 阶段 2（已完成）：第一轮物理平移

- `src/shared` 的协议与类型实体迁入 `packages/ipc-contract` 与 `packages/domain`
- `src/renderer` 物理平移到 `apps/shared-renderer/src`，构建入口已切换
- `src/main` / `src/preload` / `src/shared` 物理平移到 `apps/mac-electron/src`，`build:mac` 已切换到新路径
- `src-tauri` 物理平移到 `apps/win-tauri`，`dev/build/package` 已切换到新路径
- 旧路径目录当前保留为过渡兼容副本

### 阶段 3：共享层收敛与导入清理

- 将 `src/renderer` 平移到 `apps/shared-renderer`
- 将 `src/shared` 拆分到：
  - `packages/ipc-contract`
  - `packages/domain`
- `apps/win-tauri` 与 `apps/mac-electron` 仅保留壳层与平台实现

### 阶段 4：平台适配统一

- 抽离 `packages/platform-adapter`
- 禁止 UI 直接调用 tauri/electron API
- 前端统一调用 adapter 暴露的接口

### 阶段 5：测试与发布

- 增加 contract test，保证双端协议兼容
- 增加平台 E2E：`test:e2e:win` / `test:e2e:mac`
- CI 按平台矩阵构建与发布

## 目录职责约束

1. `packages/domain` 禁止依赖运行时平台库（tauri/electron/node）
2. `packages/ipc-contract` 仅定义通道、请求、响应和错误码
3. 平台差异只允许存在于 `apps/win-tauri` 与 `apps/mac-electron`
4. 新增功能必须在 PR 中标记平台覆盖范围：Win / Mac / Both

## 当前映射（过渡期）

- `src-tauri/` 对应未来 `apps/win-tauri/`
- `src/main/` + `src/preload/` 对应未来 `apps/mac-electron/`
- `src/renderer/` 对应未来 `apps/shared-renderer/`
- `src/shared/` 对应未来 `packages/domain` + `packages/ipc-contract`

本阶段不进行大规模代码移动，优先保证当前分支可持续开发与可回滚。