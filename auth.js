// ═══════════════════════════════════════════
//  Galaxy Studio — auth.js
//  Supabase Auth: sign-up, sign-in, session
// ═══════════════════════════════════════════

function getAuthSB() { return getSB(); }

// ── Auth UI state ──
let _authReady = false;
let _onAuthReady = null;

// ════════════════════════════════════
//  MODAL SHOW / HIDE
// ════════════════════════════════════

function showAuthModal(tab) {
  const overlay = $('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  if (tab === 'signup') {
    showAuthTab('signup');
  } else {
    showAuthTab('login');
  }
}

function hideAuthModal() {
  const overlay = $('authOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('hidden', f.id !== 'auth' + cap(tab)));
  $('authError') && ($('authError').textContent = '');
  $('authError2') && ($('authError2').textContent = '');
}

// ════════════════════════════════════
//  SIGN UP
// ════════════════════════════════════

async function authSignUp(e) {
  e && e.preventDefault();
  const sb = getAuthSB();
  if (!sb) return;
  const email = $('signupEmail').value.trim();
  const password = $('signupPassword').value;
  const name = $('signupName').value.trim();
  const errEl = $('authError2');
  errEl.textContent = '';

  if (!email || !password || !name) { errEl.textContent = 'All fields are required.'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  const btn = $('signupBtn');
  btn.disabled = true; btn.textContent = 'Creating account...';

  try {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    });
    if (error) throw error;
    if (data.user) {
      hideAuthModal();
      onUserSignedIn(data.user);
      showToast('Welcome to Galaxy Studio, ' + name + '!');
    } else {
      errEl.textContent = 'Check your email to confirm your account.';
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

// ════════════════════════════════════
//  SIGN IN
// ════════════════════════════════════

async function authSignIn(e) {
  e && e.preventDefault();
  const sb = getAuthSB();
  if (!sb) return;
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const errEl = $('authError');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Email and password required.'; return; }

  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in...';

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    hideAuthModal();
    onUserSignedIn(data.user);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

// ════════════════════════════════════
//  SIGN OUT
// ════════════════════════════════════

async function authSignOut() {
  const sb = getAuthSB();
  if (!sb) return;
  await sb.auth.signOut();
  setCurrentUser(null);
  showAuthModal('login');
  $('userMenuDropdown') && $('userMenuDropdown').classList.add('hidden');
  $('userMenuBtn') && ($('userMenuBtn').innerHTML = '');
  showToast('Signed out.');
}

// ════════════════════════════════════
//  FORGOT PASSWORD
// ════════════════════════════════════

async function authForgotPassword() {
  const sb = getAuthSB();
  if (!sb) return;
  const email = $('loginEmail').value.trim();
  if (!email) { $('authError').textContent = 'Enter your email first.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=1'
  });
  if (error) { $('authError').textContent = error.message; }
  else { showToast('Password reset email sent!'); }
}

// ════════════════════════════════════
//  SESSION INIT
// ════════════════════════════════════

async function initAuth(onReady) {
  _onAuthReady = onReady;
  const sb = getAuthSB();
  if (!sb) {
    // No Supabase — run in offline/guest mode
    _authReady = true;
    onReady && onReady(null);
    return;
  }

  // Listen for auth changes (avoid async inside callback — Supabase deadlock risk)
  sb.auth.onAuthStateChange((event, session) => {
    (async () => {
      const user = session?.user || null;
      setCurrentUser(user);
      updateUserAvatar(user);
      if (!_authReady) {
        _authReady = true;
        onReady && onReady(user);
      } else {
        if (event === 'SIGNED_IN') {
          onUserSignedIn(user);
        } else if (event === 'SIGNED_OUT') {
          showAuthModal('login');
        }
      }
    })();
  });

  // Get current session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    // First load with no session
    if (!_authReady) {
      _authReady = true;
      showAuthModal('login');
      onReady && onReady(null);
    }
  }
}

// ════════════════════════════════════
//  POST-SIGN-IN
// ════════════════════════════════════

async function onUserSignedIn(user) {
  if (!user) return;
  setCurrentUser(user);
  updateUserAvatar(user);
  hideAuthModal();

  // Load settings from Supabase
  const settings = await loadUserSettings();
  if (settings.provider) {
    cfg.provider = settings.provider;
    localStorage.setItem('gs_provider', cfg.provider);
  }
  if (settings.model) {
    cfg.model = settings.model;
    localStorage.setItem('gs_model', cfg.model);
  }

  // Load projects
  const list = await listProjects();
  if (list.length > 0) {
    const loaded = await loadProjectById(list[0].id);
    if (loaded) switchProject(list[0].id);
    else newProject();
  } else {
    const migratedId = await migrateOldProject();
    if (migratedId) switchProject(migratedId);
    else newProject();
  }

  renderProjectSidebar(list);
  updateTopbar();
}

// ════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════

function updateUserAvatar(user) {
  const btn = $('userMenuBtn');
  if (!btn) return;
  if (!user) { btn.innerHTML = ''; btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  const name = user.user_metadata?.full_name || user.email || 'U';
  const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const avatarUrl = user.user_metadata?.avatar_url;
  if (avatarUrl) {
    btn.innerHTML = `<img src="${esc(avatarUrl)}" class="user-avatar-img" alt="${esc(initials)}">`;
  } else {
    btn.innerHTML = `<div class="user-avatar-initials">${esc(initials)}</div>`;
  }
}

function toggleUserMenu() {
  const drop = $('userMenuDropdown');
  if (!drop) return;
  const isVisible = !drop.classList.contains('hidden');
  drop.classList.toggle('hidden', isVisible);
  if (!isVisible) {
    const user = getCurrentUser();
    const nameEl = drop.querySelector('.user-menu-name');
    const emailEl = drop.querySelector('.user-menu-email');
    if (nameEl) nameEl.textContent = user?.user_metadata?.full_name || 'Guest';
    if (emailEl) emailEl.textContent = user?.email || '';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const drop = $('userMenuDropdown');
  const btn = $('userMenuBtn');
  if (drop && btn && !drop.contains(e.target) && !btn.contains(e.target)) {
    drop.classList.add('hidden');
  }
});

// ════════════════════════════════════
//  ERROR MAPPING
// ════════════════════════════════════

function friendlyAuthError(msg) {
  if (!msg) return 'Something went wrong. Try again.';
  if (msg.includes('Invalid login credentials')) return 'Wrong email or password.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'Email already in use. Try signing in.';
  if (msg.includes('Password should be')) return 'Password must be at least 6 characters.';
  if (msg.includes('Email not confirmed')) return 'Please check your email to confirm your account.';
  if (msg.includes('rate limit')) return 'Too many attempts. Please wait a minute.';
  return msg;
}

// ════════════════════════════════════
//  TOAST
// ════════════════════════════════════

function showToast(msg, type) {
  let toast = $('gsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gsToast';
    toast.className = 'gs-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'gs-toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.className = 'gs-toast'; }, 3200);
}

console.log('✦ auth.js loaded');
