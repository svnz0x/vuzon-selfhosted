import { interpretAddDestError } from './utils/error.js';
import { isVerifiedStatus } from './utils/verification.js';

document.addEventListener('alpine:init', () => {
  Alpine.data('vuzonApp', () => ({
    // Estado
    profile: { rootDomain: '' },
    rules: [],
    dests: [],
    loading: false,
    
    // UI Inputs
    search: '',
    newAlias: { local: '', dest: '' },
    newDestInput: '',
    
    // UI Feedback
    statusMsg: '',
    errors: { alias: '', dest: '' },
    copied: false,
    statusTimer: null,

    // Computados
    get verifiedDests() {
      return this.dests.filter(d => isVerifiedStatus(d.verified));
    },
    get filteredRules() {
      if (!this.search) return this.rules;
      const q = this.search.toLowerCase();
      return this.rules.filter(r => r.name && r.name.toLowerCase().includes(q));
    },
    get previewText() {
      const local = this.newAlias.local.trim().toLowerCase() || 'alias';
      const domain = this.profile?.rootDomain || '—';
      return `${local}@${domain}`;
    },
    get canCreateAlias() {
      return this.newAlias.local.trim() && this.newAlias.dest && this.profile?.rootDomain;
    },

    // Inicialización
    init() {
      this.refreshAll();
    },

    // API Client (MEJORADO)
    async api(path, method = 'GET', body = null) {
      const opts = { 
        headers: { 'Content-Type': 'application/json' },
        // --- CORRECCIÓN CLAVE ---
        // 'include' fuerza al navegador a enviar la cookie de sesión en la petición AJAX.
        credentials: 'include' 
      };
      
      if (method !== 'GET') {
        opts.method = method;
        if (body) opts.body = JSON.stringify(body);
      }
      
      const res = await fetch(path, opts);

      // Redirección automática al login si la sesión expiró
      if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Sesión expirada, redirigiendo...');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
      return data;
    },

    // Acciones
    async refreshAll() {
      this.loading = true;
      try {
        const [meData, rulesData, destsData] = await Promise.all([
          this.api('/api/me').catch(() => ({})),
          this.api('/api/rules').catch(() => ({ result: [] })),
          this.api('/api/addresses').catch(() => ({ result: [] }))
        ]);

        this.profile = meData || {};
        this.rules = rulesData?.result || [];
        this.dests = destsData?.result || [];
        
        // Auto-seleccionar primer destino si no hay uno
        if (!this.newAlias.dest && this.verifiedDests.length > 0) {
          this.newAlias.dest = this.verifiedDests[0].email;
        }
      } catch (err) {
        console.error(err);
      } finally {
        this.loading = false;
      }
    },

    async createAlias() {
      if (!this.canCreateAlias) return;
      this.clearErrors();
      this.loading = true;
      try {
        await this.api('/api/rules', 'POST', {
          localPart: this.newAlias.local.trim(),
          destEmail: this.newAlias.dest
        });
        this.setStatus('Alias creado');
        this.newAlias.local = '';
        this.refreshAll();
      } catch (err) {
        this.errors.alias = err.message;
      } finally {
        this.loading = false;
      }
    },

    async addDest() {
      if (!this.newDestInput) return;
      this.clearErrors();
      this.loading = true;
      try {
        await this.api('/api/addresses', 'POST', { email: this.newDestInput });
        this.setStatus('Añadido. Revisa tu correo.');
        this.newDestInput = '';
        this.refreshAll();
      } catch (err) {
        const interpretation = interpretAddDestError(err);
        this.errors.dest = interpretation.message;
      } finally {
        this.loading = false;
      }
    },

    async toggleRule(rule) {
      const originalState = rule.enabled;
      rule.enabled = !originalState; 
      try {
        const action = !originalState ? 'enable' : 'disable';
        await this.api(`/api/rules/${rule.id}/${action}`, 'POST');
      } catch (err) {
        rule.enabled = originalState; 
        this.setStatus(`Error: ${err.message}`);
      }
    },

    async deleteRule(id) {
      if (!confirm('¿Eliminar alias permanentemente?')) return;
      try {
        await this.api(`/api/rules/${id}`, 'DELETE');
        this.rules = this.rules.filter(r => r.id !== id);
        this.setStatus('Alias eliminado');
      } catch (err) {
        this.setStatus(err.message);
        this.refreshAll();
      }
    },

    async deleteDest(id) {
      if (!confirm('¿Eliminar destinatario?')) return;
      try {
        await this.api(`/api/addresses/${id}`, 'DELETE');
        this.dests = this.dests.filter(d => d.id !== id);
        this.setStatus('Destinatario eliminado');
      } catch (err) {
        this.setStatus(err.message);
      }
    },

    // Utilidades UI
    generateLocalPart() {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
      let result = '';
      for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
      this.newAlias.local = result;
      this.clearErrors();
    },

    copyPreview() {
      if (!this.profile.rootDomain) return;
      navigator.clipboard.writeText(this.previewText).then(() => {
        this.copied = true;
        setTimeout(() => this.copied = false, 2000);
      });
    },

    setStatus(msg) {
      this.statusMsg = msg;
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => this.statusMsg = '', 3000);
    },

    clearErrors() { this.errors.alias = ''; this.errors.dest = ''; },
    isVerified(dest) { return isVerifiedStatus(dest.verified); },
    getRuleDest(rule) {
      const dests = rule.actions?.[0]?.value || [];
      return Array.isArray(dests) ? dests.join(', ') : dests;
    }
  }));
});
