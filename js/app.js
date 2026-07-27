/**
 * app.js - 秦安县秦剧团云端预约系统主业务逻辑
 *
 * 功能模块：
 * 1. 阶梯优惠计算引擎
 * 2. 预约表单验证与提交
 * 3. 导航栏移动端交互
 * 4. 平滑滚动与页面通用交互
 * 5. localStorage 数据持久化（预约、订单、用户）
 * 6. 后台管理通用增删改查（CRUD）模拟
 */

(function (global) {
  'use strict';

  // ============================================================
  // 模块 0: 通用工具函数 Utils
  // ============================================================
  var Utils = {
    /**
     * 格式化日期 YYYY-MM-DD
     */
    formatDate: function (date) {
      var d = (date instanceof Date) ? date : new Date(date);
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    },

    /**
     * 格式化金额（保留2位小数，千分位）
     */
    formatMoney: function (num) {
      var n = Number(num) || 0;
      return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    /**
     * 生成唯一ID
     */
    generateId: function (prefix) {
      var p = prefix || 'id';
      var ts = Date.now().toString(36);
      var rnd = Math.random().toString(36).substring(2, 8);
      return p + '_' + ts + '_' + rnd;
    },

    /**
     * 防抖动
     */
    debounce: function (fn, delay) {
      var timer = null;
      return function () {
        var ctx = this;
        var args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(ctx, args);
        }, delay || 300);
      };
    },

    /**
     * 防节流
     */
    throttle: function (fn, delay) {
      var last = 0;
      return function () {
        var now = Date.now();
        if (now - last >= (delay || 300)) {
          last = now;
          fn.apply(this, arguments);
        }
      };
    },

    /**
     * HTML 转义（防XSS）
     */
    escapeHtml: function (str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /**
     * 验证手机号（中国大陆）
     */
    isPhone: function (phone) {
      return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
    },

    /**
     * 验证邮箱
     */
    isEmail: function (email) {
      return /^[\w.-]+@[\w-]+\.[\w.-]+$/.test(String(email || '').trim());
    },

    /**
     * 验证身份证号（简版）
     */
    isIdCard: function (idCard) {
      return /^\d{17}[\dXx]$/.test(String(idCard || '').trim());
    },

    /**
     * Toast 轻提示
     */
    toast: function (msg, type) {
      var t = type || 'info';
      var colors = {
        info: '#2563eb',
        success: '#16a34a',
        warn: '#d97706',
        error: '#dc2626'
      };
      var bg = colors[t] || colors.info;

      var el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = [
        'position:fixed',
        'top:32px',
        'left:50%',
        'transform:translateX(-50%)',
        'background:' + bg,
        'color:#fff',
        'padding:10px 20px',
        'border-radius:6px',
        'font-size:14px',
        'z-index:99999',
        'box-shadow:0 4px 12px rgba(0,0,0,.15)',
        'opacity:0',
        'transition:opacity .3s, top .3s'
      ].join(';');

      document.body.appendChild(el);
      requestAnimationFrame(function () {
        el.style.opacity = '1';
        el.style.top = '52px';
      });

      setTimeout(function () {
        el.style.opacity = '0';
        el.style.top = '32px';
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
      }, 2200);
    },

    /**
     * 确认对话框（简单同步版）
     */
    confirm: function (msg) {
      return window.confirm(msg);
    },

    /**
     * 深拷贝（简单对象）
     */
    deepClone: function (obj) {
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        return obj;
      }
    }
  };

  // ============================================================
  // 模块 1: 阶梯优惠计算引擎 PricingEngine
  // ============================================================
  var PricingEngine = {
    /**
     * 标准单场定价（可根据实际业务调整）
     */
    STANDARD_PRICE_PER_SHOW: 6800,

    /**
     * 杂费标准（交通费、设备费等）
     */
    MISCELLANEOUS_FEE: 1200,

    /**
     * 阶梯配置
     */
    TIERS: [
      {
        min: 1, max: 3,
        name: '基础档',
        discount: 1.0,
        waiveMisc: false,
        priority: false,
        exclusive: false,
        desc: '标准定价，无折扣'
      },
      {
        min: 4, max: 8,
        name: '合作档',
        discount: 0.9,
        waiveMisc: true,
        priority: false,
        exclusive: false,
        desc: '9折优惠 + 杂费全免'
      },
      {
        min: 9, max: Infinity,
        name: '战略档',
        discount: 0.8,
        waiveMisc: true,
        priority: true,
        exclusive: true,
        desc: '8折 + 优先排期 + 专属对接'
      }
    ],

    /**
     * 根据场次获取对应阶梯
     */
    getTier: function (shows) {
      var n = parseInt(shows, 10) || 0;
      for (var i = 0; i < this.TIERS.length; i++) {
        if (n >= this.TIERS[i].min && n <= this.TIERS[i].max) {
          return this.TIERS[i];
        }
      }
      return this.TIERS[0];
    },

    /**
     * 计算完整价格方案
     * @param {number} shows 场次
     * @param {number} customPrice 自定义单场价格（可选）
     * @returns {Object}
     */
    calculate: function (shows, customPrice) {
      var n = Math.max(1, parseInt(shows, 10) || 1);
      var pricePerShow = Number(customPrice) || this.STANDARD_PRICE_PER_SHOW;
      var tier = this.getTier(n);

      var standardTotal = n * pricePerShow;
      var miscFee = tier.waiveMisc ? 0 : this.MISCELLANEOUS_FEE;
      var discountAmount = standardTotal * (1 - tier.discount);
      var discountedTotal = standardTotal - discountAmount;
      var finalTotal = discountedTotal + miscFee;
      var savedAmount = standardTotal + this.MISCELLANEOUS_FEE - finalTotal;

      return {
        shows: n,
        tier: {
          name: tier.name,
          discount: tier.discount,
          discountText: (tier.discount * 10).toFixed(1) + '折',
          waiveMisc: tier.waiveMisc,
          priority: tier.priority,
          exclusive: tier.exclusive,
          desc: tier.desc
        },
        pricePerShow: pricePerShow,
        standardTotal: standardTotal,
        miscFee: miscFee,
        miscFeeText: tier.waiveMisc ? '已减免' : Utils.formatMoney(miscFee),
        discountAmount: discountAmount,
        discountedTotal: discountedTotal,
        finalTotal: finalTotal,
        savedAmount: Math.max(0, savedAmount),
        breakdown: [
          { label: '场次', value: n + ' 场' },
          { label: '单场标准价', value: '¥' + Utils.formatMoney(pricePerShow) },
          { label: '标准总价', value: '¥' + Utils.formatMoney(standardTotal) },
          { label: '阶梯折扣', value: tier.discountText + ' (-¥' + Utils.formatMoney(discountAmount) + ')' },
          { label: '杂费', value: tier.waiveMisc ? '¥0.00 (' + tier.name + '减免)' : '¥' + Utils.formatMoney(miscFee) },
          { label: '最终合计', value: '¥' + Utils.formatMoney(finalTotal), highlight: true }
        ]
      };
    },

    /**
     * 获取全部阶梯说明（用于展示）
     */
    getAllTiers: function () {
      return this.TIERS.map(function (t) {
        return {
          range: t.max === Infinity ? (t.min + '+ 场') : (t.min + '-' + t.max + ' 场'),
          name: t.name,
          discountText: (t.discount * 10).toFixed(1) + '折',
          waiveMisc: t.waiveMisc,
          priority: t.priority,
          exclusive: t.exclusive,
          desc: t.desc
        };
      });
    }
  };

  // ============================================================
  // 模块 2: 数据持久化 Storage（基于 localStorage）
  // ============================================================
  var Storage = {
    PREFIX: 'qaxqjt_',

    KEYS: {
      APPOINTMENTS: 'appointments',
      ORDERS: 'orders',
      USERS: 'users',
      PLAYS: 'plays',
      ADMIN: 'admin_session',
      SETTINGS: 'settings'
    },

    _get: function (key) {
      try {
        var raw = localStorage.getItem(this.PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.error('[Storage] 读取失败', key, e);
        return null;
      }
    },

    _set: function (key, value) {
      try {
        localStorage.setItem(this.PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('[Storage] 写入失败', key, e);
        return false;
      }
    },

    /**
     * 通用 CRUD: 查询列表
     */
    list: function (key, filters) {
      var data = this._get(key) || [];
      if (!filters || Object.keys(filters).length === 0) {
        return data;
      }
      return data.filter(function (item) {
        for (var k in filters) {
          if (filters.hasOwnProperty(k)) {
            if (item[k] != filters[k]) return false;
          }
        }
        return true;
      });
    },

    /**
     * 通用 CRUD: 根据ID查询单条
     */
    get: function (key, id) {
      var data = this._get(key) || [];
      for (var i = 0; i < data.length; i++) {
        if (data[i].id === id) return data[i];
      }
      return null;
    },

    /**
     * 通用 CRUD: 新增
     */
    create: function (key, record) {
      var data = this._get(key) || [];
      var now = new Date().toISOString();
      var newRecord = Utils.deepClone(record);
      if (!newRecord.id) {
        newRecord.id = Utils.generateId(key);
      }
      newRecord.createdAt = newRecord.createdAt || now;
      newRecord.updatedAt = now;
      data.unshift(newRecord);
      this._set(key, data);
      return newRecord;
    },

    /**
     * 通用 CRUD: 更新
     */
    update: function (key, id, patch) {
      var data = this._get(key) || [];
      for (var i = 0; i < data.length; i++) {
        if (data[i].id === id) {
          data[i] = Object.assign({}, data[i], Utils.deepClone(patch));
          data[i].updatedAt = new Date().toISOString();
          this._set(key, data);
          return data[i];
        }
      }
      return null;
    },

    /**
     * 通用 CRUD: 删除
     */
    remove: function (key, id) {
      var data = this._get(key) || [];
      for (var i = 0; i < data.length; i++) {
        if (data[i].id === id) {
          var removed = data.splice(i, 1)[0];
          this._set(key, data);
          return removed;
        }
      }
      return null;
    },

    /**
     * 清空某集合
     */
    clear: function (key) {
      return this._set(key, []);
    },

    /**
     * 批量初始化演示数据
     */
    seedDemoData: function () {
      if (this._get(this.KEYS.PLAYS)) return;

      var plays = [
        { id: 'play_001', name: '《周仁回府》', category: '传统本戏', duration: '160分钟', synopsis: '经典秦腔传统剧目，讲述周仁为救盟兄之妻，献妻于贼的忠义故事。' },
        { id: 'play_002', name: '《三滴血》', category: '传统本戏', duration: '180分钟', synopsis: '范紫东代表作，讲述晋信书以滴血认亲之法断案的故事。' },
        { id: 'play_003', name: '《铡美案》', category: '传统本戏', duration: '150分钟', synopsis: '包拯怒铡陈世美，伸张正义的经典故事。' },
        { id: 'play_004', name: '《窦娥冤》', category: '传统本戏', duration: '170分钟', synopsis: '关汉卿名作，窦娥蒙冤感天动地的悲剧。' },
        { id: 'play_005', name: '《火焰驹》', category: '传统本戏', duration: '155分钟', synopsis: '李彦荣与黄桂英的爱情故事，以马踏火焰驹闻名。' }
      ];
      this._set(this.KEYS.PLAYS, plays);

      var sampleAppointments = [
        {
          id: Utils.generateId('apt'),
          customerName: '王建国',
          phone: '13909380001',
          organization: '兴国镇文化站',
          shows: 5,
          selectedPlays: ['play_001', 'play_003'],
          preferredStartDate: '2026-09-15',
          venue: '兴国镇文化广场',
          remarks: '请提前3天搭台',
          status: 'pending',
          createdAt: '2026-07-20T10:30:00.000Z',
          updatedAt: '2026-07-20T10:30:00.000Z'
        }
      ];
      this._set(this.KEYS.APPOINTMENTS, sampleAppointments);

      this._set(this.KEYS.ORDERS, []);
      this._set(this.KEYS.USERS, [
        { id: 'user_001', username: 'admin', password: 'admin123', role: 'admin', name: '系统管理员' }
      ]);
    }
  };

  // ============================================================
  // 模块 3: 预约表单 FormValidator
  // ============================================================
  var FormValidator = {
    /**
     * 校验预约表单
     * @param {Object} data 表单数据
     * @returns {Object} { valid: bool, errors: { field: msg } }
     */
    validateAppointment: function (data) {
      var errors = {};

      if (!data.customerName || !data.customerName.trim()) {
        errors.customerName = '请填写联系人姓名';
      } else if (data.customerName.trim().length < 2) {
        errors.customerName = '姓名至少2个字符';
      }

      if (!data.phone || !data.phone.trim()) {
        errors.phone = '请填写联系电话';
      } else if (!Utils.isPhone(data.phone)) {
        errors.phone = '请输入正确的手机号';
      }

      if (!data.organization || !data.organization.trim()) {
        errors.organization = '请填写单位/组织名称';
      }

      var shows = parseInt(data.shows, 10);
      if (!shows || isNaN(shows)) {
        errors.shows = '请填写预约场次';
      } else if (shows < 1) {
        errors.shows = '场次至少1场';
      } else if (shows > 100) {
        errors.shows = '单次预约不超过100场';
      }

      if (!data.preferredStartDate || !data.preferredStartDate.trim()) {
        errors.preferredStartDate = '请选择首选演出日期';
      } else {
        var date = new Date(data.preferredStartDate);
        if (isNaN(date.getTime())) {
          errors.preferredStartDate = '日期格式不正确';
        } else {
          var today = new Date();
          today.setHours(0, 0, 0, 0);
          if (date < today) {
            errors.preferredStartDate = '演出日期不能早于今天';
          }
        }
      }

      if (!data.venue || !data.venue.trim()) {
        errors.venue = '请填写演出地点';
      }

      if (data.email && data.email.trim() && !Utils.isEmail(data.email)) {
        errors.email = '邮箱格式不正确';
      }

      if (data.idCard && data.idCard.trim() && !Utils.isIdCard(data.idCard)) {
        errors.idCard = '身份证号格式不正确';
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors: errors
      };
    },

    /**
     * 在页面上渲染错误提示
     * @param {HTMLElement} form 表单元素
     * @param {Object} errors 错误对象
     */
    renderErrors: function (form, errors) {
      var errorBox = form.querySelector('[data-form-errors]');
      if (errorBox) {
        if (Object.keys(errors).length === 0) {
          errorBox.innerHTML = '';
          errorBox.style.display = 'none';
        } else {
          var html = '<ul style="margin:0;padding-left:20px;color:#dc2626;font-size:13px;line-height:1.8;">';
          for (var f in errors) {
            if (errors.hasOwnProperty(f)) {
              html += '<li>' + Utils.escapeHtml(errors[f]) + '</li>';
            }
          }
          html += '</ul>';
          errorBox.innerHTML = html;
          errorBox.style.display = 'block';
        }
      }

      var fields = form.querySelectorAll('[data-field]');
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var name = field.getAttribute('data-field');
        var input = field.querySelector('input, select, textarea');
        if (errors[name]) {
          field.classList.add('field-error');
          if (input) input.setAttribute('aria-invalid', 'true');
          var tip = field.querySelector('.field-error-tip');
          if (tip) tip.textContent = errors[name];
        } else {
          field.classList.remove('field-error');
          if (input) input.removeAttribute('aria-invalid');
          var tip2 = field.querySelector('.field-error-tip');
          if (tip2) tip2.textContent = '';
        }
      }
    },

    /**
     * 处理预约表单提交
     */
    submitAppointment: function (form) {
      var formData = new FormData(form);
      var data = {};
      formData.forEach(function (val, key) {
        if (key === 'selectedPlays') {
          if (!data.selectedPlays) data.selectedPlays = [];
          data.selectedPlays.push(val);
        } else {
          data[key] = val;
        }
      });

      var selectedPlaysCB = form.querySelectorAll('input[name="selectedPlays"]:checked');
      if (selectedPlaysCB.length > 0 && !data.selectedPlays) {
        data.selectedPlays = [];
        for (var i = 0; i < selectedPlaysCB.length; i++) {
          data.selectedPlays.push(selectedPlaysCB[i].value);
        }
      }

      var result = this.validateAppointment(data);
      this.renderErrors(form, result.errors);

      if (!result.valid) {
        Utils.toast('请检查表单填写', 'warn');
        return null;
      }

      var pricing = PricingEngine.calculate(data.shows);

      var appointment = {
        customerName: data.customerName.trim(),
        phone: data.phone.trim(),
        organization: data.organization.trim(),
        shows: parseInt(data.shows, 10),
        selectedPlays: data.selectedPlays || [],
        preferredStartDate: data.preferredStartDate,
        venue: data.venue.trim(),
        email: data.email ? data.email.trim() : '',
        idCard: data.idCard ? data.idCard.trim() : '',
        remarks: data.remarks ? data.remarks.trim() : '',
        pricing: pricing,
        status: 'pending',
        statusText: '待审核'
      };

      var saved = Storage.create(Storage.KEYS.APPOINTMENTS, appointment);
      Utils.toast('预约提交成功！我们将在24小时内与您联系', 'success');
      form.reset();

      var pricingDetail = document.querySelector('[data-pricing-detail]');
      if (pricingDetail) pricingDetail.innerHTML = '';

      return saved;
    }
  };

  // ============================================================
  // 模块 4: 导航栏交互 NavBar
  // ============================================================
  var NavBar = {
    init: function () {
      var toggle = document.querySelector('[data-nav-toggle]');
      var menu = document.querySelector('[data-nav-menu]');

      if (!toggle || !menu) return;

      toggle.addEventListener('click', function () {
        var isOpen = menu.classList.toggle('nav-open');
        toggle.classList.toggle('nav-active', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        menu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        document.body.classList.toggle('nav-locked', isOpen);
      });

      var links = menu.querySelectorAll('a[href^="#"]');
      for (var i = 0; i < links.length; i++) {
        links[i].addEventListener('click', function () {
          if (menu.classList.contains('nav-open')) {
            menu.classList.remove('nav-open');
            toggle.classList.remove('nav-active');
            toggle.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('nav-locked');
          }
        });
      }

      var header = document.querySelector('[data-header]');
      if (header) {
        var onScroll = Utils.throttle(function () {
          if (window.scrollY > 20) {
            header.classList.add('header-scrolled');
          } else {
            header.classList.remove('header-scrolled');
          }
        }, 100);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      }
    }
  };

  // ============================================================
  // 模块 5: 平滑滚动与页面通用交互 SmoothScroll & UI
  // ============================================================
  var PageUI = {
    init: function () {
      this.initSmoothScroll();
      this.initBackToTop();
      this.initRevealOnScroll();
      this.initAccordion();
      this.initTabs();
      this.initPricePreview();
      this.initAppointmentForm();
    },

    /**
     * 平滑滚动到锚点
     */
    initSmoothScroll: function () {
      document.addEventListener('click', function (e) {
        var a = e.target.closest('a[href^="#"]');
        if (!a) return;
        var id = a.getAttribute('href');
        if (id.length < 2 || id === '#') return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();

        var headerH = document.querySelector('[data-header]')
          ? document.querySelector('[data-header]').offsetHeight
          : 0;
        var top = target.getBoundingClientRect().top + window.scrollY - headerH - 10;

        window.scrollTo({
          top: Math.max(0, top),
          behavior: 'smooth'
        });
      });
    },

    /**
     * 返回顶部按钮
     */
    initBackToTop: function () {
      var btn = document.querySelector('[data-back-to-top]');
      if (!btn) return;

      var onScroll = Utils.throttle(function () {
        btn.style.display = window.scrollY > 400 ? 'block' : 'none';
      }, 200);
      window.addEventListener('scroll', onScroll, { passive: true });

      btn.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    },

    /**
     * 滚动时元素渐入
     */
    initRevealOnScroll: function () {
      var items = document.querySelectorAll('[data-reveal]');
      if (items.length === 0) return;

      if (!('IntersectionObserver' in window)) {
        for (var i = 0; i < items.length; i++) {
          items[i].style.opacity = '1';
          items[i].style.transform = 'none';
        }
        return;
      }

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });

      for (var j = 0; j < items.length; j++) {
        observer.observe(items[j]);
      }
    },

    /**
     * 手风琴折叠
     */
    initAccordion: function () {
      var accs = document.querySelectorAll('[data-accordion]');
      for (var i = 0; i < accs.length; i++) {
        var headers = accs[i].querySelectorAll('[data-acc-header]');
        for (var j = 0; j < headers.length; j++) {
          headers[j].addEventListener('click', function () {
            var item = this.closest('[data-acc-item]');
            if (!item) return;
            var isOpen = item.classList.toggle('acc-open');
            var body = item.querySelector('[data-acc-body]');
            if (body) {
              body.style.maxHeight = isOpen ? body.scrollHeight + 'px' : '0';
            }
          });
        }
      }
    },

    /**
     * 标签页切换
     */
    initTabs: function () {
      var groups = document.querySelectorAll('[data-tabs]');
      for (var i = 0; i < groups.length; i++) {
        (function (group) {
          var btns = group.querySelectorAll('[data-tab-btn]');
          var panels = group.querySelectorAll('[data-tab-panel]');

          for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
              var key = this.getAttribute('data-tab-btn');
              for (var b = 0; b < btns.length; b++) {
                btns[b].classList.toggle('active', btns[b].getAttribute('data-tab-btn') === key);
              }
              for (var p = 0; p < panels.length; p++) {
                panels[p].classList.toggle('active', panels[p].getAttribute('data-tab-panel') === key);
              }
            });
          }
        })(groups[i]);
      }
    },

    /**
     * 实时价格预览（联动场次输入）
     */
    initPricePreview: function () {
      var showInput = document.querySelector('[data-shows-input]');
      var previewBox = document.querySelector('[data-pricing-detail]');
      if (!showInput || !previewBox) return;

      var render = function () {
        var shows = parseInt(showInput.value, 10) || 1;
        var pricing = PricingEngine.calculate(shows);
        var html = '';
        html += '<div style="margin-bottom:12px;">';
        html +=   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html +=     '<span style="font-weight:600;">优惠档次：</span>';
        html +=     '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 10px;border-radius:12px;font-size:12px;">' + Utils.escapeHtml(pricing.tier.name) + ' · ' + pricing.tier.discountText + '</span>';
        html +=   '</div>';
        html +=   '<div style="font-size:13px;color:#475569;">' + Utils.escapeHtml(pricing.tier.desc);
        if (pricing.tier.priority) html += ' ✓ 优先排期';
        if (pricing.tier.exclusive) html += ' ✓ 专属对接人';
        html +=   '</div>';
        html += '</div>';
        html += '<table style="width:100%;font-size:14px;border-collapse:collapse;">';
        for (var i = 0; i < pricing.breakdown.length; i++) {
          var row = pricing.breakdown[i];
          var hl = row.highlight ? 'font-weight:700;color:#b91c1c;font-size:16px;border-top:2px dashed #e2e8f0;' : '';
          html += '<tr>';
          html +=   '<td style="padding:6px 4px;' + hl + '">' + Utils.escapeHtml(row.label) + '</td>';
          html +=   '<td style="padding:6px 4px;text-align:right;' + hl + '">' + Utils.escapeHtml(row.value) + '</td>';
          html += '</tr>';
        }
        html += '</table>';
        if (pricing.savedAmount > 0) {
          html += '<div style="margin-top:10px;padding:8px 12px;background:#f0fdf4;color:#166534;border-radius:6px;font-size:13px;">';
          html +=   '🎉 本单累计节省 <strong>¥' + Utils.formatMoney(pricing.savedAmount) + '</strong>';
          html += '</div>';
        }
        previewBox.innerHTML = html;
      };

      showInput.addEventListener('input', Utils.debounce(render, 100));
      if (showInput.value) render();
    },

    /**
     * 绑定预约表单提交
     */
    initAppointmentForm: function () {
      var form = document.querySelector('[data-appointment-form]');
      if (!form) return;

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        FormValidator.submitAppointment(form);
      });

      form.addEventListener('reset', function () {
        var errorBox = form.querySelector('[data-form-errors]');
        if (errorBox) {
          errorBox.innerHTML = '';
          errorBox.style.display = 'none';
        }
        var fields = form.querySelectorAll('.field-error');
        for (var i = 0; i < fields.length; i++) {
          fields[i].classList.remove('field-error');
        }
      });
    }
  };

  // ============================================================
  // 模块 6: 后台管理通用 CRUD AdminCRUD
  // ============================================================
  var AdminCRUD = {
    currentUser: null,

    /**
     * 管理员登录（模拟）
     */
    login: function (username, password) {
      var users = Storage.list(Storage.KEYS.USERS, { role: 'admin' });
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === username && users[i].password === password) {
          this.currentUser = { id: users[i].id, name: users[i].name, username: users[i].username };
          Storage._set(Storage.KEYS.ADMIN, this.currentUser);
          return this.currentUser;
        }
      }
      return null;
    },

    /**
     * 退出登录
     */
    logout: function () {
      this.currentUser = null;
      localStorage.removeItem(Storage.PREFIX + Storage.KEYS.ADMIN);
    },

    /**
     * 检查登录状态
     */
    checkAuth: function () {
      if (this.currentUser) return this.currentUser;
      var saved = Storage._get(Storage.KEYS.ADMIN);
      if (saved) {
        this.currentUser = saved;
        return saved;
      }
      return null;
    },

    /**
     * 获取预约列表（带状态筛选和分页）
     */
    getAppointments: function (filter, page, pageSize) {
      var data = Storage.list(Storage.KEYS.APPOINTMENTS);
      filter = filter || {};

      if (filter.status) {
        data = data.filter(function (d) { return d.status === filter.status; });
      }
      if (filter.keyword) {
        var kw = String(filter.keyword).toLowerCase();
        data = data.filter(function (d) {
          return (d.customerName || '').toLowerCase().indexOf(kw) > -1 ||
                 (d.phone || '').toLowerCase().indexOf(kw) > -1 ||
                 (d.organization || '').toLowerCase().indexOf(kw) > -1;
        });
      }

      data.sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      var total = data.length;
      var pg = Math.max(1, parseInt(page, 10) || 1);
      var ps = Math.max(1, parseInt(pageSize, 10) || 10);
      var start = (pg - 1) * ps;

      return {
        list: data.slice(start, start + ps),
        total: total,
        page: pg,
        pageSize: ps,
        totalPages: Math.ceil(total / ps)
      };
    },

    /**
     * 更新预约状态
     */
    updateAppointmentStatus: function (id, status) {
      var STATUS_MAP = {
        pending: '待审核',
        approved: '已确认',
        rejected: '已拒绝',
        paid: '已收款',
        completed: '已完成',
        cancelled: '已取消'
      };
      return Storage.update(Storage.KEYS.APPOINTMENTS, id, {
        status: status,
        statusText: STATUS_MAP[status] || status
      });
    },

    /**
     * 统计看板数据
     */
    getDashboardStats: function () {
      var appts = Storage.list(Storage.KEYS.APPOINTMENTS);
      var plays = Storage.list(Storage.KEYS.PLAYS);

      var totalAppts = appts.length;
      var pendingAppts = 0;
      var completedAppts = 0;
      var totalShows = 0;
      var totalRevenue = 0;

      for (var i = 0; i < appts.length; i++) {
        var a = appts[i];
        if (a.status === 'pending') pendingAppts++;
        if (a.status === 'completed') completedAppts++;
        totalShows += parseInt(a.shows, 10) || 0;
        if (a.pricing && a.pricing.finalTotal && (a.status === 'paid' || a.status === 'completed')) {
          totalRevenue += a.pricing.finalTotal;
        }
      }

      return {
        totalAppointments: totalAppts,
        pendingAppointments: pendingAppts,
        completedAppointments: completedAppts,
        totalShows: totalShows,
        totalRevenue: totalRevenue,
        totalPlays: plays.length,
        revenueText: '¥' + Utils.formatMoney(totalRevenue)
      };
    },

    /**
     * 通用：获取剧目列表
     */
    getPlays: function () {
      return Storage.list(Storage.KEYS.PLAYS);
    },

    createPlay: function (data) {
      if (!data.name) throw new Error('剧目名称必填');
      return Storage.create(Storage.KEYS.PLAYS, data);
    },

    updatePlay: function (id, data) {
      return Storage.update(Storage.KEYS.PLAYS, id, data);
    },

    deletePlay: function (id) {
      return Storage.remove(Storage.KEYS.PLAYS, id);
    },

    /**
     * 订单 CRUD
     */
    getOrders: function (filter) {
      var data = Storage.list(Storage.KEYS.ORDERS);
      filter = filter || {};
      if (filter.status) {
        data = data.filter(function (d) { return d.status === filter.status; });
      }
      return data;
    },

    createOrder: function (appointmentId) {
      var apt = Storage.get(Storage.KEYS.APPOINTMENTS, appointmentId);
      if (!apt) throw new Error('预约记录不存在');
      var order = {
        appointmentId: appointmentId,
        orderNo: 'QAX' + Date.now(),
        customerName: apt.customerName,
        phone: apt.phone,
        shows: apt.shows,
        amount: apt.pricing ? apt.pricing.finalTotal : 0,
        status: 'unpaid',
        statusText: '待付款'
      };
      var saved = Storage.create(Storage.KEYS.ORDERS, order);
      Storage.update(Storage.KEYS.APPOINTMENTS, appointmentId, { orderId: saved.id });
      return saved;
    },

    updateOrderStatus: function (id, status) {
      var STATUS = { unpaid: '待付款', paid: '已付款', refunded: '已退款' };
      return Storage.update(Storage.KEYS.ORDERS, id, {
        status: status,
        statusText: STATUS[status] || status
      });
    }
  };

  // ============================================================
  // 对外统一导出 API
  // ============================================================
  var App = {
    Utils: Utils,
    Pricing: PricingEngine,
    Storage: Storage,
    Form: FormValidator,
    Nav: NavBar,
    UI: PageUI,
    Admin: AdminCRUD,

    /**
     * 应用入口初始化
     */
    init: function () {
      Storage.seedDemoData();
      NavBar.init();
      PageUI.init();
    }
  };

  global.QinApp = App;
  global.Utils = Utils;
  global.Pricing = PricingEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { App.init(); }, { once: true });
    } else {
      App.init();
    }
  }

})(typeof window !== 'undefined' ? window : this);
