/**********************************************************
 * PULSE — MVP Front-end (protótipo navegável)
 * Melhorias:
 *  - Swipe por arrasto (touch/mouse)
 *  - Distância simulada dinamicamente
 *  - Matches/chats persistidos por local
 **********************************************************/

/* ---------------------------- Estado & Mock DB ---------------------------- */

const DB = {
  profiles: [
    { id: 1,  name: "Ana",      age: 24, photo: "https://randomuser.me/api/portraits/women/33.jpg", bio: "Amo dançar e conhecer pessoas novas",       interests: ["Música","Viagens"],     status: "Solteiro", likedYou: true  },
    { id: 2,  name: "Carlos",   age: 28, photo: "https://randomuser.me/api/portraits/men/22.jpg",   bio: "Programador e cervejeiro nas horas vagas",   interests: ["Tecnologia","Comida"], status: "Amizade",  likedYou: false },
    { id: 3,  name: "Mariana",  age: 26, photo: "https://randomuser.me/api/portraits/women/44.jpg", bio: "Sempre pronta para uma boa conversa",        interests: ["Filmes","Música"],     status: "Namoro",   likedYou: true  },
    { id: 4,  name: "Pedro",    age: 30, photo: "https://randomuser.me/api/portraits/men/45.jpg",   bio: "Músico e apaixonado por viagens",            interests: ["Música","Viagens"],    status: "Networking", likedYou: false },
    { id: 5,  name: "Juliana",  age: 27, photo: "https://randomuser.me/api/portraits/women/55.jpg", bio: "Fotógrafa e exploradora de bares",            interests: ["Fotografia","Comida"], status: "Solteiro", likedYou: false },
    { id: 6,  name: "Rafa",     age: 25, photo: "https://randomuser.me/api/portraits/men/11.jpg",   bio: "Viciado em filmes e boas conversas",         interests: ["Filmes","Comida"],     status: "Solteiro", likedYou: true  },
  ],
  places: [
    { name: "Barzinho do João", icon: "fa-glass-martini-alt", color: "text-purple-600", bg: "bg-purple-100", distance: "300m" },
    { name: "Boate X",          icon: "fa-music",             color: "text-blue-600",   bg: "bg-blue-100",    distance: "450m" },
    { name: "Praça Central",    icon: "fa-tree",              color: "text-green-600",  bg: "bg-green-100",   distance: "600m" },
    { name: "Cafeteria Aconchego", icon: "fa-coffee",         color: "text-yellow-600", bg: "bg-yellow-100",  distance: "750m" },
  ],
};

const State = {
  user: null,
  isLoggedIn: false,
  checkin: null,              // { place, startedAt, expiresAt }
  checkinTimer: null,
  currentCards: [],
  currentCardIndex: 0,
  likesGiven: {},
  matches: {},                // { place: { profileId: { chat: [] } } }
  likesInboxCount: 0,
  filters: {
    ageMin: 18,
    ageMax: 30,
    interests: new Set(["Música"]),
    status: "Solteiro",
    maxKm: 5,
    stealth: false,
  },
  chatOpenWith: null,
};

/* ---------------------------- Persistência ---------------------------- */

const Storage = {
  save() {
    localStorage.setItem("pulse_state", JSON.stringify(State));
  },
  load() {
    const raw = localStorage.getItem("pulse_state");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      Object.assign(State, data);
      // retransforma Set
      if (data.filters?.interests) {
        State.filters.interests = new Set(data.filters.interests);
      }
    } catch(e) {
      console.warn("Erro ao carregar storage:", e);
    }
  },
  clearCheckinOnly() {
    State.checkin = null;
    if (State.checkinTimer) clearInterval(State.checkinTimer);
    State.checkinTimer = null;
    Storage.save();
  }
};

/* ---------------------------- Utils ---------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatCountdown(ms) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/* ---------------------------- UI ---------------------------- */

