/* ====================================================================
   IAM Auth Server — inline form validation
   Adds HTML5 live validation, custom error messages, and a red glow
   for invalid fields. Server-side validation errors (rendered into
   the page) are highlighted automatically.
   ==================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Validators per `data-validate` type
  // ------------------------------------------------------------------
  const VALIDATORS = {
    email(v) {
      if (!v) return 'Please enter your email address.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address.';
      return '';
    },
    password(v) {
      if (!v) return 'Please enter a password.';
      if (v.length < 8) return 'Password must be at least 8 characters.';
      if (!/[A-Za-z]/.test(v)) return 'Password must include at least one letter.';
      if (!/\d/.test(v)) return 'Password must include at least one number.';
      return '';
    },
    name(v) {
      if (!v) return 'Please enter your name.';
      if (v.trim().length < 2) return 'Name must be at least 2 characters.';
      return '';
    },
    otp(v, len = 6) {
      if (!v) return `Please enter the ${len}-digit code.`;
      if (v.length < len) return `${len - v.length} more digit${len - v.length !== 1 ? 's' : ''} needed.`;
      if (!/^\d+$/.test(v)) return 'Code must contain digits only.';
      return '';
    }
  };

  // ------------------------------------------------------------------
  // Per-field error display
  // ------------------------------------------------------------------
  function setFieldError(input, message) {
    const field = input.closest('.iam-field');
    if (!field) return;
    let errEl = field.querySelector('.iam-field-error[data-field-error]');
    if (message) {
      input.classList.add('is-error');
      input.classList.remove('is-success');
      input.setAttribute('aria-invalid', 'true');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'iam-field-error';
        errEl.setAttribute('role', 'alert');
        errEl.setAttribute('data-field-error', input.name || 'field');
        errEl.innerHTML = '<span aria-hidden="true">⚠</span> <span class="msg"></span>';
        const hint = field.querySelector('.iam-otp-hint, .iam-pw-hint');
        if (hint) field.insertBefore(errEl, hint);
        else field.appendChild(errEl);
      }
      errEl.querySelector('.msg').textContent = message;
      errEl.style.display = '';
    } else {
      input.classList.remove('is-error');
      input.removeAttribute('aria-invalid');
      if (errEl) errEl.style.display = 'none';
    }
  }

  function setFieldSuccess(input) {
    const field = input.closest('.iam-field');
    if (!field) return;
    input.classList.remove('is-error');
    input.classList.add('is-success');
    input.removeAttribute('aria-invalid');
    const errEl = field.querySelector('.iam-field-error[data-field-error]');
    if (errEl) errEl.style.display = 'none';
  }

  function clearFieldError(input) {
    setFieldError(input, '');
  }

  // ------------------------------------------------------------------
  // Live validation driver. A field runs validation on blur and on
  // input (after first interaction), unless its form is marked
  // `data-local-only` (the login form, until the user explicitly
  // chooses local sign-in).
  // ------------------------------------------------------------------
  function isFieldLive(input) {
    const form = input.closest('form.iam-validate');
    if (form && form.hasAttribute('data-local-only')) return false;
    return true;
  }

  function runValidator(input) {
    if (!isFieldLive(input)) return; // suppress until local-sign-in is chosen
    const type = input.getAttribute('data-validate');
    const validator = VALIDATORS[type];
    if (!validator) return;
    const msg = validator(input.value);
    if (msg) setFieldError(input, msg);
    else if (input.value) setFieldSuccess(input);
    else clearFieldError(input);
  }

  document.querySelectorAll('[data-validate]').forEach(function (input) {
    let touched = false;
    input.addEventListener('blur', function () {
      if (!isFieldLive(input)) return;
      touched = true;
      runValidator(input);
    });
    input.addEventListener('input', function () {
      if (!isFieldLive(input)) return;
      if (!touched) return;
      runValidator(input);
    });
  });

  // ------------------------------------------------------------------
  // Login form: opt-in for live validation only AFTER the user has
  // focused the email/password field or clicked the local Sign-in
  // button. Until then, blur / input / change events are silently
  // ignored, so clicking the "Continue with Google" link never
  // shows a red error glow.
  // ------------------------------------------------------------------
  document.querySelectorAll('form.iam-validate[data-local-only]').forEach(function (form) {
    function commitToLocal() {
      if (!form.hasAttribute('data-local-only')) return;
      form.removeAttribute('data-local-only');
      // Re-evaluate any field the user may have already touched so
      // existing input is now validated.
      form.querySelectorAll('[data-validate]').forEach(runValidator);
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', commitToLocal, { once: true });
    }
  });

  // ------------------------------------------------------------------
  // Password strength meter
  // ------------------------------------------------------------------
  document.querySelectorAll('[data-pw-strength]').forEach(function (input) {
    const meter = document.querySelector(input.getAttribute('data-pw-strength'));
    if (!meter) return;
    input.addEventListener('input', function () {
      const v = input.value;
      const score = passwordScore(v);
      meter.className = 'iam-pw-strength ' + score.cls;
      const hint = meter.parentElement.querySelector('.iam-pw-hint');
      if (hint) hint.textContent = score.label;
    });
  });

  function passwordScore(v) {
    if (!v) return { cls: '', label: 'Use 8+ characters with letters and numbers.' };
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;
    if (s <= 1) return { cls: 'is-weak',   label: 'Weak password.' };
    if (s <= 2) return { cls: 'is-fair',   label: 'Fair — add numbers and symbols.' };
    if (s <= 3) return { cls: 'is-good',   label: 'Good password.' };
    return         { cls: 'is-strong', label: 'Strong password.' };
  }

  // ------------------------------------------------------------------
  // Highlight server-rendered errors on page load
  // ------------------------------------------------------------------
  document.querySelectorAll('.iam-field-error[data-field-error]').forEach(function (errEl) {
    const name = errEl.getAttribute('data-field-error');
    if (!name) return;
    const field = errEl.closest('.iam-field');
    if (!field) return;
    const input = field.querySelector(`[name="${name}"]`);
    if (input) {
      input.classList.add('is-error');
      input.setAttribute('aria-invalid', 'true');
    }
  });

  // ------------------------------------------------------------------
  // Block form submit if any field has a visible inline error.
  // (Google sign-in is an <a> link outside this form, so it can't
  // trigger this handler at all.)
  // ------------------------------------------------------------------
  document.querySelectorAll('form.iam-validate').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      let firstInvalid = null;
      form.querySelectorAll('[data-validate]').forEach(function (input) {
        const type = input.getAttribute('data-validate');
        const validator = VALIDATORS[type];
        if (!validator) return;
        const msg = validator(input.value);
        if (msg) {
          setFieldError(input, msg);
          if (!firstInvalid) firstInvalid = input;
        }
      });
      if (firstInvalid) {
        e.preventDefault();
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
})();
