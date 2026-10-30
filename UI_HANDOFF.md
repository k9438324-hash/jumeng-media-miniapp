# 聚梦传媒 · Claude UI交接

## 固定产品约束

品牌“聚梦传媒”，人物统一称“IP”。仅两个底部导航：`对标 SOP`、`聚梦AI`；默认 SOP。不得加入首页、我的、课程、作业、打卡、商城、排行榜或智能体广场。首版仅文字与SOP，不做图片/视频识别。这里的目录、字段、接口已经实现；视觉设计以这些约定为基础。

## 技术栈与构建

微信原生：WXML + WXSS + TypeScript（预编译成 CommonJS JS）；不使用 HTML/ReactDOM/浏览器video API。根目录运行 `npm run build`，开发者工具导入根目录。Node.js 24 服务端，SQLite单实例持久化，无前端密钥。所有路径均相对本工程。

## 页面路由

| 路由 | 作用 | 路由状态 |
|---|---|---|
| `pages/sop/index` | SOP目录 + 页内案例详情 | `lesson=null` 为目录，非空为照拍；底部Tab始终保留 |
| `pages/ai/index` | 聚梦AI聊天 | 内部展示历史列表；没有第三个Tab |

SOP详情有“返回目录”按钮，不新增页面。若未来拆为独立详情路由，须另行解决底部两导航和视频销毁生命周期，不能只改样式。

## 组件区域和状态

目前按页面内语义区域划分，尚未抽取自定义组件；Claude可在不更改契约的情况下拆成原生组件。

| 区域 | 绑定状态 | 事件/行为 |
|---|---|---|
| 五类选择 | `categories, categoryId, cases` | `selectCategory`，保持固定五类 |
| 案例卡片 | `cases` | `openCase`，自动恢复该案例进度 |
| 视频 | `videoSrc, poster, initialTime, full, mediaError` | `timeUpdate, videoError, toggleFull, replay` |
| 镜头信息 | `lesson, shot, shotIndex` | `previous, next, selectShot`；首尾按钮禁用 |
| SOP转AI | 当前 `lesson.id, shotIndex` | `bringToAI`；暂停、存上下文、切Tab |
| AI模式提示 | `modeLabel` | 模拟必须可见；不得隐藏或伪装真实接入 |
| 聊天记录 | `conversation.messages` | `copy`；text selectable；保留换行 |
| 在途生成 | `busy, partial, status` | `stop`；`partial`是暂存结果，完成后从正式消息中显示 |
| 输入区 | `input, examples, connecting` | `input, example, send`；示例在输入框上方 |
| 内部历史 | `historyOpen, history` | `showHistory, selectHistory, closeHistory` |
| 异常提示 | `error` | `retry`按失败操作重试；不得吞掉额度/权限/网络错误 |
| 对话操作 | 当前 conversation | `newConversation`；生成时禁用新建/切历史 |

视频必须保留 `object-fit="contain"`、`autoplay=false`、`bindtimeupdate`、`binderror`、ID `reference`。切镜/切类别/返回目录/切原片/切Tab/离开页面必须调用暂停。默认播放器高640rpx，视觉可调高度但不得裁掉内容。播放器不自动连播下一镜。

SOP本地存储：`jumeng:category`、`jumeng:progress:{lessonId}`（`shotIndex,time,full`）。AI交接：`jumeng:pendingSop`；AI在新对话创建成功后消费，保留完整SOP和当前镜头索引。聊天正文在服务端，客户端仅缓存当前ID、任务ID、待发送请求以便恢复。不要为了设计预览把全体学员历史放到前端数据里。

## 数据字段与示例

来源清洗后的完整数据在 `miniprogram/data/course.json`。索引从0开始，时间单位秒，媒体均为相对键。

原生运行约束：页面import使用 `../../data/course`，构建会把JSON生成TS再编译成JS。不能把页面改回直接import/require course.json，否则微信运行时会出现找不到module并显示空白页；Node测试能读JSON不代表小程序能读。

