import { api, sessionLabel } from '../../services/api';
interface Account {
  membership: { label: string; startsAt: number; expiresAt: number; quota: number; used: number } | null;
  status: 'inactive' | 'expired' | 'exhausted' | 'active'; remaining: number; todayUsed: number; dailyLimit: number;
  records: { id: string; at: number; status: string; mode: string; charged: number }[];
}
function time(value: number) {
  const date = new Date(value + 8 * 3600000);
  return date.getUTCFullYear() + '/' + (date.getUTCMonth()+1) + '/' + date.getUTCDate() + ' ' + String(date.getUTCHours()).padStart(2,'0') + ':' + String(date.getUTCMinutes()).padStart(2,'0');
}
Page({
  data: {
    menuItems: [{ label: '登录 / 刷新会员状态', action: 'refresh', guarded: true }], account: null as Account | null, loading: false, error: '', modeLabel: '', statusLabel: '', expiresLabel: '', records: [] as { id: string; time: string; status: string; mode: string; charged: number }[] },
  visible: false,
  openTeacher() { if (this.data.loading) return; wx.navigateTo({ url: '/pages/teacher/index' }); },
  menuCommand(e: WechatMiniprogram.CustomEvent<{ action: string }>) {
    if (e.detail.action === 'refresh') void this.refresh();
  },
  onShow() {
    this.visible = true;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 2 });
    if (this.data.account) void this.refresh();
  },
  onHide() { this.visible = false; },
  onUnload() { this.visible = false; },
  async refresh() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const account = await api<Account>('/account');
      if (!this.visible) return;
      const statuses: Record<string,string> = { inactive:'尚未开通', expired:'已到期', exhausted:'额度已用完', active:'使用中' };
      const results: Record<string,string> = { running:'生成中', completed:'已完成', stopped:'已停止', failed:'失败' };
      this.setData({ account, modeLabel: sessionLabel(), statusLabel: statuses[account.status],
        expiresLabel: account.membership ? time(account.membership.expiresAt) : '',
        records: account.records.map(r => ({ id:r.id, time:time(r.at), status:results[r.status] || r.status, mode:r.mode === 'mock' ? '模拟' : 'AI', charged:r.charged })) });
    } catch (e) {
      if (this.visible) this.setData({ account: null, records: [], error: e instanceof Error ? e.message : '加载失败，请重试' });
    } finally { this.setData({ loading: false }); }
  },
});
