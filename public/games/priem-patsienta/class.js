// Режим занятия: ординатор заходит по коду (?c=КОД), проходит назначенные случаи, баллы уходят учителю.
// Подключается ДО app.js (задаёт window.CLASS), стартует после него. Без ?c= игра работает как обычно.
(function () {
  var m = /[?&]c=([A-Za-z0-9]{4,8})/.exec(location.search);
  if (!m) return;
  var code = m[1].toUpperCase();
  var cfg = window.GAME_CFG || {};
  var AUTH_KEY = 'priem-classauth-' + code;
  var QUEUE_KEY = 'priem-classq-' + code;
  var C = (window.CLASS = { code: code, keys: [], ready: false, title: '', name: '', score: 0 });

  var st = document.createElement('style');
  // Подсказки с ответами и «начать заново» в занятии не нужны
  st.textContent = '#btnAns,#btnReset,#secs{display:none!important}' +
    '.cl-back{position:fixed;inset:0;z-index:80;background:rgba(5,9,16,.86);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.cl-box{width:100%;max-width:460px;background:var(--paper);border:2px solid var(--line);border-radius:22px;padding:24px}' +
    '.cl-box h2{margin:0 0 6px;font:700 24px var(--f-display)}.cl-box p{margin:6px 0 14px;color:var(--muted);line-height:1.45}' +
    '.cl-box input{width:100%;height:54px;border-radius:14px;border:2px solid var(--line);background:#111a2b;color:var(--ink);font:600 18px var(--f-body);padding:0 16px;margin-bottom:12px}' +
    '.cl-err{color:var(--bad);margin:0 0 10px;min-height:20px}' +
    '.cl-chip{display:inline-block;margin-left:8px;font:700 13px var(--f-body);padding:4px 10px;border-radius:10px;background:var(--accent-soft);color:var(--ink)}';
  document.head.appendChild(st);

  function rpc(name, args) {
    return fetch(cfg.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) {
          var e = new Error((j && (j.message || j.hint)) || 'Нет связи с сервером');
          e.status = r.status;
          throw e;
        }
        return j;
      });
    });
  }
  function readJ(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function writeJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  var auth = readJ(AUTH_KEY);

  // Отправка результатов: очередь переживает обрыв связи и перезагрузку
  var sending = false;
  function flush() {
    var q = readJ(QUEUE_KEY) || [];
    if (!q.length || sending || !auth) return;
    sending = true;
    var it = q[0];
    rpc('clinic_report', { p_code: code, p_n: auth.n, p_secret: auth.secret, p_key: it.k, p_pts: it.p })
      .then(function (r) {
        var cur = readJ(QUEUE_KEY) || [];
        cur.shift();
        writeJ(QUEUE_KEY, cur);
        if (r && typeof r.score === 'number') C.score = r.score;
        chip();
        sending = false;
        flush();
      })
      .catch(function (e) {
        sending = false;
        if (e.status && e.status < 500 && e.status !== 429) {
          // Занятие закончилось или вход не подтверждён: повторять бессмысленно
          var cur = readJ(QUEUE_KEY) || [];
          cur.shift();
          writeJ(QUEUE_KEY, cur);
          chip(e.message);
          flush();
        }
      });
  }
  C.report = function (key, pts) {
    var q = readJ(QUEUE_KEY) || [];
    q.push({ k: key, p: Math.round(pts || 0) });
    writeJ(QUEUE_KEY, q);
    chip();
    flush();
  };
  setInterval(flush, 8000);

  function chip(err) {
    var el = document.getElementById('clChip');
    if (!el) {
      var h = document.querySelector('.top h1');
      if (!h) return;
      el = document.createElement('span');
      el.id = 'clChip';
      el.className = 'cl-chip';
      h.appendChild(el);
    }
    var q = readJ(QUEUE_KEY) || [];
    el.textContent = err ? err : (C.name || '') + (q.length ? ' · отправка…' : ' · результаты у учителя');
  }

  C.homeView = function () {
    return '<div class="home"><h2>' + (C.ready ? 'Занятие' : 'Подключение…') + '</h2><p class="s">' +
      (C.ready ? 'Выберите случай на вкладках выше.' : 'Подождите секунду.') + '</p></div>';
  };

  function overlay(html) {
    var o = document.getElementById('clOv');
    if (!o) { o = document.createElement('div'); o.id = 'clOv'; o.className = 'cl-back'; document.body.appendChild(o); }
    o.innerHTML = '<div class="cl-box">' + html + '</div>';
    return o;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function enter(d) {
    C.keys = d.keys || [];
    C.title = d.title || '';
    C.name = d.name || '';
    C.score = d.score || 0;
    C.ready = true;
    var o = document.getElementById('clOv');
    if (o) o.remove();
    home = false;
    finished = false;
    revealed = false;
    var L = secIdx();
    cur = (L.find(function (i) { return !cxDone(i); }) != null ? L.find(function (i) { return !cxDone(i); }) : L[0]) || 0;
    render();
    chip();
    flush();
  }

  function join(info) {
    overlay('<h2>' + esc(info.title || 'Занятие') + '</h2><p>Случаев в занятии: ' + info.count + '. Введите имя, оно появится на экране учителя.</p>' +
      '<input id="clName" maxlength="40" placeholder="Фамилия Имя" autocomplete="name"><div class="cl-err" id="clErr"></div>' +
      '<button class="btn primary" id="clGo" type="button" style="width:100%;height:54px">Войти</button>');
    var go = document.getElementById('clGo');
    var inp = document.getElementById('clName');
    var run = function () {
      var nm = inp.value.trim();
      if (!nm) { document.getElementById('clErr').textContent = 'Введите имя'; return; }
      go.disabled = true;
      rpc('clinic_join', { p_code: code, p_name: nm }).then(function (r) {
        auth = { n: r.n, secret: r.secret };
        writeJ(AUTH_KEY, auth);
        enter({ keys: r.keys, title: r.title, name: r.name, score: 0 });
      }).catch(function (e) {
        go.disabled = false;
        document.getElementById('clErr').textContent = e.message;
      });
    };
    go.onclick = run;
    inp.onkeydown = function (e) { if (e.key === 'Enter') run(); };
    inp.focus();
  }

  function fail(msg) {
    overlay('<h2>Не удалось войти</h2><p>' + esc(msg) + '</p><button class="btn primary" id="clRetry" type="button" style="width:100%;height:54px">Повторить</button>');
    document.getElementById('clRetry').onclick = function () { location.reload(); };
  }

  function start() {
    if (!cfg.url || !cfg.key) { fail('Игра не настроена'); return; }
    overlay('<h2>Подключение…</h2><p>Проверяю код занятия ' + code + '.</p>');
    var begin = function () {
      rpc('clinic_info', { p_code: code }).then(function (info) {
        if (!info) { fail('Занятие с кодом ' + code + ' не найдено'); return; }
        if (info.status !== 'open') { fail('Занятие уже закончилось'); return; }
        join(info);
      }).catch(function (e) { fail(e.message); });
    };
    if (!auth) { begin(); return; }
    rpc('clinic_state', { p_code: code, p_n: auth.n, p_secret: auth.secret }).then(function (d) {
      if (d.status !== 'open') { fail('Занятие уже закончилось'); return; }
      enter(d);
    }).catch(function (e) {
      if (e.status && e.status < 500) { auth = null; try { localStorage.removeItem(AUTH_KEY); } catch (x) { } begin(); }
      else fail(e.message);
    });
  }
  setTimeout(start, 0);
})();
