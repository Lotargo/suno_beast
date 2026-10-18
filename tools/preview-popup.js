// Development preview only. No recording, native messaging, files or credentials.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'extension');
const previewApi = `
const previewState = {recording:false,auto:false,processing:false,error:'',lastFile:'Sonata — Хара Боро.mp3',outputDir:'',outputMode:'browser',track:{title:'Изиг Мунуш (Izig Munush)',artist:'Sonata',audio_src:''}};
previewState.track={...previewState.track,id:'/song/a15e6b08-0f21-4623-9f6b-5928eef0c260',image_url:'https://cdn2.suno.ai/image_large_a15e6b08-0f21-4623-9f6b-5928eef0c260.jpeg',duration:207.2,model:'V6-MINI',tags:'Siberian ethno-trap, 128 BPM galloping horse groove, heavy sliding 808 sub-bass, twanging khomus and massive frame drums.',lyrics:'[Instrumental Intro]\\n\\n[Verse]\\nТекст песни из карточки Suno…',metadata_status:'ready'};
previewState.playback={currentTime:72.4,duration:207.2,playing:false};
const previewStarted=Date.now();

window.chrome = {runtime:{async sendMessage(message){
 if(fixture==='error')return {ok:false,error:'Помощник не подключён. Перезапусти расширение и попробуй ещё раз.'};
 if(message.type==='toggle-record'){previewState.recording=!previewState.recording;previewState.lastFile='Sonata — Изиг Мунуш.mp3';}
 if(message.type==='toggle-auto'){previewState.auto=!previewState.auto;previewState.recording=previewState.auto;}
 if(message.type==='folder')previewState.notice='Предпросмотр: папка записей';
 if(message.type==='choose-folder'){previewState.outputMode='custom';previewState.outputDir='D:\\\\Music\\\\Suno';}
 if(message.type==='reset-folder'){previewState.outputMode='browser';previewState.outputDir='';}
 if(message.type==='link-existing')previewState.notice='Уже в коллекции: Sonata — Изиг Мунуш.mp3';
 if(message.type==='close-panel')window.parent.postMessage({type:'preview-close-panel'},location.origin);
 if(previewState.playback?.playing)previewState.playback.currentTime=Math.min(207.2,72.4+(Date.now()-previewStarted)/1000);
 return {ok:true,data:{...previewState}};
}},storage:{local:{async get(defaults){return {...defaults,...JSON.parse(localStorage.getItem('suno-preview-preferences')||'{}')};},async set(value){localStorage.setItem('suno-preview-preferences',JSON.stringify({...JSON.parse(localStorage.getItem('suno-preview-preferences')||'{}'),...value}));}}},tabs:{async create(){previewState.notice='Предпросмотр: открыть Suno';}}};
const fixture = new URLSearchParams(location.search).get('state');
if(fixture==='recording'||fixture==='album'){previewState.recording=true;previewState.auto=true;previewState.processing=true;previewState.playback.playing=true;}
if(fixture==='album')previewState.track.album='Пример альбома · только макет';
if(fixture==='empty'){previewState.track=null;previewState.playback=null;previewState.lastFile='';}
if(fixture==='duplicate'){previewState.notice='Уже в коллекции: Sonata — Изиг Мунуш (Izig Munush).mp3';}
if(fixture==='error')previewState.error='Помощник не подключён. Перезапусти расширение и попробуй ещё раз.';
if(fixture==='long'){previewState.track.title='Очень длинное название песни — ночная дорога сквозь кибернетический лес';previewState.lastFile='Sonata — Очень длинное название песни — ночная дорога сквозь кибернетический лес.mp3';}
`;
const floatingHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Suno Beast — предпросмотр плавающей панели</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#242025;color:#eee;font:14px/1.5 "Segoe UI",sans-serif}header{height:70px;padding:20px 28px;border-bottom:1px solid #39343b;display:flex;align-items:center;gap:24px}h1{font-size:20px;margin:0}button{padding:9px 16px;border:1px solid #5c525e;border-radius:999px;background:#332c35;color:inherit;cursor:pointer}main{padding:32px;max-width:1000px}p{color:#bfb6c3}.rows{display:grid;gap:16px;margin-top:28px}.row{height:100px;border:1px solid #463d48;border-radius:16px;background:#2d2630;display:flex;gap:20px;align-items:center;padding:18px}.cover{width:62px;height:62px;border-radius:12px;background:#74616f}span{color:#c6bac8}.site-toolbar{position:fixed;top:16px;right:24px;display:flex;gap:8px;height:44px}.site-toolbar button{height:44px;border-color:#aaa;background:#242025}.site-toolbar .trash{width:44px;padding:0}</style></head>
<body><div class="site-toolbar" aria-label="Кнопки страницы за панелью"><button>Аудио</button><button class="trash" aria-label="Корзина">▧</button></div><header><h1>Suno Beast</h1><span>Предпросмотр · демонстрационные данные</span><button id="show-preview">Открыть панель</button></header><main><h2>Библиотека</h2><p>Панель находится поверх страницы. За скруглёнными углами видна сама страница.</p><div class="rows"><div class="row"><div class="cover"></div><span>Трек в библиотеке</span></div><div class="row"><div class="cover"></div><span>Следующий трек</span></div><div class="row"><div class="cover"></div><span>Коллекция</span></div></div></main><script src="policy.js"></script><script src="panel-host.js"></script><script src="floating-preview.js"></script></body></html>`;
const floatingJs = `const panel = SunoPanelHost.create({runtime:{id:'preview',getURL:file=>new URL('/'+file,location).href,onMessage:{addListener(){},removeListener(){}}}});
const open = () => panel.toggle(new URL('/popup.html?state=recording&panel=preview&tab=7',location).href);
document.getElementById('show-preview').addEventListener('click',open);
// Preview-only transport. Production panel commands use authenticated runtime messages.
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='preview-close-panel')panel.hide();});
open();`;
const routes = new Map([
  ['/popup.html', ['popup.html', 'text/html; charset=utf-8']],
  ['/popup.css', ['popup.css', 'text/css; charset=utf-8']],
  ['/popup.js', ['popup.js', 'text/javascript; charset=utf-8']],
  ['/policy.js', ['policy.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/playback.js', ['playback.js', 'text/javascript; charset=utf-8']],
  ['/panel-host.js', ['panel-host.js', 'text/javascript; charset=utf-8']],
  ['/assets/suno-beast-icon.svg', ['assets/suno-beast-icon.svg', 'image/svg+xml']],
  ['/assets/icon-32.png', ['assets/icon-32.png', 'image/png']],
  ['/assets/suno-logo.svg', ['assets/suno-logo.svg', 'image/svg+xml']]
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/floating-preview.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(floatingHtml); return; }
  if (url.pathname === '/floating-preview.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(floatingJs); return; }
  if (url.pathname === '/preview-api.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(previewApi); return; }
  const route = routes.get(url.pathname);
  if (!route) { res.writeHead(404); res.end(); return; }
  let content = fs.readFileSync(path.join(root, route[0]));
  if (route[0] === 'popup.html') content = content.toString().replace('<script src="popup.js">', '<script src="/preview-api.js"></script><script src="popup.js">');
  res.writeHead(200, { 'Content-Type': route[1] }); res.end(content);
});
server.listen(18889, '127.0.0.1', () => console.log('Popup visual fixture: http://127.0.0.1:18889/popup.html'));
