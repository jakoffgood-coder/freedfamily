\
const $ = (s) => document.querySelector(s);

const state = {
  all: [],
  filtered: [],
  authors: [],
  categories: [],
  config: null,
  lastAuthor: "—",
  ready: false,
};

const CATEGORY_RULES = [
  { cat: "Обслуживание (ТО)", keys: ["то", "обслуж", "регламент", "интервал", "пробег"] },
  { cat: "Масла и жидкости", keys: ["масло", "жидк", "atf", "cvt", "вариатор", "антифриз", "тормозн"] },
  { cat: "Фильтры", keys: ["фильтр", "filter"] },
  { cat: "Свечи и зажигание", keys: ["свеч", "ngk", "denso", "катуш"] },
  { cat: "Лампы и свет", keys: ["ламп", "h11", "hb3", "wy21w", "py21w", "w5w", "t10", "t15"] },
  { cat: "Электрика и схемы", keys: ["схем", "wiring", "manual", "электропровод", "предохран", "датчик", "honda sensing", "edlc", "ионистор"] },
  { cat: "Кузов/Салон", keys: ["двер", "зеркал", "багаж", "сиден", "наклейк"] },
  { cat: "Ремонт/Инструкции", keys: ["как", "снять", "замена", "чистк", "регулировк", "проверка", "демонтаж", "открут", "собрать"] },
  { cat: "Ссылки/Ресурсы", keys: ["http://", "https://", "drive2", "youtube", "drom", "aliexpress"] },
];

function normalizeText(s){
  return (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pickCategory(plain){
  const t = normalizeText(plain);
  for (const r of CATEGORY_RULES){
    if (r.keys.some(k => t.includes(k))) return r.cat;
  }
  return "Прочее";
}

function stripHtml(html){
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return d.textContent || d.innerText || "";
}

function fmtDate(isoOrTitle){
  // Telegram: title="06.09.2024 11:08:21 UTC+06:00"
  const m = (isoOrTitle||"").match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})/);
  if (!m) return isoOrTitle || "";
  return `${m[1]}.${m[2]}.${m[3]} ${m[4]}`;
}

async function loadConfig(){
  try{
    const res = await fetch("kb_config.json", {cache:"no-store"});
    state.config = await res.json();
  }catch(e){
    state.config = { pinned: [] };
  }
}

async function loadTelegramExport(){
  const res = await fetch("info.html", {cache:"no-store"});
  const html = await res.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const nodes = Array.from(doc.querySelectorAll(".message.default"));
  const items = [];

  let lastAuthor = "—";

  for (const el of nodes){
    const id = el.getAttribute("id") || "";
    if (!id.startsWith("message")) continue;

    const from = el.querySelector(".from_name");
    if (from && from.textContent.trim()) lastAuthor = from.textContent.trim();
    const author = lastAuthor;

    const dateEl = el.querySelector(".pull_right.date.details");
    const dateTitle = dateEl?.getAttribute("title") || "";
    const timeText = dateEl?.textContent?.trim() || "";
    const date = fmtDate(dateTitle) || timeText;

    const textEl = el.querySelector(".text");
    const htmlText = textEl ? textEl.innerHTML.trim() : "";
    const plain = stripHtml(htmlText);

    const mediaThumbs = Array.from(el.querySelectorAll("img.photo"))
      .slice(0, 6)
      .map(img => img.getAttribute("src"))
      .filter(Boolean);

    const links = Array.from(el.querySelectorAll(".text a[href]"))
      .map(a => a.getAttribute("href"))
      .filter(Boolean);

    // Skip totally empty (e.g. pure join/forward shells) unless has media/links
    if (!plain && mediaThumbs.length === 0 && links.length === 0) continue;

    const category = pickCategory(plain + " " + links.join(" "));
    const tags = [];
    for (const r of CATEGORY_RULES){
      if (r.cat === category) continue;
      const t = normalizeText(plain);
      if (r.keys.some(k => t.includes(k))) tags.push(r.cat);
    }

    items.push({
      id,
      author,
      date,
      htmlText,
      plain,
      links,
      mediaThumbs,
      category,
      tags,
    });
  }

  state.all = items;

  const authors = Array.from(new Set(items.map(x => x.author))).sort((a,b)=>a.localeCompare(b,'ru'));
  const categories = Array.from(new Set(items.map(x => x.category))).sort((a,b)=>a.localeCompare(b,'ru'));

  state.authors = authors;
  state.categories = categories;
  state.ready = true;
}

function renderFilters(){
  const selA = $("#author");
  const selC = $("#category");

  for (const a of state.authors){
    const opt = document.createElement("option");
    opt.value = a; opt.textContent = a;
    selA.appendChild(opt);
  }
  for (const c of state.categories){
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    selC.appendChild(opt);
  }

  // chips
  const cats = $("#cats");
  cats.innerHTML = "";
  for (const c of state.categories){
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = c;
    chip.addEventListener("click", () => {
      $("#category").value = c;
      doSearch();
      for (const x of cats.querySelectorAll(".chip")) x.classList.toggle("active", x.textContent === c);
    });
    cats.appendChild(chip);
  }
}

function renderPinned(){
  const box = $("#pinned");
  box.innerHTML = "";

  const pins = (state.config?.pinned || []).slice(0, 12);
  if (!pins.length){
    const d = document.createElement("div");
    d.className = "muted tiny";
    d.textContent = "Добавьте закреплённые материалы в kb_config.json";
    box.appendChild(d);
    return;
  }

  for (const p of pins){
    const item = state.all.find(x => x.id === p.id);
    const card = document.createElement("div");
    card.className = "pin";
    card.innerHTML = `<div class="t">${escapeHtml(p.title || item?.plain?.slice(0,80) || p.id)}</div>
                      <div class="d">${escapeHtml(p.note || (item ? `${item.category} • ${item.date}` : "—"))}</div>`;
    card.addEventListener("click", () => openItem(item || {id:p.id, author:"—", date:"", category:"", htmlText:""}));
    box.appendChild(card);
  }
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function highlight(text, q){
  if (!q) return escapeHtml(text);
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "ig");
  return escapeHtml(text).replace(re, "<mark>$1</mark>");
}

