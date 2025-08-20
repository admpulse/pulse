/**********************************************************
 * PULSE — App Front-end + Firebase (Auth, Firestore)
 * Fluxos: Login/Cadastro, Check-in, Swipe, Match, Chat
 * Requer: index.html com window._fb exposto (já OK)
 **********************************************************/

/* ---------------------------- Atalhos Firebase ---------------------------- */
const FB = window._fb;
const {
  auth, db, storage,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, FacebookAuthProvider, signInWithPopup, signOut, updateProfile,
  doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, serverTimestamp,
  ref, uploadBytes, getDownloadURL
} = FB;

/* ---------------------------- Estado Global ---------------------------- */
const State = {
  user: null,              // doc em /users/{uid}
  isLoggedIn: false,
  currentPlace: null,      // string do select
  cards: [],               // perfis renderizados (outros usuários no mesmo local)
  cardIndex: 0,
  likesGiven: {},          // cache local para não repetir
  lastMatch: null,         // { matchId, profile }
  chat: {
    matchId: null,
    other: null,           // { uid, name, photo }
    unsubMessages: null
  }
};

/* ---------------------------- Utilidades ---------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function screenOnly(id) {
  $$(".screen").forEach(s => hide(s));
  show($(id));
}

function nameFromEmail(email) {
  if (!email) return "Usuário";
  return email.split("@")[0]?.replace(/\W+/g, " ").trim() || "Usuário";
}

/* ---------------------------- Perfil (Firestore) ---------------------------- */
const Profile = {
  async ensureUserDoc(firebaseUser) {
    const uid = firebaseUser.uid;
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      const displayName = firebaseUser.displayName || nameFromEmail(firebaseUser.email);
      const photoURL = firebaseUser.photoURL || "";
      await setDoc(doc(db, "users", uid), {
        uid,
        name: displayName,
        email: firebaseUser.email || null,
        photoURL,
        age: 25,
        status: "Solteiro",
        currentPlace: null,
        createdAt: serverTimestamp()
      });
    }
  },
  async loadMe() {
    const u = auth.currentUser;
    if (!u) return null;
    const d = await getDoc(doc(db, "users", u.uid));
    return d.exists() ? d.data() : null;
  },
  async setPlace(place) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, "users", uid), { currentPlace: place }, { merge: true });
  },
  async clearPlace() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(doc(db, "users", uid), { currentPlace: null }, { merge: true });
  }
};

/* ---------------------------- Pessoas por local ---------------------------- */
const People = {
  async fetchNearby(place) {
    // Lista usuários no mesmo lugar (exceto eu)
    const qs = query(collection(db, "users"), where("currentPlace", "==", place));
    const snap = await getDocs(qs);
    const arr = [];
    snap.forEach(d => {
      const val = d.data();
      if (val.uid !== auth.currentUser?.uid) {
        val.distanceKm = (Math.random() * 2).toFixed(2);
        arr.push({
          id: val.uid,
          name: val.name || "Usuário",
          age: val.age || 25,
          photo: val.photoURL || "https://placehold.co/300x300",
          bio: "Disponível no local",
          interests: ["Música"],
          status: val.status || "Solteiro",
          distanceKm: val.distanceKm
        });
      }
    });
    arr.sort((a, b) => a.distanceKm - b.distanceKm);
    return arr;
  }
};

/* ---------------------------- Swipes / Matches / Chat ---------------------------- */
const Swipes = {
  async like(toUid, place) {
    await addDoc(collection(db, "swipes"), {
      fromUid: auth.currentUser.uid,
      toUid,
      place: place || null,
      action: "like",
      createdAt: serverTimestamp()
    });
  },
  async dislike(toUid, place) {
    await addDoc(collection(db, "swipes"), {
      fromUid: auth.currentUser.uid,
      toUid,
      place: place || null,
      action: "dislike",
      createdAt: serverTimestamp()
    });
  },
  async isMutual(toUid) {
    // verifica se o outro já deu like em mim
    const q1 = query(
      collection(db, "swipes"),
      where("fromUid", "==", toUid),
      where("toUid", "==", auth.currentUser.uid),
      where("action", "==", "like")
    );
    const snap = await getDocs(q1);
    return !snap.empty;
  }
};

const Matches = {
  buildId(otherUid, place) {
    const a = auth.currentUser.uid;
    const b = otherUid;
    const [x, y] = a < b ? [a, b] : [b, a];
    return `${x}_${y}_${place || "global"}`;
  },
  async createIfMutual(otherUid, place) {
    const mutual = await Swipes.isMutual(otherUid);
    if (!mutual) return null;
    const matchId = this.buildId(otherUid, place);
    const mRef = doc(db, "matches", matchId);
    const existing = await getDoc(mRef);
    if (!existing.exists()) {
      await setDoc(mRef, {
        id: matchId,
        uids: [auth.currentUser.uid, otherUid],
        place: place || null,
        createdAt: serverTimestamp()
      });
    }
    return matchId;
  }
};

