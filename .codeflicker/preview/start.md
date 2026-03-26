# Scout 马戏星探 启动指南

## 项目概述
Scout 马戏星探是一款在线多人桌游，基于 Express + Socket.io 实现实时多人对战。

## 快速启动

```bash
npm install
npm start
```

**启动后访问**：http://localhost:3000

```yaml
subProjectPath: .
command: npm start
cwd: .
port: 3000
previewUrl: http://localhost:3000
description: Scout 在线多人桌游服务器（支持 WebSocket 实时通信）
```

## 说明
- 默认端口：3000（可通过环境变量 `PORT` 修改）
- 启动后会看到提示：`🎪 Scout 游戏服务器已启动！`
- 支持多人在线游戏，使用 Socket.io 实现实时通信
