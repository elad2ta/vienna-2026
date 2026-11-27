// Family chat and shared photos, stored in Firebase (Firestore).
// Access: anonymous sign-in + a family code checked by the Firestore security rules
// (the code lives only in the rules in the Firebase console, never in this public file).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, doc, getDoc, setDoc, deleteDoc,
  collection, query, orderBy, limit, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Paste the web app config from Firebase → Project settings → Your apps.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDagUHAkQMkW8r8mbe4ntxL9RXeK_YqcHQ",
  authDomain: "vienna-2026.firebaseapp.com",
  projectId: "vienna-2026",
  storageBucket: "vienna-2026.firebasestorage.app",
  messagingSenderId: "943221920820",
  appId: "1:943221920820:web:90f672b6f8bbf14e422661"
};

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const phMsg = t => { $("#phMsg").textContent = t || ""; };
const chMsg = t => { $("#chMsg").textContent = t || ""; };

$("#panel-photo .lead").textContent = "כל המשפחה רואה את התמונות כאן, וכל אחד יכול להוסיף ולמחוק. לוחצים על תמונה כדי להגדיל, לשמור או למחוק.";
$("#panel-chat .lead").textContent = "הודעות בין כל בני המשפחה. כשמגיעה הודעה חדשה מופיעה נקודה אדומה על הלשונית.";

// Day picker for uploads.
(function(){
  const ti = DAYS.findIndex(d => d.date === today);
  $("#phDay").innerHTML = DAYS.map((d,i) => '<option value="'+d.label+'"'+(i===(ti>=0?ti:0)?' selected':'')+'>'+d.dow+' '+d.label+'</option>').join("");
})();

let db = null, uid = null;
let photos = [], phFilter = "all", lbCur = null, delArm = false;
let chat = [];
const names = {};

function lockUI(msg){
  $("#phUp").hidden = true; $("#chatform").hidden = true;
  $("#chatlist").innerHTML = ""; phMsg(msg); chMsg(msg);
}

/* ---------- joining ---------- */
function joinForm(where){
  const box = document.createElement("div");
  box.className = "card joinbox";
  box.innerHTML = '<h3>כניסה למשפחה</h3><p>פעם אחת בכל טלפון: השם שלכם והקוד המשפחתי.</p>'
    + '<div class="netform"><label>השם שלי<input class="jName" autocomplete="nickname" maxlength="40" style="direction:rtl;text-align:right"></label>'
    + '<label>קוד משפחתי<input class="jCode" autocomplete="off"></label>'
    + '<button class="primary jGo" type="button">כניסה</button></div><p class="note jMsg" style="margin-top:4px"></p>';
  where.insertAdjacentElement("afterend", box);
  box.querySelector(".jGo").onclick = async () => {
    const name = box.querySelector(".jName").value.trim(), code = box.querySelector(".jCode").value.trim();
    const m = box.querySelector(".jMsg");
    if (!name || !code) { m.textContent = "צריך למלא שם וקוד."; return; }
    m.textContent = "נכנסים...";
    try {
      await setDoc(doc(db, "members", uid), { name, code, ts: Date.now() });
      document.querySelectorAll(".joinbox").forEach(b => b.remove());
      start();
    } catch (e) {
      m.textContent = /permission/i.test(String(e && e.code)) ? "הקוד לא נכון." : "לא הצלחתי להיכנס. בדקו את החיבור לאינטרנט.";
    }
  };
}
function showJoin(){
  lockUI("");
  joinForm($("#phMsg"));
  joinForm($("#chMsg"));
}

