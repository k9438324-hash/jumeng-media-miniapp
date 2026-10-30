import { course as source, refreshCourse } from '../../services/course';
import { Lesson, Shot, boundedIndex, mediaUrl, normalizeProgress, Progress } from '../../domain';
import { config } from '../../config';
let lessons = source.lessons as Lesson[];

// 分类显示名映射表：只改展示层，内部 category key 与数据结构不变。
const categoryLabels: Record<string, string> = {
  measure: '量房',
  start: '开工',
  case: '案例',
  meet: '谈单',
  inspect: '巡检',
};
// 固定五类显示顺序（与数据 category 顺序一致）
const categoryOrder = ['measure', 'start', 'case', 'meet', 'inspect'];

// 展示层去掉任务描述里的“让人看懂：”前缀，不改动 course 源数据。
function displayTask(task: string): string { return task.replace(/^让人看懂[：:]\s*/, ''); }

type CaseItem = Lesson & { displayTask: string; isNew: boolean; readShotIndex: number; hasProgress: boolean };
function toCases(lessonIds: number[]): CaseItem[] {
  // 新课程按导入数据的追加顺序置前，不把 id 当成时间。
  return lessons.filter(l => lessonIds.includes(l.id)).slice().reverse().map(l => {
    const raw = wx.getStorageSync('jumeng:progress:' + l.id) as Partial<Progress> | undefined;
    const progress = normalizeProgress(raw, l.shots.length);
    return {
      ...l,
      displayTask: displayTask(l.task),
      isNew: !raw,                 // 从未读过 → 显示“新”
      hasProgress: !!raw,
      readShotIndex: progress.shotIndex, // 0-based，展示层 +1
    };
  });
}

