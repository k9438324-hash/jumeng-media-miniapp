export interface Account {
  membership: { label: string; startsAt: number; expiresAt: number; quota: number; used: number } | null;
  status: 'inactive' | 'expired' | 'exhausted' | 'active';
  remaining: number; todayUsed: number; dailyLimit: number;
  records: { id: string; at: number; status: string; mode: string; charged: number }[];
}
export function quotaView(account: Account) {
  const remaining = Math.max(0, Number(account.remaining) || 0);
  const quota = Math.max(0, Number(account.membership?.quota) || 0);
  const available = account.status === 'active' ? remaining : 0;
  const todayRemaining = Math.max(0, account.dailyLimit - account.todayUsed);
  return {
    percent: quota > 0 ? Math.min(100, Math.floor(available / quota * 100)) : 0,
    dailyPercent: account.status === 'active' && account.dailyLimit > 0 ? Math.min(100, Math.floor(Math.min(available, todayRemaining) / account.dailyLimit * 100)) : 0,
    todayRemaining: account.status === 'active' ? Math.min(available, todayRemaining) : 0,
    label: account.status === 'active' ? '套餐剩余' : account.status === 'expired' ? '已到期' : account.status === 'exhausted' ? '额度已用完' : '尚未开通',
  };
}
