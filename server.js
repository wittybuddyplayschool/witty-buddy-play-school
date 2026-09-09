
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
 const {student_name,class_name,guardian_name,mobile,address,document_name=""}=req.body;
 if(!student_name||!class_name||!guardian_name||!mobile||!address) return res.status(400).json({error:"Please fill all required fields"});
 const r=db.prepare(`INSERT INTO admissions(student_name,class_name,guardian_name,mobile,address,document_name) VALUES(?,?,?,?,?,?)`)
 .run(student_name,class_name,guardian_name,mobile,address,document_name);
 res.json({ok:true,id:r.lastInsertRowid,message:"Application received"});
});
app.get("/api/admissions",auth,(req,res)=>res.json(db.prepare("SELECT * FROM admissions ORDER BY id DESC").all()));

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"admin-online.html")));
app.use((err,req,res,next)=>{console.error("Unhandled server error",err);if(res.headersSent)return next(err);res.status(500).json({error:"Server error: "+err.message})});
app.listen(PORT,"0.0.0.0",()=>console.log(`Witty Buddy Play School running on port ${PORT}`));
