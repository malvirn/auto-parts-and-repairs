import { noteWrite } from "./toast.js";
// ========= Supabase Client =========
// 1. npm install @supabase/supabase-js  (if you move to a bundler later)
// 2. For plain HTML/JS, we load Supabase from CDN in each page's <script> tag
//    and initialise it here.

export const SUPABASE_URL = "https://pztwmmkmkyotszylbhsr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_pi3_GxiETMzWNI-6U7Myhg_SqeHqK00"; // paste your FULL copied key here

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

// Every successful insert / update / delete shows a short confirmation
// message (see toast.js). Reads are untouched.
const originalFrom = supabase.from.bind(supabase);
supabase.from = (table) => {
  const builder = originalFrom(table);
  for (const op of ["insert", "update", "upsert", "delete"]) {
    const original = builder[op];
    if (typeof original !== "function") continue;
    builder[op] = function (...args) {
      const query = original.apply(this, args);
      const payload = args[0];
      const kind = op === "upsert" ? "update" : op;
      const then = query.then;
      query.then = function (onFulfilled, onRejected) {
        return then.call(this, (result) => {
          try {
            const rows = Array.isArray(result?.data) ? result.data.length : null;
            if (!result?.error && rows !== 0) noteWrite(table, kind, payload);
          } catch (e) {}
          return result;
        }).then(onFulfilled, onRejected);
      };
      return query;
    };
  }
  return builder;
};

export default supabase;
