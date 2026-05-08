// Move 14.1 from section_key='devices' to 'training' and update title.
const SUPABASE_URL = 'https://hbvuwnzemdifaapktaol.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/franchise_hq_items?id=eq.14.1`,
  {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      section_key: 'training',
      title: 'Гайд: POS — кассовая программа',
      sort_order: 110,
    }),
  }
);
console.log(res.status, await res.text().then(t => t.slice(0, 300)));
