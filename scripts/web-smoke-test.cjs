const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'estoque-web-test-'));
  const port = 3417;
  const env = { ...process.env, PORT: String(port), ESTOQUE_DATA_DIR: dataDir,
    APP_ACCESS_PASSWORD: 'acesso-teste-forte', ADMIN_PASSWORD: 'admin-teste-forte',
    SESSION_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
    NODE_ENV: 'test' };
  const server = spawn(process.execPath, ['server.cjs'], { env, stdio: ['ignore','pipe','pipe'] });
  let logs = '';
  server.stdout.on('data', x => logs += x);
  server.stderr.on('data', x => logs += x);
  const base = 'http://127.0.0.1:' + port;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const request = async (route, method='GET', body, cookie) => {
    const response = await fetch(base + route, {
      method, headers: { ...(body ? {'content-type':'application/json'} : {}), ...(cookie ? {cookie} : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'manual'
    });
    return response;
  };
  try {
    let ready = false;
    for (let i=0; i<60; i++) {
      if (server.exitCode !== null) throw new Error('Servidor encerrou antes de iniciar: ' + logs);
      try { const r=await fetch(base + '/'); if (r.status===200) { ready=true; break; } } catch {}
      await wait(250);
    }
    assert.equal(ready, true, 'Servidor web não iniciou: ' + logs);
    assert.equal((await request('/api/dashboard')).status, 401, 'API deveria exigir login');
    assert.equal((await request('/api/login','POST',{password:'errada'})).status, 401, 'Senha de acesso incorreta deveria ser recusada');
    const login = await request('/api/login','POST',{password:env.APP_ACCESS_PASSWORD});
    assert.equal(login.status, 200, 'Login válido deveria funcionar');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/dashboard','GET',null,cookie)).status, 200, 'Dashboard deveria abrir após login');

    assert.equal((await request('/api/products','POST',{name:'Produto teste',category:'Outros'},cookie)).status, 400, 'Cadastro sem autorização administrativa deveria ser bloqueado');
    assert.equal((await request('/api/admin/authorize','POST',{password:'errada',actor:'Teste',reason:'Teste'},cookie)).status, 403, 'Senha administrativa incorreta deveria ser recusada');

    const authorize = async () => {
      const r=await request('/api/admin/authorize','POST',{password:env.ADMIN_PASSWORD,actor:'Teste automatizado',reason:'Teste de segurança'},cookie);
      assert.equal(r.status,200,'Autorização administrativa deveria funcionar');
      return (await r.json()).token;
    };
    const productAuth = await authorize();
    const productRes = await request('/api/products','POST',{name:'Produto teste',category:'Outros',unit:'un',stock:0,admin:{token:productAuth}},cookie);
    assert.equal(productRes.status,200,'Cadastro autorizado deveria funcionar');
    const productId = await productRes.json();

    assert.equal((await request('/api/movements','POST',{product_id:productId,type:'entrada',quantity:10},cookie)).status,400,'Entrada sem autorização deveria ser bloqueada');
    const entryToken = await authorize();
    assert.equal((await request('/api/movements','POST',{product_id:productId,type:'entrada',quantity:10,admin:{token:entryToken}},cookie)).status,200,'Entrada autorizada deveria funcionar');

    const sellerToken = await authorize();
    const sellerRes = await request('/api/sellers','POST',{name:'Vendedor teste',admin:{token:sellerToken}},cookie);
    assert.equal(sellerRes.status,200,'Cadastro de vendedor autorizado deveria funcionar');
    const sellerId = await sellerRes.json();
    assert.equal((await request('/api/movements','POST',{product_id:productId,type:'saida',quantity:5,seller_id:sellerId},cookie)).status,200,'Venda normal não deve exigir senha administrativa');

    const sales = await (await request('/api/movements','GET',null,cookie)).json();
    const sale = sales.find(x=>x.type==='saida');
    assert.ok(sale,'Venda deveria constar no histórico');
    assert.equal((await request('/api/movements/delete-sale','POST',{id:sale.id},cookie)).status,400,'Excluir venda sem autorização deveria ser bloqueado');
    const deleteToken = await authorize();
    assert.equal((await request('/api/movements/delete-sale','POST',{id:sale.id,admin:{token:deleteToken}},cookie)).status,200,'Excluir venda com autorização deveria funcionar');

    const products = await (await request('/api/products','GET',null,cookie)).json();
    assert.equal(products.find(x=>x.id===productId).stock,10,'Estorno deveria devolver a quantidade ao estoque');
    console.log('OK: login, bloqueio sem login, senha administrativa, entrada protegida, venda normal sem senha e exclusão protegida com estorno.');
  } finally {
    server.kill();
    await wait(300);
    await rm(dataDir,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode=1; });
