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
  if (where.id === "joinOvCard") { box.className = "joinbox"; box.querySelector("h3").remove(); box.querySelector("p").remove(); where.appendChild(box); }
  else where.insertAdjacentElement("afterend", box);
  box.querySelector(".jGo").onclick = async () => {
    const name = box.querySelector(".jName").value.trim(), code = box.querySelector(".jCode").value.trim();
    const m = box.querySelector(".jMsg");
    if (!name || !code) { m.textContent = "צריך למלא שם וקוד."; return; }
    m.textContent = "נכנסים...";
    try {
      await setDoc(doc(db, "members", uid), { name, code, ts: Date.now() });
      document.querySelectorAll(".joinbox").forEach(b => b.remove());
      const ov = $("#joinOv"); if (ov) ov.remove();
      start();
    } catch (e) {
      m.textContent = /permission/i.test(String(e && e.code)) ? "הקוד לא נכון." : "לא הצלחתי להיכנס. בדקו את החיבור לאינטרנט.";
    }
  };
}
// Welcome screen on first open: name + family code, so chat, photos and the QR work right away.
function joinOverlay(){
  if ($("#joinOv")) return;
  const ov = document.createElement("div");
  ov.id = "joinOv"; ov.setAttribute("dir", "rtl"); ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
  ov.style.cssText = "position:fixed;inset:0;z-index:60;background:rgba(10,30,22,.6);display:flex;align-items:center;justify-content:center;padding:16px";
  ov.innerHTML = '<div id="joinOvCard" class="card" style="width:100%;max-width:420px;margin:0;border:2px solid var(--gold);padding:18px 16px">'
    + '<h3 style="font-size:1.4rem;color:var(--pine);margin-bottom:4px">ברוכים הבאים לטיול!</h3>'
    + '<p>פעם אחת בטלפון הזה: השם שלכם והקוד המשפחתי. אחר כך הצ׳אט, התמונות וקוד ה־QR של האינטרנט פתוחים לכם.</p></div>';
  document.body.appendChild(ov);
  joinForm($("#joinOvCard"));
  const later = document.createElement("button");
  later.type = "button"; later.className = "copy"; later.textContent = "אחר כך"; later.style.marginTop = "8px";
  later.onclick = () => ov.remove();
  $("#joinOvCard").appendChild(later);
  setTimeout(() => { const n = ov.querySelector(".jName"); if (n) n.focus(); }, 100);
}
function showJoin(){
  lockUI("");
  joinForm($("#phMsg"));
  joinForm($("#chMsg"));
  joinOverlay();
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

/* ---------- shared hotspot QR (same for the whole family) ---------- */
const hsNote = () => [...document.querySelectorAll("#netPanel .note")].find(n => n.textContent.includes("שם הרשת"));
function hotspotLocked(){
  const n = hsNote(); if (n) n.textContent = "כדי לראות את קוד ה־QR של המשפחה, נכנסים פעם אחת בלשונית צ׳אט עם השם והקוד המשפחתי.";
}
let hsOpened = false;
function watchHotspot(){
  const n = hsNote(); if (n) n.textContent = "שם הרשת והסיסמה משותפים לכל המשפחה: מה שנשמר כאן מופיע אצל כולם. מציגים את הקוד, ובטלפון השני סורקים אותו במצלמה.";
  const btn = $("#hsMake");
  if (btn) btn.onclick = async () => {
    const v = { ssid: $("#hsSsid").value.trim(), pass: $("#hsPass").value };
    try { localStorage.setItem("vienna-hotspot", JSON.stringify(v)); } catch (e) {}
    drawQr(v.ssid, v.pass);
    try { await setDoc(doc(db, "shared", "hotspot"), v); } catch (e) {}
  };
  onSnapshot(doc(db, "shared", "hotspot"), snap => {
    if (!snap.exists()) return;
    const v = snap.data(), s = $("#hsSsid"), p = $("#hsPass");
    try { localStorage.setItem("vienna-hotspot", JSON.stringify({ ssid: v.ssid || "", pass: v.pass || "" })); } catch (e) {}
    if (s && p && document.activeElement !== s && document.activeElement !== p) { s.value = v.ssid || ""; p.value = v.pass || ""; }
    drawQr(v.ssid, v.pass);
    if (!hsOpened && v.ssid) { hsOpened = true; const d = document.querySelector('details.sec[data-sec="qr"]'); if (d) d.open = true; }
  }, () => {});
}

/* ---------- start ---------- */
function start(){
  watchHotspot();
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

/* ---------- stay in the same place after a refresh ---------- */
const POS_KEY = "vienna-pos";
function savePos(){
  const open = document.querySelector("section.panel:not([hidden])");
  const pos = { panel: open ? open.id.replace("panel-", "") : "day", day: current, y: Math.round(window.scrollY), t: Date.now() };
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
}
let posTimer = null;
addEventListener("scroll", () => { clearTimeout(posTimer); posTimer = setTimeout(savePos, 300); }, { passive: true });
document.addEventListener("click", () => setTimeout(savePos, 50));
addEventListener("pagehide", savePos);
document.addEventListener("visibilitychange", () => { if (document.hidden) savePos(); });
(function restorePos(){
  let pos = null; try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) {}
  // Only right after a refresh or update (within 30 minutes); otherwise the app opens on today as usual.
  if (!pos || !(Date.now() - pos.t < 30 * 60 * 1000)) return;
  if (Number.isInteger(pos.day) && pos.day >= 0 && pos.day < DAYS.length && pos.day !== current) { current = pos.day; renderDays(); renderDay(); }
  if (pos.panel && document.getElementById("panel-" + pos.panel)) showPanel(pos.panel);
  const y = pos.y || 0; let moved = false;
  ["touchstart", "wheel", "keydown"].forEach(ev => addEventListener(ev, () => { moved = true; }, { once: true, passive: true }));
  // Content (photos, messages) arrives a moment later, so try a few times until the page is tall enough.
  [0, 300, 900, 2000].forEach(ms => setTimeout(() => { if (!moved && Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y); }, ms));
})();

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
      if (me.exists()) start(); else { showJoin(); hotspotLocked(); }
    } catch (e) { lockUI("לא הצלחתי להתחבר. בדקו את החיבור לאינטרנט."); }
  });
}
