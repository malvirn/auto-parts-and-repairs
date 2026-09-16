// ========= Supabase Client =========
// 1. npm install @supabase/supabase-js  (if you move to a bundler later)
// 2. For plain HTML/JS, we load Supabase from CDN in each page's <script> tag
//    and initialise it here.

const SUPABASE_URL = "https://pztwmmkmkyotszylbhsr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_pi3_GxiETMzWNI-6U7Myhg_SqeHqK00"; // paste your FULL copied key here

// storage: sessionStorage (not the default localStorage) means the
// session is tied to this specific tab/browser session — closing the
// browser clears it, and the next visit requires logging in again. Normal
// navigation between pages within the same open session still works
// fine, since sessionStorage survives page loads, just not closing the
// tab/browser.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export default supabase;