const Chat = {
  async openFor(otherProfile) {
    // Descobre matchId determinístico
    const matchId = Matches.buildId(otherProfile.id, State.currentPlace || "global");
    State.chat.matchId = matchId;
    State.chat.other = { uid: otherProfile.id, name: otherProfile.name, photo: otherProfile.photo };

    // Navega para tela de chat
    screenOnly("#chat-screen");
    $("#chat-messages").innerHTML = "";

    // Liga listener em tempo real para mensagens
    if (State.chat.unsubMessages) {
      State.chat.unsubMessages();
      State.chat.unsubMessages = null;
    }
    const { onSnapshot, orderBy, limit } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
    const msgsRef = collection(db, "matches", matchId, "messages");
    const qMsgs = query(msgsRef, orderBy("ts", "asc"), limit(200));

    State.chat.unsubMessages = onSnapshot(qMsgs, (snap) => {
      const msgs = [];
      snap.forEach(d => msgs.push(d.data()));
      Chat.render(msgs);
    });
  },
  async send(text) {
    if (!text.trim()) return;
    await addDoc(collection(db, "matches", State.chat.matchId, "messages"), {
      from: auth.currentUser.uid,
      text: text.trim(),
      ts: serverTimestamp()
    });
    $("#chat-input").value = "";
  },
  close() {
    if (State.chat.unsubMessages) {
      State.chat.unsubMessages();
      State.chat.unsubMessages = null;
    }
    State.chat.matchId = null;
    State.chat.other = null;
    // volta para swipes
    screenOnly("#swipe-screen");
  },
  render(messages) {
    const box = $("#chat-messages");
    box.innerHTML = "";
    messages.forEach(m => {
      const mine = m.from === auth.currentUser.uid;
      const div = document.createElement("div");
      div.className = `msg ${mine ? "me" : "them"}`;
      div.innerHTML = `
        <div class="bubble ${mine ? "me" : "them"}">
          <p>${escapeHtml(m.text || "")}</p>
        </div>
      `;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }
};

/* ---------------------------- Swipe UI ---------------------------- */
const Swipe = {
  async reloadCards() {
    const container = $("#cards-container");
    container.innerHTML = "<p style='padding:16px;text-align:center;'>Carregando...</p>";
    if (!State.currentPlace) {
      container.innerHTML = "<p style='padding:16px;text-align:center;'>Faça check-in para ver pessoas.</p>";
      return;
    }
    const list = await People.fetchNearby(State.currentPlace);
    State.cards = list;
    State.cardIndex = 0;
    if (!list.length) {
      container.innerHTML = "<p style='padding:16px;text-align:center;'>Ninguém por aqui agora.</p>";
      return;
    }
    container.innerHTML = "";
    list.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = `card ${idx === 0 ? "top" : "hidden"}`;
      card.dataset.uid = p.id;
      card.innerHTML = `
        <div class="photo" style="background-image:url('${p.photo}')"></div>
        <div class="info">
          <h3>${p.name}, ${p.age}</h3>
          <p>${p.bio}</p>
          <small>${p.distanceKm} km • ${p.status}</small>
        </div>
      `;
      this._attachDrag(card, p);
      container.appendChild(card);
    });
  },
  current() {
    return State.cards[State.cardIndex] || null;
  },
  _advance() {
    const cards = $$("#cards-container .card");
    if (cards[State.cardIndex]) cards[State.cardIndex].remove();
    State.cardIndex++;
    const next = cards[State.cardIndex];
    if (next) next.classList.remove("hidden");
  },
  async like() {
    const p = this.current(); if (!p) return;
    State.likesGiven[p.id] = "like";
    await Swipes.like(p.id, State.currentPlace);
    const matchId = await Matches.createIfMutual(p.id, State.currentPlace);
    if (matchId) {
      State.lastMatch = { matchId, profile: p };
      // Atualiza UI de match
      $("#matchUserA").src = State.user?.photoURL || "https://placehold.co/120x120";
      $("#matchUserB").src = p.photo;
      $("#matchText").textContent = `Você e ${p.name} curtiram um ao outro!`;
      screenOnly("#match-screen");
    } else {
      this._advance();
    }
  },
  async dislike() {
    const p = this.current(); if (!p) return;
    State.likesGiven[p.id] = "dislike";
    await Swipes.dislike(p.id, State.currentPlace);
    this._advance();
  },
  _attachDrag(card, profile) {
    let startX = 0, deltaX = 0, dragging = false;

    const move = (x) => {
      if (!dragging) return;
      deltaX = x - startX;
      card.style.transform = `translateX(${deltaX}px) rotate(${deltaX / 20}deg)`;
      card.style.transition = "none";
    };
    const end = async () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = "transform .2s ease";
      if (deltaX > 100) {
        card.style.transform = "translateX(300px) rotate(15deg)";
        await this.like();
      } else if (deltaX < -100) {
        card.style.transform = "translateX(-300px) rotate(-15deg)";
        await this.dislike();
      } else {
        card.style.transform = "translateX(0) rotate(0)";
      }
    };

    card.addEventListener("mousedown", (e) => { dragging = true; startX = e.clientX; });
    card.addEventListener("mousemove", (e) => move(e.clientX));
    card.addEventListener("mouseup", end);
    card.addEventListener("mouseleave", end);

    card.addEventListener("touchstart", (e) => { dragging = true; startX = e.touches[0].clientX; });
    card.addEventListener("touchmove", (e) => move(e.touches[0].clientX));
    card.addEventListener("touchend", end);
  }
};