function buildSnippet(item, q){
  const plain = item.plain || "";
  const t = normalizeText(plain);
  const qq = normalizeText(q);
  if (!qq) return escapeHtml(plain.slice(0, 260)) + (plain.length>260?"…":"");

  const idx = t.indexOf(qq);
  if (idx === -1) return escapeHtml(plain.slice(0, 260)) + (plain.length>260?"…":"");

  const start = Math.max(0, idx - 90);
  const end = Math.min(plain.length, idx + qq.length + 140);
  const chunk = plain.slice(start, end);
  return highlight(chunk, qq) + (end<plain.length?"…":"");
}

function doSearch(){
  const q = $("#q").value.trim();
  const author = $("#author").value;
  const cat = $("#category").value;

  const nq = normalizeText(q);

  let arr = state.all;

  if (author) arr = arr.filter(x => x.author === author);
  if (cat) arr = arr.filter(x => x.category === cat);

  if (nq){
    arr = arr.filter(x => {
      const hay = normalizeText(x.plain + " " + (x.links||[]).join(" "));
      return hay.includes(nq);
    });
  }

  // newest first (ids often increase over time; not always perfect but ok)
  arr = arr.slice().sort((a,b)=> (parseInt(b.id.replace("message",""))||0) - (parseInt(a.id.replace("message",""))||0));

  state.filtered = arr;
  renderResults(q);
}

function renderResults(q){
  const box = $("#results");
  const count = $("#count");
  const status = $("#status");

  box.innerHTML = "";

  count.textContent = `${state.filtered.length} сообщений`;
  status.textContent = state.ready ? "Индекс готов: можно искать." : "Загружаю…";

  const max = 200; // keep UI fast
  const list = state.filtered.slice(0, max);

  for (const item of list){
    const el = document.createElement("div");
    el.className = "item";

    const title = item.plain ? item.plain.slice(0, 70).trim() : "Сообщение";
    const badges = [item.category, item.author].filter(Boolean).slice(0,2)
      .map(x => `<span class="badge">${escapeHtml(x)}</span>`).join("");

    const thumbs = (item.mediaThumbs||[]).slice(0,3)
      .map(src => `<img src="${escapeHtml(src)}" alt="" style="width:70px;height:70px;object-fit:cover;border-radius:12px;border:1px solid rgba(34,52,88,.7)"/>`)
      .join("");

    el.innerHTML = `
      <div class="item-head">
        <div class="item-title">${escapeHtml(title || "Сообщение")}</div>
        <div class="badges">${badges}</div>
      </div>
      <div class="item-meta">${escapeHtml(item.date || "")}</div>
      <div class="item-body">${buildSnippet(item, q)}</div>
      ${thumbs ? `<div class="item-actions">${thumbs}</div>` : `<div class="item-actions"></div>`}
      <div class="item-actions">
        <button class="btn ghost" data-open="${escapeHtml(item.id)}">Открыть</button>
        <a class="btn" href="info.html#${encodeURIComponent(item.id)}" target="_blank" rel="noreferrer">В архиве</a>
      </div>
    `;

    el.querySelector('[data-open]')?.addEventListener("click", () => openItem(item));
    box.appendChild(el);
  }

  if (state.filtered.length > max){
    const more = document.createElement("div");
    more.className = "muted tiny";
    more.textContent = `Показаны первые ${max}. Уточните поиск/фильтры, чтобы сузить выдачу.`;
    box.appendChild(more);
  }
}

function openItem(item){
  const modal = $("#modal");
  $("#mTitle").textContent = item.category ? item.category : "Сообщение";
  $("#mMeta").textContent = [item.author, item.date, item.id].filter(Boolean).join(" • ");

  const body = $("#mBody");
  const safe = item.htmlText || "";
  body.innerHTML = `
    ${safe ? `<div class="card" style="background:rgba(16,26,51,.35)">${safe}</div>` : `<div class="muted">Нет текста (возможно, только медиа).</div>`}
    ${item.links?.length ? `<div style="margin-top:12px">
      <div class="section-title">Ссылки</div>
      ${item.links.map(h=>`<div><a class="link" href="${escapeHtml(h)}" target="_blank" rel="noreferrer">${escapeHtml(h)}</a></div>`).join("")}
    </div>` : ""}
  `;

  $("#mLink").href = `info.html#${encodeURIComponent(item.id)}`;
  modal.showModal();
}

function route(){
  const hash = location.hash || "#/";
  const isKB = hash.startsWith("#/kb");
  $("#home").hidden = isKB;
  $("#app").hidden = !isKB;
  if (isKB){
    // search on enter
    $("#q").addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ e.preventDefault(); doSearch(); }});
  }
}

async function init(){
  route();
  window.addEventListener("hashchange", route);

  $("#btnSearch").addEventListener("click", doSearch);
  $("#btnReset").addEventListener("click", () => {
    $("#q").value = "";
    $("#author").value = "";
    $("#category").value = "";
    for (const x of document.querySelectorAll(".chip")) x.classList.remove("active");
    doSearch();
  });

  try{
    await loadConfig();
    await loadTelegramExport();
    renderFilters();
    renderPinned();
    doSearch();
  }catch(e){
    console.error(e);
    $("#status").textContent = "Не удалось загрузить info.html. Проверьте, что файл лежит рядом и называется info.html.";
  }
}

init();
