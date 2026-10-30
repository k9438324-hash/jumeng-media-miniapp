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
- `miniprogram/styles/tokens.wxss`：色板、字体、字号、间距、圆角全部在此统一定义，页面内不得散落硬编码色值。
- `miniprogram/pages/sop/index.wxss`：视频比例容器、分类、镜头信息。
- `miniprogram/pages/ai/index.wxss`：消息、示例、输入区和键盘布局。
- 两页 WXML：布局、文案层级、空态/错误态。可以调整布局或抽组件，保留事件和数据契约。
- `app.json`：导航栏和Tab的视觉属性。Tab名称、数量、路由与默认顺序锁定。

## 四轮 UI 定稿（2026-10-30 傍晚，Lei 风格，最终版，覆盖前三轮所有描述）

本轮按最新 UI/UX 需求整体重构，只改呈现、不改业务逻辑/接口/字段/事件语义。以本节为最终权威，前三轮「界面已落地」「二轮优化」「三轮定稿」均已作废。

**色板**（`styles/tokens.wxss`）：`--bg #F5F1E8`（页面底/导航栏/tabBar 统一，消除色差）、`--surface #FBF8F1`、`--ink #1C1B19`、`--ink-2 #5E5A52`、`--ink-3 #8F8A7F`、`--line #E4DED0`、`--select #ECE6D8`、`--accent #D9482B`（橙红，全局仅镜头序号/阅读进度/新标，一屏≤2处）、`--warn #B4531A`、`--danger #B3261E`。

**字体**：标题衬线 `--font-title`（"Songti SC","Noto Serif SC","STSong","SimSun",serif，字重600）；正文无衬线 `--font-body`（苹方等，字重500）。字号：主标题52/区块36/正文30/说明28/辅助24（不低于24）。行高正文1.65、标题1.35。**Noto Serif SC 子集字体打包（wx.loadFontFace）本轮未做，属待办**，当前依赖系统衬线回退链（开发者工具/部分机型会回退细黑体）。

**分类显示名映射表**：`pages/sop/index.ts` 顶部 `categoryLabels` 常量集中管理，内部 category key 不变。映射 measure→量房、start→开工、case→案例（原"成品案例"）、meet→谈单（原"见客户"）、inspect→巡检。固定五类顺序。

**SOP 目录页**：标题"对标 SOP"衬线56rpx + 说明"选一种现场，照着参考片拍"28rpx `--ink-2`；五类等宽分段条（`--select` 圆角条底，选中项 `--ink` 实心胶囊+`--bg` 字，未选中 `--ink-2`）；"共 N 条"24rpx `--ink-3` 动态；案例纯文字行（案例名衬线36rpx→说明28rpx `--ink-2` 两行→"N个镜头"24rpx `--ink-3`），行内上下padding32rpx、行间1px `--line`，不做卡片；空类"这一类还没有案例"；未读行首 `--accent` "新"标；有进度右侧 `--ink` 实心胶囊"继续"+镜头数后 `--accent` "读到第X镜"；无进度右侧细线箭头；案例>20条显示搜索入口（当前9案例不触发）。加载用 `--select` 骨架条。

**SOP 详情页**：顶部返回+案例名；视频 `object-fit:contain` 竖屏不裁切（高约42vh）；分段切换（当前参考片段/完整原片）用 `--select` 分段条；镜头导航"第X/N镜"（序号衬线 `--accent` 44rpx）+镜头名+上一镜/重播/下一镜（下一镜 `--ink` 实心胶囊主按钮，上/重播线框次按钮）；六项信息逐项呈现（小标签24rpx `--ink-3` + 正文30rpx `--ink`，"IP说什么或问什么"衬线+左2px引文线，"拍够的标准"行首勾图标），六项间发丝线/32rpx间距，不用卡片；底部吸附"带入聚梦AI，按现场调整拍法"（`--ink` 胶囊全宽留边距）。原镜头列表 shot-list 与"已保存阅读位置"提示已移除（切镜由镜头导航条承担），`selectShot` 方法保留但 WXML 未渲染。

**AI 页**：顶栏"聚梦AI"衬线600 nowrap flex-shrink:0 + 右"新对话""历史"26rpx `--ink-2` 文字按钮（热区≥88rpx）；模拟模式时标题下 `--warn` 线框"模拟模式"标签，真实AI不显示；登录过期紧凑提示条（72rpx `--select` 底+左4rpx `--warn` 竖线+重试靠右）；上下文条一行截断+右侧"清除"+`--ink-3` 淡提示"补充现场条件，建议会更准"，未带入不占位；空态上移约上1/3（头像96rpx+衬线标题"把现场说清楚"无说明段），头像改用 `assets/jumeng-avatar.png`（灰黑圆环缺口+中心橙红点，本轮新增）；提问示例纯文字列表（28rpx `--ink-2` 行高88rpx 无分割线无胶囊，点击填完整提问）；输入区外框3rpx `--ink` 边框（≈1.5px）+16rpx圆角+`--surface`底，占位"补充现场情况"，发送键76rpx圆形 `--ink` 底+`--bg` 箭头，输入空 opacity0.4 不可点不消失，生成中变停止方块，键盘弹出上抬；消息用户右对齐 `--select` 底16rpx圆角，AI左对齐无底30rpx行高1.7+前24rpx"聚梦AI"标签，每条AI回复末尾"AI建议请结合现场核对"+复制/重试文字按钮。

**底部 tabBar**：选中态 `--ink` 加粗+4rpx×56rpx `--ink` 短线（原 `--accent`）；图标 CSS 细线（线框文档/线框气泡）；未选中 `--ink-3`。

**头像**：`brand/` 与 `assets/` 新增 `jumeng-avatar-144.png`/`jumeng-avatar.png`（灰黑圆环缺口+中心橙红点，用户本轮提供），AI页空态使用；旧"聚梦"字头像 `assets/brand.png` 保留但不再用于空态。

**待真机验证**：标题衬线字体、小屏/大屏标题不换行、竖屏视频不裁切、超长中文换行、键盘弹出输入与发送可点、底部安全区、Tab切换、案例内切Tab后状态、空类与案例很多的表现、Noto Serif SC 字体加载效果。