/* ---------------------------- Autenticação (UI) ---------------------------- */
const AuthUI = {
  async loginEmail() {
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-password").value.trim();
    if (!email || !pass) return alert("Preencha email e senha.");
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await Profile.ensureUserDoc(cred.user);
  },
  async registerEmail() {
    const email = $("#auth-email").value.trim();
    const pass = $("#auth-password").value.trim();
    if (!email || !pass) return alert("Informe email e senha para cadastrar.");
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    // define displayName básico
    await updateProfile(cred.user, { displayName: nameFromEmail(email) });
    await Profile.ensureUserDoc(cred.user);
    alert("Conta criada! Você já está logado.");
  },
  async loginGoogle() {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await Profile.ensureUserDoc(cred.user);
  },
  async loginFacebook() {
    const provider = new FacebookAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    await Profile.ensureUserDoc(cred.user);
  },
  async logout() {
    // Ao sair, limpa presença
    await Profile.clearPlace();
    await signOut(auth);
  }
};

/* ---------------------------- Check-in ---------------------------- */
async function doCheckin() {
  const sel = $("#checkin-place");
  const place = sel.value || null;
  if (!place) return alert("Selecione um local.");
  State.currentPlace = place;
  await Profile.setPlace(place);
  await Swipe.reloadCards();
  screenOnly("#swipe-screen");
}

/* ---------------------------- Navegação de telas ---------------------------- */
function goContinueFromMatch() {
  State.lastMatch = null;
  screenOnly("#swipe-screen");
}

function openChatFromMatch() {
  if (!State.lastMatch) return goContinueFromMatch();
  Chat.openFor(State.lastMatch.profile);
}

/* ---------------------------- Helpers UI (mínimos) ---------------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* ---------------------------- Handlers de Botões ---------------------------- */
function bindEvents() {
  $("#btn-login-email").addEventListener("click", () => AuthUI.loginEmail().catch(err => alert(err.message)));
  $("#btn-register-email").addEventListener("click", () => AuthUI.registerEmail().catch(err => alert(err.message)));
  $("#btn-login-google").addEventListener("click", () => AuthUI.loginGoogle().catch(err => alert(err.message)));
  $("#btn-login-facebook").addEventListener("click", () => AuthUI.loginFacebook().catch(err => alert(err.message)));

  $("#btn-checkin").addEventListener("click", () => doCheckin().catch(err => alert(err.message)));

  $("#btn-like").addEventListener("click", () => Swipe.like().catch(err => alert(err.message)));
  $("#btn-dislike").addEventListener("click", () => Swipe.dislike().catch(err => alert(err.message)));

  $("#btn-open-chat").addEventListener("click", openChatFromMatch);
  $("#btn-continue").addEventListener("click", goContinueFromMatch);

  $("#btn-send-chat").addEventListener("click", () => {
    const text = $("#chat-input").value;
    Chat.send(text).catch(err => alert(err.message));
  });
  $("#btn-close-chat").addEventListener("click", () => Chat.close());
}

/* ---------------------------- Auth Observer ---------------------------- */
function startAuthWatcher() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await Profile.ensureUserDoc(user);
      State.user = await Profile.loadMe();
      State.isLoggedIn = true;
      // Vai para check-in (se já tinha place salvo, mantém)
      if (State.user?.currentPlace) {
        State.currentPlace = State.user.currentPlace;
        await Swipe.reloadCards();
        screenOnly("#swipe-screen");
      } else {
        screenOnly("#checkin-screen");
      }
    } else {
      State.user = null;
      State.isLoggedIn = false;
      State.currentPlace = null;
      screenOnly("#auth-screen");
    }
  });
}

/* ---------------------------- Bootstrap ---------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // splash curto
  setTimeout(() => {
    screenOnly("#auth-screen");
  }, 400);

  bindEvents();
  startAuthWatcher();
});
