Component({
  properties: {
    percent: { type: Number, value: 0 },
    compact: { type: Boolean, value: false },
    label: { type: String, value: '套餐剩余' },
  },
  data: { value: 0, first: 0, second: 0 },
  observers: {
    percent(percent: number) {
      const value = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)));
      this.setData({ value, first: Math.min(50, value) * 3.6, second: Math.max(0, value - 50) * 3.6 });
    },
  },
});
