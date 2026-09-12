// ========= Supabase Client =========
// 1. npm install @supabase/supabase-js  (if you move to a bundler later)
// 2. For plain HTML/JS, we load Supabase from CDN in each page's <script> tag
//    and initialise it here.

   const SUPABASE_URL = "https://pztwmmkmkyotszylbhsr.supabase.co";
   const SUPABASE_ANON_KEY = "sb_publishable_pi3_GxiETMzWNI-6U7Myhg_SqeHqK00"; // paste your FULL copied key here

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
