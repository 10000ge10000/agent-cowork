# 更新日志

本文档记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2025-05-06

### 新增

- 权限策略配置系统（PermissionManager）
- 权限设置界面（Settings → Permissions 标签页）
- 工具覆盖配置（允许/询问用户/拒绝）
- 危险工具强制确认开关
- 中断会话检测与恢复入口
- CSS 虚拟化优化（content-visibility: auto）
- 消息列表 memo 优化
- API 类型选择器（Anthropic/Custom）
- API 连接测试功能

### 改进

- 数据库操作事务保护
- 权限请求持久化（支持崩溃恢复）
- 会话继续支持异步等待 claudeSessionId
- App.tsx 组件拆分重构
- 提取 useAutoScroll、usePartialMessage hooks
- MessageList 组件独立化
- 类型安全 IPC 层优化

### 测试

- 新增 SessionStore 单元测试
- 新增 PermissionManager 单元测试
- 新增 IPC Handlers 单元测试
- 新增 React Hooks 单元测试
- 新增组件渲染测试
- 测试覆盖率达到 68 个测试用例

### CI/CD

- 新增 lint-and-test 作业
- 新增 TypeScript 类型检查步骤
- 新增单元测试步骤

## [0.1.0] - 2025-01-xx

### 新增

- 初始版本发布
- 基于 Electron 39 的桌面应用
- React 19 + Tailwind CSS 4 UI
- Zustand 5 状态管理
- better-sqlite3 会话持久化
- @anthropic-ai/claude-agent-sdk 集成
- 会话列表侧边栏
- 消息流式显示
- Markdown 渲染（react-markdown + remark-gfm）
- 代码高亮（highlight.js + rehype-highlight）
- 权限请求弹窗
- API 配置设置
- 支持 macOS (ARM64/x64)、Windows、Linux

---

## 版本说明

- **主版本号**: 不兼容的 API 变更
- **次版本号**: 向后兼容的功能新增
- **修订号**: 向后兼容的问题修复
