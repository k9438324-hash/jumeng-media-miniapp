interface MenuItem { label: string; action: string; guarded?: boolean }
Component({
  properties: {
    items: { type: Array, value: [] as MenuItem[] },
    busy: { type: Boolean, value: false },
  },
  data: { open: false },
  pageLifetimes: { hide() { this.setData({ open: false }); } },
  methods: {
    toggle() { this.setData({ open: !this.data.open }); },
    close() { this.setData({ open: false }); },
    choose(e: WechatMiniprogram.TouchEvent) {
      const item = (this.properties.items as MenuItem[])[Number(e.currentTarget.dataset.index)];
      if (!item || (item.guarded && this.properties.busy)) return;
      this.setData({ open: false });
      this.triggerEvent('command', { action: item.action });
    },
  },
});