```json
{
  "categories": [{"id":"measure","name":"量房","desc":"问需求、量尺寸、说改法","lessonIds":[1],"primary":1}],
  "lessons": [{
    "id":1,"name":"进门看厨房","task":"让人看懂：这家厨房哪里不方便，准备怎么改。",
    "need":"一间还没改的厨房、一位愿意讲情况的业主、一位会量房的IP、一把卷尺。",
    "takeaway":"先让业主讲生活，再让IP讲办法。",
    "file":"videos/13437715451966486.mp4","duration":160.266667,
    "shots":[{
      "title":"先拍今天来干什么","where":"站在院门口，离IP约2米。",
      "frame":"手机竖着，IP从头到膝盖都在画面里。",
      "action":"按录像，IP看镜头说话。","say":"IP说：今天来看旧厨房。",
      "stop":"说完等2秒。","check":"人和声音清楚。",
      "ref":0,"end":5,"keep":5,
      "clip":"clips/bb241dc6a8710a7a.mp4","clipPoster":"clips/bb241dc6a8710a7a.jpg","image":"assets/v1-1.jpg"
    }]
  }]
}
```

上例文字有缩略，实际正文以数据文件为准。`ref/end` 为原片参考区间；`keep` 是建议拍够的秒数，不能拿它当参考片段的真实时长。分镜使用实际独立clip播放。保留全部9案例，成品案例类有5个；量房/见客户共用1条视频但脚本不同。

`Conversation = {id,title,context: {lessonId,shotIndex}|null,messages:[{role:'user'|'assistant',content}],updatedAt}`。`Job = {id,conversationId,status:'running'|'completed'|'stopped'|'failed',text,error,mode:'mock'|'deepseek'}`。时间戳为毫秒。客户端不得提交OpenID、owner、system角色或模型Key作为可信身份。

## HTTP接口

JSON；除健康检查/登录及本机调试媒体外，均要求 `Authorization: Bearer <token>`。`POST`、`DELETE`也按此认证。详见 `server/app.ts`。

| 请求 | 请求体 | 成功响应 |
|---|---|---|
| `GET /health` | 无 | `200 {ok,authMode,aiMode}` |
| `POST /auth/login` | 模拟 `{deviceId}`；真实 `{code}` | `200 {token,expiresAt,authMode,aiMode}` |
| `GET /conversations` | 无 | `200 {items:[{id,title,context,updatedAt}]}`，当前用户的历史 |
| `POST /conversations` | `{context?:{lessonId,shotIndex}}` | `201 Conversation` |
| `GET /conversations/:id` | 无 | `200 Conversation` |
| `POST /conversations/:id/generations` | `{requestId,content}` | `202 Job`，约600ms轮询一次 |
| `GET /conversations/:id/generations/by-request/:requestId` | 无 | `200 Job`；只读查询已存在任务，未找到或越权404，不创建任务、不扣额 |
| `GET /generations/:id` | 无 | `200 Job`；`text`为完整累计内容，不是增量 |
| `DELETE /generations/:id` | 无 | `200 Job`；向上游传递Abort并等待任务落定 |

统一失败：`{error:"可展示的错误信息"}`。400字段错误；401重登；403未开通；404含跨用户访问；409生成冲突/对话轮次满；413体积过大；429每日额度或登录频率；500/502服务器/微信上游异常。AI上游运行失败体现在任务 `status=failed,error`，不是把失败当作assistant回复。

同一对话重复相同 `requestId` 返回原任务，不重复扣额。明确失败后重试使用新requestId；断网导致结果未知时复用原requestId。停止会保留已生成文字，无法撤回已发生的上游费用。

## 视觉调整入口

- `miniprogram/app.wxss`：`--surface/background/text/muted/line/accent/radius`、基础字号和间距。
- `miniprogram/pages/sop/index.wxss`：视频比例容器、分类、镜头信息。
- `miniprogram/pages/ai/index.wxss`：消息、示例、输入区和键盘布局。
- 两页 WXML：布局、文案层级、空态/错误态。可以调整布局或抽组件，保留事件和数据契约。
- `app.json`：导航栏和Tab的视觉属性。Tab名称、数量、路由与默认顺序锁定。

**色板已定稿**（见 `styles/tokens.wxss`）：底色 Parchment `#F5F4F0`、主文字 `#1A1917`、强调色赭石砖红 `#C05A3A`、分隔线 `#E9E7E0`。字体为全无衬线细体（苹方优先，标题 `font-weight:300`）。改变样式后跑 `npm test`，再在开发者工具和手机复核视频比例、键盘遮挡、长文本、Tab切换暂停。逻辑测试通过不代表视觉验收或手机验收通过。

## 界面已落地（2026-10-30 修正）

以下 UI 已在现有工程落地，只改呈现、不改业务逻辑/接口/字段/事件语义，不新增色值，统一沿用 `styles/tokens.wxss`。

