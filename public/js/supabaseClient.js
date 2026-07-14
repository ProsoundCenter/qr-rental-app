// supabaseClient.js - client Supabase dung chung + cac ham xac thuc / phan quyen.
// Yeu cau da nap truoc: config.js va thu vien supabase-js (CDN).
const sb = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

function usernameToEmail(username) {
  return String(username || '').trim().toLowerCase() + '@' + window.APP_CONFIG.USERNAME_EMAIL_DOMAIN;
}

async function getSessionProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('*, companies(*)')
    .eq('id', session.user.id)
    .single();
  if (error || !data) { console.error(error); return null; }
  return data;
}

// Goi dau moi trang can dang nhap. Tra ve profile (co role, company_id, companies.name)
// hoac null (va tu dong chuyen huong ve /login.html) neu chua dang nhap.
async function requireLogin() {
  const profile = await getSessionProfile();
  if (!profile) {
    location.href = '/login.html';
    return null;
  }
  return profile;
}

function isAdmin(profile) {
  return !!profile && (profile.role === 'owner' || profile.role === 'superadmin');
}

async function logout() {
  await sb.auth.signOut();
  location.href = '/login.html';
}