Page({
  data: {
    menuItems: [{ label: '返回目录', action: 'catalog' }, { label: '刷新课程', action: 'refresh' }, { label: '隐私说明', action: 'privacy' }],
    courseNotice: '',
    categories: source.categories.slice().sort((a,b) => categoryOrder.indexOf(a.id) - categoryOrder.indexOf(b.id)).map(c => ({ ...c, name: categoryLabels[c.id] || c.name })),
    categoryId: source.categories[0].id,
    cases: toCases(source.categories[0].lessonIds),
    caseCount: 0,
    showSearch: false,
    searchOpen: false, searchQuery: '',
    visibleCases: [] as CaseItem[],
    lesson: null as Lesson | null, shot: null as Shot | null, shotIndex: 0,
    videoSrc: '', poster: '', initialTime: 0, full: false, mediaError: '',
    progressMap: {} as Record<number, boolean>,
    privacyOpen: false,
  },
  currentTime: 0,
  courseEpoch: 0,
  menuCommand(e: WechatMiniprogram.CustomEvent<{ action: string }>) {
    if (e.detail.action === 'catalog') this.back();
    if (e.detail.action === 'privacy') this.showPrivacy();
    if (e.detail.action === 'refresh') void this.loadCourse();
  },
  onShow() { this.refreshProgress(); this.syncTabBar(0); void this.loadCourse(); },
  async loadCourse() {
    const epoch=++this.courseEpoch;
    try {
      await refreshCourse();
      if(epoch!==this.courseEpoch)return;
      lessons=source.lessons;
      const categoryId=source.categories.some(c=>c.id===this.data.categoryId)?this.data.categoryId:source.categories[0].id;
      this.setData({categories:source.categories.map(c=>({...c,name:categoryLabels[c.id] || c.name})),categoryId,courseNotice:''});
      const current=this.data.lesson;
      if(current) {
        const latest=lessons.find(l=>l.id===current.id);
        if(!latest){this.pauseAndSave();this.setData({lesson:null,shot:null,videoSrc:'',courseNotice:'这条 SOP 已下架'});}
        else if(JSON.stringify(current)!==JSON.stringify(latest)){this.pauseAndSave();this.setData({lesson:latest});this.showShot(this.data.shotIndex,this.currentTime,this.data.full);}
      }
      this.refreshProgress();
    } catch {
      if(epoch===this.courseEpoch)this.setData({courseNotice:'暂未连上课程服务，当前显示本机已有内容。可点 Logo 刷新。'});
    }
  },
  syncTabBar(index: number) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },
  refreshProgress() {
    const progressMap: Record<number, boolean> = {};
    for (const lesson of lessons) progressMap[lesson.id] = !!wx.getStorageSync('jumeng:progress:' + lesson.id);
    this.setData({ progressMap });
    // 刷新当前分类案例（同步“新”标与进度）
    const cat = source.categories.find(c => c.id === this.data.categoryId);
    if (cat) this.setData({ cases: toCases(cat.lessonIds) });
    this.updateCaseMeta();
  },
  onLoad() {
    const category = source.categories.find(c => c.id === wx.getStorageSync('jumeng:category'));
    if (category) this.setData({ categoryId: category.id, cases: toCases(category.lessonIds) });
    this.updateCaseMeta();
  },
  updateCaseMeta() {
    const cases = this.data.cases as CaseItem[];
    const query = this.data.searchQuery.trim();
    this.setData({ caseCount: cases.length, showSearch: cases.length > 20,
      visibleCases: cases.filter(c => !query || (c.name + c.displayTask).includes(query)) });
  },
  toggleSearch() { this.setData({ searchOpen: !this.data.searchOpen, searchQuery: '' }); this.updateCaseMeta(); },
  search(e: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ searchQuery: e.detail.value }); this.updateCaseMeta(); },
  onHide() { this.courseEpoch++; this.pauseAndSave(); },
  onUnload() { this.courseEpoch++; this.pauseAndSave(); },
  selectCategory(e: WechatMiniprogram.TouchEvent) {
    this.pauseAndSave();
    const category = source.categories.find(c => c.id === e.currentTarget.dataset.id)!;
    wx.setStorageSync('jumeng:category', category.id);
    this.setData({ categoryId: category.id, cases: toCases(category.lessonIds), lesson: null, shot: null, videoSrc: '', searchOpen: false, searchQuery: '' });
    this.updateCaseMeta();
  },
  openCase(e: WechatMiniprogram.TouchEvent) {
    this.pauseAndSave();
    const lesson = lessons.find(l => l.id === Number(e.currentTarget.dataset.id))!;
    const progress = normalizeProgress(wx.getStorageSync('jumeng:progress:' + lesson.id) || undefined, lesson.shots.length);
    this.setData({ lesson });
    this.showShot(progress.shotIndex, progress.time, progress.full);
  },
  back() { this.pauseAndSave(); this.refreshProgress(); this.setData({ lesson: null, shot: null, videoSrc: '' }); },
  pauseAndSave() {
    wx.createVideoContext('reference', this).pause();
    if (this.data.lesson) wx.setStorageSync('jumeng:progress:' + this.data.lesson.id, { shotIndex: this.data.shotIndex, time: this.currentTime, full: this.data.full });
  },
  showShot(index: number, time = 0, full = false) {
    const lesson = this.data.lesson!;
    index = boundedIndex(index, lesson.shots.length);
    const shot = lesson.shots[index];
    this.currentTime = time;
    this.setData({ videoSrc: '' }, () => {
      this.setData({ shotIndex: index, shot, full, initialTime: time,
        videoSrc: mediaUrl(config.mediaBase, full ? lesson.file : shot.clip),
        poster: mediaUrl(config.mediaBase, shot.clipPoster), mediaError: '',
      });
      this.pauseAndSave();
    });
  },
  previous() { this.pauseAndSave(); this.showShot(this.data.shotIndex - 1); },
  next() { this.pauseAndSave(); this.showShot(this.data.shotIndex + 1); },
  selectShot(e: WechatMiniprogram.TouchEvent) { this.pauseAndSave(); this.showShot(Number(e.currentTarget.dataset.index)); },
  toggleFull() { this.pauseAndSave(); this.showShot(this.data.shotIndex, 0, !this.data.full); },
  replay() {
    if (this.data.mediaError) { this.showShot(this.data.shotIndex, 0, this.data.full); return; }
    const player = wx.createVideoContext('reference', this); player.seek(0); player.play();
  },
  timeUpdate(e: WechatMiniprogram.CustomEvent<{ currentTime: number }>) {
    this.currentTime = e.detail.currentTime;
    if (this.data.lesson) wx.setStorageSync('jumeng:progress:' + this.data.lesson.id, { shotIndex: this.data.shotIndex, time: this.currentTime, full: this.data.full });
  },
  videoError() { this.setData({ mediaError: '视频加载失败，请检查媒体配置或网络，点击重播可重试。' }); },
  showPrivacy() { this.setData({ privacyOpen: true }); },
  closePrivacy() { this.setData({ privacyOpen: false }); },
  bringToAI() {
    this.pauseAndSave();
    wx.setStorageSync('jumeng:pendingSop', { lessonId: this.data.lesson!.id, shotIndex: this.data.shotIndex });
    wx.switchTab({ url: '/pages/ai/index' });
  },
});
