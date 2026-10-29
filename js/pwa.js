/* PWA 注册：只对“模块化 + http(s)”版本启用。
   单文件版（dist）没有 manifest 链接，且通常用 file:// 打开，这里会自动跳过，
   所以不会破坏“双击 HTML 就能离线用”的承诺。 */
(function (global) {
  'use strict';

  function register() {
    if (!global.navigator || !global.navigator.serviceWorker) return;
    var protocol = global.location && global.location.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return;
    var manifest = document.querySelector('link[rel="manifest"]');
    if (!manifest) return; // 单文件版没有 manifest，不注册
    try {
      global.navigator.serviceWorker.register('sw.js').then(function(reg) {
        var requested=false;
        function notice() {
          if (!reg.waiting || !global.navigator.serviceWorker.controller || document.getElementById('pwaUpdate')) return;
          var button=document.createElement('button');button.id='pwaUpdate';button.className='btn';button.textContent='新版本可用：结束练习后点此更新';
          button.style.cssText='position:fixed;bottom:8px;right:8px;z-index:900';
          button.addEventListener('click',function(){requested=true; reg.waiting.postMessage({type:'SKIP_WAITING'});});
          document.body.appendChild(button);
        }
        notice();reg.addEventListener('updatefound',function(){var worker=reg.installing;if(worker)worker.addEventListener('statechange',notice);});
        global.navigator.serviceWorker.addEventListener('controllerchange',function(){if(requested)global.location.reload();});
      }).catch(function () {
        /* 注册失败不影响主功能：页面仍然可以直接用 */
      });
    } catch (err) {
      /* 某些老浏览器会抛同步异常，忽略 */
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
  else register();
})(window);
