# 聚梦标题字体

`jumeng-serif-semibold.ttf` 为 Noto Serif SC 的 600 字重标题子集（68,924 字节），按 SIL Open Font License 1.1 分发，授权全文在 `OFL.txt`。修改后内部字体名为 Jumeng Serif Subset；界面注册名为 Jumeng Serif。

原始可变字体来自 Google Fonts 官方仓库：
https://github.com/google/fonts/tree/main/ofl/notoserifsc

只覆盖 `characters.txt` 中的界面标题、案例名、镜头标题与数字；不承担普通正文的全部中文。新增案例时，缺字会使用系统回退字体；需要视觉一致时用原始 TTF 更新子集：

```powershell
python -m pip install fonttools
python scripts/subset-title-font.py 原始NotoSerifSC字体.ttf
npm run build
```

正常项目构建不需要 Python 或完整字体；Node 将已提交的子集转成忽略提交的 `data/title-font.ts`，供 App 启动时 `wx.loadFontFace` 全局加载。Data URL 需要基础库 3.7.9+；旧版或加载失败保留系统字体，不能把构建通过当作真机字体验收。此方式不上传字体，不依赖额外字体域名。

微信官方 API：https://developers.weixin.qq.com/miniprogram/dev/api/ui/font/wx.loadFontFace.html
