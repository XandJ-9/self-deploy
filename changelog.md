# Changelog

> 所有功能新增（feat）和缺陷修复（bugfix）都必须记录于此。按日期倒序排列。
>
> 格式：
> - `feat(模块): 描述`
> - `bugfix(模块): 描述`

## 2026-05-24

- feat(renderer): 模块页面顶部 `PageHero` 卡片改为吸顶（sticky），加深背景与模糊度避免内容透出，纵向滚动时始终可见
- feat(deploy): 本地文件夹模式新增「远端子目录」(`targetSubDir`)，可将本地子目录上传到部署根下的指定子目录，UI 实时预览实际目标根路径
- feat(docs): 新增 `changelog.md`，并在 `AGENTS.md` 中加入"变更记录"全局原则
