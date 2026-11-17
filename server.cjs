const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('Defina ADMIN_PASSWORD antes de iniciar.'); process.exit(1); }

if (!APP_ACCESS_PASSWORD || !SESSION_SECRET) {
  console.error('Defina APP_ACCESS_PASSWORD e SESSION_SECRET antes de iniciar.');
  process.exit(1);
}
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expires FROM web_sessions WHERE sid=?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires <= Date.now()) { db.prepare('DELETE FROM web_sessions WHERE sid=?').run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8*60*60*1000;
      db.prepare('INSERT INTO web_sessions(sid,sess,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires=excluded.expires').run(sid, JSON.stringify(sess), expires);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM web_sessions WHERE sid=?').run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  next();
});

const dataDir = process.env.ESTOQUE_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'estoque-grupo-atualize-v2');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'estoque-atualize.db'));
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS web_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)');
const sessionStore = new SQLiteSessionStore();
app.use(session({ name: 'estoque.sid', store: sessionStore, secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 } }));
db.pragma('foreign_keys = ON');
db.exec(\`
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros', unit TEXT NOT NULL DEFAULT 'un', units_per_box INTEGER, stock INTEGER NOT NULL DEFAULT 0, min_stock INTEGER NOT NULL DEFAULT 0, purchase_price REAL NOT NULL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS sellers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, item TEXT, old_quantity INTEGER, new_quantity INTEGER, reason TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id), type TEXT NOT NULL CHECK(type IN ('entrada','saida','perda','ajuste')), quantity INTEGER NOT NULL, seller_id INTEGER REFERENCES sellers(id), note TEXT, unit_price REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
\`);
const cols = db.prepare('PRAGMA table_info(products)').all().map(x=>x.name);
if (!cols.includes('units_per_box')) db.exec('ALTER TABLE products ADD COLUMN units_per_box INTEGER');
const addCat = db.prepare('INSERT OR IGNORE INTO categories(name) VALUES (?)');
['Sorvetes','Lubrificantes','Outros'].forEach(x=>addCat.run(x));
db.prepare('INSERT OR IGNORE INTO categories(name) SELECT DISTINCT category FROM products').run();
if (!db.prepare('SELECT COUNT(*) n FROM sellers').get().n) {
  const s=db.prepare('INSERT INTO sellers(name) VALUES (?)'); s.run('Rayane'); s.run('Bruno');
}
if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) {
 const rows=[['51421','Cremosinho sabor leite condensado','Sorvetes',10,10],['51452','Cremosinho sabor maracujá','Sorvetes',10,10],['51438','Cremosinho sabor morango','Sorvetes',10,10],['50240','Picolé cobertura Quy Lack','Sorvetes',22,22],['50684','Picolé cobertura Tentação','Sorvetes',22,22],['50134','Picolé Milk Chocolate','Sorvetes',26,26],['50141','Picolé Milk Coco','Sorvetes',26,26],['50172','Picolé Milk Leite Condensado','Sorvetes',26,26],['50295','Picolé Sublime Mousse Maracujá','Sorvetes',null,0],['50097','Picolé Suco Morango','Sorvetes',26,26],['50073','Picolé Suco Uva','Sorvetes',26,26],['50332','Sorvete pote 2L Napolitano','Sorvetes',1,1],['50356','Sorvete pote 2L Passas','Sorvetes',1,1],['50745','Sorvete Quy Copão Napolitano','Sorvetes',null,0]];
 const ins=db.prepare('INSERT INTO products(code,name,category,unit,units_per_box,stock) VALUES (?,?,?,"un",?,?)');
 db.transaction(()=>rows.forEach(x=>ins.run(...x)))();
}
const adminSessions = new Map();

const authAttempts = new Map();
function limitAuth(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now(), entry = authAttempts.get(key) || { count: 0, reset: now + 15*60*1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15*60*1000; }
  if (entry.count >= 8) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
  entry.count++; authAttempts.set(key, entry); next();
}

const requireLogin=(req,res,next)=>req.session?.loggedIn?next():res.status(401).json({error:'Faça login para continuar.'});
const requireAdmin=data=>{
 const token=data?.admin?.token, saved=token?adminSessions.get(token):null;
 if(!saved||saved.expiresAt<Date.now()){if(token)adminSessions.delete(token);throw new Error('Autorização administrativa necessária ou expirada.')}
 adminSessions.delete(token); return saved;
};
const audit=x=>db.prepare('INSERT INTO audit_logs(actor,action,entity_type,entity_id,item,old_quantity,new_quantity,reason,details) VALUES (?,?,?,?,?,?,?,?,?)').run(x.actor,x.action,x.entityType,x.entityId??null,x.item??null,x.oldQuantity??null,x.newQuantity??null,x.reason,x.details?JSON.stringify(x.details):null);
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'src/login.html')));
app.post('/api/login',limitAuth,(req,res)=>{
 if(String(req.body?.password||'')!==APP_ACCESS_PASSWORD)return res.status(401).json({error:'Senha de acesso incorreta.'});
 req.session.loggedIn=true; req.session.save(err=>err?res.status(500).json({error:'Não foi possível iniciar a sessão.'}):res.json({ok:true}));
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('estoque.sid');res.json({ok:true})}));
app.get('/api/session',(req,res)=>res.json({loggedIn:!!req.session?.loggedIn}));
app.use('/api', (req,res,next)=>req.path==='/login'||req.path==='/logout'||req.path==='/session'?next():requireLogin(req,res,next));
app.get('/app',requireLogin,(req,res)=>res.sendFile(path.join(__dirname,'src/index.html')));
app.get('/api/dashboard',(req,res)=>{
 const products=db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n, units=db.prepare('SELECT COALESCE(SUM(stock),0) n FROM products WHERE active=1').get().n;
 const low=db.prepare('SELECT COUNT(*) n FROM products WHERE active=1 AND stock<=min_stock').get().n;
 const today=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM movements WHERE type='saida' AND date(created_at)=date('now','localtime')").get().n;
 const sales=db.prepare("SELECT COALESCE(SUM(quantity*unit_price),0) n FROM movements WHERE type='saida' AND date(created_at)=date('now','localtime')").get().n;
  const totalOut=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM movements WHERE type IN ('saida','perda')").get().n;
 const totalSales=db.prepare("SELECT COALESCE(SUM(quantity*unit_price),0) n FROM movements WHERE type='saida'").get().n;
 const totalLoss=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM movements WHERE type='perda'").get().n;
 const monthOut=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM movements WHERE type='saida' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')").get().n;
 const daily=db.prepare("SELECT date(created_at) day,COALESCE(SUM(quantity),0) qty FROM movements WHERE type='saida' AND date(created_at)>=date('now','localtime','-6 days') GROUP BY date(created_at) ORDER BY day").all();
 const categoryOut=db.prepare("SELECT c.name category,COALESCE(SUM(m.quantity),0) qty FROM categories c LEFT JOIN products p ON p.category=c.name LEFT JOIN movements m ON m.product_id=p.id AND m.type='saida' GROUP BY c.name ORDER BY c.id").all();
 const attention=db.prepare('SELECT id,name,category,stock,min_stock FROM products WHERE active=1 AND (stock<=0 OR (min_stock>0 AND stock<=min_stock)) ORDER BY stock,name').all();
 const allProducts=db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,name').all();
 res.json({products,units,low,today,sales,totalOut,totalSales,totalLoss,monthOut,daily,categoryOut,attention,allProducts});
});
app.post('/api/admin/stock-value',(req,res)=>{if(String(req.body?.password||'')!==ADMIN_PASSWORD)return res.status(403).json({error:'Senha incorreta.'});const value=db.prepare('SELECT COALESCE(SUM(stock*purchase_price),0) n FROM products WHERE active=1').get().n;res.json({value})});
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT name FROM categories ORDER BY id').all()));
app.get('/api/products',(req,res)=>{const c=req.query.category||'Todos';res.json(c==='Todos'?db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,name').all():db.prepare('SELECT * FROM products WHERE active=1 AND category=? ORDER BY name').all(c))});
app.get('/api/sellers',(req,res)=>res.json(db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY name').all()));
app.get('/api/movements',(req,res)=>res.json(db.prepare("SELECT m.*,p.name product_name,p.code,s.name seller_name FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN sellers s ON s.id=m.seller_id ORDER BY m.id DESC LIMIT ?").all(Math.min(Number(req.query.limit)||100,1000))));
app.get('/api/audit',(req,res)=>res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all()));
app.post('/api/admin/authorize',limitAuth,(req,res)=>{const d=req.body||{};if(String(d.password||'')!==ADMIN_PASSWORD)return res.status(403).json({error:'Senha administrativa incorreta.'});const actor=String(d.actor||'').trim(),reason=String(d.reason||'').trim();if(!actor||!reason)return res.status(400).json({error:'Informe o responsável e o motivo da operação.'});const token=crypto.randomUUID();adminSessions.set(token,{actor,reason,expiresAt:Date.now()+120000});res.json({token,actor,reason})});
app.post('/api/categories',(req,res)=>{try{const d=req.body,ad=requireAdmin(d),name=String(d.name||'').trim();if(!name)throw Error('Informe o nome da categoria.');if(name.length>40)throw Error('Use até 40 caracteres.');db.prepare('INSERT INTO categories(name) VALUES (?)').run(name);audit({actor:ad.actor,action:'Criação de categoria',entityType:'categoria',item:name,reason:ad.reason});res.json(true)}catch(e){res.status(400).json({error:e.message.includes('UNIQUE')?'Essa categoria já existe.':e.message})}});
app.post('/api/products',(req,res)=>{try{const p=req.body,ad=requireAdmin(p);if(!p.name?.trim())throw Error('Informe o nome do produto.');let id;if(p.id){const before=db.prepare('SELECT * FROM products WHERE id=?').get(p.id);if(!before)throw Error('Produto não encontrado.');db.prepare('UPDATE products SET code=?,name=?,category=?,unit=?,units_per_box=?,min_stock=?,purchase_price=?,sale_price=? WHERE id=?').run(p.code||null,p.name.trim(),p.category,p.unit||'un',p.units_per_box||null,Number(p.min_stock)||0,Number(p.purchase_price)||0,Number(p.sale_price)||0,p.id);id=p.id;audit({actor:ad.actor,action:'Edição de produto',entityType:'produto',entityId:id,item:p.name,oldQuantity:before.stock,newQuantity:before.stock,reason:ad.reason,details:{antes:before,depois:db.prepare('SELECT * FROM products WHERE id=?').get(id)}})}else{id=db.prepare('INSERT INTO products(code,name,category,unit,units_per_box,stock,min_stock,purchase_price,sale_price) VALUES (?,?,?,?,?,?,?,?,?)').run(p.code||null,p.name.trim(),p.category,p.unit||'un',p.units_per_box||null,Number(p.units_per_box)||0,Number(p.min_stock)||0,Number(p.purchase_price)||0,Number(p.sale_price)||0).lastInsertRowid;audit({actor:ad.actor,action:'Cadastro de produto',entityType:'produto',entityId:id,item:p.name,oldQuantity:0,newQuantity:Number(p.units_per_box)||0,reason:ad.reason})}res.json(id)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/products/deactivate',(req,res)=>{try{const d=req.body,ad=requireAdmin(d),p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(d.id);if(!p)throw Error('Produto não encontrado.');const n=db.prepare('UPDATE products SET active=0 WHERE id=?').run(d.id).changes;if(n)audit({actor:ad.actor,action:'Desativação de produto',entityType:'produto',entityId:d.id,item:p.name,oldQuantity:p.stock,newQuantity:p.stock,reason:ad.reason});res.json(n)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/sellers',(req,res)=>{try{const d=req.body,ad=requireAdmin(d),name=String(d.name||'').trim();if(!name)throw Error('Informe o nome do vendedor.');const id=db.prepare('INSERT INTO sellers(name) VALUES (?)').run(name).lastInsertRowid;audit({actor:ad.actor,action:'Cadastro de vendedor',entityType:'vendedor',entityId:id,item:name,reason:ad.reason});res.json(id)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/movements',(req,res)=>{try{const m=req.body,ad=m.type==='saida'?null:requireAdmin(m),qty=Math.floor(Number(m.quantity));if(!m.product_id||!qty||qty<1)throw Error('Selecione um produto e informe uma quantidade válida.');if(m.type==='saida'&&!m.seller_id)throw Error('Selecione o vendedor.');const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(m.product_id);if(!p)throw Error('Produto não encontrado.');if(!['entrada','saida','perda'].includes(m.type))throw Error('Tipo de movimentação inválido.');const old=p.stock,signed=m.type==='entrada'?qty:-qty;if(m.type!=='entrada'&&p.stock<qty)throw Error('Estoque insuficiente. Disponível: '+p.stock);db.transaction(()=>{db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(signed,p.id);db.prepare('INSERT INTO movements(product_id,type,quantity,seller_id,note,unit_price) VALUES (?,?,?,?,?,?)').run(p.id,m.type,qty,m.seller_id||null,m.note||'',Number(m.unit_price??p.sale_price)||0);const seller=m.seller_id?db.prepare('SELECT name FROM sellers WHERE id=?').get(m.seller_id)?.name:null;audit({actor:ad?.actor||seller||'Venda normal',action:m.type==='saida'?'Venda registrada':m.type==='entrada'?'Entrada de estoque':'Perda registrada',entityType:'movimentação',entityId:p.id,item:p.name,oldQuantity:old,newQuantity:old+signed,reason:ad?.reason||String(m.note||'Venda normal').trim()})})();res.json(true)}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/movements/delete-sale',(req,res)=>{try{const d=req.body,ad=requireAdmin(d),sale=db.prepare("SELECT id,product_id,quantity FROM movements WHERE id=? AND type='saida'").get(d.id);if(!sale)throw Error('Venda não encontrada ou não pode ser excluída.');const p=db.prepare('SELECT name,stock FROM products WHERE id=?').get(sale.product_id);db.transaction(()=>{db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(sale.quantity,sale.product_id);db.prepare("DELETE FROM movements WHERE id=? AND type='saida'").run(d.id);audit({actor:ad.actor,action:'Exclusão de venda / estorno',entityType:'venda',entityId:d.id,item:p.name,oldQuantity:p.stock,newQuantity:p.stock+sale.quantity,reason:ad.reason,details:{quantidadeEstornada:sale.quantity}})})();res.json(true)}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/export.csv',(req,res)=>{const rows=db.prepare("SELECT m.id,m.created_at,m.type,p.code,p.name product,m.quantity,COALESCE(s.name,'—') seller,m.unit_price,(m.quantity*m.unit_price) total,m.note FROM movements m JOIN products p ON p.id=m.product_id LEFT JOIN sellers s ON s.id=m.seller_id ORDER BY m.id DESC").all();const header=['ID','Data','Tipo','Código','Produto','Quantidade','Vendedor','Preço unitário','Total','Observação'];const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv='\uFEFF'+[header,...rows.map(r=>[r.id,r.created_at,r.type,r.code,r.product,r.quantity,r.seller,r.unit_price,r.total,r.note])].map(r=>r.map(q).join(';')).join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="relatorio-estoque-atualize.csv"');res.send(csv)});
app.get('/api/backup',(req,res)=>{const temp=path.join(os.tmpdir(),'backup-estoque-'+Date.now()+'.db');db.backup(temp).then(()=>res.download(temp,'backup-estoque-atualize.db',()=>fs.rm(temp,{force:true},()=>{}))).catch(()=>res.status(500).json({error:'Falha ao gerar backup.'}))});
app.use('/assets',express.static(path.join(__dirname,'assets'),{dotfiles:'deny',index:false}));
app.get('/styles.css',(req,res)=>res.sendFile(path.join(__dirname,'src/styles.css')));
app.get('/renderer.js',(req,res)=>res.sendFile(path.join(__dirname,'src/renderer.js')));
app.get('/web-api.js',(req,res)=>res.sendFile(path.join(__dirname,'src/web-api.js')));
app.get('*',(req,res)=>res.redirect(req.session?.loggedIn?'/app':'/'));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Erro interno do servidor.'})});
app.listen(PORT,'0.0.0.0',()=>console.log('Estoque Posto V2 web disponível na porta '+PORT));
