/**
 * EarnNest Web Task Site - Main Task Script
 */

(function () {
  const SUPABASE_BASE_URL = 'https://sseubghheacqkmfutlcx.supabase.co/functions/v1';

  // 1. Fragment parser — reads #session_id=...&token=... from the URL
  function parseHashParams() {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.substring(1)
      : window.location.hash;
    const params = {};
    if (!hash) return params;

    const pairs = hash.split('&');
    for (const pair of pairs) {
      if (!pair) continue;
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        params[decodeURIComponent(pair.trim())] = '';
      } else {
        const key = decodeURIComponent(pair.slice(0, eqIndex).trim());
        const val = decodeURIComponent(pair.slice(eqIndex + 1).trim());
        params[key] = val;
      }
    }
    return params;
  }

  function redirectToInvalid(errorMsg) {
    let target = 'session-invalid.html';
    if (errorMsg) {
      target += '?error=' + encodeURIComponent(errorMsg);
    }
    window.location.href = target;
  }

  const { session_id, token } = parseHashParams();

  if (!session_id || !token) {
    redirectToInvalid('Missing session_id or token in URL fragment.');
    return;
  }

  // Tracking state
  const scrollThresholds = [
    { percent: 25, type: 'SCROLL_25', fired: false },
    { percent: 50, type: 'SCROLL_50', fired: false },
    { percent: 75, type: 'SCROLL_75', fired: false },
    { percent: 100, type: 'SCROLL_100', fired: false }
  ];

  let scroll100Fired = false;
  let timer15sPassed = false;
  let completionTriggered = false;
  const observedZones = new Set();

  // 2. track-event helper
  async function trackEvent(eventType, payload) {
    try {
      await fetch(SUPABASE_BASE_URL + '/track-event', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: session_id,
          event_type: eventType,
          payload: payload || {}
        })
      });
    } catch (err) {
      console.warn('Failed to track event:', eventType, err);
    }
  }

  // 3. Fetch article data
  async function loadArticle() {
    try {
      const response = await fetch(SUPABASE_BASE_URL + '/get-article', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: session_id })
      });

      if (!response.ok) {
        let errorText = 'HTTP Error ' + response.status;
        try {
          const errData = await response.json();
          if (errData && (errData.error || errData.message)) {
            errorText = errData.error || errData.message;
          }
        } catch (_e) {
          // ignore — body wasn't JSON
        }
        redirectToInvalid(errorText);
        return;
      }

      const data = await response.json();
      if (!data || !data.success || !data.article) {
        const errorMsg = (data && (data.error || data.message)) || 'Invalid article response';
        redirectToInvalid(errorMsg);
        return;
      }

      renderArticle(data.article);
    } catch (err) {
      redirectToInvalid(err.message || 'Network error while fetching article');
    }
  }

  // 4. Render article and set up ad zones
  function renderArticle(article) {
    document.title = (article.title || 'EarnNest Task') + ' | EarnNest';

    if (article.meta_description) {
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
      }
      meta.content = article.meta_description;
    }

    const titleEl = document.getElementById('article-title');
    const bodyEl = document.getElementById('article-body');
    const loadingEl = document.getElementById('loading-state');
    const articleContainer = document.getElementById('article-container');

    if (titleEl) titleEl.textContent = article.title || 'Untitled Article';

    if (bodyEl) {
      bodyEl.innerHTML = '';
      const paragraphs = (article.body || '')
        .split(/\r?\n+/)
        .map(function (p) { return p.trim(); })
        .filter(function (p) { return p.length > 0; });

      const midIndex = Math.max(1, Math.floor(paragraphs.length / 2));

      paragraphs.forEach(function (pText, idx) {
        const p = document.createElement('p');
        p.textContent = pText;
        bodyEl.appendChild(p);

        if (idx + 1 === midIndex) {
          const infeedAd = document.createElement('div');
          infeedAd.id = 'ad-zone-infeed-native';
          infeedAd.className = 'ad-zone';
          infeedAd.textContent = '[In-Feed Native Placeholder]';
          bodyEl.appendChild(infeedAd);
        }
      });
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (articleContainer) articleContainer.style.display = 'block';

    setTimeout(function () {
      timer15sPassed = true;
      checkCompletionReady();
    }, 15000);

    setupAdZoneObserver();

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  // 5. Intersection observer for ad zone visibility — fully self-contained
  function setupAdZoneObserver() {
    const zoneIds = [
      'ad-zone-sdk-banner',
      'ad-zone-infeed-native',
      'ad-zone-outstream-video',
      'ad-zone-interstitial'
    ];

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          const zoneId = entry.target.id;
          if (!observedZones.has(zoneId)) {
            observedZones.add(zoneId);
            trackEvent('AD_VISIBLE', { zone: zoneId });
          }
        }
      });
    }, { threshold: 0.1 });

    zoneIds.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    });
  }

  // 6. Scroll tracking
  function handleScroll() {
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    let currentPercent = 100;
    if (maxScroll > 0) {
      const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      currentPercent = (scrollTop / maxScroll) * 100;
    }

    const isAtBottom = maxScroll <= 0 || currentPercent >= 99.5;

    scrollThresholds.forEach(function (t) {
      if (!t.fired) {
        if (t.percent === 100 && isAtBottom) {
          t.fired = true;
          scroll100Fired = true;
          trackEvent(t.type);
          checkCompletionReady();
        } else if (t.percent < 100 && currentPercent >= t.percent) {
          t.fired = true;
          trackEvent(t.type);
        }
      }
    });
  }

  // 7. Completion check -> interstitial flow
  function checkCompletionReady() {
    if (scroll100Fired && timer15sPassed && !completionTriggered) {
      completionTriggered = true;
      triggerInterstitialFlow();
    }
  }

  function triggerInterstitialFlow() {
    const interstitial = document.getElementById('ad-zone-interstitial');
    const countdownEl = document.getElementById('countdown-number');
    if (!interstitial || !countdownEl) return;

    interstitial.style.display = 'flex';
    let timeLeft = 5;
    countdownEl.textContent = timeLeft;

    const interval = setInterval(function () {
      timeLeft -= 1;
      countdownEl.textContent = Math.max(0, timeLeft);

      if (timeLeft <= 0) {
        clearInterval(interval);
        interstitial.style.display = 'none';
        showClaimButton();
      }
    }, 1000);
  }

  // 8. Claim reward flow
  function showClaimButton() {
    const claimSection = document.getElementById('claim-section');
    const claimBtn = document.getElementById('claim-button');
    if (claimSection) claimSection.style.display = 'block';
    if (claimBtn) claimBtn.onclick = handleClaimTask;
  }

  async function handleClaimTask() {
    const claimBtn = document.getElementById('claim-button');
    const claimStatus = document.getElementById('claim-status');

    if (claimBtn) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Claiming...';
    }
    if (claimStatus) {
      claimStatus.className = '';
      claimStatus.textContent = '';
    }

    try {
      const response = await fetch(SUPABASE_BASE_URL + '/claim-task', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: session_id })
      });

      let data = null;
      try {
        data = await response.json();
      } catch (_e) {
        // ignore — body wasn't JSON
      }

      if (response.ok && data && data.success) {
        if (claimStatus) {
          claimStatus.className = 'status-success';
          claimStatus.textContent = '✓ Task complete!';
        }
        if (claimBtn) claimBtn.style.display = 'none';
      } else {
        const errorMsg = (data && (data.error || data.message)) || ('Claim failed (HTTP ' + response.status + ')');
        if (claimStatus) {
          claimStatus.className = 'status-error';
          claimStatus.textContent = errorMsg;
        }
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim Reward';
        }
      }
    } catch (err) {
      if (claimStatus) {
        claimStatus.className = 'status-error';
        claimStatus.textContent = err.message || 'Network error while claiming task.';
      }
      if (claimBtn) {
        claimBtn.disabled = false;
        claimBtn.textContent = 'Claim Reward';
      }
    }
  }

  // Initialize once the page is ready
  document.addEventListener('DOMContentLoaded', loadArticle);
})();
