Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/sop/index', text: '对标 SOP', icon: 'doc' },
      { pagePath: '/pages/ai/index', text: '聚梦AI', icon: 'bubble' },
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
