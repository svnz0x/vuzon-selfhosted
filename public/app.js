import { getDestSelectionState } from './utils/destSelection.js';
import { interpretAddDestError } from './utils/errors.js';
import { isVerifiedStatus } from './utils/verification.js';

const $ = sel => document.querySelector(sel);
const destList = $('#destList');
const rulesList = $('#rulesList');
const destSel = $('#destSel');
const status = $('#status');
const newDestError = $('#newDestError');
const aliasError = $('#aliasError');
const subdomainEl = $('#subdomain');
const aliasSearch = $('#aliasSearch');
const aliasForm = document.getElementById('aliasForm');
const localPartInput = $('#localPart');
const aliasPreviewEl = $('#aliasPreview');
const aliasPreviewCopyBtn = $('#aliasPreviewCopy');
const aliasPreviewHint = $('#aliasPreviewHint');
const createBtn = $('#create');
const createHelper = $('#createHelper');

let cachedRules = [];
let statusHideTimer = null;
let aliasPreviewCopyResetTimer = null;
let currentRootDomain = '';

// --- UI Helpers ---

const setStatus = (msg = '', { autoHide = false, timeout = 2600 } = {}) => {
  if (!status) return;
  if (statusHideTimer) {
    clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }
  if (!msg) {
    status.classList.remove('is-visible');
    status.textContent = '';
    return;
  }
  status.textContent = msg;
  status.classList.add('is-visible');
  if (autoHide) {
    statusHideTimer = setTimeout(() => {
      statusHideTimer = null;
      if (status?.textContent === msg) setStatus('');
    }, timeout);
  }
};

const setFormError = (element, message = '') => {
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
};

// --- API ---

async function api(path, opts = {}){
  const { headers: optsHeaders = {}, ...restOpts } = opts;
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...optsHeaders };
  
  const res = await fetch(path, { ...restOpts, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.clone().json();
      if (data && typeof data.error === 'string') message = data.error;
    } catch {
      try { message = await res.text(); } catch {}
    }
    const error = new Error(message || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return await res.json().catch(()=>({}));
}

// --- Logic ---

const updateCreateButtonState = () => {
  if (!createBtn || !destSel) return;
  const selectedOption = destSel.selectedOptions?.[0];
  const isValidSelection = !!selectedOption && !selectedOption.disabled && !!destSel.value;
  createBtn.disabled = !isValidSelection;
  if (createHelper) {
    createHelper.hidden = isValidSelection;
  }
};

const generateAlias = (() => {
  const length = 8;
  return () => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  };
})();

function updateAliasPreview(){
  if (!aliasPreviewEl) return;
  const rawLocal = localPartInput?.value ?? '';
  const local = rawLocal.trim().toLowerCase() || 'alias';
  const domain = currentRootDomain || '—';
  const aliasValue = `${local}@${domain}`;
  
  aliasPreviewEl.textContent = aliasValue;
  if (aliasPreviewCopyBtn) {
    aliasPreviewCopyBtn.dataset.aliasValue = aliasValue;
    aliasPreviewCopyBtn.disabled = !currentRootDomain;
  }
}

// --- Loaders ---

async function loadProfile(){
  try {
    const me = await api('/api/me');
    currentRootDomain = me.rootDomain || '';
    if (subdomainEl) subdomainEl.textContent = currentRootDomain;
    document.title = `vuzon · ${currentRootDomain}`;
    updateAliasPreview();
  } catch (err) {
    console.error('Error loading profile', err);
  }
}

async function loadDests(){
  if (!destList) return;
  const previousValue = destSel.value;
  try {
    const d = await api('/api/addresses');
    const items = d.result || [];
    
    // Render list
    destList.innerHTML = items.map(dest => {
      const isVerified = isVerifiedStatus(dest.verified);
      return `
        <li>
          <details class="rule-card ${isVerified ? 'rule-card--active' : 'rule-card--inactive'}">
            <summary>${esc(dest.email)}</summary>
            <div class="rule-content">
              <div class="rule-field">
                <span class="rule-label">Estado</span>
                <span class="rule-status-label ${isVerified ? 'rule-status-label--active' : 'rule-status-label--inactive'}">
                  ${isVerified ? 'Verificado' : 'Pendiente'}
                </span>
              </div>
              <div class="rule-field rule-field--actions">
                <span class="rule-label">Acciones</span>
                <button type="button" class="secondary danger sm action-btn dest-delete-btn" data-id="${esc(dest.id)}">Eliminar</button>
              </div>
            </div>
          </details>
        </li>`;
    }).join('') || '<li class="rule-empty">No hay destinatarios.</li>';

    // Render select
    const { selectedValue, hasEnabledOption } = getDestSelectionState(items, previousValue);
    destSel.innerHTML = items.map(dest => {
      const isVerified = isVerifiedStatus(dest.verified);
      const sel = selectedValue === dest.email ? 'selected' : '';
      return `<option value="${esc(dest.email)}" ${!isVerified ? 'disabled' : ''} ${sel}>
        ${esc(dest.email)} ${!isVerified ? '(Pendiente)' : ''}
      </option>`;
    }).join('');
    
    if (!hasEnabledOption && items.length > 0) {
       destSel.innerHTML = '<option disabled selected>Selecciona...</option>' + destSel.innerHTML;
    }

    updateCreateButtonState();
  } catch (err) {
    console.error(err);
  }
}

