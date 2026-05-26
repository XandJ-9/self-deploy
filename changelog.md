# Changelog

> 所有功能新增（feat）和缺陷修复（bugfix）都必须记录于此。按日期倒序排列。
>
> 格式：
> - `feat(模块): 描述`
> - `bugfix(模块): 描述`

## 2026-05-26

- feat(mac-tauri): 新增 macOS Tauri 应用壳，默认 dev/build/package 入口切换到 Mac Tauri
- feat(tauri-core): 抽出 Win/Mac 共享 Rust 后端 core，并为 macOS 接入 Keychain 凭据存取
- feat(ci): macOS 平台矩阵构建切换为 Tauri 并补充 Rust 工具链
- feat(release): 新增发布产物归集脚本，统一输出到 release/final 并生成版本/框架/系统/架构清单
- feat(restructure): 删除旧路径 src-tauri/、src/main/、src/preload/、src/renderer/、src/shared/，完成全量迁移到 apps/ 和 packages/；同步移除 @shared 别名并修正 ftp.spec.ts 导入路径
- feat(restructure): 完成第一轮物理迁移，shared 实体迁入 packages，renderer 迁入 apps/shared-renderer，Win/Mac 壳迁入 apps 并切换脚本入口
- feat(ci): 新增 Win/Mac 平台矩阵 CI 骨架（lint/test + Windows Tauri build + macOS Electron build）
- feat(renderer): 渲染层类型导入切换到 packages 桥接层，并将 runtime API 适配逻辑抽离到 platform-adapter
- feat(test): 新增 IPC contract 基线测试与 test:contract 脚本，纳入平台矩阵 CI
- feat(docs): 新增双平台双框架仓库组织方案，统一 Win/Mac 脚本命名（dev/build/package）并补充执行文档
- bugfix(build): 收敛当前分支为 Windows-only，移除非 Windows 打包入口与旧钥匙串依赖，并消除 Tauri/Vite 构建警告
- feat(tauri): 完成 T7 收尾，Tauri 成为默认开发/构建/打包入口，并补齐 Rust 部署忽略规则、Hook 与并发上传
- feat(history): Tauri 后端迁移部署历史、详情、日志读取与 Git 模式回滚，完成 T6 历史与回滚
- bugfix(deploy): 修复 Tauri deploy:run 的 source 入参 camelCase 解析失败导致点击部署时报“部署调用失败”
- feat(deploy): Tauri 后端迁移 deploy:run 与 deploy:scanFolder，支持 SFTP/FTP 上传、临时目录切换和实时日志事件
- feat(git): Tauri 后端迁移提交列表、diff 与 status 通道，完成 T4 Git 增量预览
- bugfix(security): Tauri Windows 凭据保存收敛为 DPAPI 加密 vault，并刷新孤儿 `credential_ref`
- bugfix(transport): Tauri SFTP 连接测试在密码认证失败后补充 keyboard-interactive 兜底，提升直连服务器兼容性
- feat(transport): Tauri 后端连接测试升级为 SFTP/FTP 协议级登录与远端基路径检查，完成 T3 服务器与项目页面能力迁移
- bugfix(tauri): 补齐 Windows Tauri 构建所需的 `icon.ico` 资源，修复 build script 检查失败
- feat(security): Tauri 后端接入系统钥匙串凭据保存，并迁移 Server 增删改与凭据读取式连接测试
- feat(db): Tauri 后端接入 SQLite 初始化与 Project 增删改查，Server/Project 列表开始读取真实数据库
- feat(tauri): 新增 Tauri v2 迁移脚手架、前端 runtime API 兼容层与迁移方案文档

## 2026-05-24

- feat(renderer): 模块页面顶部 `PageHero` 卡片改为吸顶（sticky），加深背景与模糊度避免内容透出，纵向滚动时始终可见
- feat(deploy): 本地文件夹模式新增「远端子目录」(`targetSubDir`)，可将本地子目录上传到部署根下的指定子目录，UI 实时预览实际目标根路径
- feat(docs): 新增 `changelog.md`，并在 `AGENTS.md` 中加入"变更记录"全局原则
