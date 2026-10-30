# 聚梦传媒微信小程序

**其他AI接手先读 [NEXT_AI_HANDOFF.md](NEXT_AI_HANDOFF.md)，界面设计读 [UI_HANDOFF.md](UI_HANDOFF.md)。**

交给Claude的完整设计与原生实现提示词：[CLAUDE_UI_PROMPT.md](docs/CLAUDE_UI_PROMPT.md)。

独立工程。微信原生小程序 + TypeScript；Node.js 24 服务端 + SQLite；DeepSeek 由服务端调用。采用米白底、黑色文字、橙色点缀与品牌 Logo。底部为 **对标 SOP**、**聚梦AI**、**会员**，默认进入 SOP；点击各页 Logo 展开功能菜单。

本地老师后台可管理 SOP 草稿、发布状态、学员权限、会员期限与 AI 次数，见 [老师后台使用说明](docs/老师后台.md)。SOP 拆解技能尚未创建。源码同步到 GitHub 不等于部署或微信上线。

已导入真实课程：五类、9 案例、54 镜、8 条不同完整视频。没有把旧网页当成小程序，没有改动 LeiLifeOS，没有上传原素材或发布上线。

## 本地打开

需要 Node.js **24.16 或更新的 24.x** 和微信开发者工具稳定版。

在本目录打开 PowerShell：

```powershell
npm ci
npm run build
npm run setup
npm run dev
```

setup保留现有.env。GitHub仓库不提交生成JS，首次导入前运行build；后续编辑TypeScript后重新构建，或另开终端 `npm run watch:mini`。不要直接修改生成JS。

1. 微信开发者工具 → 导入项目 → 选择本工程根目录（包含 `project.config.json`），不是 `miniprogram` 子目录。
2. 已接入用户提供的 AppID `wx0d79451e6dd4b6b9`。开发者工具需使用有权限的微信扫码；其他开发者须由管理员添加权限。
3. 本地模拟时，在开发者工具“详情 → 本地设置”临时勾选“不校验合法域名、web-view、TLS版本及HTTPS证书”。正式环境必须恢复域名校验。
4. 本地配置为 `http://127.0.0.1:8787`；视频从 `.env` 的 `MEDIA_ROOT` 只读提供，聊天有明显的“模拟模式”提示。
5. 默认目录中点击案例 → 切镜/重播/完整原片 → 带入聚梦AI → 补充现场文字后发送。

最新验证：AppID已成功导入，原生模拟器8项交互检查通过（使用本机媒体与模拟AI）。复跑时先启动服务，在工具开启服务端口，再运行：

```powershell
& 'D:/微信web开发者工具/cli.bat' auto --project 'D:/4.3杨磊/垒/聚梦传媒小程序' --auto-port 9420 --port 44386
npm run test:devtools
```

安装路径、服务端口按本机实际情况调整；该检查不等于真实API或手机验收。完整记录见docs/devtools-verification.json。课程JSON会在build时转为JS模块，小程序页面不得直接require JSON。

手机上的 `127.0.0.1` 指手机本身，不能用来访问电脑服务。手机联调应使用微信身份模式和经过配置的可访问 HTTPS 测试服务；本工程不开放模拟身份到局域网或公网。

## 目录

| 目录/文件 | 用途 |
|---|---|
| `miniprogram/pages/sop` | 目录、案例照拍、原片/片段切换、续看 |
| `miniprogram/pages/ai` | 文字聊天、SOP上下文、历史和异常处理 |
| `miniprogram/data/course.json` | 小程序和服务端共享的已清洗课程 |
| `miniprogram/domain.ts` | 类型、进度边界、媒体URL |
| `miniprogram/services/api.ts` | 微信/模拟登录、统一请求 |
| `miniprogram/config.ts` | 公开的API地址、身份模式、媒体地址 |
| `miniprogram/app.wxss` | 全局视觉变量和基础样式 |
| `server` | 身份、权限、额度、SQLite、DeepSeek适配 |
| `scripts` | 只读课程导入、媒体核验 |
| `tests` | 服务端HTTP集成测试与小程序逻辑模拟测试 |
| `UI_HANDOFF.md` | Claude设计交接约定 |
| `docs/DEPLOYMENT.md` | 环境、媒体与部署说明 |
| `docs/VERIFICATION.md` | 已验证范围与人工验收清单 |

## 修改素材

原视频、字幕、PDF、原JSON都保持原位。课程导入脚本只读取来源，输出本工程的清洗副本，不带 `source` 本地绝对路径。

```powershell
npm run import:course
npm run verify:media
npm test
```

本机已安装Windows开发者工具时，可运行 `npm run verify:native`，使用其附带编译器检查WXML/WXSS；安装在其他位置时设置WECHAT_DEVTOOLS_PATH。此检查不替代工具内运行和手机验收。

导入与媒体核验默认依赖本机现有文件；工程移到别处后，可在命令行传入明确的 JSON、媒体根目录参数。测试中的媒体专项依赖现有素材目录，跨机器运行前须配置 `TEST_MEDIA_ROOT`，详见验证说明。

## 接入所需信息

不需要把密钥发到聊天中。后续统一准备：小程序 AppID、可管理该小程序的微信账号、服务端环境变量里的 AppSecret 与 DeepSeek Key、学员 OpenID 许可名单、HTTPS API域名及服务器、经授权的媒体托管地址。具体字段见 `server/.env.example` 和部署说明。

目前状态：模拟测试通过；真实API、微信开发者工具编译/播放、手机验收尚未通过。所有发布、上传素材操作均待你明确授权。