async function loadRules(){
  if (!rulesList) return;
  setStatus('Cargando alias...');
  try {
    const d = await api('/api/rules');
    cachedRules = d.result || [];
    applyRuleFilter();
  } catch(err){
    console.error(err);
  } finally {
    setStatus('');
  }
}

function ruleRow(rule){
  // Simplificado para la vista selfhosted
  const alias = rule.name; // En la API server.js usamos name como el alias completo
  const isEnabled = rule.enabled;
  const dests = rule.actions?.[0]?.value || [];
  const destText = Array.isArray(dests) ? dests.join(', ') : dests;
  
  return `
    <details class="rule-card ${isEnabled ? 'rule-card--active' : 'rule-card--inactive'}">
      <summary>${esc(alias)}</summary>
      <div class="rule-content">
        <div class="rule-field">
           <span class="rule-label">Estado</span>
           <span class="rule-status-label ${isEnabled ? 'rule-status-label--active' : 'rule-status-label--inactive'}">
             ${isEnabled ? 'Activo' : 'Pausado'}
           </span>
        </div>
        <div class="rule-field">
           <span class="rule-label">Destino</span>
           <span>${esc(destText)}</span>
        </div>
        <div class="rule-field rule-field--actions">
           <span class="rule-label">Acciones</span>
           <button class="secondary sm action-btn toggle-btn" data-id="${rule.id}" data-enabled="${isEnabled}">
             ${isEnabled ? 'Pausar' : 'Activar'}
           </button>
           <button class="secondary danger sm action-btn delete-btn" data-id="${rule.id}">Eliminar</button>
        </div>
      </div>
    </details>
  `;
}

function applyRuleFilter(){
  const query = aliasSearch ? aliasSearch.value.trim().toLowerCase() : '';
  const filtered = query 
    ? cachedRules.filter(r => (r.name || '').toLowerCase().includes(query)) 
    : cachedRules;
    
  rulesList.innerHTML = filtered.length 
    ? filtered.map(ruleRow).join('') 
    : '<div class="rule-empty">No hay alias.</div>';
}

function esc(str=''){ return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

// --- Event Listeners ---

const refreshBtn = $('#refresh');
if(refreshBtn) refreshBtn.addEventListener('click', () => {
  loadProfile(); loadDests(); loadRules();
});

const genBtn = $('#gen');
if(genBtn) genBtn.addEventListener('click', () => {
  localPartInput.value = generateAlias();
  updateAliasPreview();
});

if(localPartInput) localPartInput.addEventListener('input', updateAliasPreview);
if(aliasSearch) aliasSearch.addEventListener('input', applyRuleFilter);

if(aliasForm) aliasForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFormError(aliasError);
  const lp = localPartInput.value.trim();
  const dest = destSel.value;
  if(!lp || !dest) return;
  
  createBtn.disabled = true;
  try {
    await api('/api/rules', { method: 'POST', body: JSON.stringify({ localPart: lp, destEmail: dest }) });
    localPartInput.value = '';
    updateAliasPreview();
    setStatus('Alias creado', { autoHide: true });
    loadRules();
  } catch(err) {
    setFormError(aliasError, err.message);
  } finally {
    createBtn.disabled = false;
  }
});

const newDestForm = document.getElementById('newDestForm');
const addDestBtn = $('#addDest');
if(newDestForm) newDestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#newDest');
  const email = input.value.trim();
  if(!email) return;
  
  addDestBtn.disabled = true;
  try {
    await api('/api/addresses', { method: 'POST', body: JSON.stringify({ email }) });
    input.value = '';
    setStatus('Destinatario añadido. Revisa tu correo.', { autoHide: true });
    loadDests();
  } catch(err) {
    const { message } = interpretAddDestError(err);
    setFormError(newDestError, message);
  } finally {
    addDestBtn.disabled = false;
  }
});

if(rulesList) rulesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if(!btn) return;
  const id = btn.dataset.id;
  
  if(btn.classList.contains('delete-btn')) {
    if(!confirm('¿Eliminar alias?')) return;
    btn.disabled = true;
    try {
      await api(`/api/rules/${id}`, { method: 'DELETE' });
      loadRules();
    } catch(err) {
      alert(err.message);
      btn.disabled = false;
    }
  }
  
  if(btn.classList.contains('toggle-btn')) {
    const isEnabled = btn.dataset.enabled === 'true';
    btn.disabled = true;
    try {
      await api(`/api/rules/${id}/${isEnabled ? 'disable' : 'enable'}`, { method: 'POST' });
      loadRules();
    } catch(err) {
      alert(err.message);
      btn.disabled = false;
    }
  }
});

if(destList) destList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.dest-delete-btn');
  if(!btn) return;
  if(!confirm('¿Eliminar destinatario?')) return;
  btn.disabled = true;
  try {
    await api(`/api/addresses/${btn.dataset.id}`, { method: 'DELETE' });
    loadDests();
  } catch(err) {
    alert(err.message);
    btn.disabled = false;
  }
});

// Init
Promise.all([loadProfile(), loadDests(), loadRules()]);
