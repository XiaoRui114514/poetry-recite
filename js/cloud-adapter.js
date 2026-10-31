/* Optional hosted-page adapter. Local storage and scoring remain authoritative. */
(function (global) {
  'use strict';
  function start() {
    if (!/^https?:$/.test(global.location.protocol) || !global.LearningCloud) return;
    var storage = global.PoetryStorage;
    // Restore local/account ownership before app.boot reads the requested route.
    storage.load();
    global.PoetryCloud = global.LearningCloud.start({
      app: 'poetry',
      label: '古诗文',
      mount: document.querySelector('.header-actions'),
      defaults: function () { return storage.defaults(); },
      getData: function () {
        // sanitize constructs a fresh, explicit learning-data whitelist.
        var data = storage.sanitize(storage.exportData().state);
        if (storage.validate(data).length) throw new Error('学习记录校验失败，请先导出备份。');
        return data;
      },
      setData: function (data, context) {
        var result = storage.importData(data);
        if (!result.ok) throw new Error(result.error);
        if (!storage.isPersistent()) throw new Error('本机空间不足，请导出记录后重试。');
        var app = global.PoetryApp;
        if (app && (!context || context.reason !== 'startup')) {
          var saved = storage.getState();
          app.getState().stage = saved.stage;
          app.navigate(saved.stage ? (saved.selectedIds.length ? 'home' : 'select') : 'stage');
          app.render();
        }
      },
      isEmpty: function (data) {
        return JSON.stringify(storage.sanitize(data)) === JSON.stringify(storage.defaults());
      },
      subscribe: function (callback) {
        global.addEventListener('poetry-storage', callback);
      }

    });
  }
  start();
})(window);
