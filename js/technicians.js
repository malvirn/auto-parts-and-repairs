import supabase from './supabaseClient.js';

async function loadTechnicians() {
  const tbody = document.getElementById('tech-table');
  const { data, error } = await supabase
    .from('technicians')
    .select('*')
    .order('full_name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted)">No technicians yet</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(t => `
    <tr data-id="${t.id}">
      <td class="t-name">${t.full_name}</td>
      <td class="t-phone">${t.phone ?? ''}</td>
      <td>${t.is_active ? 'Yes' : 'No'}</td>
      <td>
        <button class="btn edit-btn">Edit</button>
        <button class="btn toggle-btn">${t.is_active ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const id = row.dataset.id;
      const newName = prompt('Full name:', row.querySelector('.t-name').textContent);
      if (newName === null) return;
      const newPhone = prompt('Phone:', row.querySelector('.t-phone').textContent);
      const { error } = await supabase.from('technicians')
        .update({ full_name: newName.trim(), phone: newPhone?.trim() || null })
        .eq('id', id);
      if (error) { alert('Update failed: ' + error.message); return; }
      loadTechnicians();
    });
  });

  tbody.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('tr');
      const id = row.dataset.id;
      const { data: current } = await supabase.from('technicians').select('is_active').eq('id', id).single();
      const { error } = await supabase.from('technicians')
        .update({ is_active: !current.is_active })
        .eq('id', id);
      if (error) { alert('Update failed: ' + error.message); return; }
      loadTechnicians();
    });
  });
}

async function handleAdd(e) {
  e.preventDefault();
  const full_name = document.getElementById('tech-name').value.trim();
  const phone = document.getElementById('tech-phone').value.trim() || null;
  if (!full_name) return;

  const { error } = await supabase.from('technicians').insert([{ full_name, phone }]);
  if (error) { alert('Failed to add: ' + error.message); return; }
  document.getElementById('tech-form').reset();
  loadTechnicians();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tech-form').addEventListener('submit', handleAdd);
  loadTechnicians();
});