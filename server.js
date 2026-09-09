
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "school.db");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS achievements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 image TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gallery (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 caption TEXT DEFAULT '',
 image TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS results (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_name TEXT NOT NULL,
 class_name TEXT NOT NULL,
 guardian_name TEXT NOT NULL,
 mobile TEXT NOT NULL,
 address TEXT NOT NULL,
 document_name TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe migration for older databases: add payment tracking if it is missing.
const admissionColumns = db.prepare("PRAGMA table_info(admissions)").all().map(c => c.name);
if (!admissionColumns.includes("payment_status")) db.exec("ALTER TABLE admissions ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Pending'");
if (!admissionColumns.includes("payment_confirmed_at")) db.exec("ALTER TABLE admissions ADD COLUMN payment_confirmed_at TEXT DEFAULT ''");

const defaultUser = process.env.ADMIN_USERNAME || "admin";
const defaultPass = process.env.ADMIN_PASSWORD || "Witty@2026";
const exists = db.prepare("SELECT id FROM admin_users WHERE username=?").get(defaultUser);
if (!exists) {
  db.prepare("INSERT INTO admin_users(username,password_hash) VALUES(?,?)")
    .run(defaultUser, bcrypt.hashSync(defaultPass, 12));
} else if (process.env.ADMIN_PASSWORD) {
  db.prepare("UPDATE admin_users SET password_hash=? WHERE username=?")
    .run(bcrypt.hashSync(defaultPass, 12), defaultUser);
}

const defaults = {
 schoolName: "Witty Buddy Play School",
 tagline: "Small steps, big learning, new beginnings every day.",
 address: "Witty Buddy Play School, Ayodhyapuri, Front of Hotel Grand Patliputra, Near Daroga Rai College, Mairwa Road, Siwan, Bihar, PIN-841226",
 mobile: "",
 whatsapp: "",
 admissionFee: "1000",
 upiId: "tarakpndy1991@oksbi"
};
const setStmt = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
Object.entries(defaults).forEach(([k,v])=>setStmt.run(k,v));

app.set("trust proxy", 1);
app.use(express.json({limit:"8mb"}));
app.use(express.urlencoded({extended:true, limit:"8mb"}));
app.use(session({
 secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
 resave: false,
 saveUninitialized: false,
 cookie: { httpOnly: true, sameSite: "lax", secure: true, maxAge: 1000*60*60*8 }
}));
app.use(express.static(__dirname));

function auth(req,res,next){ if(req.session.user) return next(); res.status(401).json({error:"Unauthorized"}); }
function allData(){
 const settings={}; db.prepare("SELECT key,value FROM settings").all().forEach(x=>settings[x.key]=x.value);
 return {
  settings,
  notices: db.prepare("SELECT * FROM notices ORDER BY id DESC").all(),
  achievements: db.prepare("SELECT * FROM achievements ORDER BY id DESC").all(),
  gallery: db.prepare("SELECT * FROM gallery ORDER BY id DESC").all(),
  results: db.prepare("SELECT * FROM results ORDER BY id DESC").all()
 };
}

app.get("/api/health", (req,res)=>res.json({ok:true,db:DB_FILE}));
app.get("/api/site", (req,res)=>{try{res.set("Cache-Control","no-store");res.json(allData())}catch(e){console.error("site read failed",e);res.status(500).json({error:"Database read failed: "+e.message})}});
app.post("/api/login",(req,res)=>{
 const {username,password}=req.body;
 const u=db.prepare("SELECT * FROM admin_users WHERE username=?").get(username||"");
 if(!u || !bcrypt.compareSync(password||"",u.password_hash)) return res.status(401).json({error:"Invalid login"});
 req.session.user={id:u.id,username:u.username};
 req.session.save(err=>{
   if(err){ console.error("session save failed",err); return res.status(500).json({error:"Session save failed: "+err.message}); }
   res.set("Cache-Control","no-store");
   res.json({ok:true});
 });
});
app.post("/api/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({loggedIn:!!req.session.user,username:req.session.user?.username||""}));

app.put("/api/settings",auth,(req,res)=>{
 try {
  const allowed=["schoolName","tagline","address","mobile","whatsapp","admissionFee","upiId"];
  const st=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx=db.transaction(()=>allowed.forEach(k=>{if(req.body[k]!==undefined)st.run(k,String(req.body[k]))}));
  tx();
  console.log("Settings saved by", req.session.user?.username);
  res.set("Cache-Control","no-store");
  res.json({ok:true,settings:allData().settings});
 } catch(e) {
  console.error("settings save failed",e);
  res.status(500).json({error:"Database save failed: "+e.message});
 }
});
app.post("/api/notices",auth,(req,res)=>{
 if(!req.body.title || !req.body.body) return res.status(400).json({error:"Title and body required"});
 const r=db.prepare("INSERT INTO notices(title,body) VALUES(?,?)").run(req.body.title,req.body.body); res.json({id:r.lastInsertRowid});
});
app.delete("/api/notices/:id",auth,(req,res)=>{db.prepare("DELETE FROM notices WHERE id=?").run(req.params.id);res.json({ok:true})});

app.post("/api/achievements",auth,(req,res)=>{
 const r=db.prepare("INSERT INTO achievements(title,body,image) VALUES(?,?,?)").run(req.body.title||"",req.body.body||"",req.body.image||"");res.json({id:r.lastInsertRowid});
});
app.delete("/api/achievements/:id",auth,(req,res)=>{db.prepare("DELETE FROM achievements WHERE id=?").run(req.params.id);res.json({ok:true})});

app.post("/api/gallery",auth,(req,res)=>{
 if(!req.body.image) return res.status(400).json({error:"Image required"});
 const r=db.prepare("INSERT INTO gallery(caption,image) VALUES(?,?)").run(req.body.caption||"",req.body.image);res.json({id:r.lastInsertRowid});
});
app.delete("/api/gallery/:id",auth,(req,res)=>{db.prepare("DELETE FROM gallery WHERE id=?").run(req.params.id);res.json({ok:true})});

app.post("/api/results",auth,(req,res)=>{
 const r=db.prepare("INSERT INTO results(title,body) VALUES(?,?)").run(req.body.title||"",req.body.body||"");res.json({id:r.lastInsertRowid});
});
app.delete("/api/results/:id",auth,(req,res)=>{db.prepare("DELETE FROM results WHERE id=?").run(req.params.id);res.json({ok:true})});


function razorpayRequest(method, pathname, body){
 return new Promise((resolve,reject)=>{
  const key=process.env.RAZORPAY_KEY_ID, secret=process.env.RAZORPAY_KEY_SECRET;
  if(!key||!secret)return reject(new Error('Razorpay is not configured'));
  const data=body?JSON.stringify(body):'';
  const rq=https.request({hostname:'api.razorpay.com',path:pathname,method,auth:key+':'+secret,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},r=>{let out='';r.on('data',c=>out+=c);r.on('end',()=>{let d={};try{d=JSON.parse(out)}catch{}if(r.statusCode>=200&&r.statusCode<300)resolve(d);else reject(new Error(d?.error?.description||'Razorpay request failed'));});});
  rq.on('error',reject);if(data)rq.write(data);rq.end();
 });
}
app.get('/api/payment-config',(req,res)=>{const settings=allData().settings;res.set('Cache-Control','no-store');res.json({admissionFee:Number(settings.admissionFee||0),upiId:settings.upiId||'',razorpayConfigured:!!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET),razorpayKeyId:process.env.RAZORPAY_KEY_ID||''});});
app.get('/api/payment-qr',async(req,res)=>{try{const st=allData().settings,upi=(st.upiId||'').trim();if(!upi)return res.status(404).json({error:'UPI details are not configured yet.'});const amount=Number(st.admissionFee||0),p=new URLSearchParams({pa:upi,pn:st.schoolName||'Witty Buddy Play School',cu:'INR'});if(amount>0)p.set('am',amount.toFixed(2));const png=await QRCode.toBuffer('upi://pay?'+p.toString(),{width:600,margin:2,errorCorrectionLevel:'M'});res.set('Content-Type','image/png');res.set('Cache-Control','no-store');res.send(png);}catch(e){console.error('QR generation failed',e);res.status(500).json({error:'QR generation failed'});}});
app.post('/api/create-order',async(req,res)=>{try{const st=allData().settings,amount=Math.round(Number(st.admissionFee||0)*100);if(!amount)return res.status(400).json({error:'Admission fee is not configured.'});const order=await razorpayRequest('POST','/v1/orders',{amount,currency:'INR',receipt:'admission_'+Date.now(),notes:{purpose:'School admission fee'}});res.json({id:order.id,amount:order.amount,currency:order.currency});}catch(e){console.error('Order creation failed',e);res.status(503).json({error:e.message});}});
app.post('/api/verify-payment',(req,res)=>{try{const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body||{};if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature)return res.status(400).json({error:'Incomplete payment response'});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(razorpay_signature)))return res.status(400).json({error:'Payment signature verification failed'});res.json({ok:true});}catch(e){console.error('Payment verification failed',e);res.status(500).json({error:'Payment verification failed'});}});

