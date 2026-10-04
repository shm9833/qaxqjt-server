/* ==========================================================================
 * admin-wage-negotiate.js v20260928d
 * 秦安县秦剧团 · 天工资商议单 —— 模板数据全部可自定义
 * 存储：Setting 表单条 JSON（key=wage_negotiate_template, group=wage_negotiate）
 *       GET /v1/system/settings/key/:key 读取（404 用默认）
 *       POST /v1/system/settings/batch 保存（super_admin）
 *       localStorage 兜底（后端不可达时不影响编辑）
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__NgWageSheet) return;
  window.__NgWageSheet = true;

  var STORE_KEY = 'qaxqjt_wage_negotiate_template_v1';
  var SETTING_KEY = 'wage_negotiate_template';
  var ARCHIVE_PREFIX = 'wage_negotiate_archive_'; // 存档 key 前缀
  var performerCache = []; // 花名册演员缓存
  var archiveCache = []; // 最近一次加载的存档列表（导出用）

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg, type || 'success'); return; }
      if (window.Utils && typeof window.Utils.toast === 'function') { window.Utils.toast(msg, type || 'success'); return; }
    } catch (_) {}
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:100000;padding:10px 22px;border-radius:10px;font-size:.88rem;color:#fff;background:' + (type === 'error' ? '#dc2626' : (type === 'warning' ? '#d97706' : '#16a34a')) + ';box-shadow:0 8px 24px rgba(0,0,0,.2);';
    document.body.appendChild(el);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 2600);
  }

  function status(msg) { var el = $('ngStatus'); if (el) el.textContent = msg || ''; }

  function markBtn(b) {
    b.__superPatchBound = 1; b.__ts3Done = 1; b.__bindDone = 1;
    b.__ctE2Done = 1; b.__deadBtnChecked = 1; b.__ngBound = 1;
    return b;
  }

  /* ---------------- 默认模板（所有内容均可在后台修改） ---------------- */
  function defaultTemplate() {
    return {
      troupeName: '秦安县秦剧团文化演出有限公司',
      docTitle: '天工资商议单',
      docNo: '',
      partyA: { name: '秦安县秦剧团文化演出有限公司', contact: '剧团负责人', phone: '13993839833', address: '甘肃省天水市秦安县陇城镇张沟村' },
      partyB: { name: '', idCard: '', phone: '', address: '', role: '' },
      intro: '为明确演出劳务报酬标准，甲乙双方本着平等自愿、协商一致、诚实信用的原则，就乙方参加甲方组织的戏曲演出活动的天工资标准及相关事宜，经友好商议，达成如下约定，共同遵照执行。',
      grades: [
        { code: 'A', name: '首席主演（一级）', scope: '担纲本戏主演、国家级/省级非遗传承人或高级职称演员', dailyRate: '380', meal: '30', traffic: '20', night: '60', attendance: '800' },
        { code: 'B', name: '主要演员（二级）', scope: '担纲主要配角、折子戏主演，经验丰富的骨干演员', dailyRate: '300', meal: '30', traffic: '20', night: '50', attendance: '600' },
        { code: 'C', name: '一般演员（三级）', scope: '担任一般角色、龙套跟角，完成日常排练与演出任务', dailyRate: '240', meal: '30', traffic: '20', night: '40', attendance: '500' },
        { code: 'D', name: '优秀青年/学员', scope: '跟团实习的青年演员、在册学员，按带教安排参演', dailyRate: '180', meal: '30', traffic: '20', night: '30', attendance: '400' },
        { code: 'E', name: '乐队/舞美/后勤', scope: '文武场伴奏、舞美灯光音响、装车卸台等后勤保障岗位', dailyRate: '200', meal: '30', traffic: '20', night: '30', attendance: '400' }
      ],
      common: [
        { label: '计薪工日', value: '每完成一场（含日场或晚场）完整演出计 1 个工日；同日双场经甲方安排的按 1.5 个工日计算。' },
        { label: '排练安排', value: '集中排练由甲方提前通知，排练期间按对应等级天工资的 50% 计发，半天按半日计算。' },
        { label: '夜场补贴', value: '晚场演出结束时间超过 22:00 的，按等级表发放夜场补贴；下乡返程超过 24:00 的另议。' },
        { label: '结算方式', value: '单场/短期演出于演出结束后 3 个工作日内，按实际出勤工日一次性结清；长期跟团人员按月结算。' },
        { label: '安全与纪律', value: '乙方须服从演出调度与安全管理，因个人原因迟到、误场、罢演造成损失的，甲方有权按团规扣减当日报酬；演出期间交通、餐饮按等级表标准执行。' }
      ],
      clauses: [
        '本单所列天工资标准为税前劳务报酬，个人应缴税费按国家规定由甲方代扣代缴或由乙方自行申报。',
        '乙方应保证身体健康、能够胜任演出任务，并自行办理演出期间个人人身意外保险；演出往返及演出过程中因不服从安全管理造成的意外，由乙方自行承担相应责任。',
        '乙方应爱护甲方服装、道具、乐器及舞美设备，人为损坏或遗失的照价赔偿。',
        '本单标准有效期内，如遇政府惠民演出、公益场等特殊场次，双方可另行协商补贴标准；国家法定节假日演出按国家规定执行。',
        '双方发生争议应友好协商解决；协商不成的，可向甲方所在地人民法院提起诉讼。'
      ],
      extra: '',
      copies: '本单一式两份，甲乙双方各执一份，自双方签字（盖章）之日起生效，具有同等效力。'
    };
  }

  var tpl = defaultTemplate();

  /* ---------------- 样式注入 ---------------- */
  function injectCss() {
    if (document.getElementById('__ngWageStyle')) return;
    var css = ''
      + '.ng-grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px 18px;}'
      + '.ng-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 18px;}'
      + '.ng-field{display:flex;flex-direction:column;gap:5px;}'
      + '.ng-field.full{grid-column:1/-1;}'
      + '.ng-field label{font-size:.8rem;font-weight:600;color:var(--primary-dark);}'
      + '.ng-field input,.ng-field textarea{padding:9px 12px;border:1.5px solid var(--border-light,#e5e7eb);border-radius:8px;font-family:inherit;font-size:.88rem;background:#fff;box-sizing:border-box;width:100%;}'
      + '.ng-field textarea{resize:vertical;}'
      + '.ng-field input:focus,.ng-field textarea:focus{outline:none;border-color:var(--gold,#c9a962);box-shadow:0 0 0 2px rgba(201,169,98,.15);}'
      + '.ng-card{background:#fff;border:1px solid var(--border-light,#e5e7eb);border-radius:14px;padding:18px 22px;margin-bottom:18px;box-shadow:0 2px 10px rgba(0,0,0,.03);}'
      + '.ng-card-title{display:flex;align-items:center;gap:8px;margin:0 0 14px;font-size:.98rem;color:var(--primary-dark);font-weight:700;}'
      + '.ng-grade-table{width:100%;border-collapse:collapse;}'
      + '.ng-grade-table th{background:linear-gradient(135deg,#8b0000,#a52a2a);color:#fff;padding:9px 8px;font-size:.78rem;font-weight:600;text-align:center;white-space:nowrap;}'
      + '.ng-grade-table td{border:1px solid var(--border-light,#e5e7eb);padding:6px;}'
      + '.ng-grade-table input{padding:7px 8px;border:1px solid var(--border-light,#e5e7eb);border-radius:6px;font-family:inherit;font-size:.83rem;text-align:center;box-sizing:border-box;width:100%;}'
      + '.ng-grade-table input.ng-name, .ng-grade-table input.ng-scope{text-align:left;}'
      + '.ng-grade-table tr:nth-child(even) td{background:rgba(201,169,98,.03);}'
      + '.ng-row-del{padding:6px 10px;border:none;background:#fee2e2;color:#dc2626;border-radius:6px;cursor:pointer;font-size:.8rem;white-space:nowrap;}'
      + '.ng-add-btn{margin-top:10px;padding:8px 16px;border:1.5px dashed #c9a962;background:#fffdf6;color:#8a6d3b;border-radius:8px;cursor:pointer;font-size:.85rem;}'
      + '.ng-clause-item{display:flex;gap:10px;margin-bottom:10px;align-items:flex-start;}'
      + '.ng-clause-item textarea{flex:1;}'
      + '.ng-sheet{background:#fff;padding:46px 50px;box-shadow:0 8px 40px rgba(0,0,0,.18);font-size:13px;color:#111;line-height:1.8;box-sizing:border-box;}'
      + '.ng-sheet .ng-doc-head{text-align:center;border-bottom:3px double #8b0000;padding-bottom:14px;margin-bottom:16px;}'
      + '.ng-sheet .ng-doc-troupe{font-size:16px;color:#8b0000;letter-spacing:2px;font-weight:600;}'
      + '.ng-sheet .ng-doc-title{font-size:26px;font-weight:800;letter-spacing:8px;margin:6px 0 4px;}'
      + '.ng-sheet .ng-doc-no{font-size:12px;color:#555;text-align:right;margin-bottom:10px;}'
      + '.ng-sheet table.ng-print-table{width:100%;border-collapse:collapse;margin:8px 0 14px;}'
      + '.ng-sheet table.ng-print-table th,.ng-sheet table.ng-print-table td{border:1px solid #333;padding:7px 9px;font-size:12.5px;text-align:center;vertical-align:top;}'
      + '.ng-sheet table.ng-print-table th{background:#f3ece0;}'
      + '.ng-sheet table.ng-print-table td.l{text-align:left;}'
      + '.ng-sheet .ng-amt{font-family:Georgia,serif;font-weight:700;}'
      + '.ng-sheet .ng-clauses{margin:6px 0 14px;padding-left:22px;}'
      + '.ng-sheet .ng-clauses li{margin-bottom:6px;}'
      + '.ng-sheet .ng-common p{margin:4px 0;}'
      + '.ng-sheet .ng-extra{margin:6px 0 14px;white-space:pre-wrap;}'
      + '.ng-sheet .ng-sign{display:flex;justify-content:space-between;gap:30px;margin-top:40px;}'
      + '.ng-sheet .ng-sign>div{flex:1;line-height:2.5;}'
      + '.ng-sheet .ng-foot{margin-top:18px;font-size:11px;color:#777;text-align:center;border-top:1px solid #ddd;padding-top:8px;}'
      + '@media(max-width:760px){.ng-grid2,.ng-grid3{grid-template-columns:1fr;}.ng-sheet{padding:24px 16px;}}'
      + '@media print{body *{visibility:hidden !important;}#ngPreviewMask,#ngPreviewMask *{visibility:visible !important;}'
      + '#ngPreviewMask{position:absolute !important;inset:0 !important;background:#fff !important;padding:0 !important;z-index:999999 !important;overflow:visible !important;}'
      + '#ngPreviewMask>div{max-width:none !important;}#ngPreviewBar{display:none !important;}'
      + '#ngSheet{box-shadow:none !important;padding:0 6mm !important;max-width:none !important;}@page{size:A4;margin:12mm;}}';
    var st = document.createElement('style');
    st.id = '__ngWageStyle';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- 编辑器渲染 ---------------- */
  function escAttr(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;'); }

  function card(title, icon, bodyHtml) {
    return '<div class="ng-card"><h4 class="ng-card-title">' + icon + ' ' + title + '</h4>' + bodyHtml + '</div>';
  }

  function renderEditor() {
    var box = $('ngEditor');
    if (!box) return;
    var h = '';

    // 1. 单据抬头
    h += card('单据抬头', '🏷️',
      '<div class="ng-grid2">'
      + '<div class="ng-field"><label>剧团（单位）名称</label><input data-ng-path="troupeName" value="' + escAttr(tpl.troupeName) + '"></div>'
      + '<div class="ng-field"><label>单据标题</label><input data-ng-path="docTitle" value="' + escAttr(tpl.docTitle) + '"></div>'
      + '<div class="ng-field full"><label>单据编号（可留空，打印后手工填写）</label><input data-ng-path="docNo" value="' + escAttr(tpl.docNo) + '" placeholder="如：QAX-NG-2026-001"></div>'
      + '</div>');

    // 2. 甲方
    var a = tpl.partyA;
    h += card('甲方（用工单位）信息', '🏛️',
      '<div class="ng-grid2">'
      + '<div class="ng-field"><label>单位名称</label><input data-ng-path="partyA.name" value="' + escAttr(a.name) + '"></div>'
      + '<div class="ng-field"><label>负责人/联系人</label><input data-ng-path="partyA.contact" value="' + escAttr(a.contact) + '"></div>'
      + '<div class="ng-field"><label>联系电话</label><input data-ng-path="partyA.phone" value="' + escAttr(a.phone) + '"></div>'
      + '<div class="ng-field"><label>单位地址</label><input data-ng-path="partyA.address" value="' + escAttr(a.address) + '"></div>'
      + '</div>');

    // 3. 乙方（含花名册联动选择）
    var b = tpl.partyB;
    var perfOpts = '<option value="">— 手动填写 / 或从花名册选择 —</option>';
    var selectedId = b.performerId || '';
    if (performerCache.length) {
      performerCache.forEach(function (p) {
        perfOpts += '<option value="' + p.id + '"' + (p.id === selectedId ? ' selected' : '') + '>'
          + escAttr((p.name || p.staffNo || p.id).slice(0, 24))
          + (p.rankGrade ? ' [' + escAttr(p.rankGrade) + ']' : '')
          + (p.dailyRate ? ' ¥' + escAttr(p.dailyRate) + '/天' : '')
          + '</option>';
      });
    }
    h += card('乙方（演职人员）信息', '🎭',
      '<div class="ng-grid3">'
      + '<div class="ng-field">'
      + '<label>👤 从花名册选择演员（自动带出姓名/行当/等级/日薪）</label>'
      + '<select id="ngPerformerSelect" data-ng-perf-select style="padding:9px 12px;border:1.5px solid var(--border-light,#e5e7eb);border-radius:8px;font-size:.88rem;background:#fff;width:100%;box-sizing:border-box;cursor:pointer;">' + perfOpts + '</select>'
      + '<div id="ngPerformerHint" style="font-size:.75rem;color:#8a6d3b;margin-top:3px;">提示：选中后自动填充；也可直接修改下方任一输入框手动覆盖</div>'
      + '</div>'
      + '<div class="ng-field"><label>姓名</label><input data-ng-path="partyB.name" value="' + escAttr(b.name) + '" placeholder="可留空，签订时填写"></div>'
      + '<div class="ng-field"><label>身份证号</label><input data-ng-path="partyB.idCard" value="' + escAttr(b.idCard) + '"></div>'
      + '<div class="ng-field"><label>联系电话</label><input data-ng-path="partyB.phone" value="' + escAttr(b.phone) + '"></div>'
      + '<div class="ng-field"><label>行当 / 岗位</label><input data-ng-path="partyB.role" value="' + escAttr(b.role) + '" placeholder="如：青衣 / 板胡 / 舞美"></div>'
      + '<div class="ng-field full"><label>住址</label><input data-ng-path="partyB.address" value="' + escAttr(b.address) + '"></div>'
      + '</div>');

    // 4. 引言
    h += card('商议事由（引言）', '📜',
      '<div class="ng-field"><textarea rows="3" data-ng-path="intro">' + escAttr(tpl.intro) + '</textarea></div>');

    // 5. A-E 等级工资表
    var gh = '<div style="overflow-x:auto;"><table class="ng-grade-table"><thead><tr>'
      + '<th style="min-width:56px;">等级</th><th style="min-width:150px;">等级名称</th><th style="min-width:240px;">适用范围 / 说明</th>'
      + '<th>天工资<br>(元/天)</th><th>餐补<br>(元/天)</th><th>交通补<br>(元/天)</th><th>夜场补贴<br>(元/场)</th><th>全勤参考<br>(元/月)</th><th></th>'
      + '</tr></thead><tbody>';
    tpl.grades.forEach(function (g, i) {
      gh += '<tr data-ng-grade-row="' + i + '">'
        + '<td><input data-ng-path="grades.' + i + '.code" value="' + escAttr(g.code) + '" style="font-weight:700;"></td>'
        + '<td><input class="ng-name" data-ng-path="grades.' + i + '.name" value="' + escAttr(g.name) + '"></td>'
        + '<td><input class="ng-scope" data-ng-path="grades.' + i + '.scope" value="' + escAttr(g.scope) + '"></td>'
        + '<td><input type="number" min="0" data-ng-path="grades.' + i + '.dailyRate" value="' + escAttr(g.dailyRate) + '"></td>'
        + '<td><input type="number" min="0" data-ng-path="grades.' + i + '.meal" value="' + escAttr(g.meal) + '"></td>'
        + '<td><input type="number" min="0" data-ng-path="grades.' + i + '.traffic" value="' + escAttr(g.traffic) + '"></td>'
        + '<td><input type="number" min="0" data-ng-path="grades.' + i + '.night" value="' + escAttr(g.night) + '"></td>'
        + '<td><input type="number" min="0" data-ng-path="grades.' + i + '.attendance" value="' + escAttr(g.attendance) + '"></td>'
        + '<td><button type="button" class="ng-row-del" data-ng-grade-del="' + i + '">删除</button></td>'
        + '</tr>';
    });
    gh += '</tbody></table></div>';
    gh += '<button type="button" class="ng-add-btn" id="ngAddGrade">➕ 增加一个工资等级</button>';
    h += card('等级天工资标准（A / B / C / D / E …可自由增删）', '💰', gh);

    // 6. 通用计薪约定
    var ch = '';
    tpl.common.forEach(function (c, i) {
      ch += '<div class="ng-field" style="margin-bottom:12px;"><label data-ng-clabel="' + i + '">' + escAttr(c.label) + '（小标题可编辑）</label>'
        + '<input data-ng-path="common.' + i + '.label" value="' + escAttr(c.label) + '" style="margin-bottom:6px;font-weight:600;">'
        + '<textarea rows="2" data-ng-path="common.' + i + '.value">' + escAttr(c.value) + '</textarea></div>';
    });
    ch += '<button type="button" class="ng-add-btn" id="ngAddCommon">➕ 增加一项约定</button>';
    h += card('计薪与补贴通用约定', '⚙️', ch);

    // 7. 条款
    var lh = '';
    tpl.clauses.forEach(function (c, i) {
      lh += '<div class="ng-clause-item"><textarea rows="2" data-ng-clause="' + i + '">' + escAttr(c) + '</textarea>'
        + '<button type="button" class="ng-row-del" data-ng-clause-del="' + i + '">删除</button></div>';
    });
    lh += '<button type="button" class="ng-add-btn" id="ngAddClause">➕ 增加一条条款</button>';
    h += card('商议条款', '📖', lh);

    // 8. 补充 + 份数
    h += card('补充约定与生效', '✍️',
      '<div class="ng-field" style="margin-bottom:12px;"><label>其他补充约定（可留空）</label>'
      + '<textarea rows="3" data-ng-path="extra" placeholder="双方另有约定的其他事项…">' + escAttr(tpl.extra) + '</textarea></div>'
      + '<div class="ng-field"><label>份数 / 生效说明</label><textarea rows="2" data-ng-path="copies">' + escAttr(tpl.copies) + '</textarea></div>');

    box.innerHTML = h;
    bindEditorEvents();
    bindPerformerSelect();
  }

  function setDeep(obj, path, val) {
    var p = path.split('.');
    var o = obj;
    for (var i = 0; i < p.length - 1; i++) {
      var k = p[i];
      if (o[k] == null) o[k] = /^\d+$/.test(p[i + 1]) ? [] : {};
      o = o[k];
    }
    o[p[p.length - 1]] = val;
  }

  function collectInputs() {
    var nodes = $('ngEditor').querySelectorAll('[data-ng-path]');
    nodes.forEach(function (n) { setDeep(tpl, n.getAttribute('data-ng-path'), n.value); });
    var clauses = $('ngEditor').querySelectorAll('[data-ng-clause]');
    var list = [];
    clauses.forEach(function (n) { list.push(n.value); });
    tpl.clauses = list;
  }

  function bindEditorEvents() {
    var box = $('ngEditor');
    // 输入同步到内存（input 事件不受全局补丁影响）
    box.addEventListener('input', function (e) {
      var t = e.target;
      if (t.hasAttribute && t.hasAttribute('data-ng-path')) {
        setDeep(tpl, t.getAttribute('data-ng-path'), t.value);
      } else if (t.hasAttribute && t.hasAttribute('data-ng-clause')) {
        tpl.clauses[Number(t.getAttribute('data-ng-clause'))] = t.value;
      }
    });
  }

  /* ---------------- A4 预览 ---------------- */
  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  }
  function blank(v) { return (v === '' || v == null) ? '＿＿＿＿＿＿' : escHtml(v); }
  function yuan(v) { return (v === '' || v == null) ? '—' : '¥' + escHtml(v); }

  function renderSheet() {
    var g = tpl;
    var h = '';
    h += '<div class="ng-doc-head">'
      + '<div class="ng-doc-troupe">' + escHtml(g.troupeName) + '</div>'
      + '<div class="ng-doc-title">' + escHtml(g.docTitle) + '</div>'
      + '<div style="font-size:12px;color:#555;">（演职人员天工资标准商议凭证）</div>'
      + '</div>';
    h += '<div class="ng-doc-no">编号：' + blank(g.docNo) + '</div>';

    // 甲乙方
    h += '<table class="ng-print-table"><tbody>'
      + '<tr><th style="width:90px;">甲方（用工单位）</th><td class="l" colspan="3">' + blank(g.partyA.name) + '</td></tr>'
      + '<tr><th>负责人</th><td class="l">' + blank(g.partyA.contact) + '</td><th style="width:90px;">联系电话</th><td class="l">' + blank(g.partyA.phone) + '</td></tr>'
      + '<tr><th>单位地址</th><td class="l" colspan="3">' + blank(g.partyA.address) + '</td></tr>'
      + '<tr><th>乙方（演员）</th><td class="l">' + blank(g.partyB.name) + '</td><th>行当/岗位</th><td class="l">' + blank(g.partyB.role) + '</td></tr>'
      + '<tr><th>身份证号</th><td class="l" colspan="3">' + blank(g.partyB.idCard) + '</td></tr>'
      + '<tr><th>联系电话</th><td class="l">' + blank(g.partyB.phone) + '</td><th>住址</th><td class="l">' + blank(g.partyB.address) + '</td></tr>'
      + '</tbody></table>';

    h += '<p style="text-indent:2em;margin:6px 0;">' + escHtml(g.intro) + '</p>';

    // 等级表
    h += '<p style="font-weight:700;margin:10px 0 4px;">一、天工资等级标准</p>';
    h += '<table class="ng-print-table"><thead><tr>'
      + '<th>等级</th><th>等级名称</th><th>适用范围 / 说明</th><th>天工资<br>(元/天)</th><th>餐补</th><th>交通补</th><th>夜场补贴</th><th>全勤参考</th>'
      + '</tr></thead><tbody>';
    g.grades.forEach(function (r) {
      h += '<tr><td class="ng-amt">' + escHtml(r.code) + '</td>'
        + '<td>' + escHtml(r.name) + '</td>'
        + '<td class="l">' + escHtml(r.scope) + '</td>'
        + '<td class="ng-amt">' + yuan(r.dailyRate) + '</td>'
        + '<td>' + yuan(r.meal) + '</td><td>' + yuan(r.traffic) + '</td><td>' + yuan(r.night) + '</td>'
        + '<td>' + yuan(r.attendance) + '</td></tr>';
    });
    h += '</tbody></table>';

    // 通用约定
    h += '<p style="font-weight:700;margin:10px 0 4px;">二、计薪与补贴约定</p><div class="ng-common">';
    g.common.forEach(function (c) {
      h += '<p><strong>' + escHtml(c.label) + '：</strong>' + escHtml(c.value) + '</p>';
    });
    h += '</div>';

    // 条款
    h += '<p style="font-weight:700;margin:10px 0 4px;">三、其他商议条款</p><ol class="ng-clauses">';
    g.clauses.forEach(function (c) { h += '<li>' + escHtml(c) + '</li>'; });
    h += '</ol>';

    if (g.extra && g.extra.trim()) {
      h += '<p style="font-weight:700;margin:10px 0 4px;">四、补充约定</p><div class="ng-extra">' + escHtml(g.extra) + '</div>';
    }

    // 签字区
    h += '<div class="ng-sign">'
      + '<div><strong>甲方（盖章）：</strong><br>代表签字：＿＿＿＿＿＿＿＿<br>联系电话：' + blank(g.partyA.phone) + '<br>签订日期：＿＿＿年＿＿月＿＿日</div>'
      + '<div><strong>乙方（签字按印）：</strong><br>身份证号：' + blank(g.partyB.idCard) + '<br>联系电话：' + blank(g.partyB.phone) + '<br>签订日期：＿＿＿年＿＿月＿＿日</div>'
      + '</div>';
    h += '<div class="ng-foot">' + escHtml(g.copies) + '</div>';

    $('ngSheet').innerHTML = h;
  }

  function openPreview() {
    collectInputs();
    renderSheet();
    $('ngPreviewMask').style.display = 'block';
  }
  function closePreview() { $('ngPreviewMask').style.display = 'none'; }

  /* ---------------- 持久化 ---------------- */
  function localLoad() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }
  function localSave() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(tpl)); } catch (_) {}
  }

  function loadFromServer() {
    var A = window.QAXQJT_API;
    status('正在加载已保存模板…');
    if (!A) {
      var loc = localLoad();
      if (loc) tpl = mergeDefaults(loc);
      renderEditor();
      status('API 未就绪，已加载本地缓存模板（可编辑，保存需登录后台）');
      return;
    }
    A.get('/v1/system/settings/key/' + SETTING_KEY, { showErrorToast: false, timeoutMs: 10000 })
      .then(function (row) {
        var v = row && row.value;
        if (v) {
          try { tpl = mergeDefaults(JSON.parse(v)); status('已加载服务器模板 · 更新：' + ((row.updatedBy || '') + ' ' + String(row.updatedAt || '').slice(0, 10))); }
          catch (_) { status('⚠️ 服务器模板解析失败，显示默认模板'); }
        } else {
          status('尚未保存自定义模板，当前为系统默认模板');
        }
        localSave();
        renderEditor();
      })
      .catch(function () {
        var loc = localLoad();
        if (loc) { tpl = mergeDefaults(loc); status('⚠️ 服务器不可达，已加载本地缓存模板'); }
        else { status('⚠️ 服务器不可达，显示默认模板（编辑会自动暂存本地）'); }
        renderEditor();
      });
  }

  function mergeDefaults(saved) {
    // 浅合并 + 嵌套结构补全，防止旧版本模板缺字段
    var d = defaultTemplate();
    if (!saved || typeof saved !== 'object') return d;
    Object.keys(d).forEach(function (k) {
      if (saved[k] === undefined) saved[k] = d[k];
    });
    saved.partyA = Object.assign({}, d.partyA, saved.partyA || {});
    saved.partyB = Object.assign({}, d.partyB, saved.partyB || {});
    if (!Array.isArray(saved.grades) || !saved.grades.length) saved.grades = d.grades;
    if (!Array.isArray(saved.common) || !saved.common.length) saved.common = d.common;
    if (!Array.isArray(saved.clauses)) saved.clauses = d.clauses;
    return saved;
  }

  var saving = false;
  function saveTemplate() {
    if (saving) return;
    collectInputs();
    localSave();
    var A = window.QAXQJT_API;
    if (!A) { toast('API 未就绪，已暂存本地浏览器', 'warning'); return; }
    saving = true;
    status('正在保存到服务器…');
    var body = {
      items: [{
        key: SETTING_KEY,
        value: JSON.stringify(tpl),
        group: 'wage_negotiate',
        description: '天工资商议单模板（A-E 等级工资及全部条款，后台可自定义）',
        isPublic: true
      }]
    };
    A.post('/v1/system/settings/batch', body, { showErrorToast: false, timeoutMs: 12000 })
      .then(function () {
        toast('✅ 商议单模板已保存');
        // 同步归档一份快照到存档列表
        var snap = buildSnapshot();
        return saveArchive(snap)
          .then(function () {
            status('✅ 模板已保存并归档（' + new Date().toLocaleString('zh-CN') + '）· 见「商议单存档」');
            refreshArchiveList();
          })
          .catch(function () {
            status('✅ 模板已保存（存档写入失败，不影响模板使用）');
          });
      })
      .catch(function (e) {
        status('⚠️ 服务器保存失败（已暂存本地）：' + ((e && e.message) || e) + '；需超级管理员权限');
        toast('保存失败：已暂存本地，登录超管账号可上传', 'error');
      })
      .then(function () { saving = false; }, function () { saving = false; });
  }

  /* ---------------- 重置（无原生 confirm，二次点击确认） ---------------- */
  var resetArmed = false, resetTimer = null, resetOrigText = '';
  function doResetClick(btn) {
    if (!resetArmed) {
      resetArmed = true;
      resetOrigText = btn.textContent;
      btn.textContent = '⚠️ 再点一次：确认恢复默认？';
      status('将放弃全部自定义并恢复系统默认模板（再次点击确认，3 秒后取消）');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () { resetArmed = false; btn.textContent = resetOrigText; }, 3000);
    } else {
      clearTimeout(resetTimer);
      resetArmed = false;
      btn.textContent = resetOrigText;
      tpl = defaultTemplate();
      localSave();
      renderEditor();
      status('已恢复系统默认模板（如需生效请点击「保存模板」）');
      toast('↩ 已恢复默认模板');
    }
  }

  function addGrade() {
    collectInputs();
    var n = String.fromCharCode(65 + (tpl.grades.length % 26));
    tpl.grades.push({ code: n, name: '新增等级', scope: '', dailyRate: '', meal: '', traffic: '', night: '', attendance: '' });
    renderEditor();
  }
  function addClause() { collectInputs(); tpl.clauses.push(''); renderEditor(); }
  function addCommon() { collectInputs(); tpl.common.push({ label: '新约定', value: '' }); renderEditor(); }

  /* ---------------- 全局点击委托（window capture，抢在 app.js 全局补丁前） ---------------- */
  function onGlobalClick(e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    var panel = $('wtab-negotiate');
    var archPanel = $('wtab-archive');
    var inNeg = panel && panel.contains(t);
    var inArch = archPanel && archPanel.contains(t);
    if (!inNeg && !inArch) return; // 只管商议单/存档面板内的点击

    var hit;
    if ((hit = t.closest && t.closest('#ngBtnReload'))) { e.preventDefault(); e.stopPropagation(); loadFromServer(); return; }
    if ((hit = t.closest && t.closest('#ngBtnSave'))) { e.preventDefault(); e.stopPropagation(); saveTemplate(); return; }
    if ((hit = t.closest && t.closest('#ngBtnPreview'))) { e.preventDefault(); e.stopPropagation(); openPreview(); return; }
    if ((hit = t.closest && t.closest('#ngBtnClosePreview'))) { e.preventDefault(); e.stopPropagation(); closePreview(); return; }
    if ((hit = t.closest && t.closest('#ngBtnReset'))) { e.preventDefault(); e.stopPropagation(); doResetClick($('ngBtnReset')); return; }
    if ((hit = t.closest && t.closest('#ngBtnPrint'))) {
      e.preventDefault(); e.stopPropagation();
      try { window.print(); } catch (_) { toast('当前浏览器不支持直接打印，请用 Ctrl+P', 'warning'); }
      return;
    }
    if ((hit = t.closest && t.closest('#ngAddGrade'))) { e.preventDefault(); e.stopPropagation(); addGrade(); return; }
    if ((hit = t.closest && t.closest('#ngAddClause'))) { e.preventDefault(); e.stopPropagation(); addClause(); return; }
    if ((hit = t.closest && t.closest('#ngAddCommon'))) { e.preventDefault(); e.stopPropagation(); addCommon(); return; }
    if ((hit = t.closest && t.closest('[data-ng-grade-del]'))) {
      e.preventDefault(); e.stopPropagation();
      collectInputs();
      tpl.grades.splice(Number(hit.getAttribute('data-ng-grade-del')), 1);
      renderEditor(); return;
    }
    if ((hit = t.closest && t.closest('[data-ng-clause-del]'))) {
      e.preventDefault(); e.stopPropagation();
      collectInputs();
      tpl.clauses.splice(Number(hit.getAttribute('data-ng-clause-del')), 1);
      renderEditor(); return;
    }
    // 存档列表操作（key|index 定位单条）
    if ((hit = t.closest && t.closest('#ngBtnArchExport'))) { e.preventDefault(); e.stopPropagation(); exportArchives(); return; }
    if ((hit = t.closest && t.closest('[data-ng-arch-view]'))) {
      e.preventDefault(); e.stopPropagation();
      viewArchive(hit.getAttribute('data-ng-arch-view')); return;
    }
    if ((hit = t.closest && t.closest('[data-ng-arch-print]'))) {
      e.preventDefault(); e.stopPropagation();
      printArchive(hit.getAttribute('data-ng-arch-print')); return;
    }
    if ((hit = t.closest && t.closest('[data-ng-arch-del]'))) {
      e.preventDefault(); e.stopPropagation();
      delArchive(hit); return;
    }
  }

  /* ---------------- 花名册演员联动 ---------------- */
  function fetchPerformers() {
    var A = window.QAXQJT_API;
    if (!A) return Promise.resolve([]);
    return A.get('/v1/performers', { query: { pageSize: 500, status: 'active' }, showErrorToast: false, timeoutMs: 10000 })
      .then(function (rows) {
        var list = (rows && rows.items) ? rows.items : (Array.isArray(rows) ? rows : []);
        return list.map(function (p) {
          return {
            id: p.id || p.staffNo || '',
            name: p.name || '',
            staffNo: p.staffNo || '',
            phone: p.phone || '',
            idCardNo: p.idCardNo || '',
            rankGrade: p.rankGrade || '',
            dailyRate: p.dailyRate != null ? String(p.dailyRate) : '',
            primaryRole: p.primaryRole || '',
            role: p.role || ''
          };
        }).filter(function (p) { return p.name; });
      })
      .catch(function () { return []; });
  }

  function fillPartyB(p) {
    if (!p) return;
    tpl.partyB.performerId = p.id || '';
    tpl.partyB.name = p.name || '';
    tpl.partyB.phone = p.phone || '';
    tpl.partyB.role = p.primaryRole || p.role || '';
    tpl.partyB.idCard = p.idCardNo || '';
    // 自动匹配等级：按 rankGrade 含 A/B/C/D/E 或按 dailyRate 最接近值
    var gradeMatch = findGradeByRankGrade(p.rankGrade);
    if (!gradeMatch && p.dailyRate) gradeMatch = findGradeByDailyRate(p.dailyRate);
    if (gradeMatch) {
      // 用匹配到的等级值覆盖对应行（如果用户没改的话）
      var gi = tpl.grades.findIndex(function (g) { return g.code === gradeMatch.code; });
      if (gi >= 0) {
        // 只自动填充空白的等级字段，已填的不覆盖
        ['dailyRate', 'meal', 'traffic', 'night', 'attendance'].forEach(function (k) {
          if (tpl.grades[gi][k] === '') tpl.grades[gi][k] = gradeMatch[k];
        });
      }
    }
  }

  function findGradeByRankGrade(rg) {
    if (!rg) return null;
    rg = String(rg).toUpperCase();
    // 支持 A/B/C/D/E 或含 "A级"、"B级" 等
    var m = rg.match(/([A-E])级?/);
    if (!m) return null;
    var code = m[1];
    return tpl.grades.find(function (g) { return g.code === code; });
  }

  function findGradeByDailyRate(rate) {
    if (!rate) return null;
    var n = Number(rate);
    if (!isFinite(n)) return null;
    var best = null, bestDiff = Infinity;
    tpl.grades.forEach(function (g) {
      var gn = Number(g.dailyRate);
      if (!isFinite(gn)) return;
      var d = Math.abs(gn - n);
      if (d < bestDiff) { bestDiff = d; best = g; }
    });
    return best;
  }

  function bindPerformerSelect() {
    var sel = $('ngPerformerSelect');
    if (!sel) return;
    sel.addEventListener('change', function () {
      var id = sel.value;
      var hint = $('ngPerformerHint');
      if (!id) { if (hint) hint.textContent = '提示：选中后自动填充；也可直接修改下方任一输入框手动覆盖'; return; }
      var p = performerCache.find(function (x) { return x.id === id; });
      if (!p) { if (hint) hint.textContent = '未找到该演员信息'; return; }
      fillPartyB(p);
      // 同步到输入框
      var nameEl = document.querySelector('[data-ng-path="partyB.name"]');
      var phoneEl = document.querySelector('[data-ng-path="partyB.phone"]');
      var roleEl = document.querySelector('[data-ng-path="partyB.role"]');
      var idCardEl = document.querySelector('[data-ng-path="partyB.idCard"]');
      if (nameEl) nameEl.value = p.name || '';
      if (phoneEl) phoneEl.value = p.phone || '';
      if (roleEl) roleEl.value = p.primaryRole || p.role || '';
      if (idCardEl) idCardEl.value = p.idCardNo || '';
      if (hint) hint.textContent = '已带出：' + (p.name || '') + (p.rankGrade ? ' [' + p.rankGrade + ']' : '') + (p.dailyRate ? ' ¥' + p.dailyRate + '/天' : '');
      toast('已自动带出演员：' + (p.name || ''), 'success');
    });
  }

  /* ---------------- 商议单存档 ---------------- */
  function archiveKey(dateStr) {
    return ARCHIVE_PREFIX + (dateStr || new Date().toISOString().slice(0, 10));
  }

  // upsert：batch 409 冲突时按返回行 id 递归重试（兼容 updateMany 原子计数不生效的实现）
  function saveSettingValue(key, value, group, desc) {
    var A = window.QAXQJT_API;
    return A.post('/v1/system/settings/batch', {
      items: [{ key: key, value: value, group: group, description: desc, isPublic: false }]
    }, { showErrorToast: false, timeoutMs: 12000 })
      .catch(function (e) {
        var msg = String((e && e.message) || e || '');
        if (/409|duplicate|已存在|unique/i.test(msg)) {
          return A.get('/v1/system/settings/key/' + key, { showErrorToast: false, timeoutMs: 8000 })
            .then(function (row) {
              return saveSettingValue(row && row.id ? String(row.id) : key, value, group, desc);
            });
        }
        throw e;
      });
  }

  // 生成存档快照（深拷贝当前模板 + 时间戳 + 匹配等级）
  function buildSnapshot() {
    var snap;
    try { snap = JSON.parse(JSON.stringify(tpl)); }
    catch (_) { snap = Object.assign({}, tpl); }
    snap._savedAt = Date.now();
    snap._matchedGrade = null;
    try {
      var pb = tpl.partyB || {};
      var p = null;
      if (pb.performerId) {
        p = performerCache.find(function (x) { return x.id === pb.performerId; });
      }
      var gm = null;
      if (p) gm = findGradeByRankGrade(p.rankGrade) || findGradeByDailyRate(p.dailyRate);
      if (gm) snap._matchedGrade = { code: gm.code, name: gm.name, dailyRate: gm.dailyRate };
    } catch (_) {}
    return snap;
  }

  function saveArchive(snapshot) {
    var A = window.QAXQJT_API;
    if (!A) return Promise.resolve(null);
    var dateStr = new Date().toISOString().slice(0, 10);
    var key = archiveKey(dateStr);
    // 读取已有存档，追加
    return A.get('/v1/system/settings/key/' + key, { showErrorToast: false, timeoutMs: 8000 })
      .then(function (row) {
        var list = [];
        if (row && row.value) {
          try { var v = JSON.parse(row.value); if (Array.isArray(v)) list = v; } catch (_) {}
        }
        list.push(snapshot);
        return saveSettingValue(key, JSON.stringify(list), 'wage_negotiate_archive', '天工资商议单存档 ' + dateStr);
      })
      .catch(function () {
        // 不存在则创建
        return saveSettingValue(key, JSON.stringify([snapshot]), 'wage_negotiate_archive', '天工资商议单存档 ' + dateStr);
      });
  }

  function loadArchives() {
    var A = window.QAXQJT_API;
    if (!A) return Promise.resolve([]);
    // 列出所有存档 key（通过 group 过滤）
    return A.get('/v1/system/settings', { query: { group: 'wage_negotiate_archive', pageSize: 200 }, showErrorToast: false, timeoutMs: 10000 })
      .then(function (res) {
        var items = (res && res.items) ? res.items : (Array.isArray(res) ? res : []);
        var archives = [];
        items.forEach(function (it) {
          if (!it.value) return;
          try {
            var list = JSON.parse(it.value);
            if (Array.isArray(list)) {
              list.forEach(function (snap, idx) {
                if (snap && typeof snap === 'object') archives.push({ key: it.key, index: idx, snapshot: snap });
              });
            }
          } catch (_) {}
        });
        // 按时间倒序
        archives.sort(function (a, b) {
          var ta = a.snapshot && a.snapshot._savedAt ? a.snapshot._savedAt : 0;
          var tb = b.snapshot && b.snapshot._savedAt ? b.snapshot._savedAt : 0;
          return tb - ta;
        });
        return archives;
      })
      .catch(function () { return []; });
  }

  function refreshArchiveList() {
    var listBox = $('ngArchiveList');
    if (!listBox) return;
    loadArchives().then(function (archives) { renderArchiveList(listBox, archives); });
  }

  /* ---------------- 存档导出（尊重当前搜索过滤；xlsx-js-style 优先，CSV 兜底） ---------------- */
  function exportArchives() {
    if (!archiveCache.length) { toast('暂无存档可导出', 'warning'); return; }
    var kw = '';
    var searchEl = $('ngArchSearch');
    if (searchEl) kw = searchEl.value.trim().toLowerCase();
    var rows = archiveCache.filter(function (a) {
      if (!kw) return true;
      var s = a.snapshot || {};
      var name = ((s.partyB && s.partyB.name) || '').toLowerCase();
      var no = String(s.docNo || '').toLowerCase();
      var time = s._savedAt ? new Date(s._savedAt).toLocaleString('zh-CN') : '';
      return name.indexOf(kw) >= 0 || no.indexOf(kw) >= 0 || time.toLowerCase().indexOf(kw) >= 0;
    });
    if (!rows.length) { toast('当前筛选条件下无存档可导出', 'warning'); return; }
    var aoa = [['序号', '演员姓名', '单据编号', '等级', '等级名称', '天工资(元/天)', '存档时间', '存档日期']];
    rows.forEach(function (a, i) {
      var s = a.snapshot || {};
      aoa.push([
        i + 1,
        (s.partyB && s.partyB.name) || '',
        s.docNo || '',
        (s._matchedGrade && s._matchedGrade.code) ? s._matchedGrade.code + '级' : '',
        (s._matchedGrade && s._matchedGrade.name) || '',
        (s._matchedGrade && s._matchedGrade.dailyRate != null) ? s._matchedGrade.dailyRate : '',
        s._savedAt ? new Date(s._savedAt).toLocaleString('zh-CN') : '',
        a.key ? a.key.replace(ARCHIVE_PREFIX, '') : ''
      ]);
    });
    var fname = '商议单存档_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Date.now() % 100000 + '.xlsx';

    // 降级 CSV（带 BOM，Excel 直开不乱码）
    var exportCsvFallback = function () {
      var csv = '\uFEFF' + aoa.map(function (r) {
        return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fname.replace('.xlsx', '.csv');
      document.body.appendChild(link);
      link.click();
      setTimeout(function () { try { link.remove(); } catch (_) {} }, 500);
      toast('📤 已导出 ' + rows.length + ' 条存档（CSV）');
    };
    var exportXlsx = function (XLSX) {
      try {
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 20 }, { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }];
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '商议单存档');
        XLSX.writeFile(wb, fname);
        toast('📤 已导出 ' + rows.length + ' 条存档（Excel）');
      } catch (e) { exportCsvFallback(); }
    };

    // xlsx 按需懒加载（P3-0930）：新版 app.js 点击时才拉取 838KB 库；
    // 兼容旧版 app.js（无加载器但已在首屏预载全局 XLSX）；两者皆无 → 降级 CSV。
    var xlsxReady;
    if (typeof window.__qaEnsureXlsx === 'function') {
      toast('⏳ 正在准备 Excel 组件…', 'info', 1200);
      xlsxReady = window.__qaEnsureXlsx();
    } else if (typeof XLSX !== 'undefined' && XLSX && typeof XLSX.writeFile === 'function') {
      xlsxReady = Promise.resolve(XLSX);
    } else {
      xlsxReady = Promise.reject(new Error('xlsx-not-loaded'));
    }
    xlsxReady.then(exportXlsx).catch(exportCsvFallback);
  }

  function renderArchiveList(container, archives) {
    archiveCache = archives || [];
    if (!archives || !archives.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999;font-size:.88rem;">📭 暂无存档记录<br><span style="font-size:.78rem;">保存商议单模板或打印后会自动归档</span></div>';
      return;
    }
    var h = '<div style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      + '<input id="ngArchSearch" placeholder="🔍 搜索演员/编号/日期…" style="padding:8px 14px;border:1.5px solid var(--border-light,#e5e7eb);border-radius:8px;font-size:.85rem;flex:1;min-width:180px;">'
      + '<span style="font-size:.78rem;color:#888;">共 ' + archives.length + ' 条存档</span>'
      + '<button type="button" id="ngBtnArchExport" style="padding:6px 14px;border:1px solid #16a34a;background:#f0fdf4;color:#16a34a;border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:600;">📤 导出Excel</button>'
      + '</div>'
      + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.85rem;">'
      + '<thead><tr style="background:linear-gradient(135deg,#8b0000,#a52a2a);color:#fff;">'
      + '<th style="padding:9px 10px;text-align:left;">演员</th><th style="padding:9px 10px;">编号</th><th style="padding:9px 10px;">等级</th>'
      + '<th style="padding:9px 10px;">天工资</th><th style="padding:9px 10px;">存档时间</th><th style="padding:9px 10px;">操作</th>'
      + '</tr></thead><tbody>';
    archives.forEach(function (a) {
      var s = a.snapshot || {};
      var kid = a.key + '|' + a.index;
      var name = s.partyB && s.partyB.name ? s.partyB.name : '—';
      var no = s.docNo || '—';
      var grade = s._matchedGrade ? escHtml(s._matchedGrade.code + '级 ' + (s._matchedGrade.name || '')) : '—';
      var rate = s._matchedGrade ? '¥' + escHtml(s._matchedGrade.dailyRate || '') + '/天' : '—';
      var time = s._savedAt ? new Date(s._savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
      h += '<tr style="border-bottom:1px solid #eee;" data-arch-row data-arch-name="' + escAttr(name) + '" data-arch-no="' + escAttr(no) + '" data-arch-time="' + escAttr(time) + '">'
        + '<td style="padding:8px 10px;">' + escHtml(name) + '</td>'
        + '<td style="padding:8px 10px;text-align:center;color:#666;">' + escHtml(no) + '</td>'
        + '<td style="padding:8px 10px;text-align:center;">' + grade + '</td>'
        + '<td style="padding:8px 10px;text-align:center;color:#8b0000;font-weight:600;">' + rate + '</td>'
        + '<td style="padding:8px 10px;text-align:center;color:#888;font-size:.78rem;">' + escHtml(time) + '</td>'
        + '<td style="padding:8px 10px;text-align:center;white-space:nowrap;">'
        + '<button type="button" data-ng-arch-view="' + escAttr(kid) + '" style="padding:4px 10px;border:1px solid #c9a962;background:#fffdf6;color:#8a6d3b;border-radius:5px;font-size:.78rem;cursor:pointer;margin-right:4px;">查看</button>'
        + '<button type="button" data-ng-arch-print="' + escAttr(kid) + '" style="padding:4px 10px;border:1px solid #16a34a;background:#f0fdf4;color:#16a34a;border-radius:5px;font-size:.78rem;cursor:pointer;margin-right:4px;">打印</button>'
        + '<button type="button" data-ng-arch-del="' + escAttr(kid) + '" style="padding:4px 10px;border:1px solid #dc2626;background:#fee2e2;color:#dc2626;border-radius:5px;font-size:.78rem;cursor:pointer;">删除</button>'
        + '</td></tr>';
    });
    h += '</tbody></table></div>';
    container.innerHTML = h;

    // 动态按钮打全套防劫持标记（innerHTML 重建后必须重打）
    var expBtn = $('ngBtnArchExport');
    if (expBtn) { expBtn.__superPatchBound = 1; expBtn.__ts3Done = 1; expBtn.__bindDone = 1; expBtn.__ctE2Done = 1; expBtn.__deadBtnChecked = 1; expBtn.__ngBound = 1; }

    // 绑定搜索
    var searchEl = $('ngArchSearch');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var kw = searchEl.value.trim().toLowerCase();
        container.querySelectorAll('[data-arch-row]').forEach(function (tr) {
          var name = (tr.getAttribute('data-arch-name') || '').toLowerCase();
          var no = (tr.getAttribute('data-arch-no') || '').toLowerCase();
          var time = (tr.getAttribute('data-arch-time') || '').toLowerCase();
          var match = !kw || name.includes(kw) || no.includes(kw) || time.includes(kw);
          tr.style.display = match ? '' : 'none';
        });
      });
    }
  }

  function parseKid(kid) {
    var parts = String(kid || '').split('|');
    return { key: parts[0], index: Number(parts[1]) };
  }

  function fetchArchiveList(key) {
    var A = window.QAXQJT_API;
    return A.get('/v1/system/settings/key/' + key, { showErrorToast: false, timeoutMs: 8000 })
      .then(function (row) {
        if (!row || !row.value) return [];
        var list;
        try { list = JSON.parse(row.value); } catch (_) { return []; }
        return Array.isArray(list) ? list : [];
      });
  }

  function viewArchive(kid) {
    var A = window.QAXQJT_API;
    if (!A) { toast('API 未就绪', 'error'); return; }
    var k = parseKid(kid);
    fetchArchiveList(k.key)
      .then(function (list) {
        var snap = (k.index >= 0 && k.index < list.length) ? list[k.index] : list[list.length - 1];
        if (!snap) { toast('存档不存在或已删除', 'error'); return; }
        openArchivePreview(snap);
      })
      .catch(function () { toast('加载存档失败', 'error'); });
  }

  function openArchivePreview(snapshot) {
    var saved = tpl;
    var cloned;
    try { cloned = JSON.parse(JSON.stringify(snapshot)); } catch (_) { cloned = snapshot; }
    tpl = mergeDefaults(cloned);
    renderSheet();
    tpl = saved; // 渲染完成后立即恢复编辑中的模板
    $('ngPreviewMask').style.display = 'block';
  }

  function printArchive(kid) {
    var A = window.QAXQJT_API;
    if (!A) { toast('API 未就绪', 'error'); return; }
    var k = parseKid(kid);
    fetchArchiveList(k.key)
      .then(function (list) {
        var snap = (k.index >= 0 && k.index < list.length) ? list[k.index] : list[list.length - 1];
        if (!snap) { toast('存档不存在或已删除', 'error'); return; }
        openArchivePreview(snap);
        setTimeout(function () {
          try { window.print(); } catch (_) { toast('请用 Ctrl+P 打印', 'warning'); }
        }, 400);
      })
      .catch(function () { toast('加载存档失败', 'error'); });
  }

  function delArchive(btn) {
    var kid = btn.getAttribute('data-ng-arch-del');
    // 二次确认
    if (!btn.getAttribute('data-armed')) {
      btn.setAttribute('data-armed', '1');
      btn.textContent = '再点确认';
      btn.style.background = '#dc2626';
      btn.style.color = '#fff';
      setTimeout(function () {
        if (btn.isConnected) {
          btn.removeAttribute('data-armed');
          btn.textContent = '删除';
          btn.style.background = '';
          btn.style.color = '';
        }
      }, 3000);
      return;
    }
    var A = window.QAXQJT_API;
    if (!A) { toast('API 未就绪', 'error'); return; }
    var k = parseKid(kid);
    fetchArchiveList(k.key)
      .then(function (list) {
        if (k.index >= 0 && k.index < list.length) list.splice(k.index, 1);
        else list.pop();
        return saveSettingValue(k.key, JSON.stringify(list), 'wage_negotiate_archive', '天工资商议单存档');
      })
      .then(function () {
        toast('存档已删除', 'success');
        refreshArchiveList();
      })
      .catch(function () { toast('删除失败', 'error'); });
  }

  /* ---------------- 存档子Tab ---------------- */
  function initArchiveTab() {
    if (!$('wtab-archive')) return;
    refreshArchiveList();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var panel = $('wtab-negotiate');
    if (!panel) return;
    injectCss();
    renderEditor();
    loadFromServer();
    initArchiveTab();
    // 拉取花名册演员，填充乙方下拉选择
    fetchPerformers().then(function (list) {
      performerCache = list || [];
      renderEditor(); // 重渲染带出下拉选项
    });
    // 切到「存档」子Tab时刷新列表
    document.querySelectorAll('.wage-sub-tab[data-wtab="archive"]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(refreshArchiveList, 60); });
    });

    // 关键：window capture 先于 document 上的全局补丁执行
    window.addEventListener('click', onGlobalClick, true);
    $('ngPreviewMask').addEventListener('click', function (e) { if (e.target === $('ngPreviewMask')) closePreview(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('ngPreviewMask').style.display === 'block') closePreview();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