/* ---------- photos ---------- */
function renderPhotos(){
  $("#phFilter").innerHTML = ["all"].concat(DAYS.map(d => d.label)).map(k => '<button type="button" class="chip'+(phFilter===k?' on':'')+'" data-f="'+k+'">'+(k==="all"?"הכול":esc(k))+'</button>').join("");
  $("#phFilter").querySelectorAll(".chip").forEach(b => b.onclick = () => { phFilter = b.dataset.f; renderPhotos(); });
  const list = photos.filter(p => p.thumb && (phFilter === "all" || p.day === phFilter));
  $("#phEmpty").hidden = list.length > 0;
  $("#pgrid").innerHTML = list.map(p => '<button type="button" data-p="'+esc(p.id)+'" aria-label="תמונה מ־'+esc(p.day||"")+'"><img loading="lazy" alt="" src="'+p.thumb+'"></button>').join("");
}
$("#pgrid").addEventListener("click", e => { const b = e.target.closest("button[data-p]"); if (b) openLb(b.dataset.p); });
async function openLb(id){
  lbCur = photos.find(p => p.id === id); if (!lbCur) return;
  const cur = lbCur;
  $("#lbImg").src = cur.thumb; $("#lbFull").hidden = true;
  const d = DAYS.find(x => x.label === cur.day);
  $("#lbCap").textContent = (d ? d.dow + " " + d.label : "") + (names[cur.by] ? " · " + names[cur.by] : "");
  $("#lbDel").hidden = false; delArm = false; $("#lbDel").textContent = "מחק";
  $("#lb").hidden = false; $("#lbClose").focus();
  try {
    const s = await getDoc(doc(db, "photoFull", cur.id));
    if (lbCur === cur && s.exists()) { const src = s.data().data; $("#lbImg").src = src; $("#lbFull").href = src; $("#lbFull").download = "vienna-" + (cur.day || "") + ".jpg"; $("#lbFull").hidden = false; }
  } catch (e) {}
}
function closeLb(){ $("#lb").hidden = true; $("#lbImg").removeAttribute("src"); lbCur = null; }
$("#lbFull").textContent = "שמירה";
$("#lbClose").onclick = closeLb;
$("#lb").addEventListener("click", e => { if (e.target.id === "lb") closeLb(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#lb").hidden) closeLb(); });
$("#lbDel").onclick = async () => {
  if (!delArm) { delArm = true; $("#lbDel").textContent = "למחוק? לחצו שוב"; return; }
  const p = lbCur; closeLb();
  try { const b = writeBatch(db); b.delete(doc(db, "photos", p.id)); b.delete(doc(db, "photoFull", p.id)); await b.commit(); phMsg("התמונה נמחקה."); }
  catch (e) { phMsg("לא הצלחתי למחוק את התמונה."); }
};
async function toJpeg(file, maxSide, quality){
  let bmp; try { bmp = await createImageBitmap(file, {imageOrientation:"from-image"}); } catch (e) { bmp = await createImageBitmap(file); }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width*s); c.height = Math.round(bmp.height*s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
async function fullImage(file){
  for (const [side, q] of [[1600,.8],[1280,.75],[1024,.7],[800,.65]]) { const u = await toJpeg(file, side, q); if (u.length < 950000) return u; }
  throw new Error("too big");
}
$("#phIn").onchange = async e => {
  const files = Array.from(e.target.files || []); e.target.value = "";
  if (!files.length || !db) return;
  const day = $("#phDay").value; let ok = 0;
  $("#phUp").style.pointerEvents = "none"; $("#phUp").style.opacity = ".6";
  for (let i = 0; i < files.length; i++) {
    phMsg("מעלה " + (i+1) + " מתוך " + files.length + "...");
    try {
      const id = "p" + Date.now() + Math.random().toString(36).slice(2,7), ts = Date.now();
      const [thumb, full] = [await toJpeg(files[i], 360, .7), await fullImage(files[i])];
      const b = writeBatch(db);
      b.set(doc(db, "photos", id), { thumb, day, by: uid, ts });
      b.set(doc(db, "photoFull", id), { data: full, by: uid, ts });
      await b.commit(); ok++;
    } catch (err) { console.log("[photos]", err && (err.code || err.message)); }
  }
  $("#phUp").style.pointerEvents = ""; $("#phUp").style.opacity = "";
  phMsg(ok === files.length ? (ok === 1 ? "התמונה הועלתה." : ok + " תמונות הועלו.") : "הועלו " + ok + " מתוך " + files.length + ". אפשר לנסות שוב את השאר.");
  if (ok && typeof confetti === "function") confetti($("#phUp"), 14);
};

/* ---------- chat ---------- */
const chSeen = () => { try { return +(localStorage.getItem("vienna-chat-seen") || 0); } catch (e) { return 0; } };
const chTime = ts => { try { return new Intl.DateTimeFormat("he-IL", {hour:"2-digit", minute:"2-digit"}).format(new Date(ts)); } catch (e) { return ""; } };
const chDay = ts => { try { return new Intl.DateTimeFormat("he-IL", {weekday:"long", day:"numeric", month:"numeric"}).format(new Date(ts)); } catch (e) { return ""; } };
const chOpen = () => !$("#panel-chat").hidden;
function updBadge(){
  const t = document.querySelector('nav.tabs button[data-panel="chat"]'); if (!t) return;
  const last = chat[chat.length-1];
  t.classList.toggle("hasNew", !!(last && last.by !== uid && last.ts > chSeen() && !chOpen()));
}
function markSeen(){ const last = chat[chat.length-1]; try { localStorage.setItem("vienna-chat-seen", String(Math.max(last ? last.ts : 0, chSeen()))); } catch (e) {} updBadge(); }
const scrollChat = () => window.scrollTo(0, document.body.scrollHeight);
function renderChat(){
  let html = "", lastDay = "";
  chat.forEach(m => {
    const d = chDay(m.ts); if (d !== lastDay) { html += '<div class="daysep">'+esc(d)+'</div>'; lastDay = d; }
    const me = m.by === uid;
    html += '<div class="msg'+(me?' me':'')+'">'+(me?'':'<div class="who">'+esc(names[m.by] || "מישהו")+'</div>')+'<div class="txt">'+esc(m.text || "")+'</div><div class="tm">'+chTime(m.ts)+'</div></div>';
  });
  $("#chatlist").innerHTML = html || '<p class="lead">עוד אין הודעות. אפשר להתחיל!</p>';
  if (chOpen()) { scrollChat(); markSeen(); } else updBadge();
}
showPanel = (orig => name => { orig(name); if (name === "chat") setTimeout(() => { scrollChat(); markSeen(); }, 0); else updBadge(); })(showPanel);
const chatIn = $("#chatIn");
chatIn.addEventListener("input", () => { chatIn.style.height = "auto"; chatIn.style.height = Math.min(chatIn.scrollHeight, 120) + "px"; });
chatIn.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); $("#chatform").requestSubmit(); } });
$("#chatform").onsubmit = async e => {
  e.preventDefault();
  const t = chatIn.value.trim(); if (!t || !db) return;
  $("#chatSend").disabled = true; chMsg("");
  try {
    await setDoc(doc(db, "chat", "m" + Date.now() + Math.random().toString(36).slice(2,6)), { by: uid, text: t.slice(0, 2000), ts: Date.now() });
    chatIn.value = ""; chatIn.style.height = "auto";
  } catch (err) { chMsg("ההודעה לא נשלחה. בדקו את החיבור ונסו שוב."); }
  finally { $("#chatSend").disabled = false; }
};