- **底部导航**：改用微信自定义 tabBar（`app.json` 设 `tabBar.custom=true`，新增 `custom-tab-bar/` 组件）。仍仅「对标 SOP」「聚梦AI」两项；24rpx 文字，上方 44rpx 细线图标（CSS 绘制：SOP 线框文档、AI 线框气泡），未选中 `--ink-3`、选中 `--ink` 加粗 + 顶部 4rpx `--ink` 短线；背景 `--bg`、顶部 1px `--line`、底部 `env(safe-area-inset-bottom)` 留白。两页在 `onShow` 通过 `getTabBar().setData({selected})` 同步选中态。
- **聚梦AI 页**：顶栏单行（标题「聚梦AI」衬线 44rpx `white-space:nowrap` + 右侧「新建对话」「历史」26rpx 文字按钮带 CSS 细线图标，热区 ≥88rpx）；下一行状态「真实 AI」（26rpx `--ink-3`）或「模拟模式」（`--warn` 线框小标签）；登录过期（401）为紧凑提示条（72rpx、`--warn` 文字 `--select` 底、左 4rpx `--warn` 竖线、「重试」靠右同行）；上下文条一行截断 + 右侧「清除」；空态垂直居中（头像 96rpx、标题 34rpx 衬线、说明 26rpx `--ink-2` 两行）；提问示例改为短标签胶囊（≤12 字，横向滚动、首尾 32rpx 边距、点击填入完整文本）；输入区合并为 16rpx 圆角 `--surface` 容器（textarea 1–4 行自适应，右下 80rpx 圆形 `--ink` 发送键，生成中变「停止」方块）；下方仅一行 24rpx `--ink-3` 提示「AI建议请结合现场核对」；消息用户右对齐 `--select` 底 16rpx 圆角，AI 左对齐无底 30rpx 行高 1.7、前 24rpx「聚梦AI」小标签，复制/重新生成放回复下方。
- **对标 SOP 目录页**：案例名（衬线 34rpx `--ink` 不加粗）→ 说明（28rpx `--ink-2` 常规，去掉「让人看懂：」前缀、两行截断）→ 底部「N 个镜头」（24rpx `--ink-3`）；整行可点、右侧仅细线箭头，有进度行案例名前加 12rpx `--accent` 圆点、右侧「继续」；行内上下 padding 36rpx、行间 1px `--line`、无卡片底；分类标签选中 `--ink` 加粗 + 下方 4rpx×32rpx `--ink` 横线（取消灰块底），未选中 `--ink-2` 常规。

**头像说明**：仓库内 `assets/brand.png` 与 `brand/` 目录均为「聚梦」黑字 + 橙红点版本（非「圆环+橙红点」抽象版）。需求第 4 条要求优先用「jumeng-avatar 圆环+橙红点」版本，若仓库内为旧「聚梦」字头像则保持原图——当前仓库内即旧「聚梦」字头像，故**保持原图未替换**。

**待真机验证**：标题在 iPhone 小/大屏下不换行、提问胶囊不截断、键盘弹出时输入与发送可点、案例详情内底部导航仍在。这些项已通过 `npm test`（15 项）与官方 WXML/WXSS 编译器检查，但尚未真机验收。

## 三轮 UI 定稿（2026-10-30，覆盖上述第一轮描述）

第一轮的「衬线标题、`--ink` 选中态、深色发送键」已被后续三轮迭代覆盖，**以当前源码为准**：

- **配色**：`styles/tokens.wxss` 最终定为 Parchment `#F5F4F0` 底 + `#1A1917` 文字 + 赭石砖红 `#C05A3A` 强调（此前试过 `#C96442`/`#D97757`，均已弃用）。
- **字体**：从衬线宋体改为**全无衬线细体**（苹方优先），标题 `font-weight:300` + 大字号 + letter-spacing。微信小程序无法引入外部字体，宋体会 fallback 到 SimSun（丑）。
- **发送键/主按钮**：赭石橙（非深色）；全局 button 去边框、圆角改小圆角。
- **tabBar 选中态**：赭石橙（非 `--ink` 黑）；修复了硬编码旧色值。
- **SOP 目录页**：改大图卡片列表（封面图 + 标题 + 说明 + 镜头数），五类分类平铺（非横向滚动）。
- **上架合规**：AI 回复加「内容由AI生成」标识、免责提示、SOP 页「隐私说明」入口 + 弹窗。

接手 AI 判断当前 UI 时，应以本节 + 实际源码为准，第一轮「界面已落地」节的衬线/深色描述已作废。
