import titleFont from './data/title-font';
App({
  onLaunch() {
    wx.loadFontFace({
      global: true, family: 'Jumeng Serif', source: 'url("' + titleFont + '")',
      desc: { weight: '600', style: 'normal' },
      fail() { console.warn('标题字体未加载，使用系统衬线回退字体'); },
    });
  },
});