/* ---------- start ---------- */
function start(){
  $("#phUp").hidden = false; $("#chatform").hidden = false; phMsg(""); chMsg("");
  $("#chatlist").innerHTML = '<p class="lead">טוען הודעות...</p>';
  onSnapshot(collection(db, "members"), snap => { snap.docs.forEach(d => { names[d.id] = d.data().name || ""; }); renderChat(); renderPhotos(); }, () => {});
  onSnapshot(query(collection(db, "photos"), orderBy("ts", "desc")), snap => {
    photos = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); renderPhotos();
  }, () => phMsg("לא הצלחתי לטעון את התמונות."));
  onSnapshot(query(collection(db, "chat"), orderBy("ts", "desc"), limit(300)), snap => {
    chat = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(m => m.text).reverse(); renderChat();
  }, () => chMsg("לא הצלחתי לטעון את ההודעות."));
}

renderPhotos();
if (!FIREBASE_CONFIG.apiKey) {
  lockUI("התמונות והצ׳אט יופעלו בקרוב.");
} else {
  lockUI("מתחבר...");
  const app = initializeApp(FIREBASE_CONFIG);
  db = initializeFirestore(app, { localCache: persistentLocalCache() });
  const auth = getAuth(app);
  onAuthStateChanged(auth, async user => {
    if (!user) { signInAnonymously(auth).catch(() => lockUI("לא הצלחתי להתחבר. בדקו את החיבור לאינטרנט.")); return; }
    if (uid === user.uid) return;
    uid = user.uid;
    try {
      const me = await getDoc(doc(db, "members", uid));
      if (me.exists()) start(); else showJoin();
    } catch (e) { lockUI("לא הצלחתי להתחבר. בדקו את החיבור לאינטרנט."); }
  });
}
