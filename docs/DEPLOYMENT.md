# 环境、媒体与部署

## 服务端配置

复制 `server/.env.example` 到 `server/.env`，只在服务器或本机环境中填写。`.gitignore` 排除 `.env`、SQLite与本地媒体配置；客户端不包含任何Key。生产部署不复制 `.env` 进镜像，通过环境/密钥管理注入。

| 变量 | 说明 |
|---|---|
| `AUTH_MODE` | `mock`仅本机开发；`wechat`使用微信code换openid |
| `AI_MODE` | `mock`明显模拟回复；`deepseek`真实调用，缺Key直接启动失败 |
| `WECHAT_APP_ID/WECHAT_APP_SECRET` | 微信服务器换取身份，仅服务端保存Secret |
| `WECHAT_ALLOWED_OPENIDS` | 首版人工管理的学员许可名单，逗号分隔；为空拒绝启动真实身份模式 |
| `DEEPSEEK_API_KEY` | DeepSeek Key，服务端环境变量 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com`，可改HTTPS兼容地址，不包含 `/chat/completions` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash`；按实际账号模型权限配置 |
| `DAILY_REQUEST_LIMIT` | 每用户每日请求上限，默认30，北京时间零点换日 |
| `DB_PATH` | SQLite持久卷绝对路径；默认 `server/data/jumeng.sqlite` |
| `HOST/PORT` | 默认127.0.0.1:8787；真实身份可改0.0.0.0供反向代理访问 |
| `MEDIA_ROOT` | 仅模拟身份模式下启用的本机只读媒体目录；真实模式不开放此路由 |
| `NODE_ENV` | 部署时设 `production`；禁止模拟身份/模拟AI启动 |

额度在服务端事务内预扣，幂等重复不再扣；失败、停止、重试均可能产生费用，因此失败/停止不退请求额度，重试算一次新调用。每对话最多30轮，输入最多4000字，生成最多2048 tokens，90秒中止，输出最多30000字符。不是按token实时计费系统，不含付款/充值。

微信身份由 `wx.login` → `/auth/login` → `jscode2session` 得到。客户端提供的设备ID只在本机模拟有效。服务端把身份哈希与每条对话/任务绑定，用不透明短期token认证；token在数据库只存哈希，7天到期。许可名单变更后重启服务即可撤销已移除学员的旧token权限。首版不包含后台管理页面；通过本地管理环境维护许可名单，不对陌生账号自动开户。

首次取得学员OpenID：在真实AppID的开发者工具控制台执行 `wx.login({success:r=>console.log(r.code)})`，由管理员在本地终端运行 `node --env-file=server/.env scripts/resolve-openid.mjs`，输入刚取得的code。此脚本仅展示OpenID，核实身份后由管理员写入许可名单；不会输出AppSecret或自动授权。正式学员的code需在其本人登录环境取得，不能用管理员自己的code代替。

## 小程序配置

1. 在 `project.config.json` 填真实AppID。
2. `miniprogram/config.ts`：设置 `authMode:'wechat'`、`apiBase:'https://你的API域名'`、`mediaBase:'https://你的媒体域名/课程前缀'`。
3. 在小程序管理后台配置request合法域名，以及媒体所在downloadFile合法域名；按微信后台当前规则配置HTTPS证书和域名。不要把API Key或AppSecret填入此文件。
4. `npm run build`后在开发者工具调试；随后再做预览与手机验收。游客模式不能替代真实微信身份验收。

## 媒体配置

`mediaBase + '/' + course.json内相对键` 构成地址。保留：

```text
videos/13437715451966486.mp4
clips/bb241dc6a8710a7a.mp4
clips/bb241dc6a8710a7a.jpg
assets/v1-1.jpg
... 见 course.json
```

本地默认 `http://127.0.0.1:8787/media`，支持Range请求；只允许清单内文件，没有上传、删除、改名接口。原片入口对应完整视频副本；没有把分镜裁切拼成“完整原片”。没有把D盘或E盘地址写进可上线的课程数据。

上线前需你另行授权将经确认的文件上传到对象存储/CDN，并填HTTPS前缀。本次未执行上传。媒体主机需提供正确MIME（MP4为video/mp4）、Range支持和有效证书。留空 `mediaBase` 时显示未配置，阅读SOP仍可用。当前基于公开HTTPS媒体前缀；若要求付费媒体防盗链，需另行加服务端签名URL契约，不能把客户端拼接URL视为媒体访问控制。

## 服务端部署步骤（未执行）

单实例部署，使用持久磁盘。支持容器：

```sh
docker build -t jumeng-miniapp .
docker run --env-file /secure/jumeng.env -p 127.0.0.1:8787:8787 -v jumeng-data:/app/data jumeng-miniapp
```

生产环境配置示例（值由管理员在服务器填写）：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
AUTH_MODE=wechat
AI_MODE=deepseek
DB_PATH=/app/data/jumeng.sqlite
WECHAT_APP_ID=填写AppID
WECHAT_APP_SECRET=仅服务器填写
WECHAT_ALLOWED_OPENIDS=已获准的学员openid
DEEPSEEK_API_KEY=仅服务器填写
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DAILY_REQUEST_LIMIT=30
```

反向代理转发到服务端并提供HTTPS，关闭响应缓存。进度采用短轮询，不依赖代理SSE配置。微信与DeepSeek出站HTTPS需可达。不要让多个Node进程共用同一SQLite提供生成任务；任务控制器在单进程内。要横向扩展时先更换共享任务队列和数据库。代理层按实际规模设置登录频率限制；当前服务端每连接IP每分钟20次登录，默认不信任X-Forwarded-For。

通过 `/health` 检查模式，再使用真实许可学员测试登录、生成、停止、额度与历史隔离。部署与素材上传仍须另行明确授权；以上是操作说明，不表示已发布。

## 数据维护

服务停止后备份SQLite文件，或运行SQLite在线backup；运行中的WAL数据库不能只复制主文件当作完整备份。启动会把未完成旧任务标为失败，供学员重试。日志不打印密钥、微信换码URL或聊天正文。对话和用量保存在持久卷，重建容器不应清空卷。首版尚无聊天删除/数据导出管理入口，正式运营前应按实际学员数据管理需要补齐管理流程。

## 官方资料

2026-10-30 开发时读取：

- [微信video组件](https://developers.weixin.qq.com/miniprogram/dev/component/video.html)：contain、初始播放位置、事件。
- [VideoContext.pause](https://developers.weixin.qq.com/miniprogram/dev/api/media/video/VideoContext.pause.html)。
- [微信登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)。
- [wx.request](https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html)。
- [小程序全局配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)。
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：服务端POST、流式解析、可配置模型。

微信文档的网页检索服务未能打开正文，已通过本机HTTPS请求读取官方页面后实现；以开发者工具和手机验证作为后续运行验收。
