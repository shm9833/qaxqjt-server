/*!
 * cast-sheet-real.js · 20260922
 * admin/cast-sheet.html 的真实后端同步层：
 *  - 关联真实排期 /v1/schedules
 *  - 载入线上演出阵容 /v1/cast-sheets（含 crew 明细）
 *  - 将当前编辑器内容（真实演职人员姓名）整体发布/更新到官网
 * 不内置任何演示数据；无数据时保持空白由用户填写。
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function unwrap(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.list)) return d.list;
    return [];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function msg(t, cls) {
    var m = $('rsMsg');
    if (!m) return;
    m.textContent = t;
    m.style.color = cls === 'err' ? '#b91c1c' : (cls === 'ok' ? '#15803d' : '#075985');
  }
  function api() { return window.QAXQJT_API || null; }

  var _sheetId = '';

  /* ---------- 排期下拉 ---------- */
  function fillSchedules() {
    var sel = $('rsSchedule');
    return api().get('/v1/schedules', { query: { pageSize: 100 } }).then(function (d) {
      var rows = unwrap(d);
      if (!rows.length) {
        sel.innerHTML = '<option value="">（暂无排期，请先在【演出排期】创建）</option>';
        return;
      }
      sel.innerHTML = '<option value="">请选择关联排期…</option>' + rows.map(function (r) {
        var label = (r.date || '') + ' ' + (r.playTitle || '未命名剧目') + ' ' + (r.venueAddress || r.venue || '');
        return '<option value="' + esc(r.id) + '">' + esc(label.trim()) + '</option>';
      }).join('');
    }).catch(function () {
      sel.innerHTML = '<option value="">（排期加载失败，请确认已登录）</option>';
    });
  }

  /* ---------- 线上阵容下拉 ---------- */
  function fillSheets(preselectId) {
    var sel = $('rsSheet');
    return api().get('/v1/cast-sheets', { query: { pageSize: 100 } }).then(function (d) {
      var rows = unwrap(d);
      sel.innerHTML = '<option value="">（本次新建）</option>' + rows.map(function (s) {
        var label = (s.performanceDate || '') + ' ' + (s.playTitle || '未命名阵容') + ' [' + (s.statusText || s.status || '') + ']';
        return '<option value="' + esc(s.id) + '" data-schedule="' + esc(s.scheduleId || '') + '">' + esc(label) + '</option>';
      }).join('');
      if (preselectId) {
        sel.value = preselectId;
        syncScheduleFromSheet();
      }
    }).catch(function () { /* 无阵容时保持"本次新建" */ });
  }

  function syncScheduleFromSheet() {
    var sel = $('rsSheet');
    var opt = sel.selectedOptions && sel.selectedOptions[0];
    var sid = opt && opt.getAttribute('data-schedule');
    if (sid) $('rsSchedule').value = sid;
  }

  /* ---------- 后端阵容 -> 编辑器 state ---------- */
  function mapApiToState(d) {
    var crew = d.crew || [];

    // 主演/配角/龙套 按角色聚合为 A/B/C 角
    var castMap = {};
    var order = [];
    crew.forEach(function (c) {
      if (['主演', '配角', '龙套'].indexOf(c.category) < 0) return;
      var role = c.roleName || '';
      if (!castMap[role]) {
        castMap[role] = { role: role, type: '小生', actorA: '', actorB: '', actorC: '', group: '', note: '', isPublic: true };
        order.push(role);
      }
      var row = castMap[role];
      var restNote = (c.note || '').replace(/[ABC]角/g, '').replace(/^[；;\/\s·-]+/, '').trim();
      if (restNote && row.note.indexOf(restNote) < 0) {
        row.note = row.note ? row.note + '；' + restNote : restNote;
      }
      if (c.category === '主演') row.actorA = c.performerName || '';
      if (c.category === '配角') row.actorB = c.performerName || '';
      if (c.category === '龙套') row.actorC = c.performerName || '';
    });

    // 乐队按 note 标记分武场/文场；其余舞美工种进舞台
    var wuchang = [], wenchang = [], stage = [];
    crew.forEach(function (c) {
      if (c.category === '乐队') {
        var isWu = /武场/.test(c.note || '');
        var row = {
          pos: c.roleName || '',
          name: c.performerName || '',
          note: (c.note || '').replace(/武场|文场/g, '').replace(/^[；;\/\s·-]+/, '').trim(),
          isPublic: true
        };
        (isWu ? wuchang : wenchang).push(row);
      } else if (['舞美', '灯光', '服装', '道具', '化妆'].indexOf(c.category) >= 0) {
        stage.push({ pos: c.roleName || c.category, name: c.performerName || '', note: c.note || '', isPublic: true });
      }
    });

    var creative = [];
    if (d.directorName) creative.push({ pos: '总导演', name: d.directorName, note: '', isPublic: true });
    if (d.conductorName) creative.push({ pos: '音乐/唱腔设计', name: d.conductorName, note: '', isPublic: true });
    if (d.stageManagerName) creative.push({ pos: '舞台监督', name: d.stageManagerName, note: '', isPublic: true });

    var st = {
      isPublic: true,
      header: {
        title: d.playTitle ? ('《' + d.playTitle + '》 · 演出阵容') : '',
        host: '秦安县秦剧团文化演出有限公司',
        organizer: '', coorganizer: '', sponsor: '',
        date: d.performanceDate || '',
        time: d.performanceTime || '',
        venue: d.venueFull || '',
        notice: d.crewNote || ''
      },
      creative: creative,
      mainOpera: [{
        opera: d.playTitle ? ('《' + d.playTitle + '》') : '',
        duration: '', type: '传统本戏', rating: '', intro: '', playId: d.playId || '',
        cast: order.map(function (k) { return castMap[k]; })
      }],
      addOpera: [],
      wuchang: wuchang,
      wenchang: wenchang,
      stage: stage,
      program: []
    };

    // 用真实剧库补充分类/时长/简介
    try {
      var raw = localStorage.getItem('qaxqjt_real_plays_v1');
      if (raw) {
        var arr = JSON.parse(raw).items || [];
        var hit = arr.find(function (p) {
          return (p.name || '').replace(/[《》\s]/g, '') === (d.playTitle || '');
        });
        if (hit) {
          st.mainOpera[0].type = hit.category || '传统本戏';
          st.mainOpera[0].duration = hit.duration || '';
          st.mainOpera[0].intro = hit.synopsis || '';
        }
      }
    } catch (e) {}

    return st;
  }

  function loadSheet() {
    var id = $('rsSheet').value;
    if (!id) {
      alert('请先在"线上阵容"下拉中选择一条阵容；如需新建请保持"（本次新建）"并直接在下方编辑。');
      return;
    }
    msg('正在载入线上阵容…');
    api().get('/v1/cast-sheets/' + encodeURIComponent(id)).then(function (d) {
      window.__castSheetHook.applyState(mapApiToState(d));
      _sheetId = id;
      syncScheduleFromSheet();
      msg('已载入线上阵容 ' + (d.sheetNo || id) + '，编辑后点击"保存并发布到官网"更新', 'ok');
    }).catch(function (e) {
      msg('载入失败：' + ((e && e.message) || '阵容不存在或无权限'), 'err');
    });
  }

  /* ---------- 编辑器 state -> 后端 payload ---------- */
  function _nameIdMap() {
    var m = {};
    try {
      var p = window.__castSheetHook.loadPerformers();
      (p.flat || []).forEach(function (x) {
        if (x.name && x.id) m[x.name] = x.id;
      });
    } catch (e) {}
    return m;
  }

  function buildPayload() {
    var s = window.__castSheetHook.getState();
    var idMap = _nameIdMap();
    var crew = [];
    var sort = 0;
    function push(cat, role, name, note) {
      name = (name || '').trim();
      if (!name) return;
      crew.push({
        performerId: idMap[name] || '',
        performerName: name,
        category: cat,
        roleName: (role || '').trim(),
        sortOrder: sort++,
        note: note || ''
      });
    }

    var operas = [].concat(s.mainOpera || [], s.addOpera || []);
    operas.forEach(function (op) {
      (op.cast || []).forEach(function (c) {
        var base = (c.note || '').trim();
        push('主演', c.role, c.actorA, base ? ('A角；' + base) : 'A角');
        push('配角', c.role, c.actorB, base ? ('B角；' + base) : 'B角');
        push('龙套', c.role, c.actorC, base ? ('C角；' + base) : 'C角');
      });
    });
    (s.wuchang || []).forEach(function (r) {
      push('乐队', r.pos, r.name, '武场' + (r.note ? '；' + r.note : ''));
    });
    (s.wenchang || []).forEach(function (r) {
      push('乐队', r.pos, r.name, '文场' + (r.note ? '；' + r.note : ''));
    });
    (s.stage || []).forEach(function (r) {
      var cat = '舞美';
      var pos = r.pos || '';
      if (/灯/.test(pos)) cat = '灯光';
      else if (/服装|盔|跟包|衣/.test(pos)) cat = '服装';
      else if (/化妆|妆|勾脸|脸谱/.test(pos)) cat = '化妆';
      else if (/道具/.test(pos)) cat = '道具';
      push(cat, pos, r.name, r.note || '');
    });

    var h = s.header || {};
    var main = (s.mainOpera && s.mainOpera[0]) || {};
    var title = (main.opera || '').replace(/[《》\s]/g, '');
    var playId = main.playId || '';
    if (!playId) {
      try {
        var raw = localStorage.getItem('qaxqjt_real_plays_v1');
        if (raw) {
          var arr = JSON.parse(raw).items || [];
          var hit = arr.find(function (p) {
            return (p.name || '').replace(/[《》\s]/g, '') === title;
          });
          if (hit) playId = (hit.playId || '').replace(/^real_/, '');
        }
      } catch (e) {}
    }

    var dirName = '', condName = '', smName = '';
    (s.creative || []).forEach(function (r) {
      var pos = r.pos || '';
      var nm = (r.name || '').trim();
      if (!nm) return;
      if (/导演/.test(pos)) dirName = nm;
      else if (/音乐|唱腔|作曲|指挥|琴/.test(pos)) condName = condName ? condName + '、' + nm : nm;
      else if (/舞台监督|监督/.test(pos)) smName = nm;
    });

    return {
      playId: playId || null,
      playTitle: title || null,
      performanceDate: h.date || '',
      performanceTime: h.time || '',
      venueFull: h.venue || '',
      directorName: dirName || null,
      conductorName: condName || null,
      stageManagerName: smName || null,
      crewNote: h.notice || null,
      status: 'confirmed',
      lockFlag: false,
      crew: crew
    };
  }

  function publish() {
    var A = api();
    if (!A) { alert('接口模块未就绪，请确认已通过正式环境登录管理员账号。'); return; }
    var scheduleId = $('rsSchedule').value;
    if (!scheduleId) {
      alert('请先选择"关联排期"。演出阵容必须挂接一条真实排期；如暂无排期，请先到【演出排期】页面创建。');
      return;
    }
    var p = buildPayload();
    if (!p.playTitle) { alert('请先在"主场本戏"中填写或从剧库选择剧目名称。'); return; }
    if (!p.performanceDate && !window.confirm('封面尚未填写演出日期，仍要发布吗？')) return;
    if (!p.crew.length && !window.confirm('当前没有任何演职人员，确定发布空阵容？')) return;

    var id = _sheetId || $('rsSheet').value;
    var body = Object.assign({ scheduleId: scheduleId }, p);
    msg(id ? '正在更新线上阵容…' : '正在发布新阵容…');

    var req = id ? A.patch('/v1/cast-sheets/' + encodeURIComponent(id), body)
                 : A.post('/v1/cast-sheets', body);
    req.then(function (res) {
      window.__castSheetHook.saveLocal();
      var newId = (res && res.id) || id;
      _sheetId = newId;
      msg('✅ 已发布到官网（' + ((res && res.sheetNo) || '') + '），观众端阵容页可查看', 'ok');
      return fillSheets(newId);
    }).catch(function (e) {
      msg('发布失败：' + ((e && e.message) || '请检查登录状态与必填项'), 'err');
    });
  }

  /* ---------- init ---------- */
  function init() {
    if (!$('realSyncBar')) return;
    if (!window.QAXQJT_API) {
      msg('未检测到接口模块，官网同步不可用（请在正式部署环境登录后使用）');
      $('rsPublish').disabled = true;
      $('rsLoad').disabled = true;
      return;
    }
    $('rsLoad').addEventListener('click', loadSheet);
    $('rsPublish').addEventListener('click', publish);
    $('rsSheet').addEventListener('change', function () {
      _sheetId = this.value || '';
      if (_sheetId) syncScheduleFromSheet();
    });
    fillSchedules().then(function () { return fillSheets(''); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
