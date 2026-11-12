import { noteWrite, showToast } from "./toast.js";
import { assertWritable, connectionFetch, isReadOnly, isReadOnlyRpc } from "./connectionManager.js";
// ========= Supabase Client =========
// 1. npm install @supabase/supabase-js  (if you move to a bundler later)
// 2. For plain HTML/JS, we load Supabase from CDN in each page's <script> tag
//    and initialise it here.

export const SUPABASE_URL = "https://pztwmmkmkyotszylbhsr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_pi3_GxiETMzWNI-6U7Myhg_SqeHqK00"; // publishable key
window.__APR_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// Keep the authenticated session across page navigation, browser restarts,
// and reopening the installed app. Supabase refreshes tokens automatically.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// RPC calls are blocked while offline because the client cannot safely know
// whether a procedure is read-only or mutating. This prevents accidental
// financial writes and duplicate submissions during connection recovery.
const originalRpc = supabase.rpc.bind(supabase);
supabase.rpc = (fn, args, options) => {
  assertWritable();
  return originalRpc(fn, args, options);
};

window.addEventListener("apr:connection-change", event => {
  if (event.detail?.readOnly) {
    showToast("Read-only mode enabled", "info", "Your session is kept open. Changes are disabled until Supabase reconnects.");
  } else {
    showToast("Connection restored", "success", "Refreshing the page will load the latest records.");
  }
});

// Every successful insert / update / delete shows a short confirmation
// message (see toast.js). Reads are untouched.
function ensureWritable() {\n  try { assertWritable(); }\n  catch (error) { showToast("Read-only mode", "error", error.message); throw error; }\n}\n\nconst originalFrom = supabase.from.bind(supabase);
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