app.post("/api/admissions", (req,res)=>{
 const {student_name,class_name,guardian_name,mobile,address,document_name=""}=req.body||{};
 const clean={
  student_name:String(student_name||'').trim(), class_name:String(class_name||'').trim(),
  guardian_name:String(guardian_name||'').trim(), mobile:String(mobile||'').trim(),
  address:String(address||'').trim(), document_name:String(document_name||'').trim()
 };
 if(!clean.student_name||!clean.class_name||!clean.guardian_name||!clean.mobile||!clean.address) return res.status(400).json({error:"Please fill all required fields"});
 // Prevent duplicate applications caused by repeated taps/retries for the same details.
 const recent=db.prepare(`SELECT id FROM admissions WHERE student_name=? AND class_name=? AND guardian_name=? AND mobile=? AND address=? AND document_name=? AND created_at >= datetime('now','-24 hours') ORDER BY id DESC LIMIT 1`).get(clean.student_name,clean.class_name,clean.guardian_name,clean.mobile,clean.address,clean.document_name);
 if(recent) return res.json({ok:true,id:recent.id,message:"Application already received",duplicate:true});
 const r=db.prepare(`INSERT INTO admissions(student_name,class_name,guardian_name,mobile,address,document_name,payment_status,payment_confirmed_at) VALUES(?,?,?,?,?,?,?,?)`)
  .run(clean.student_name,clean.class_name,clean.guardian_name,clean.mobile,clean.address,clean.document_name,'Pending','');
 res.json({ok:true,id:r.lastInsertRowid,message:"Application received",duplicate:false});
});
app.post('/api/admissions/:id/payment-confirmed',(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid application'});
 const r=db.prepare("UPDATE admissions SET payment_status='Marked as completed', payment_confirmed_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
 if(!r.changes)return res.status(404).json({error:'Application not found'});
 res.json({ok:true,message:'Payment marked as completed'});
});
app.get("/api/admissions",auth,(req,res)=>res.json(db.prepare("SELECT * FROM admissions ORDER BY id DESC").all()));

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"admin-online.html")));
app.use((err,req,res,next)=>{console.error("Unhandled server error",err);if(res.headersSent)return next(err);res.status(500).json({error:"Server error: "+err.message})});

