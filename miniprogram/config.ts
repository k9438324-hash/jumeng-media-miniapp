// 仅放公开配置；不得填写 DeepSeek 或微信 AppSecret。
export const config = {
  apiBase: 'http://127.0.0.1:8787',
  authMode: 'mock' as 'mock' | 'wechat',
  // 留空显示“媒体未配置”，不会用本地绝对路径冒充媒体地址。
  mediaBase: 'http://127.0.0.1:8787/media',
};