const UI = {
  boot() {
    setTimeout(() => {
      $("#loading-bar").style.width = "100%";
      setTimeout(() => {
        $("#loading-screen").classList.add("hidden");
        if (State.isLoggedIn) {
          if (Location.isCheckinValid()) Location.enterAppFromCheckin();
          else UI.showCheckin();
        } else {
          UI.showAuth();
        }
      }, 500);
    }, 1200);
  },
  showAuth() {
    $("#auth-screens").classList.remove("hidden");
    $("#login-screen").classList.remove("hidden");
    $("#login-email-screen").classList.add("hidden");
    $("#register-screen").classList.add("hidden");
  },
  showLoginEmail() {
    $("#login-screen").classList.add("hidden");
    $("#login-email-screen").classList.remove("hidden");
  },
  showRegister() {
    $("#login-screen").classList.add("hidden");
    $("#register-screen").classList.remove("hidden");
  },
  showLoginHome() {
    $("#register-screen").classList.add("hidden");
    $("#login-email-screen").classList.add("hidden");
    $("#login-screen").classList.remove("hidden");
  },
  showCheckin() {
    $("#auth-screens").classList.add("hidden");
    $("#checkin-screen").classList.remove("hidden");
    Location.renderPlaces();
  },
  hideCheckin() { $("#checkin-screen").classList.add("hidden"); },
  enterMainApp() {
    $("#main-app").classList.remove("hidden");
    $("#headerPlace").textContent = State.checkin?.place || "-";
    $("#profilePlace").textContent = State.checkin?.place || "—";
    Swipe.reloadCards();
    Location.startCountdown();
  },
  showFilters() { $("#filters-screen").classList.remove("hidden"); },
  hideFilters() { $("#filters-screen").classList.add("hidden"); },
  showProfile() { $("#profile-screen").classList.remove("hidden"); },
  hideProfile() { $("#profile-screen").classList.add("hidden"); },
  showPromo() { $("#promo-screen").classList.remove("hidden"); },
  hidePromo() { $("#promo-screen").classList.add("hidden"); },
  continueSwiping() { $("#match-screen").classList.add("hidden"); },
  updateLikesBadge() {
    const badge = $("#likesBadge");
    if (State.likesInboxCount > 0) {
      badge.textContent = State.likesInboxCount;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
};

/* ---------------------------- Auth ---------------------------- */

const Auth = {
  quickLogin(provider) {
    State.user = { id: 999, name: "João Silva", age: 25, status: "Solteiro", photo: "https://randomuser.me/api/portraits/men/32.jpg" };
    State.isLoggedIn = true;
    Storage.save();
    UI.showCheckin();
  },
  login() {
    State.user = { id: 999, name: "João Silva", age: 25, status: "Solteiro", photo: "https://randomuser.me/api/portraits/men/32.jpg" };
    State.isLoggedIn = true;
    Storage.save();
    UI.showCheckin();
  },
  register() {
    State.user = { id: 999, name: "Usuário", age: 25, status: "Solteiro", photo: "https://randomuser.me/api/portraits/men/32.jpg" };
    State.isLoggedIn = true;
    Storage.save();
    UI.showCheckin();
  }
};

/* ---------------------------- Check-in ---------------------------- */

const Location = {
  selectedPlace: null,
  renderPlaces() {
    const list = $("#placesList");
    list.innerHTML = "";
    DB.places.forEach((p, idx) => {
      const div = document.createElement("div");
      div.className = "location-card p-4 border border-gray-200 rounded-lg flex items-center cursor-pointer";
      div.innerHTML = `<div class="ml-4"><h3 class="font-medium">${p.name}</h3></div>`;
      div.addEventListener("click", () => {
        $$(".location-card").forEach(c => c.classList.remove("border-purple-600", "bg-purple-50"));
        div.classList.add("border-purple-600","bg-purple-50");
        Location.selectedPlace = p.name;
      });
      if (idx===0) {div.classList.add("border-purple-600","bg-purple-50"); Location.selectedPlace=p.name;}
      list.appendChild(div);
    });
  },
  confirmCheckin() {
    const place = Location.selectedPlace || DB.places[0].name;
    const now = Date.now();
    State.checkin = { place, startedAt: now, expiresAt: now + 2*60*60*1000 };
    if (!State.matches[place]) State.matches[place] = {}; // init matches do local
    Storage.save();
    UI.hideCheckin();
    this.enterAppFromCheckin();
  },
  leaveCheckin(manual=false) {
    if (manual && !confirm("Tem certeza que deseja sair do local?")) return;
    Storage.clearCheckinOnly();
    UI.showCheckin();
  },
  isCheckinValid() { return State.checkin && Date.now()<State.checkin.expiresAt; },
  startCountdown() {
    const el=$("#checkinCountdown");
    if(State.checkinTimer) clearInterval(State.checkinTimer);
    State.checkinTimer=setInterval(()=>{
      const rem=State.checkin.expiresAt-Date.now();
      el.textContent=formatCountdown(rem);
      if(rem<=0){ alert("Seu check-in expirou."); Location.leaveCheckin(); }
    },1000);
  },
  enterAppFromCheckin(){ UI.enterMainApp(); }
};

/* ---------------------------- Swipe ---------------------------- */

const Swipe = {
  reloadCards() {
    const container=$("#cards-container"); container.innerHTML="";
    const place=State.checkin?.place; if(!place) return;
    const {ageMin,ageMax,maxKm,interests,status}=State.filters;
    let list=DB.profiles.map(p=>({...p}));
    // simular distância dinâmica
    list.forEach(p=>p.distanceKm=(Math.random()*2).toFixed(2));
    list=list.filter(p=>p.age>=ageMin&&p.age<=ageMax);
    list=list.filter(p=>!State.likesGiven[p.id]);
    list=list.sort((a,b)=>a.distanceKm-b.distanceKm);
    State.currentCards=list; State.currentCardIndex=0;
    if(list.length===0){ container.innerHTML="<p class='p-6 text-center'>Sem perfis.</p>"; return;}
    list.forEach((p,idx)=>{
      const card=document.createElement("div");
      card.className=`card absolute inset-0 w-full h-full bg-white rounded-xl overflow-hidden shadow-lg ${idx===0?"":"hidden"}`;
      card.dataset.id=p.id;
      card.innerHTML=`<div class="h-full relative"><img src="${p.photo}" class="w-full h-3/4 object-cover"/><div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-4 text-white"><h3 class="text-xl font-bold">${p.name}, ${p.age}</h3><p class="text-sm">${p.bio}</p></div></div>`;
      Swipe._addDrag(card,p);
      container.appendChild(card);
    });
  },
  _advanceCard() {
    State.currentCardIndex++;
    const cards=$$(".card");
    if(State.currentCardIndex<cards.length) cards[State.currentCardIndex].classList.remove("hidden");
  },
  like(){
    const p=this.currentProfile(); if(!p)return;
    State.likesGiven[p.id]="like"; Storage.save();
    if(p.likedYou){ Match.onMatch(p);} 
    this._advanceCard();
  },
  dislike(){
    const p=this.currentProfile(); if(!p)return;
    State.likesGiven[p.id]="dislike"; Storage.save();
    this._advanceCard();
  },
  currentProfile(){ return State.currentCards[State.currentCardIndex]||null; },
  _addDrag(card,profile){
    let startX=0,currentX=0,isDragging=false;
    const handleMove=(x)=>{
      if(!isDragging)return;
      currentX=x-startX;
      card.style.transform=`translateX(${currentX}px) rotate(${currentX/20}deg)`;
    };
    const end=()=>{
      if(!isDragging)return; isDragging=false;
      if(currentX>100){ this.like(); card.remove(); }
      else if(currentX<-100){ this.dislike(); card.remove(); }
      else{ card.style.transform=""; }
    };
    card.addEventListener("mousedown",(e)=>{isDragging=true;startX=e.clientX;});
    card.addEventListener("mousemove",(e)=>handleMove(e.clientX));
    card.addEventListener("mouseup",end);
    card.addEventListener("mouseleave",end);
    card.addEventListener("touchstart",(e)=>{isDragging=true;startX=e.touches[0].clientX;});
    card.addEventListener("touchmove",(e)=>handleMove(e.touches[0].clientX));
    card.addEventListener("touchend",end);
  }
};

/* ---------------------------- Match ---------------------------- */

const Match = {
  onMatch(profile){
    const place=State.checkin.place;
    if(!State.matches[place]) State.matches[place]={};
    if(!State.matches[place][profile.id]) State.matches[place][profile.id]={chat:[]};
    $("#matchUserA").src=State.user.photo;
    $("#matchUserB").src=profile.photo;
    $("#matchText").textContent=`Você e ${profile.name} curtiram um ao outro!`;
    $("#match-screen").classList.remove("hidden");
    Storage.save();
  }
};

/* ---------------------------- Chat ---------------------------- */

const Chat = {
  quick:["Onde você está?","Vamos brindar? 🍻","Te encontro na pista?","Partiu conversar?","Qual sua música favorita?"],
  openFromMatch(){
    const p=Swipe.currentProfile()||State.currentCards[State.currentCardIndex-1];
    if(!p)return;
    this.openWith(p.id);
  },
  openWith(profileId){
    const place=State.checkin.place;
    const p=DB.profiles.find(x=>x.id===profileId);
    State.chatOpenWith=profileId;
    $("#match-screen").classList.add("hidden");
    $("#chat-screen").classList.remove("hidden");
    $("#chatName").textContent=p.name; $("#chatAvatar").src=p.photo;
    this.renderMessages();
    const qr=$("#quickReplies"); qr.innerHTML="";
    this.quick.forEach(t=>{
      const b=document.createElement("button");
      b.className="px-3 py-1 rounded-full border border-gray-300 text-sm";
      b.textContent=t;
      b.addEventListener("click",()=>this.send(t));
      qr.appendChild(b);
    });
  },
  close(){ State.chatOpenWith=null; $("#chat-screen").classList.add("hidden"); },
  send(textOpt){
    const input=$("#messageInput");
    const text=(textOpt||input.value).trim(); if(!text)return;
    const place=State.checkin.place;
    if(!State.matches[place][State.chatOpenWith]) State.matches[place][State.chatOpenWith]={chat:[]};
    const chat=State.matches[place][State.chatOpenWith].chat;
    chat.push({from:"me",text,ts:Date.now()});
    setTimeout(()=>{chat.push({from:"them",text:"😄 Bora!",ts:Date.now()});this.renderMessages();Storage.save();},700);
    input.value=""; this.renderMessages(); Storage.save();
  },
  renderMessages(){
    const container=$("#messages-container");
    const place=State.checkin.place;
    const chat=State.matches[place][State.chatOpenWith]?.chat||[];
    container.innerHTML="";
    chat.forEach(msg=>{
      const div=document.createElement("div");
      div.className=`flex ${msg.from==="me"?"justify-end":"justify-start"}`;
      div.innerHTML=`<div class="max-w-xs ${msg.from==="me"?"bg-purple-600 text-white":"bg-gray-100"} rounded-lg p-3"><p>${msg.text}</p><p class="text-xs mt-1">${new Date(msg.ts).toLocaleTimeString().slice(0,5)}</p></div>`;
      container.appendChild(div);
    });
    container.scrollTop=container.scrollHeight;
  }
};

/* ---------------------------- Init ---------------------------- */

document.addEventListener("DOMContentLoaded",()=>{
  Storage.load();
  UI.boot();
});

/* ---------------------------- Exports ---------------------------- */
window.UI=UI; window.Auth=Auth; window.Location=Location; window.Swipe=Swipe; window.Chat=Chat;
