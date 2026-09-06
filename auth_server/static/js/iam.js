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

  // ---- OTP / 6-digit code helpers (6-box style) ----
  function initOtpBoxes(containerId, hiddenInputId, hintId, submitBtnId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const boxes = Array.from(container.querySelectorAll('.iam-otp-box'));
    const hidden = document.getElementById(hiddenInputId);
    const hint = document.getElementById(hintId);
    const btn = submitBtnId ? document.getElementById(submitBtnId) : null;
    const TOTAL = boxes.length;

    function updateHidden() {
      if (hidden) hidden.value = boxes.map(b => b.value).join('');
    }

    function clearStates() {
      boxes.forEach(b => b.classList.remove('is-success', 'is-error'));
    }

    function setBoxState(index, state) {
      boxes.forEach((b, i) => {
        if (i !== index) b.classList.remove('is-error', 'is-success');
      });
      if (index >= 0 && index < TOTAL) {
        boxes[index].classList.remove('is-error', 'is-success');
        boxes[index].classList.add(state);
      }
    }

    function updateButtonState() {
      const code = boxes.map(b => b.value).join('');
      if (btn) btn.disabled = code.length !== TOTAL;
    }

    function trySubmit() {
      const code = boxes.map(b => b.value).join('');
      if (code.length === TOTAL && btn) {
        btn.click();
      }
    }

    function validateAndMark() {
      const code = boxes.map(b => b.value).join('');
      if (code.length === TOTAL) {
        clearStates();
        boxes.forEach(b => b.classList.add('is-success'));
        if (hint) hint.textContent = '';
        trySubmit();
      } else if (code.length > 0) {
        if (hint) hint.textContent = (TOTAL - code.length) + ' digit' + (TOTAL - code.length !== 1 ? 's' : '') + ' remaining';
      } else {
        if (hint) hint.textContent = '';
      }
      updateButtonState();
      return code.length === TOTAL;
    }

    boxes.forEach((box, i) => {
      box.addEventListener('input', function (e) {
        const val = box.value.replace(/\D/g, '').slice(0, 1);
        box.value = val;
        clearStates();
        updateHidden();
        if (val && i + 1 < TOTAL) {
          boxes[i + 1].focus();
        }
        validateAndMark();
        if (boxes.map(b => b.value).join('').length === TOTAL) {
          trySubmit();
        }
      });

      box.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !box.value && i > 0) {
          boxes[i - 1].focus();
        }
        if (e.key === 'ArrowLeft' && i > 0) {
          boxes[i - 1].focus();
          e.preventDefault();
        }
        if (e.key === 'ArrowRight' && i + 1 < TOTAL) {
          boxes[i + 1].focus();
          e.preventDefault();
        }
      });

      box.addEventListener('focus', function () {
        box.select();
      });

      box.addEventListener('paste', function (e) {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, TOTAL);
        clearStates();
        for (let j = 0; j < TOTAL; j++) {
          boxes[j].value = paste[j] || '';
        }
        updateHidden();
        validateAndMark();
        const filled = paste.length;
        if (filled === TOTAL) {
          boxes.forEach(b => b.classList.add('is-success'));
          trySubmit();
        } else if (filled > 0) {
          const next = Math.min(filled, TOTAL - 1);
          boxes[next].focus();
        }
      });
    });

    container.addEventListener('click', function (e) {
      if (e.target === container) {
        const firstEmpty = boxes.find(b => !b.value);
        (firstEmpty || boxes[0]).focus();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initOtpBoxes('otp-boxes-verify', 'totp_code_verify', 'otp-hint-verify', 'btn-verify');
    initOtpBoxes('otp-boxes-setup', 'totp_code_setup', 'otp-hint-setup', 'btn-verify');
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
