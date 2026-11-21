// Режим занятия: ординатор заходит по коду (?c=КОД), проходит назначенные случаи, баллы уходят учителю.
// Подключается ДО app.js (задаёт window.CLASS), стартует после него. Без ?c= игра работает как обычно.
(function () {
  var cfg = window.GAME_CFG || {};
  var m = /[?&]c=([A-Za-z0-9]{4,8})/.exec(location.search);
  var st = document.createElement('style');
  st.textContent = '.cl-back{position:fixed;inset:0;z-index:80;background:rgba(5,9,16,.86);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.cl-box{width:100%;max-width:460px;background:var(--paper);border:2px solid var(--line);border-radius:22px;padding:24px}' +
    '.cl-box h2{margin:0 0 6px;font:700 24px var(--f-display)}.cl-box p{margin:6px 0 14px;color:var(--muted);line-height:1.45}' +
    '.cl-box input{width:100%;height:54px;border-radius:14px;border:2px solid var(--line);background:#111a2b;color:var(--ink);font:600 18px var(--f-body);padding:0 16px;margin-bottom:12px}' +
    '.cl-err{color:var(--bad);margin:0 0 10px;min-height:20px}' +
    '.cl-chip{display:inline-block;margin-left:8px;font:700 13px var(--f-body);padding:4px 10px;border-radius:10px;background:var(--accent-soft);color:var(--ink)}';
  document.head.appendChild(st);
  // Пробный проход учителя (?demo=ключ,ключ…): случаи по списку, без имени и без отправки баллов
  var dm = !m && /[?&]demo=([a-z0-9,]{1,400})/.exec(location.search);
  if (dm) { demo(dm[1].split(',').filter(Boolean)); return; }
  addCodeBtn(!!m);
  if (!m) return;
  var code = m[1].toUpperCase();
  var AUTH_KEY = 'priem-classauth-' + code;
  var QUEUE_KEY = 'priem-classq-' + code;
  var C = (window.CLASS = { code: code, keys: [], ready: false, title: '', name: '', score: 0, place: 0, total: 0, modes: ['norm', 'hard'] });
  // Подсказки с ответами и «начать заново» в занятии не нужны
  var hide = document.createElement('style');
  hide.textContent = '#btnAns,#btnReset,#secs{display:none!important}';
  document.head.appendChild(hide);

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
  // Кнопка в шапке: вне занятия — «Ввести код», в занятии — «Выйти»
  function addCodeBtn(inClass) {
    var rb = document.getElementById('btnReset');
    if (!rb || !rb.parentNode) return;
    var b = document.createElement('button');
    b.id = 'clCode';
    b.type = 'button';
    b.className = 'btn';
    b.textContent = inClass ? '⎋ Выйти из занятия' : '🔑 Ввести код';
    b.onclick = inClass ? function () { location.href = location.pathname; } : askCode;
    rb.parentNode.insertBefore(b, rb);
  }
  function askCode() {
    overlay('<h2>Код занятия</h2><p>Код называет учитель, он написан на его экране.</p>' +
      '<input id="clCodeIn" maxlength="8" placeholder="Например: K7M2P" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase">' +
      '<div class="cl-err" id="clErr"></div>' +
      '<button class="btn primary" id="clCodeGo" type="button" style="width:100%;height:54px">Войти в занятие</button>' +
      '<button class="btn" id="clCodeX" type="button" style="width:100%;height:46px;margin-top:10px">Отмена</button>');
    var inp = document.getElementById('clCodeIn'), go = document.getElementById('clCodeGo'), err = document.getElementById('clErr');
    document.getElementById('clCodeX').onclick = function () { document.getElementById('clOv').remove(); };
    var run = function () {
      var c = inp.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (c.length < 4) { err.textContent = 'Введите код занятия'; return; }
      go.disabled = true;
      err.textContent = '';
      rpc('clinic_info', { p_code: c }).then(function (info) {
        if (!info) { go.disabled = false; err.textContent = 'Занятие с таким кодом не найдено'; return; }
        if (info.status !== 'open') { go.disabled = false; err.textContent = 'Это занятие уже закончилось'; return; }
        location.href = location.pathname + '?c=' + c;
      }).catch(function (e) { go.disabled = false; err.textContent = e.message; });
    };
    go.onclick = run;
    inp.onkeydown = function (e) { if (e.key === 'Enter') run(); };
    inp.focus();
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
        standing();
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

  // Своё место среди всех участников занятия (чужие имена и баллы не передаются)
  var closed = false;
  function standing() {
    if (!auth) return;
    rpc('clinic_standing', { p_code: code, p_n: auth.n, p_secret: auth.secret }).then(function (r) {
      if (!r) return;
      C.place = r.place;
      C.total = r.total;
      if (typeof r.score === 'number') C.score = r.score;
      closed = r.status === 'closed';
      chip();
    }).catch(function () { /* связи нет — покажем прошлое значение */ });
  }
  setInterval(standing, 10000);

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
    var place = C.place ? ' · место ' + C.place + ' из ' + C.total : '';
    el.textContent = err ? err : closed ? 'Занятие завершено' + place : (C.name || '') + place + (q.length ? ' · отправка…' : '');
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

  // У каждого участника свой порядок случаев (по его секрету): соседи не списывают, а при перезагрузке порядок не меняется
  function shuffled(keys) {
    var a = keys.slice(), h = 2166136261, str = String((auth && auth.secret) || code);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var rnd = function () { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
    for (var j = a.length - 1; j > 0; j--) { var k = Math.floor(rnd() * (j + 1)); var t = a[j]; a[j] = a[k]; a[k] = t; }
    return a;
  }

  function enter(d) {
    C.keys = shuffled(d.keys || []);
    C.modes = d.modes && d.modes.length ? d.modes : ['norm', 'hard'];
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
    standing();
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
        enter({ keys: r.keys, title: r.title, name: r.name, score: 0, modes: r.modes });
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
      // Вход сбрасываем только при отказе самой функции (400); лимит запросов и прочее — «Повторить»
      if (e.status === 400) { auth = null; try { localStorage.removeItem(AUTH_KEY); } catch (x) { } begin(); }
      else fail(e.message);
    });
  }
  setTimeout(start, 0);

  function demo(keys) {
    var mm = /[?&]m=(norm|hard)/.exec(location.search);
    var D = (window.CLASS = {
      code: 'demo-' + keys.join('-'), keys: keys, ready: true, demo: true,
      modes: mm ? [mm[1]] : ['norm', 'hard'],
      report: function () { /* баллы пробного прохода никуда не отправляются */ },
      homeView: function () { return '<div class="home"><h2>Пробный проход</h2><p class="s">Выберите случай на вкладках выше.</p></div>'; }
    });
    var hide = document.createElement('style');
    hide.textContent = '#btnReset,#secs{display:none!important}';
    document.head.appendChild(hide);
    var rb = document.getElementById('btnReset');
    if (rb && rb.parentNode) {
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = '↺ Пройти заново';
      again.onclick = function () {
        if (!confirm('Начать пробный проход заново? Пройденные случаи сбросятся.')) return;
        try { localStorage.removeItem('priem-class-progress-' + D.code); } catch (e) { }
        location.reload();
      };
      rb.parentNode.insertBefore(again, rb);
    }
    setTimeout(function () {
      var h = document.querySelector('.top h1');
      if (h && !document.getElementById('clChip')) {
        var el = document.createElement('span');
        el.id = 'clChip';
        el.className = 'cl-chip';
        el.textContent = 'Пробный проход · баллы никуда не отправляются';
        h.appendChild(el);
      }
      var L = secIdx();
      if (!L.length) {
        var o = document.createElement('div');
        o.className = 'cl-back';
        o.innerHTML = '<div class="cl-box"><h2>Случаи не найдены</h2><p>В ссылке нет случаев этой игры. Откройте пробный проход заново из раздела «Игры».</p></div>';
        document.body.appendChild(o);
        return;
      }
      home = false;
      finished = false;
      var next = L.find(function (i) { return !cxDone(i); });
      cur = next != null ? next : L[0];
      render();
    }, 0);
  }
})();
