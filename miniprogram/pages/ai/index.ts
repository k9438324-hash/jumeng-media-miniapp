import { api, sessionLabel, ApiError } from '../../services/api';
import { config } from '../../config';
import { Context, Conversation, Job } from '../../domain';
import course from '../../data/course';
const prefix = 'jumeng:chat:' + config.authMode + ':' + config.apiBase + ':';
type RetryAction = 'init' | 'send' | 'poll' | 'history' | 'stop' | 'load';
interface PendingSend { conversationId: string; requestId: string; content: string }
Page({
  data: {
    modeLabel: '正在连接服务端', input: '', conversation: null as Conversation | null,
    contextLabel: '', busy: false, connecting: false, partial: '', status: '',
    error: '', historyOpen: false, history: [] as Pick<Conversation, 'id' | 'title' | 'updatedAt'>[],
    examples: ['我在量房现场，空间很窄，手机应该站哪里？', 'IP不擅长口播，请改成提问式拍法', '客户不出镜，这组镜头怎么调整？'],
  },
  visible: false,
  epoch: 0,
  timer: 0,
  jobId: '',
  action: 'init' as RetryAction,
  loadId: '',
  onShow() { this.visible = true; void this.initialize(); },
  onHide() { this.visible = false; this.epoch++; clearTimeout(this.timer); },
  onUnload() { this.visible = false; this.epoch++; clearTimeout(this.timer); },
  fail(error: unknown, action: RetryAction) {
    this.action = action;
    this.setData({ error: error instanceof Error ? error.message : '请求失败，请重试', connecting: false });
  },
  async initialize() {
    const epoch = ++this.epoch;
    this.setData({ connecting: true, error: '' });
    try {
      const pending = wx.getStorageSync('jumeng:pendingSop') as Context | undefined;
      let id = wx.getStorageSync(prefix + 'current') as string;
      if (pending) {
        const oldJob = wx.getStorageSync(prefix + 'job') as { id: string } | undefined;
        if (oldJob) {
          try { await api('/generations/' + oldJob.id, 'DELETE'); }
          catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
          wx.removeStorageSync(prefix + 'job');
        }
        const pendingSend = wx.getStorageSync(prefix + 'pendingSend') as PendingSend | undefined;
        if (pendingSend) {
          // 只查询已经存在的任务，不因切换SOP而启动新的AI调用。
          try {
            const old = await api<Job>('/conversations/' + pendingSend.conversationId + '/generations/by-request/' + pendingSend.requestId);
            await api('/generations/' + old.id, 'DELETE');
          } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
          wx.removeStorageSync(prefix + 'pendingSend');
        }
        if (epoch !== this.epoch) return;
        // 带入SOP时开独立对话，避免把上一案例的上下文混入新案例。
        const c = await api<Conversation>('/conversations', 'POST', { context: pending });
        if (epoch !== this.epoch) return;
        id = c.id; wx.removeStorageSync('jumeng:pendingSop');
        wx.setStorageSync(prefix + 'current', id);
        this.jobId = ''; this.setData({ partial: '', status: '', input: '' });
      }
      if (!id) {
        const c = await api<Conversation>('/conversations', 'POST', {});
        if (epoch !== this.epoch) return;
        id = c.id; wx.setStorageSync(prefix + 'current', id);
      }
      try { await this.loadConversation(id, epoch); }
      catch (e) {
        if (e instanceof ApiError && e.status === 404) { wx.removeStorageSync(prefix + 'current'); wx.removeStorageSync(prefix + 'job'); wx.removeStorageSync(prefix + 'pendingSend'); throw new Error('旧对话已不可用，点击重试建立新对话'); }
        throw e;
      }
      if (epoch !== this.epoch) return;
      this.setData({ modeLabel: sessionLabel(), connecting: false });
      const pendingSend = wx.getStorageSync(prefix + 'pendingSend') as PendingSend | undefined;
      if (pendingSend && pendingSend.conversationId === id) { this.setData({ busy: true }); await this.submit(pendingSend); return; }
      const job = wx.getStorageSync(prefix + 'job') as { conversationId: string; id: string } | undefined;
      if (job?.conversationId === id) { this.jobId = job.id; this.setData({ busy: true }); await this.poll(); }
      else this.setData({ busy: false, partial: '', status: '' });
    } catch (e) { if (epoch === this.epoch) this.fail(e, 'init'); }
  },
  async loadConversation(id: string, epoch?: number) {
    const currentEpoch = epoch === undefined ? this.epoch : epoch;
    const c = await api<Conversation>('/conversations/' + id);
    if (currentEpoch !== this.epoch) return;
    const lesson = course.lessons.find(l => l.id === c.context?.lessonId);
    this.setData({ conversation: c, contextLabel: lesson ? lesson.name + ' · 第' + (c.context!.shotIndex + 1) + '镜（完整SOP已带入）' : '' });
    wx.setStorageSync(prefix + 'current', id);
  },
  input(e: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ input: e.detail.value }); },
  example(e: WechatMiniprogram.TouchEvent) { this.setData({ input: e.currentTarget.dataset.text }); },
  async send() {
    if (this.data.busy || this.data.connecting || !this.data.input.trim() || !this.data.conversation) return;
    const pending: PendingSend = { conversationId: this.data.conversation.id, requestId: 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2), content: this.data.input.trim() };
    wx.setStorageSync(prefix + 'pendingSend', pending);
    this.setData({ busy: true, error: '', partial: '', status: '正在提交…' });
    await this.submit(pending);
  },
  async submit(pending: PendingSend) {
    let acknowledged = false;
    try {
      const job = await api<Job>('/conversations/' + pending.conversationId + '/generations', 'POST', { requestId: pending.requestId, content: pending.content });
      if (this.data.conversation?.id !== pending.conversationId) return;
      acknowledged = true;
      this.jobId = job.id;
      wx.setStorageSync(prefix + 'job', { conversationId: pending.conversationId, id: job.id });
      wx.removeStorageSync(prefix + 'pendingSend');
      this.setData({ input: '', error: '', busy: true });
      await this.loadConversation(pending.conversationId);
      await this.poll();
    } catch (e) {
      if (acknowledged) { this.fail(e, 'poll'); return; }
      // 只有明确被服务端拒绝才清除请求；网络超时保留 requestId，重试不会重复扣额。
      const rejected = e instanceof ApiError && e.status >= 400 && e.status < 500;
      if (rejected) wx.removeStorageSync(prefix + 'pendingSend');
      this.setData({ busy: false }); this.fail(e, 'send');
    }
  },
  async poll() {
    clearTimeout(this.timer);
    const requestedJob = this.jobId;
    try {
      const job = await api<Job>('/generations/' + requestedJob);
      if (requestedJob !== this.jobId || job.conversationId !== this.data.conversation?.id) return;
      this.setData({ partial: job.text, error: '', status: job.status === 'running' ? '生成中…' : job.status === 'stopped' ? '已停止，已保留生成内容' : job.status === 'failed' ? '生成失败' : '已完成' });
      if (job.status === 'running') {
        this.setData({ busy: true });
        if (this.visible) this.timer = setTimeout(() => { void this.poll(); }, 600);
      } else {
        await this.loadConversation(job.conversationId);
        wx.removeStorageSync(prefix + 'job'); this.jobId = '';
        this.setData({ busy: false, partial: job.status === 'failed' ? job.text : '' });
        if (job.status === 'failed') this.fail(new Error(job.error), 'send');
      }
    } catch (e) {
      if (requestedJob !== this.jobId) return;
      if (e instanceof ApiError && e.status === 404) {
        wx.removeStorageSync(prefix + 'job'); this.jobId = '';
        this.setData({ busy: false, status: '生成记录已失效，请重新发送' });
        this.fail(e, 'send');
      } else this.fail(e, 'poll');
    }
  },
  async stop() {
    if (!this.jobId) return;
    clearTimeout(this.timer);
    try { await api<Job>('/generations/' + this.jobId, 'DELETE'); await this.poll(); }
    catch (e) { this.fail(e, 'stop'); }
  },
  async retry() {
    this.setData({ error: '' });
    if (this.action === 'init') { await this.initialize(); return; }
    if (this.action === 'poll') { await this.poll(); return; }
    if (this.action === 'stop') { await this.stop(); return; }
    if (this.action === 'history') { await this.showHistory(); return; }
    if (this.action === 'load') { try { await this.loadConversation(this.loadId); } catch (e) { this.fail(e, 'load'); } return; }
    const pending = wx.getStorageSync(prefix + 'pendingSend') as PendingSend | undefined;
    if (pending) { this.setData({ busy: true }); await this.submit(pending); return; }
    const lastUser = this.data.conversation?.messages.filter(m => m.role === 'user').pop();
    if (!this.data.input && lastUser) this.setData({ input: lastUser.content });
    await this.send();
  },
  async newConversation() {
    if (this.data.busy || this.data.connecting) return;
    this.setData({ connecting: true, error: '' });
    try {
      const c = await api<Conversation>('/conversations', 'POST', {});
      wx.setStorageSync(prefix + 'current', c.id); wx.removeStorageSync(prefix + 'job'); wx.removeStorageSync(prefix + 'pendingSend');
      this.jobId = ''; this.setData({ conversation: c, contextLabel: '', partial: '', input: '', status: '', connecting: false, historyOpen: false });
    } catch (e) { this.fail(e, 'init'); }
  },
  async showHistory() {
    if (this.data.busy || this.data.connecting) return;
    try { const result = await api<{ items: Conversation[] }>('/conversations'); this.setData({ history: result.items, historyOpen: true }); }
    catch (e) { this.fail(e, 'history'); }
  },
  closeHistory() { this.setData({ historyOpen: false }); },
  async selectHistory(e: WechatMiniprogram.TouchEvent) {
    this.loadId = e.currentTarget.dataset.id;
    try { await this.loadConversation(this.loadId); this.setData({ historyOpen: false, partial: '', status: '', error: '' }); }
    catch (e) { this.fail(e, 'load'); }
  },
  copy(e: WechatMiniprogram.TouchEvent) {
    const text = e.currentTarget.dataset.partial ? this.data.partial : this.data.conversation?.messages[Number(e.currentTarget.dataset.index)]?.content;
    if (text) wx.setClipboardData({ data: text });
  },
});
