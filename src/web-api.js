(() => {
  const request = async (url, options={}) => {
    const r=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const type=r.headers.get('content-type')||'';
    const data=type.includes('application/json')?await r.json():await r.text();
    if(!r.ok)throw new Error(data?.error||'Falha na comunicação com o servidor.');
    return data;
  };
  const post=(url,data)=>request(url,{method:'POST',body:JSON.stringify(data)});
  window.estoque={
    authorizeAdmin:d=>post('/api/admin/authorize',d),
    audit:()=>request('/api/audit'),
    dashboard:()=>request('/api/dashboard'),
    categories:()=>request('/api/categories'),
    addCategory:d=>post('/api/categories',d),
    products:c=>request('/api/products?category='+encodeURIComponent(c||'Todos')),
    saveProduct:d=>post('/api/products',d),
    deactivateProduct:d=>post('/api/products/deactivate',d),
    sellers:()=>request('/api/sellers'),
    addSeller:d=>post('/api/sellers',d),
    movements:n=>request('/api/movements?limit='+encodeURIComponent(n||100)),
    addMovement:d=>post('/api/movements',d),
    deleteSale:d=>post('/api/movements/delete-sale',d),
    exportCsv:async()=>{const r=await fetch('/api/export.csv');if(!r.ok)throw new Error('Falha ao exportar relatório.');const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='relatorio-estoque-atualize.csv';a.click();URL.revokeObjectURL(a.href);return true},
    backup:async()=>{const r=await fetch('/api/backup');if(!r.ok)throw new Error('Falha ao gerar backup.');const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='backup-estoque-atualize.db';a.click();URL.revokeObjectURL(a.href);return true},
    logout:()=>post('/api/logout',{})
  };
  fetch('/api/session').then(r=>r.json()).then(s=>{if(!s.loggedIn)location.href='/'});
})();