// Patch the existing HTML at startup so only this server.js needs to be replaced in GitHub.
function patchPublicAndAdminPages(){
 try{
  const indexFile=path.join(__dirname,'index.html');
  if(fs.existsSync(indexFile)){
   let html=fs.readFileSync(indexFile,'utf8');
   html=html.replace(/<script>\s*\(function\(\)\{\s*const form=document\.querySelector\('#admission form'\);[\s\S]*?\}\)\(\);\s*<\/script>/g,'');
   html=html.replace(/onsubmit="event\.preventDefault\(\); document\.getElementById\('payment'\)\.style\.display='block'; document\.getElementById\('thanks'\)\.style\.display='block';"/g,'onsubmit="return false;"');
   const js=`<script>
(function(){
  const form=document.querySelector('#admission form'); if(!form) return;
  let submitting=false, admissionId=null;
  const btn=document.getElementById('admissionSubmitBtn'), thanks=document.getElementById('thanks'), payment=document.getElementById('payment'), status=document.getElementById('paymentStatus'), done=document.getElementById('paymentDoneBtn');
  form.addEventListener('submit', async function(e){
    e.preventDefault(); e.stopPropagation(); if(submitting) return;
    const v=form.querySelectorAll('input,select,textarea'); submitting=true;
    if(btn){btn.disabled=true;btn.textContent='Submitting…';}
    try{
      const payload={student_name:v[0].value.trim(),class_name:v[1].value,guardian_name:v[2].value.trim(),mobile:v[3].value.trim(),address:v[4].value.trim(),document_name:v[5].files[0]?.name||''};
      const r=await fetch('/api/admissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const d=await r.json(); if(!r.ok) throw new Error(d.error||'Submission failed');
      admissionId=d.id;
      if(thanks){thanks.style.display='block';thanks.innerHTML=d.duplicate?'✓ Application already received. We found your existing application.':'✓ Application submitted successfully.';}
      if(payment) payment.style.display='block'; if(done) done.style.display='block';
      if(status) status.textContent='Please complete the UPI payment. After your UPI app shows SUCCESS, return here and tap “I Have Completed Payment”.';
      if(payment) payment.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(err){alert(err.message||'Submission failed');submitting=false;if(btn){btn.disabled=false;btn.textContent='Submit & Proceed to Payment';}}
  },true);
  const payBtn=document.getElementById('upiPayBtn');
  if(payBtn) payBtn.addEventListener('click',function(){setTimeout(function(){if(status) status.textContent='UPI app opened. If the UPI app shows SUCCESS, return here and tap “I Have Completed Payment”.';},500);});
  if(done) done.addEventListener('click',async function(){
    if(!admissionId){alert('Please submit the admission form first.');return;}
    done.disabled=true; done.textContent='Confirming…';
    try{
      const r=await fetch('/api/admissions/'+admissionId+'/payment-confirmed',{method:'POST'}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'Could not update payment');
      if(status){status.textContent='✓ Payment completed successfully. Your admission application and payment confirmation have been recorded.';status.style.color='#087443';}
      done.textContent='Payment Completed ✓';
    }catch(err){done.disabled=false;done.textContent='I Have Completed Payment';alert(err.message||'Could not update payment');}
  });
})();
</script>`;
   html=html.replace('</body></html>',js+'\n</body></html>');
   fs.writeFileSync(indexFile,html);
  }
  const adminFile=path.join(__dirname,'admin-online.html');
  if(fs.existsSync(adminFile)){
   let html=fs.readFileSync(adminFile,'utf8');
   html=html.replace(/<div class=item><b>\$\{esc\(x\.student_name\)\}<\/b> — \$\{esc\(x\.class_name\)\}<br>Guardian: \$\{esc\(x\.guardian_name\)\}<br>Mobile: \$\{esc\(x\.mobile\)\}<br>Address: \$\{esc\(x\.address\)\}<br><span class=muted>\$\{esc\(x\.created_at\)\}<\/span><\/div>/g,
   "<div class=item><b>${esc(x.student_name)}</b> — ${esc(x.class_name)}<br>Guardian: ${esc(x.guardian_name)}<br>Mobile: ${esc(x.mobile)}<br>Address: ${esc(x.address)}<br><b>Payment: ${esc(x.payment_status||'Pending')}</b><br><span class=muted>${esc(x.created_at)}</span></div>");
   fs.writeFileSync(adminFile,html);
  }
 }catch(e){console.error('HTML patch failed',e);}
}
patchPublicAndAdminPages();
app.listen(PORT,"0.0.0.0",()=>console.log(`Witty Buddy Play School running on port ${PORT}`));
