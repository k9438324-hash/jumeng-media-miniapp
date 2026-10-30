Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/sop/index', text: '对标 SOP' },
      { pagePath: '/pages/ai/index', text: '聚梦AI' },
      { pagePath: '/pages/account/index', text: '会员' },
    ],
  },
  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const { index, path } = e.currentTarget.dataset;
      if (Number(index) === this.data.selected) return;
      wx.switchTab({ url: path });
    },
  },
});
