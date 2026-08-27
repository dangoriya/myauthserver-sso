/* Shared interactions for IAM auth pages (vanilla JS) */
(function () {
  // ---- Password show/hide ----
  document.querySelectorAll('[data-toggle-pw]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const targetId = btn.getAttribute('data-toggle-pw');
      const inp = document.getElementById(targetId);
      if (!inp) return;
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.innerHTML = EYE_OFF_ICON;
      } else {
        inp.type = 'password';
        btn.innerHTML = EYE_ICON;
      }
    });
  });

  // ---- OTP / 6-digit code helpers ----
  document.querySelectorAll('input.iam-otp-input, input[data-otp]').forEach(function (inp) {
    inp.addEventListener('input', function (e) {
      const cleaned = inp.value.replace(/\D/g, '').slice(0, 6);
      inp.value = cleaned;
      inp.classList.remove('is-error', 'is-success');
      const hint = document.getElementById(inp.getAttribute('data-hint') || 'otp-hint');
      if (hint) {
        const rem = 6 - cleaned.length;
        hint.textContent = rem > 0 ? rem + ' digit' + (rem !== 1 ? 's' : '') + ' remaining' : '';
      }
      if (cleaned.length === 6) {
        inp.classList.add('is-success');
      }
    });
  });

  // ---- Copy secret key (2FA) ----
  document.querySelectorAll('[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = document.getElementById(btn.getAttribute('data-copy-target'));
      if (!target) return;
      const txt = target.textContent.trim();
      navigator.clipboard.writeText(txt).then(function () {
        const original = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(function () { btn.textContent = original; }, 2000);
      }).catch(function () {
        // Fallback for older browsers / insecure contexts
        const range = document.createRange();
        range.selectNode(target);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        try { document.execCommand('copy'); } catch (_) {}
        window.getSelection().removeAllRanges();
      });
    });
  });

  // ---- Disable submit buttons after first click to prevent double-submit ----
  document.querySelectorAll('form.iam-auto-disable').forEach(function (form) {
    form.addEventListener('submit', function () {
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        setTimeout(function () { btn.disabled = true; }, 0);
      }
    });
  });
})();

const EYE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
