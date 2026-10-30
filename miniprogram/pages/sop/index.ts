import source from '../../data/course';
import { Lesson, Shot, boundedIndex, mediaUrl, normalizeProgress } from '../../domain';
import { config } from '../../config';
const lessons = source.lessons as Lesson[];
Page({
  data: {
    categories: source.categories, categoryId: source.categories[0].id,
    cases: lessons.filter(l => source.categories[0].lessonIds.includes(l.id)),
    lesson: null as Lesson | null, shot: null as Shot | null, shotIndex: 0,
    videoSrc: '', poster: '', initialTime: 0, full: false, mediaError: '',
  },
  currentTime: 0,
  onLoad() {
    const category = source.categories.find(c => c.id === wx.getStorageSync('jumeng:category'));
    if (category) this.setData({ categoryId: category.id, cases: lessons.filter(l => category.lessonIds.includes(l.id)) });
  },
  onHide() { this.pauseAndSave(); },
  onUnload() { this.pauseAndSave(); },
  selectCategory(e: WechatMiniprogram.TouchEvent) {
    this.pauseAndSave();
    const category = source.categories.find(c => c.id === e.currentTarget.dataset.id)!;
    wx.setStorageSync('jumeng:category', category.id);
    this.setData({ categoryId: category.id, cases: lessons.filter(l => category.lessonIds.includes(l.id)), lesson: null, shot: null, videoSrc: '' });
  },
  openCase(e: WechatMiniprogram.TouchEvent) {
    this.pauseAndSave();
    const lesson = lessons.find(l => l.id === Number(e.currentTarget.dataset.id))!;
    const progress = normalizeProgress(wx.getStorageSync('jumeng:progress:' + lesson.id) || undefined, lesson.shots.length);
    this.setData({ lesson });
    this.showShot(progress.shotIndex, progress.time, progress.full);
  },
  back() { this.pauseAndSave(); this.setData({ lesson: null, shot: null, videoSrc: '' }); },
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
  bringToAI() {
    this.pauseAndSave();
    wx.setStorageSync('jumeng:pendingSop', { lessonId: this.data.lesson!.id, shotIndex: this.data.shotIndex });
    wx.switchTab({ url: '/pages/ai/index' });
  },
});
