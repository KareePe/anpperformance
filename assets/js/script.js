// ANP Performance — page interactions
(function () {
  'use strict';

  /* ---------- AOS (animate on scroll, loaded from CDN) ---------- */
  var aosStarted = false;
  var startAOS = function () {
    if (aosStarted) return;
    aosStarted = true;
    if (!window.AOS) {
      // CDN blocked/offline: make sure [data-aos] content is still visible
      document.documentElement.classList.add('no-aos');
      return;
    }
    window.AOS.init({
      duration: 450,          // quick & punchy — it's a tuning shop
      easing: 'ease-out-quart',
      offset: 40,
      once: true,
      disable: function () {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    });
  };

  /* ---------- Preloader ---------- */
  var preloader = document.querySelector('.preloader');
  if (preloader) {
    var start = Date.now();
    var MIN_SHOW = 600; // ms — avoid a flash on fast connections

    var hide = function () {
      var wait = Math.max(0, MIN_SHOW - (Date.now() - start));
      setTimeout(function () {
        preloader.classList.add('is-done');
        startAOS(); // hero animates in as the preloader fades out
        setTimeout(function () { preloader.remove(); }, 600);
      }, wait);
    };

    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide, { once: true });
  } else {
    startAOS();
  }
  // safety net: never leave content hidden if the load event is very late
  setTimeout(startAOS, 8000);

  /* ---------- Hero random video playlist ---------- */
  // <div class="hero-playlist" data-playlist='[{"src":..,"o":"l|p"}]' data-mode="all|match">
  //   two <video class="hero-vid"> elements; one plays while the other buffers the next clip.
  // data-mode="match" plays only clips whose orientation matches the screen.
  var playlistEl = document.querySelector('.hero-playlist');
  if (playlistEl) {
    var clips = [];
    try { clips = JSON.parse(playlistEl.dataset.playlist || '[]'); } catch (e) { clips = []; }
    var players = playlistEl.querySelectorAll('.hero-vid');
    var motionOff = window.matchMedia('(prefers-reduced-motion: reduce)');
    var queue = [];
    var lastSrc = null;
    var active = 0;      // index into players
    var started = false;
    var inView = true;

    var pool = function () {
      if (playlistEl.dataset.mode !== 'match') return clips;
      var portrait = window.innerHeight > window.innerWidth;
      var fit = clips.filter(function (c) { return (c.o === 'p') === portrait; });
      return fit.length ? fit : clips;
    };

    // Fisher–Yates shuffle; never repeat the clip that just played
    var refill = function () {
      var list = pool().slice();
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      if (list.length > 1 && list[0].src === lastSrc) list.push(list.shift());
      queue = list;
    };

    var nextClip = function () {
      if (!queue.length) refill();
      var c = queue.shift();
      lastSrc = c.src;
      return c;
    };

    var safePlay = function (v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    };

    // Buffer the upcoming clip in the hidden player
    var prepare = function () {
      var v = players[1 - active];
      v.src = nextClip().src;
      v.preload = 'auto';
      v.load();
    };

    var swap = function () {
      var from = players[active];
      var to = players[1 - active];
      active = 1 - active;
      to.currentTime = 0;
      if (inView) safePlay(to);
      to.classList.add('is-active');
      from.classList.remove('is-active');
      setTimeout(function () { from.pause(); prepare(); }, 1000); // after the crossfade
    };

    Array.prototype.forEach.call(players, function (v) {
      v.addEventListener('ended', function () { if (v === players[active]) swap(); });
      v.addEventListener('error', function () {
        // broken clip: skip it
        if (v === players[active]) swap(); else prepare();
      });
    });

    var start = function () {
      if (started || !clips.length || motionOff.matches) return;
      if (!playlistEl.getClientRects().length || getComputedStyle(playlistEl).display === 'none') return;
      started = true;
      var first = players[active];
      first.src = nextClip().src;
      first.preload = 'auto';
      safePlay(first);
      first.addEventListener('playing', prepare, { once: true });
    };

    // Pause while the hero is scrolled out of view (saves CPU / battery)
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        var v = players[active];
        if (!started) { if (inView) start(); return; }
        if (inView) safePlay(v); else v.pause();
      }, { threshold: 0.05 }).observe(playlistEl);
    } else {
      start();
    }
    window.addEventListener('resize', start);
  }

  /* ---------- Random photo slideshow ---------- */
  // <div class="js-slideshow" data-images='["a.jpg", ...]' data-interval="4500">
  //   two <img class="slide">; the hidden one loads the next photo, then they crossfade.
  Array.prototype.forEach.call(document.querySelectorAll('.js-slideshow'), function (box) {
    var images = [];
    try { images = JSON.parse(box.dataset.images || '[]'); } catch (e) { images = []; }
    var slides = box.querySelectorAll('.slide');
    if (images.length < 2 || slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var interval = parseInt(box.dataset.interval, 10) || 4500;
    var active = 0;
    var current = slides[0].getAttribute('src');
    var queue = [];
    var timer = null;
    var visible = false;

    // shuffled pass through every image; never show the same photo twice in a row
    var next = function () {
      if (!queue.length) {
        queue = images.slice();
        for (var i = queue.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = queue[i]; queue[i] = queue[j]; queue[j] = t;
        }
      }
      var src = queue.shift();
      return src === current && queue.length ? (queue.push(src), queue.shift()) : src;
    };

    // "racing pass": direction alternates; random speed streaks fly across with it
    var fromRight = true;
    var lines = box.querySelector('.speed-lines');
    var raceTimer = null;

    var spawnStreaks = function () {
      if (!lines) return;
      lines.textContent = '';
      var n = 9 + Math.floor(Math.random() * 5);
      for (var i = 0; i < n; i++) {
        var st = document.createElement('span');
        st.className = 'streak' + (Math.random() < 0.2 ? ' streak--red' : '');
        st.style.setProperty('--y', (8 + Math.random() * 84).toFixed(1) + '%');
        st.style.setProperty('--w', (25 + Math.random() * 45).toFixed(0) + '%');
        st.style.setProperty('--h', (Math.random() < 0.3 ? 3 : 1.5) + 'px');
        st.style.setProperty('--d', (Math.random() * 0.2).toFixed(2) + 's');
        lines.appendChild(st);
      }
    };

    var show = function () {
      var from = slides[active];
      var to = slides[1 - active];
      var src = next();
      to.onload = function () {
        to.onload = null;
        active = 1 - active;
        current = src;

        box.classList.remove('race-r', 'race-l', 'is-racing');
        from.classList.remove('is-active');
        to.classList.remove('is-leaving');
        void box.offsetWidth; // restart CSS animations
        box.classList.add(fromRight ? 'race-r' : 'race-l', 'is-racing');
        fromRight = !fromRight;
        spawnStreaks();

        from.classList.add('is-leaving');
        to.classList.add('is-active');
        to.alt = from.alt; from.alt = '';
        to.removeAttribute('aria-hidden'); from.setAttribute('aria-hidden', 'true');

        clearTimeout(raceTimer);
        raceTimer = setTimeout(function () {
          from.classList.remove('is-leaving');
          box.classList.remove('is-racing');
          if (lines) lines.textContent = '';
        }, 750);
      };
      to.onerror = function () { to.onerror = null; show(); }; // skip broken image
      to.src = src;
    };

    var play = function () { if (!timer) timer = setInterval(show, interval); };
    var stop = function () { clearInterval(timer); timer = null; };

    // only run while on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) play(); else stop();
      }, { threshold: 0.1 }).observe(box);
    } else {
      play();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (visible) play();
    });
  });

  /* ---------- Sticky CTA bar ---------- */
  // Hidden while the hero (which has its own call / LINE buttons) is on screen,
  // slides up once the visitor has scrolled past it.
  var stickyBar = document.querySelector('.sticky-bar');
  var hero = document.getElementById('top');
  if (stickyBar && hero && 'IntersectionObserver' in window) {
    stickyBar.classList.add('is-hidden');
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      var passed = !e.isIntersecting && e.boundingClientRect.top < 0;
      stickyBar.classList.toggle('is-hidden', !passed);
    }).observe(hero);
  }

  /* ---------- Gallery lightbox ---------- */
  // Clicking a work photo opens <dialog id="lightbox"> with every image in assets/,
  // starting at the clicked one. Arrows / keyboard / swipe / thumbnails to navigate.
  var lb = document.getElementById('lightbox');
  if (lb && typeof lb.showModal === 'function') {
    var lbImages = [];
    try { lbImages = JSON.parse(lb.dataset.images || '[]'); } catch (e) { lbImages = []; }
    var base = lb.dataset.base || '';
    var thumbBase = lb.dataset.thumbs || base;
    var lbImg = lb.querySelector('.lb-img');
    var lbCount = lb.querySelector('.lb-count');
    var lbThumbs = lb.querySelector('.lb-thumbs');
    var lbStage = lb.querySelector('.lb-stage');
    var lbIndex = 0;
    var thumbsBuilt = false;
    var opener = null;

    var buildThumbs = function () {
      if (thumbsBuilt) return;
      thumbsBuilt = true;
      lbImages.forEach(function (name, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'lb-thumb';
        b.setAttribute('aria-label', 'รูปที่ ' + (i + 1));
        var t = document.createElement('img');
        t.src = thumbBase + name;
        t.alt = '';
        t.loading = 'lazy';
        b.appendChild(t);
        b.addEventListener('click', function () { go(i); });
        lbThumbs.appendChild(b);
      });
    };

    var preload = function (i) {
      var n = (i + lbImages.length) % lbImages.length;
      new Image().src = base + lbImages[n];
    };

    var go = function (i, dir) {
      var n = lbImages.length;
      if (!n) return;
      var next = (i + n) % n;
      if (dir === undefined) dir = next >= lbIndex ? 1 : -1;
      lbIndex = next;
      lbImg.classList.remove('lb-in-r', 'lb-in-l');
      void lbImg.offsetWidth; // restart animation
      lbImg.src = base + lbImages[lbIndex];
      lbImg.alt = 'ผลงาน ANP Performance รูปที่ ' + (lbIndex + 1);
      lbImg.classList.add(dir > 0 ? 'lb-in-r' : 'lb-in-l');
      lbCount.textContent = (lbIndex + 1) + ' / ' + n;
      Array.prototype.forEach.call(lbThumbs.children, function (b, j) {
        b.classList.toggle('is-current', j === lbIndex);
        if (j === lbIndex) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      });
      preload(lbIndex + 1);
      preload(lbIndex - 1);
    };

    var openLightbox = function (src, from) {
      buildThumbs();
      var name = (src || '').split('/').pop();
      var i = Math.max(0, lbImages.indexOf(name));
      opener = from || null;
      document.documentElement.classList.add('lb-open');
      lb.showModal();
      go(i, 1);
    };

    lb.addEventListener('close', function () {
      document.documentElement.classList.remove('lb-open');
      if (opener) opener.focus();
    });

    lb.querySelector('.lb-close').addEventListener('click', function () { lb.close(); });
    lb.querySelector('.lb-prev').addEventListener('click', function () { go(lbIndex - 1, -1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { go(lbIndex + 1, 1); });

    // click on the empty area around the photo closes it
    var swiped = false;
    lbStage.addEventListener('click', function (e) {
      if (swiped) { swiped = false; return; } // a swipe also fires click: don't close
      if (e.target === lbStage) lb.close();
    });

    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(lbIndex + 1, 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(lbIndex - 1, -1); }
    });

    // swipe left / right on touch screens
    var startX = null;
    lbStage.addEventListener('pointerdown', function (e) { startX = e.clientX; });
    lbStage.addEventListener('pointerup', function (e) {
      if (startX === null) return;
      var dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) {
        swiped = true;
        go(lbIndex + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      }
    });

    // make each gallery photo a keyboard-accessible trigger
    Array.prototype.forEach.call(document.querySelectorAll('.gallery-item'), function (fig) {
      var img = fig.querySelector('img');
      if (!img) return;
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', 'ดูรูปขยาย: ' + (img.alt || 'ผลงาน'));
      fig.addEventListener('click', function () { openLightbox(img.getAttribute('src'), fig); });
      fig.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(img.getAttribute('src'), fig); }
      });
    });
  }

  /* ---------- Mobile menu ---------- */
  var menuBtn = document.querySelector('.menu-toggle');
  var menu = document.getElementById('mobile-menu');

  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.querySelector('.ms').textContent = open ? 'close' : 'menu';
  }

  if (menuBtn && menu) {
    menuBtn.addEventListener('click', function () { setMenu(menu.hidden); });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
  }

  /* ---------- Reviews carousel ---------- */
  var reviews = [
    { q: 'ทีมงานให้คำปรึกษาดีมาก งานละเอียด รถวิ่งดีขึ้นชัดเจน ประทับใจสุดๆ ครับ', name: 'คุณ ก.', init: 'ก', car: 'Audi A5', img: 'assets/614818_0.jpg' },
    { q: 'จูน TCU แล้วเกียร์ตอบสนองไวขึ้นมาก อธิบายทุกขั้นตอนก่อนเริ่มงาน', name: 'คุณ ภ.', init: 'ภ', car: 'BMW M4', img: 'assets/614820_0.jpg' },
    { q: 'เช็กอาการด้วยเครื่องมือตรงรุ่น เจอปัญหาจริงตั้งแต่ครั้งแรก', name: 'คุณ ธ.', init: 'ธ', car: 'Mercedes-AMG C63', img: 'assets/614834_0.jpg' }
  ];

  var card = document.getElementById('reviews');
  if (card) {
    var el = {
      img: card.querySelector('.review-img'),
      quote: card.querySelector('.review-quote'),
      init: card.querySelector('.avatar'),
      name: card.querySelector('.review-name'),
      car: card.querySelector('.review-car'),
      dots: card.querySelector('.dots')
    };
    var current = 0;
    var timer;

    // Preload review images so switching is instant
    reviews.forEach(function (r) { new Image().src = r.img; });

    reviews.forEach(function (_, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot';
      b.setAttribute('aria-label', 'รีวิวที่ ' + (i + 1));
      b.addEventListener('click', function () { show(i); restart(); });
      el.dots.appendChild(b);
    });

    function show(i) {
      var r = reviews[i];
      current = i;
      el.img.src = r.img;
      el.img.alt = 'รถลูกค้า ' + r.car;
      el.quote.textContent = '“' + r.q + '”';
      el.init.textContent = r.init;
      el.name.textContent = r.name;
      el.car.textContent = r.car;
      Array.prototype.forEach.call(el.dots.children, function (d, j) {
        d.classList.toggle('is-active', j === i);
      });
    }

    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { show((current + 1) % reviews.length); }, 6000);
    }

    show(0);
    restart();
  }

  /* ---------- Contact form ---------- */
  var form = document.getElementById('contact-form');
  if (form) {
    // Sends to api/contact.php, which pushes a message to the shop's LINE OA
    // (or logs it to api/storage/line-mock.log while no LINE token is configured).
    var fields = form.querySelector('.form-fields');
    var thanks = form.querySelector('.form-thanks');
    var errorBox = form.querySelector('.form-error');
    var submitBtn = form.querySelector('.form-submit');
    var submitLabel = form.querySelector('.form-submit-label');
    var defaultLabel = submitLabel ? submitLabel.textContent : '';
    var sending = false;

    var showError = function (msg) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    };

    var setSending = function (on) {
      sending = on;
      submitBtn.disabled = on;
      submitBtn.classList.toggle('is-sending', on);
      if (submitLabel) submitLabel.textContent = on ? 'กำลังส่ง…' : defaultLabel;
    };

    // client-side checks (the server validates again)
    var validate = function () {
      var bad = null;
      ['name', 'phone'].forEach(function (n) {
        var el = form.elements[n];
        var ok = el.value.trim() !== '' && el.checkValidity();
        el.classList.toggle('is-invalid', !ok);
        el.setAttribute('aria-invalid', String(!ok));
        if (!ok && !bad) bad = el;
      });
      if (bad) {
        showError(bad.name === 'phone' ? 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง' : 'กรุณากรอกชื่อ');
        bad.focus();
        return false;
      }
      return true;
    };

    ['name', 'phone'].forEach(function (n) {
      form.elements[n].addEventListener('input', function () {
        this.classList.remove('is-invalid');
        this.removeAttribute('aria-invalid');
        errorBox.hidden = true;
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      errorBox.hidden = true;
      if (!validate()) return;

      setSending(true);
      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      })
        .then(function (res) {
          return res.json().catch(function () { return { ok: false }; });
        })
        .then(function (data) {
          if (data && data.ok) {
            if (data.mock && window.console) console.info('[contact form] MOCK mode — saved to api/storage/line-mock.log, not sent to LINE');
            fields.hidden = true;
            thanks.hidden = false;
            thanks.querySelector('.link-btn').focus();
          } else {
            showError((data && data.message) || 'ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่ หรือโทร 061-442-2242');
          }
        })
        .catch(function () {
          showError('เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต หรือโทร 061-442-2242');
        })
        .then(function () { setSending(false); });
    });

    thanks.querySelector('.link-btn').addEventListener('click', function () {
      form.reset();
      thanks.hidden = true;
      fields.hidden = false;
    });
  }
})();
