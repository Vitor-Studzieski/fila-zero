const screens = {
  qr: "Supermercado Pompeia",
  home: "Supermercado Pompeia",
  sectors: "Fila virtual",
  ticket: "Minha senha",
  status: "Acompanhamento",
  offers: "Ofertas",
  detail: "Detalhe da promoção",
  done: "Atendimento",
  access: "Clube",
  rating: "Avaliação"
};

const SMART_WAIT_STATUS = "espera_inteligente";
const CANCELABLE_STATUSES = new Set(["aguardando", "proximo", "chamado", SMART_WAIT_STATUS, "standby"]);
const QR_SECTORS = new Set(["acougue", "frios", "padaria"]);
const LOCATION_CACHE_MS = 5 * 60 * 1000;
const PRESENCE_CHECK_ENABLED = false;
const PRIORITY_LABELS = {
  deficiencia_ou_mobilidade_reduzida: "Deficiencia ou mobilidade reduzida",
  tea: "TEA",
  idoso_60_mais: "Idoso 60+",
  gestante_ou_lactante: "Gestante ou lactante",
  crianca_de_colo: "Crianca de colo",
  obesidade: "Obesidade"
};
const shoppingList = new Set();
let cartItems = [];
const identity = getOrCreateIdentity();
let currentUser = null;
let presenceCheckins = JSON.parse(localStorage.getItem("filaZeroPresenceCheckins") || "{}");

let activeScreen = "qr";
let currentSector = null;
let activeQueues = {};
let sectors = {};
let stateSource = null;
let pollingTimer = null;
let previousTicketStatuses = new Map();
let countdownTimer = null;
let activeJoinSector = null;
let locationState = {
  status: "idle",
  value: null,
  checkedAt: 0,
  promise: null,
  error: ""
};

const productPhotoQueries = {
  picanha: "raw picanha steak butcher counter",
  "contra-file": "raw striploin steak butcher paper",
  alcatra: "fresh raw beef cuts market",
  "frango-file": "raw chicken breast supermarket tray",
  mussarela: "sliced mozzarella cheese deli counter",
  presunto: "sliced cooked ham deli counter",
  requeijao: "cream cheese spread supermarket",
  "queijo-prato": "sliced yellow cheese deli",
  "pao-frances": "fresh french bread bakery",
  croissant: "buttery croissant bakery display",
  "bolo-cenoura": "carrot cake chocolate glaze",
  "pao-forma": "sliced sandwich bread package",
  banana: "banana bunch supermarket",
  maca: "fuji apples supermarket display",
  tomate: "fresh italian tomatoes market",
  alface: "fresh green lettuce produce",
  arroz: "rice bag supermarket shelf",
  feijao: "beans bag supermarket shelf",
  cafe: "ground coffee package supermarket",
  macarrao: "spaghetti pasta package shelf",
  "agua-mineral": "mineral water bottle supermarket",
  "refrigerante-cola": "cola soda bottle supermarket",
  "suco-uva": "grape juice bottle supermarket",
  "cerveja-lata": "beer cans supermarket shelf",
  detergente: "dish soap bottle supermarket",
  "sabao-po": "laundry detergent box supermarket",
  amaciante: "fabric softener bottle shelf",
  desinfetante: "disinfectant cleaner bottle shelf",
  "papel-higienico": "toilet paper package supermarket",
  sabonete: "bar soap package supermarket",
  shampoo: "shampoo bottle bathroom product",
  condicionador: "conditioner bottle bathroom product",
  lasanha: "frozen lasagna package",
  pizza: "frozen pizza box supermarket",
  "batata-congelada": "frozen french fries package",
  nuggets: "chicken nuggets package",
  pilhas: "alkaline batteries package",
  "lampada-led": "led light bulb package",
  "vela-aniversario": "birthday candles package",
  guardanapo: "paper napkins package"
};

const productGroups = [
  group("Açougue", [
    product("picanha", "Picanha Bovina", "R$ 69,90", "R$ 59,90", "-14%", "Corte selecionado para churrasco, disponível no balcão do açougue.", "picanha steak"),
    product("contra-file", "Contra-filé", "R$ 44,90", "R$ 36,90", "-18%", "Peça fresca para grelha, chapa ou preparo do dia.", "beef steak"),
    product("alcatra", "Alcatra", "R$ 49,90", "R$ 41,90", "-16%", "Corte macio para bifes, assados e receitas rápidas.", "raw beef"),
    product("frango-file", "Filé de Frango", "R$ 24,90", "R$ 19,90", "-20%", "Filé resfriado para preparo rápido no dia a dia.", "chicken breast"),
    product("linguica-toscana", "Linguiça Toscana", "R$ 27,90", "R$ 22,90", "-18%", "Linguiça fresca para churrasco ou forno.", "sausage"),
    product("costela-bovina", "Costela Bovina", "R$ 39,90", "R$ 32,90", "-18%", "Costela para assar lentamente e servir em família.", "beef ribs"),
    product("patinho-moido", "Patinho Moído", "R$ 42,90", "R$ 35,90", "-16%", "Moído na hora para molhos, hambúrgueres e recheios.", "ground beef"),
    product("carne-panela", "Carne para Panela", "R$ 38,90", "R$ 31,90", "-18%", "Corte ideal para cozidos e receitas de conforto.", "stew beef")
  ]),
  group("Frios e Laticínios", [
    product("mussarela", "Queijo Mussarela", "R$ 34,90", "R$ 27,90", "-20%", "Fatiado na hora no setor de frios.", "mozzarella cheese"),
    product("presunto", "Presunto Cozido", "R$ 29,90", "R$ 23,90", "-20%", "Presunto fatiado para lanches e café da manhã.", "sliced ham"),
    product("requeijao", "Requeijão Cremoso", "R$ 12,90", "R$ 9,90", "-23%", "Oferta válida para unidade tradicional.", "cream cheese"),
    product("queijo-prato", "Queijo Prato", "R$ 36,90", "R$ 29,90", "-19%", "Queijo fatiado para sanduíches e lanches rápidos.", "sliced cheese"),
    product("mortadela", "Mortadela Defumada", "R$ 24,90", "R$ 18,90", "-24%", "Fatiada fina para pão francês e tábuas de frios.", "mortadella"),
    product("iogurte-natural", "Iogurte Natural", "R$ 8,99", "R$ 6,99", "-22%", "Unidade natural para café da manhã ou receitas.", "natural yogurt"),
    product("manteiga", "Manteiga com Sal", "R$ 19,90", "R$ 15,90", "-20%", "Tablete tradicional para pães, bolos e preparo.", "butter"),
    product("leite-integral", "Leite Integral", "R$ 5,99", "R$ 4,79", "-20%", "Caixa 1 litro para abastecer a semana.", "milk carton")
  ]),
  group("Padaria", [
    product("pao-frances", "Pão Francês", "R$ 16,90", "R$ 12,90", "-24%", "Pão francês produzido na padaria Pompeia.", "fresh bread"),
    product("croissant", "Croissant", "R$ 8,90", "R$ 6,90", "-22%", "Croissant folhado para consumo imediato.", "croissant"),
    product("bolo-cenoura", "Bolo de Cenoura", "R$ 24,90", "R$ 19,90", "-20%", "Bolo com cobertura de chocolate.", "carrot cake"),
    product("pao-forma", "Pão de Forma", "R$ 11,90", "R$ 8,90", "-25%", "Pacote macio para café da manhã e lanches.", "sandwich bread"),
    product("sonho-creme", "Sonho de Creme", "R$ 7,90", "R$ 5,90", "-25%", "Doce recheado produzido na padaria.", "cream donut"),
    product("pao-queijo", "Pão de Queijo", "R$ 34,90", "R$ 27,90", "-20%", "Porção para assar ou consumir no balcão.", "cheese bread"),
    product("torta-frango", "Torta de Frango", "R$ 39,90", "R$ 31,90", "-20%", "Torta salgada para refeição rápida.", "chicken pie"),
    product("baguete", "Baguete Artesanal", "R$ 13,90", "R$ 10,90", "-22%", "Baguete fresca para frios, patês e entradas.", "baguette")
  ]),
  group("Hortifruti", [
    product("banana", "Banana Nanica", "R$ 6,99", "R$ 4,99", "-29%", "Fruta selecionada no hortifruti.", "banana"),
    product("maca", "Maçã Fuji", "R$ 12,99", "R$ 9,99", "-23%", "Maçã fresca e crocante.", "apple fruit"),
    product("tomate", "Tomate Italiano", "R$ 10,99", "R$ 7,99", "-27%", "Ideal para saladas e molhos.", "tomatoes"),
    product("alface", "Alface Crespa", "R$ 4,99", "R$ 3,49", "-30%", "Folhas frescas para saladas e lanches.", "lettuce"),
    product("batata", "Batata Inglesa", "R$ 7,99", "R$ 5,99", "-25%", "Selecionada para purês, assados e frituras.", "potatoes"),
    product("cebola", "Cebola Nacional", "R$ 6,99", "R$ 4,99", "-29%", "Base para temperos e refogados.", "onion"),
    product("laranja", "Laranja Pera", "R$ 5,99", "R$ 4,49", "-25%", "Boa para sucos e consumo diário.", "oranges"),
    product("uva", "Uva Thompson", "R$ 18,90", "R$ 14,90", "-21%", "Bandeja de uvas doces e sem sementes.", "green grapes")
  ]),
  group("Mercearia", [
    product("arroz", "Arroz Tipo 1", "R$ 29,90", "R$ 24,90", "-17%", "Pacote 5 kg.", "rice bag"),
    product("feijao", "Feijão Carioca", "R$ 9,90", "R$ 7,90", "-20%", "Pacote 1 kg.", "beans"),
    product("cafe", "Café Torrado", "R$ 18,90", "R$ 15,90", "-16%", "Café torrado e moído.", "coffee bag"),
    product("macarrao", "Macarrão Espaguete", "R$ 5,99", "R$ 4,49", "-25%", "Pacote 500 g para refeições rápidas.", "spaghetti pasta"),
    product("molho-tomate", "Molho de Tomate", "R$ 4,99", "R$ 3,79", "-24%", "Molho pronto para massas e carnes.", "tomato sauce"),
    product("oleo-soja", "Óleo de Soja", "R$ 8,99", "R$ 6,99", "-22%", "Garrafa 900 ml para preparo diário.", "cooking oil"),
    product("acucar", "Açúcar Refinado", "R$ 5,99", "R$ 4,59", "-23%", "Pacote 1 kg para café e receitas.", "sugar bag"),
    product("farinha-trigo", "Farinha de Trigo", "R$ 6,99", "R$ 5,29", "-24%", "Pacote 1 kg para bolos, pães e massas.", "flour bag")
  ]),
  group("Bebidas", [
    product("agua-mineral", "Água Mineral", "R$ 2,99", "R$ 1,99", "-33%", "Garrafa 500 ml para levar durante as compras.", "water bottle"),
    product("refrigerante-cola", "Refrigerante Cola", "R$ 9,99", "R$ 7,49", "-25%", "Garrafa 2 litros para almoço e churrasco.", "cola soda"),
    product("suco-uva", "Suco de Uva Integral", "R$ 18,90", "R$ 14,90", "-21%", "Suco integral sem adição de açúcar.", "grape juice"),
    product("cerveja-lata", "Cerveja Lata", "R$ 4,99", "R$ 3,79", "-24%", "Lata gelada para consumo responsável.", "beer can"),
    product("energetico", "Energético", "R$ 8,99", "R$ 6,99", "-22%", "Lata para quem precisa de energia extra.", "energy drink"),
    product("cha-gelado", "Chá Gelado", "R$ 6,99", "R$ 4,99", "-29%", "Bebida leve para acompanhar lanches.", "iced tea"),
    product("agua-coco", "Água de Coco", "R$ 7,99", "R$ 5,99", "-25%", "Caixinha refrescante para hidratação.", "coconut water"),
    product("vinho-tinto", "Vinho Tinto", "R$ 39,90", "R$ 29,90", "-25%", "Rótulo selecionado para jantar e massas.", "red wine bottle")
  ]),
  group("Limpeza", [
    product("detergente", "Detergente Neutro", "R$ 2,99", "R$ 1,99", "-33%", "Unidade para limpeza diária da cozinha.", "dish soap"),
    product("sabao-po", "Sabão em Pó", "R$ 18,90", "R$ 14,90", "-21%", "Pacote para roupas do dia a dia.", "laundry detergent"),
    product("amaciante", "Amaciante", "R$ 16,90", "R$ 12,90", "-24%", "Frasco com perfume suave para roupas.", "fabric softener"),
    product("desinfetante", "Desinfetante", "R$ 9,90", "R$ 7,49", "-24%", "Perfume de limpeza para pisos e banheiros.", "cleaning bottle"),
    product("agua-sanitaria", "Água Sanitária", "R$ 6,99", "R$ 4,99", "-29%", "Produto multiuso para limpeza pesada.", "bleach bottle"),
    product("papel-toalha", "Papel Toalha", "R$ 8,99", "R$ 6,99", "-22%", "Rolo duplo para cozinha e pequenos acidentes.", "paper towel"),
    product("esponja", "Esponja Multiuso", "R$ 4,99", "R$ 3,49", "-30%", "Pacote com esponjas para louças.", "cleaning sponge"),
    product("limpa-vidros", "Limpa Vidros", "R$ 12,90", "R$ 9,90", "-23%", "Spray para janelas, espelhos e vitrines.", "glass cleaner")
  ]),
  group("Higiene", [
    product("papel-higienico", "Papel Higiênico", "R$ 24,90", "R$ 18,90", "-24%", "Pacote econômico para abastecer a casa.", "toilet paper"),
    product("sabonete", "Sabonete", "R$ 3,99", "R$ 2,79", "-30%", "Unidade perfumada para banho diário.", "soap bar"),
    product("shampoo", "Shampoo", "R$ 18,90", "R$ 14,90", "-21%", "Frasco para cuidado diário dos cabelos.", "shampoo bottle"),
    product("condicionador", "Condicionador", "R$ 19,90", "R$ 15,90", "-20%", "Condicionador para maciez e brilho.", "conditioner bottle"),
    product("creme-dental", "Creme Dental", "R$ 7,99", "R$ 5,99", "-25%", "Tubo para proteção diária dos dentes.", "toothpaste"),
    product("escova-dental", "Escova Dental", "R$ 9,99", "R$ 7,49", "-25%", "Escova macia para uso diário.", "toothbrush"),
    product("desodorante", "Desodorante Aerosol", "R$ 15,90", "R$ 11,90", "-25%", "Proteção prolongada para rotina corrida.", "deodorant"),
    product("absorvente", "Absorvente", "R$ 12,90", "R$ 9,90", "-23%", "Pacote regular para cuidado pessoal.", "sanitary pads")
  ]),
  group("Congelados", [
    product("lasanha", "Lasanha Congelada", "R$ 19,90", "R$ 15,90", "-20%", "Refeição prática para forno ou micro-ondas.", "frozen lasagna"),
    product("pizza", "Pizza Congelada", "R$ 24,90", "R$ 18,90", "-24%", "Pizza família para jantar rápido.", "frozen pizza"),
    product("batata-congelada", "Batata Pré-Frita", "R$ 18,90", "R$ 13,90", "-26%", "Pacote para air fryer ou forno.", "frozen fries"),
    product("nuggets", "Nuggets de Frango", "R$ 17,90", "R$ 13,90", "-22%", "Porção prática para crianças e lanches.", "chicken nuggets"),
    product("sorvete", "Sorvete", "R$ 29,90", "R$ 22,90", "-23%", "Pote familiar de sobremesa gelada.", "ice cream tub"),
    product("polpa-fruta", "Polpa de Fruta", "R$ 12,90", "R$ 9,90", "-23%", "Pacote para sucos naturais em minutos.", "frozen fruit"),
    product("hamburguer", "Hambúrguer Bovino", "R$ 21,90", "R$ 16,90", "-23%", "Caixa com hambúrgueres para lanche.", "frozen burger"),
    product("legumes-congelados", "Legumes Congelados", "R$ 14,90", "R$ 10,90", "-27%", "Mix de legumes para refeições rápidas.", "frozen vegetables")
  ]),
  group("Bazar", [
    product("pilhas", "Pilhas Alcalinas", "R$ 18,90", "R$ 13,90", "-26%", "Cartela com pilhas para controles e brinquedos.", "batteries"),
    product("lampada-led", "Lâmpada LED", "R$ 12,90", "R$ 8,90", "-31%", "Lâmpada econômica para casa.", "led light bulb"),
    product("vela-aniversario", "Vela de Aniversário", "R$ 7,99", "R$ 5,99", "-25%", "Kit para bolos e comemorações.", "birthday candle"),
    product("guardanapo", "Guardanapo", "R$ 6,99", "R$ 4,99", "-29%", "Pacote para mesa e festas.", "napkins"),
    product("copo-descartavel", "Copo Descartável", "R$ 9,90", "R$ 7,49", "-24%", "Pacote para eventos e uso prático.", "plastic cups"),
    product("papel-aluminio", "Papel Alumínio", "R$ 8,99", "R$ 6,79", "-24%", "Rolo para assados e conservação.", "aluminum foil"),
    product("filme-pvc", "Filme PVC", "R$ 7,99", "R$ 5,99", "-25%", "Rolo para proteger alimentos.", "plastic wrap"),
    product("carvao", "Carvão Vegetal", "R$ 24,90", "R$ 18,90", "-24%", "Saco para churrasco e grelha.", "charcoal bag")
  ])
];

const offerPriorityBySector = {
  acougue: ["Açougue", "Bebidas", "Padaria", "Mercearia", "Bazar"],
  frios: ["Frios e Laticínios", "Padaria", "Bebidas", "Mercearia", "Hortifruti"],
  padaria: ["Padaria", "Frios e Laticínios", "Mercearia", "Bebidas", "Hortifruti"]
};

init();

async function init() {
  syncMobileViewport();
  renderProducts();
  bindEvents();
  syncPriorityControls();
  syncPresenceStatus();
  currentUser = await requireSession(["customer", "manager", "admin"]);
  syncAccessArea();
  identity.customerId = currentUser.customerId;
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
  await syncSession();
  await loadCart();
  await loadState();
  connectRealtime();
  startCountdownTimer();
  navigate("home");
  if (PRESENCE_CHECK_ENABLED) warmupLocation();
}

function syncMobileViewport() {
  const root = document.documentElement;
  const apply = () => {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    root.style.setProperty("--app-viewport-width", `${width}px`);
    root.style.setProperty("--app-viewport-height", `${height}px`);
    root.style.setProperty("--app-viewport-top", `${Math.round(viewport?.offsetTop || 0)}px`);
  };
  apply();
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(apply, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", apply, { passive: true });
  window.visualViewport?.addEventListener("scroll", apply, { passive: true });
}

function getOrCreateIdentity() {
  const params = new URLSearchParams(location.search);
  const sharedCustomerId = params.get("cliente") || params.get("customer_id");
  const stored = JSON.parse(localStorage.getItem("filaZeroIdentity") || "{}");
  const identity = {
    customerId: sharedCustomerId || stored.customerId || `cliente-${crypto.randomUUID()}`,
    deviceId: stored.deviceId || `device-${crypto.randomUUID()}`
  };
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
  return identity;
}

async function syncSession() {
  const session = await api("/api/sessions", {
    method: "POST",
    body: identity
  });
  identity.customerId = session.customerId;
  identity.deviceId = session.deviceId;
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
}

async function loadState() {
  const state = await api(`/api/state?customer_id=${encodeURIComponent(identity.customerId)}`);
  applyState(state);
}

async function loadCart() {
  const result = await api(`/api/cart?customer_id=${encodeURIComponent(identity.customerId)}`);
  cartItems = result.items;
  shoppingList.clear();
  cartItems.forEach((item) => shoppingList.add(item.productId));
  renderCart();
}

function connectRealtime() {
  stateSource?.close();
  stateSource = new EventSource("/api/events");
  stateSource.addEventListener("state", (event) => applyState(JSON.parse(event.data)));
  stateSource.addEventListener("error", () => startStatePolling());
  startStatePolling();
}

function startStatePolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    loadState().catch(() => {});
  }, 3000);
}

function applyState(state) {
  const nextStatuses = new Map();
  sectors = Object.fromEntries(state.sectors.map((sector) => [sector.id, sector]));
  activeQueues = Object.fromEntries(state.tickets.map((ticket) => [ticket.sectorId, withLiveCountdown(ticket)]));

  state.tickets.forEach((ticket) => {
    nextStatuses.set(ticket.id, ticket.status);
    if (ticket.status === "chamado" && previousTicketStatuses.get(ticket.id) !== "chamado") {
      currentSector = ticket.sectorId;
      notifyTicketCalled(ticket);
      document.querySelector("#callModal").classList.add("visible");
    }
  });

  previousTicketStatuses = nextStatuses;
  if (!currentSector || !activeQueues[currentSector]) currentSector = Object.keys(activeQueues)[0] || null;
  syncPresenceStatus();
  syncQueue();
}

function startCountdownTimer() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    if (!Object.values(activeQueues).some(hasLiveCountdown)) return;
    activeQueues = Object.fromEntries(
      Object.entries(activeQueues).map(([sectorId, ticket]) => [sectorId, withLiveCountdown(ticket)])
    );
    syncQueue();
  }, 1000);
}

function withLiveCountdown(ticket) {
  if (!hasLiveCountdown(ticket)) return ticket;
  const remaining = Math.ceil((new Date(ticket.estimatedCallAt).getTime() - Date.now()) / 1000);
  return {
    ...ticket,
    secondsToCall: Math.max(0, remaining),
    countdownTotalSeconds: Math.max(ticket.countdownTotalSeconds || 0, remaining)
  };
}

function hasLiveCountdown(ticket) {
  return Boolean(ticket?.estimatedCallAt && ["aguardando", "proximo", "standby"].includes(ticket.status));
}

function group(sector, items) {
  return { sector, items };
}

function product(id, name, old, price, sale, description, query) {
  const imageQuery = productPhotoQueries[id] || query;
  return { id, name, old, price, sale, description, image: productImage(id, name, imageQuery) };
}

function productImage(id, name, query) {
  const palette = productPalette(id);
  const title = name.split(" ").slice(0, 3).join(" ");
  const subtitle = query.split(" ").slice(0, 3).join(" ");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="180" viewBox="0 0 220 180">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${palette[0]}"/>
          <stop offset="1" stop-color="${palette[1]}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#172033" flood-opacity=".22"/>
        </filter>
      </defs>
      <rect width="220" height="180" rx="18" fill="url(#bg)"/>
      <circle cx="184" cy="32" r="42" fill="#ffffff" opacity=".18"/>
      <circle cx="42" cy="152" r="56" fill="#ffffff" opacity=".14"/>
      <rect x="28" y="40" width="164" height="104" rx="16" fill="#fffdf7" opacity=".94" filter="url(#shadow)"/>
      <rect x="46" y="58" width="128" height="52" rx="10" fill="${palette[2]}" opacity=".2"/>
      <path d="M52 126h116" stroke="${palette[2]}" stroke-width="8" stroke-linecap="round" opacity=".55"/>
      <text x="110" y="84" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="900" fill="#0f3154">${escapeSvgText(title)}</text>
      <text x="110" y="107" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#5b6678">${escapeSvgText(subtitle)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function productPalette(seed) {
  const palettes = [
    ["#fff2c2", "#f8b84e", "#b45309"],
    ["#e0f2fe", "#7dd3fc", "#0369a1"],
    ["#dcfce7", "#86efac", "#15803d"],
    ["#fee2e2", "#fca5a5", "#b91c1c"],
    ["#fef3c7", "#fde68a", "#a16207"],
    ["#ede9fe", "#c4b5fd", "#6d28d9"],
    ["#fce7f3", "#f9a8d4", "#be185d"],
    ["#e2e8f0", "#94a3b8", "#334155"]
  ];
  const index = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % palettes.length;
  return palettes[index];
}

function escapeSvgText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  }[char]));
}

function navigate(screen) {
  if (!screens[screen]) return;
  activeScreen = screen;
  document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  document.querySelector("#appTitle").textContent = screens[screen];
  if (screen === "done") renderServiceScreen();
  if (screen === "offers") {
    renderOfferQueueContext();
    renderProducts();
  }
  updateTabs(screen);
  updateFloatingQueue();
}

function syncAccessArea() {
  const isManager = ["manager", "admin"].includes(currentUser?.role);
  document.querySelectorAll(".manager-access").forEach((item) => {
    item.hidden = !isManager;
  });
  document.querySelector("#accessIntro").textContent = isManager
    ? "Acesse as areas de teste usando a mesma sessao de gestor."
    : "Sua sessao esta protegida. Use somente dispositivos confiaveis.";
}

function updateTabs(screen) {
  document.querySelectorAll(".tabbar button").forEach((button) => {
    const tab = button.dataset.tab;
    button.classList.toggle("on", tab === screen || (tab === "sectors" && ["sectors", "ticket", "status", "done", "rating"].includes(screen)) || (tab === "offers" && ["offers", "detail"].includes(screen)));
  });
}

async function joinQueue(sectorId) {
  if (!sectors[sectorId]) return;
  if (activeJoinSector) return;
  activeJoinSector = sectorId;
  syncActionButtons();
  try {
    const result = await createTicketWithPresence(sectorId);
    currentSector = result.ticket.sectorId;
    activeQueues[result.ticket.sectorId] = withLiveCountdown(result.ticket);
    syncQueue();
    navigate("ticket");
  } catch (exception) {
    alert(exception.message);
  } finally {
    activeJoinSector = null;
    syncActionButtons();
  }
}

async function createTicketWithPresence(sectorId) {
  try {
    const presence = await getPresencePayload(sectorId);
    return await api("/api/tickets", {
      method: "POST",
      body: { ...identity, sectorId, ...presence, ...priorityPayload() }
    });
  } catch (exception) {
    if (!isInvalidQrError(exception) || !presenceCheckins[sectorId]) throw exception;
    clearSectorPresence(sectorId);
    const location = await ensureLocation({ force: true });
    return api("/api/tickets", {
      method: "POST",
      body: { ...identity, sectorId, location, ...priorityPayload() }
    });
  }
}

function priorityPayload() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason")?.value || "";
  const priority = Boolean(toggle?.checked);
  if (!priority) return { priority: false, priorityReason: "" };
  if (!reason) throw new Error("Selecione a categoria da fila preferencial.");
  return { priority: true, priorityReason: reason };
}

function isInvalidQrError(exception) {
  return String(exception?.message || "").toLowerCase().includes("qr code do setor invalido")
    || String(exception?.message || "").toLowerCase().includes("qr code do setor inválido");
}

function syncQueue() {
  const activeCount = Object.keys(activeQueues).length;
  const data = getCurrentQueueData();
  const serviceSector = getServiceInProgressSector();
  const hasQueue = Boolean(data);

  document.querySelector("#queueBanner").classList.toggle("visible", hasQueue);
  document.querySelector("#bannerTicket").textContent = hasQueue ? data.ticket : "";
  document.querySelector("#bannerText").textContent = hasQueue ? bannerText(data, activeCount) : "";
  document.querySelector("#bannerProgress").style.width = hasQueue ? `${data.progress}%` : "0%";

  document.querySelector("#ticketNumber").textContent = hasQueue ? data.ticket : "--";
  document.querySelector("#ticketSector").textContent = hasQueue ? data.sector : "Nenhuma senha ativa";
  document.querySelector("#ticketSub").textContent = hasQueue ? ticketSubText(data) : "Solicite uma senha em um setor para acompanhar.";
  document.querySelector("#currentQueue").textContent = hasQueue ? data.current : "--";

  document.querySelector("#statusSector").textContent = hasQueue ? `${data.sector} - ${data.counterLabel}` : "Nenhuma senha ativa";
  document.querySelector("#positionNumber").textContent = hasQueue ? positionText(data) : "--";
  document.querySelector("#estimatedTime").textContent = hasQueue ? statusText(data) : "Sem atendimento em andamento";
  document.querySelector("#timeInfo").textContent = hasQueue ? timeInfoText(data) : "--";
  document.querySelector("#aheadInfo").textContent = hasQueue ? aheadInfoText(data) : "--";
  document.querySelector(".progress-donut").style.setProperty("--donut-progress", `${hasQueue ? donutProgress(data) : 0}%`);

  document.querySelector("#statusFinishButton").classList.toggle("visible", Boolean(serviceSector));
  document.querySelector("#statusFinishButton").textContent = serviceSector && serviceSector !== currentSector
    ? `Informar fim do pedido em ${activeQueues[serviceSector].sector}`
    : "Informar fim do pedido";

  document.querySelector("#callText").textContent = hasQueue
    ? `Dirija-se ao ${data.counterLabel} de ${data.sector}. Sua senha ${data.ticket} foi chamada.`
    : "";
  document.querySelector("#floatingTicket").textContent = hasQueue ? data.ticket : "";
  document.querySelector("#floatingTime").textContent = hasQueue ? floatingTimeText(data) : "";
  document.querySelector("#ticketCancelButton").classList.toggle("visible", canCancelTicket(data));
  document.querySelector("#statusCancelButton").classList.toggle("visible", canCancelTicket(data));

  renderActiveTickets();
  renderSectorCards();
  renderOfferQueueContext();
  updateFloatingQueue();
}

function getCurrentQueueData() {
  if (currentSector && activeQueues[currentSector]) return activeQueues[currentSector];
  const firstSector = Object.keys(activeQueues)[0];
  if (!firstSector) return null;
  currentSector = firstSector;
  return activeQueues[firstSector];
}

function hasActiveQueues() {
  return Object.keys(activeQueues).length > 0;
}

function getServiceInProgressSector() {
  return Object.keys(activeQueues).find((sectorId) => activeQueues[sectorId].status === "em_atendimento") || null;
}

function canCancelTicket(ticket) {
  return Boolean(ticket && CANCELABLE_STATUSES.has(ticket.status));
}

function donutProgress(data) {
  if (!data) return 0;
  if (hasLiveCountdown(data)) {
    const total = Math.max(1, Number(data.countdownTotalSeconds || data.secondsToCall || 1));
    return Math.max(0, Math.min(100, (Number(data.secondsToCall || 0) / total) * 100));
  }
  return data.progress || 0;
}

async function cancelCurrentTicket(ticketId = null) {
  const data = ticketId
    ? Object.values(activeQueues).find((ticket) => ticket.id === ticketId)
    : getCurrentQueueData();
  if (!canCancelTicket(data)) return;
  if (!confirm(`Cancelar a senha ${data.ticket} de ${data.sector}?`)) return;

  try {
    await api(`/api/tickets/${encodeURIComponent(data.id)}/cancel`, { method: "POST", body: identity });
    await loadState();
    navigate(hasActiveQueues() ? "status" : "sectors");
  } catch (exception) {
    alert(exception.message);
  }
}

function getNextSmartWaitSector() {
  return Object.entries(activeQueues)
    .filter(([, data]) => data.status === SMART_WAIT_STATUS)
    .sort(([, a], [, b]) => new Date(a.createdAt) - new Date(b.createdAt))[0]?.[0] || null;
}

async function confirmCall() {
  const data = getCurrentQueueData();
  if (!data || data.status !== "chamado") return;
  document.querySelector("#callModal").classList.remove("visible");
  await api(`/api/tickets/${encodeURIComponent(data.id)}/confirm`, { method: "POST", body: identity });
  await loadState();
  navigate("done");
}

async function finishCurrentService() {
  const serviceSector = getServiceInProgressSector();
  if (!serviceSector) {
    navigate(hasActiveQueues() ? "status" : "rating");
    return;
  }

  const ticket = activeQueues[serviceSector];
  await api(`/api/tickets/${encodeURIComponent(ticket.id)}/finish`, { method: "POST", body: identity });
  await loadState();
  const called = getCurrentQueueData();
  if (called?.status === "chamado") {
    document.querySelector("#callModal").classList.add("visible");
    navigate("status");
    return;
  }
  navigate(hasActiveQueues() ? "status" : "rating");
}

function renderServiceScreen() {
  const serviceSector = getServiceInProgressSector();
  if (serviceSector) currentSector = serviceSector;

  const current = serviceSector ? activeQueues[serviceSector] : null;
  const smartWaitSector = getNextSmartWaitSector();
  const smartWait = smartWaitSector ? activeQueues[smartWaitSector] : null;
  const waitingCount = Object.values(activeQueues).filter((item) => item.status === SMART_WAIT_STATUS).length;

  if (!current) {
    document.querySelector("#serviceTitle").textContent = "Atendimento finalizado";
    document.querySelector("#serviceMessage").textContent = "Não há pedido em atendimento neste momento.";
    document.querySelector("#serviceCurrent").textContent = "Senha atual: --";
    document.querySelector("#serviceNext").textContent = hasActiveQueues() ? "Você ainda possui senhas ativas." : "Nenhuma senha ativa.";
    document.querySelector("#completeServiceButton").textContent = hasActiveQueues() ? "Voltar para minhas senhas" : "Ir para avaliação";
    return;
  }

  document.querySelector("#serviceTitle").textContent = "Pedido em atendimento";
  document.querySelector("#serviceMessage").textContent =
    "Quando o pedido terminar, informe no app para liberar a próxima senha protegida.";
  document.querySelector("#serviceCurrent").textContent = `Senha atual: ${current.ticket} - ${current.sector}`;
  document.querySelector("#serviceNext").textContent = smartWait
    ? `Próxima protegida: ${smartWait.ticket} - ${smartWait.sector}.`
    : waitingCount > 1
      ? `${waitingCount} senhas estão protegidas para chamada em sequência.`
      : "Nenhuma senha protegida no momento.";
  document.querySelector("#completeServiceButton").textContent = smartWait
    ? "Informar fim e chamar próxima senha"
    : "Informar fim do pedido";
}

function statusText(data) {
  if (data.status === "chamado") return "Senha chamada";
  if (data.status === "em_atendimento") return "Em atendimento";
  if (data.status === SMART_WAIT_STATUS) return "Espera inteligente";
  if (data.status === "standby") return "Standby";
  if (data.status === "proximo") return "Próxima senha";
  if (hasLiveCountdown(data)) return `Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Aguardando chamada";
  return `Previsão: ${formatTimer(data.secondsToCall)}`;
}

function bannerText(data, activeCount) {
  const prefix = activeCount > 1 ? `${activeCount} senhas ativas` : data.sector;
  return `${prefix} - ${statusText(data)}`;
}

function positionText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Pausa";
  if (data.status === "standby") return "Standby";
  if (data.status === "chamado" || data.status === "em_atendimento") return "Agora";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  return `${data.position}º`;
}

function timeInfoText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Protegida";
  if (data.status === "standby") return "Até 10 min para retorno";
  if (data.status === "chamado") return "Dirija-se ao balcão";
  if (data.status === "em_atendimento") return "Pedido em andamento";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "Aguardando chamada";
  return formatTimer(data.secondsToCall);
}

function aheadInfoText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Aguardando fim do pedido atual";
  if (data.status === "standby") return "Será chamada novamente após o próximo atendimento";
  if (data.status === "chamado" || data.status === "em_atendimento") return "Você é o atendimento atual";
  if (data.position === 1) return "Você é o próximo";
  return `${data.ahead} pessoas`;
}

function floatingTimeText(data) {
  if (data.status === "chamado") return "chamada";
  if (data.status === "em_atendimento") return "atendimento";
  if (data.status === SMART_WAIT_STATUS) return "protegida";
  if (data.status === "standby") return "standby";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "próxima";
  return formatTimer(data.secondsToCall);
}

function ticketSubText(data) {
  const priority = priorityText(data);
  if (priority && ["aguardando", "proximo"].includes(data.status)) return `${priority}. ${data.position} na fila preferencial.`;
  if (data.status === "em_atendimento") return `Pedido em atendimento no ${data.counterLabel}.`;
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar.";
  if (data.status === "standby") return "Em standby. Será chamada novamente após o próximo atendimento.";
  if (data.status === "chamado") return `Apresente-se no ${data.counterLabel}.`;
  if (data.status === "proximo") return "Você será chamado em instantes.";
  if (hasLiveCountdown(data)) return `Sua senha será chamada em ${formatTimer(data.secondsToCall)}.`;
  if (data.position === 1) return "Você é o próximo da fila.";
  return `${data.ahead} pessoas à frente`;
}

function queueItemLine(data) {
  const priority = priorityText(data);
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar";
  if (data.status === "standby") return "Standby - retorno após próximo atendimento";
  if (data.status === "em_atendimento") return "Atendimento em andamento";
  if (data.status === "chamado") return `${data.counterLabel} - senha chamada`;
  if (data.status === "proximo") return "Próxima chamada";
  if (hasLiveCountdown(data)) return `${priority ? `${priority} - ` : ""}Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Próxima da fila";
  return `${data.ahead} pessoas à frente`;
}

function priorityText(data) {
  return data?.priority ? `Preferencial${data.priorityReason && PRIORITY_LABELS[data.priorityReason] ? ` - ${PRIORITY_LABELS[data.priorityReason]}` : ""}` : "";
}

function updateFloatingQueue() {
  const hiddenScreens = ["ticket", "status", "done", "rating"];
  const serviceSector = getServiceInProgressSector();
  document.querySelector("#floatingQueue").classList.toggle("visible", hasActiveQueues() && !hiddenScreens.includes(activeScreen));
  document.querySelector("#floatingFinishButton").classList.toggle("visible", Boolean(serviceSector) && !["status", "done", "rating"].includes(activeScreen));
  if (serviceSector) document.querySelector("#floatingFinishButton").textContent = `Informar fim do pedido em ${activeQueues[serviceSector].sector}`;
}

function renderActiveTickets() {
  const list = document.querySelector("#activeTicketList");
  const entries = Object.entries(activeQueues);
  list.innerHTML = entries.length
    ? entries.map(([sectorId, data]) => `
        <button class="mini-ticket ${sectorId === currentSector ? "active" : ""}" data-view-ticket="${sectorId}">
          <div>
            <strong>${data.sector}</strong>
            ${data.priority ? `<em class="priority-badge">Preferencial</em>` : ""}
            <span>${queueItemLine(data)}</span>
          </div>
          <b>${data.ticket}</b>
        </button>
      `).join("")
    : `<div class="empty-state">Você ainda não possui senhas ativas.</div>`;

  document.querySelectorAll("[data-view-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      currentSector = button.dataset.viewTicket;
      syncQueue();
      navigate("ticket");
    });
  });
}

function renderSectorCards() {
  document.querySelectorAll("[data-join]").forEach((button) => {
    const sectorId = button.dataset.join;
    const sector = sectors[sectorId];
    if (!sector) return;

    const card = button.closest(".sector-card");
    const hasTicket = Boolean(activeQueues[sectorId]);
    card?.classList.toggle("has-ticket", hasTicket);
    card.querySelector(".sector-head strong").textContent = sector.name;
    card.querySelector(".sector-head span").textContent = sector.serviceLabel;
    card.querySelector(".sector-head b").textContent = sector.counterLabel;
    card.querySelector(".sector-meta").innerHTML = `<span>Fila base: ${sector.queueSize} pessoas</span><span>${sector.status === "open" ? `${sector.averageServiceSeconds}s por atendimento` : "Setor indisponível"}</span>`;
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.textContent = hasTicket ? `Ver senha ${activeQueues[sectorId].ticket}` : `Solicitar senha - ${sector.name}`;
    if (activeJoinSector === sectorId) button.textContent = "Gerando senha...";
  });

  document.querySelectorAll("[data-quick-join]").forEach((button) => {
    const sectorId = button.dataset.quickJoin;
    const sector = sectors[sectorId];
    if (!sector) return;
    const hasTicket = Boolean(activeQueues[sectorId]);
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.classList.toggle("has-ticket", hasTicket);
    button.textContent = activeJoinSector === sectorId ? "..." : hasTicket ? activeQueues[sectorId].ticket : sector.name;
  });
}

function renderOfferQueueContext() {
  const box = document.querySelector("#offersQueue");
  const data = getCurrentQueueData();
  box.classList.toggle("visible", Boolean(data));
  box.innerHTML = data
    ? `<span>${data.sector}: ${data.ticket}</span><b>${statusText(data)}</b>`
    : "";
}

function renderCart() {
  const list = document.querySelector("#cartList");
  if (!list) return;
  list.innerHTML = cartItems.length
    ? cartItems.map((item) => `<div class="cart-item"><span>${item.quantity}x ${item.productName}</span><b>${item.price}</b></div>`).join("")
    : `<div class="empty-state">Nenhum produto adicionado.</div>`;
}

async function getPresencePayload(sectorId) {
  if (!PRESENCE_CHECK_ENABLED) return {};

  const qrToken = new URLSearchParams(location.search).get("qr");
  const storedToken = presenceCheckins[sectorId];
  if (qrToken) {
    registerSectorPresence(sectorId, qrToken);
    return { qrToken };
  }
  try {
    const currentLocation = await ensureLocation();
    return storedToken ? { qrToken: storedToken, location: currentLocation } : { location: currentLocation };
  } catch (exception) {
    if (storedToken) return { qrToken: storedToken };
    throw exception;
  }
}

async function confirmSectorPresence(sectorId) {
  if (!PRESENCE_CHECK_ENABLED) {
    navigate("sectors");
    return;
  }

  try {
    await ensureLocation({ force: true });
    navigate("sectors");
  } catch (exception) {
    alert(exception.message);
  }
}

function registerSectorPresence(sectorId, token = null) {
  if (!QR_SECTORS.has(sectorId) || !token) return;
  presenceCheckins = { ...presenceCheckins, [sectorId]: token };
  localStorage.setItem("filaZeroPresenceCheckins", JSON.stringify(presenceCheckins));
  syncPresenceStatus();
}

function clearSectorPresence(sectorId) {
  if (!presenceCheckins[sectorId]) return;
  const nextCheckins = { ...presenceCheckins };
  delete nextCheckins[sectorId];
  presenceCheckins = nextCheckins;
  localStorage.setItem("filaZeroPresenceCheckins", JSON.stringify(presenceCheckins));
  syncPresenceStatus();
}

function syncPresenceStatus() {
  const status = document.querySelector("#presenceStatus");
  if (!status) return;
  const confirmed = Object.keys(presenceCheckins)
    .filter((sectorId) => QR_SECTORS.has(sectorId) && presenceCheckins[sectorId])
    .map((sectorId) => sectors[sectorId]?.name || sectorNameFallback(sectorId));

  status.textContent = confirmed.length
    ? `Confirmado: ${confirmed.join(", ")}`
    : locationStatusText();

  document.querySelectorAll("[data-qr-checkin]").forEach((button) => {
    const sectorId = button.dataset.qrCheckin;
    button.classList.toggle("checked", Boolean(presenceCheckins[sectorId]));
  });
}

function sectorNameFallback(sectorId) {
  return { acougue: "Açougue", frios: "Frios", padaria: "Padaria" }[sectorId] || sectorId;
}

function warmupLocation() {
  ensureLocation().catch(() => {});
}

async function ensureLocation(options = {}) {
  if (hasFreshLocation() && !options.force) return locationState.value;
  if (locationState.promise && !options.force) return locationState.promise;

  locationState.status = "loading";
  locationState.error = "";
  syncPresenceStatus();

  locationState.promise = requestLocation()
    .then((value) => {
      locationState.status = "ready";
      locationState.value = value;
      locationState.checkedAt = Date.now();
      locationState.error = "";
      return value;
    })
    .catch((error) => {
      locationState.status = "error";
      locationState.error = error.message;
      throw error;
    })
    .finally(() => {
      locationState.promise = null;
      syncPresenceStatus();
    });

  return locationState.promise;
}

function hasFreshLocation() {
  return Boolean(locationState.value && Date.now() - locationState.checkedAt < LOCATION_CACHE_MS);
}

function locationStatusText() {
  if (!PRESENCE_CHECK_ENABLED) return "Localizacao desativada durante os testes.";
  if (hasFreshLocation()) return "Localizacao confirmada automaticamente.";
  if (locationState.status === "loading") return "Confirmando localizacao automaticamente...";
  if (locationState.status === "error") return locationState.error || "Nao foi possivel confirmar a localizacao.";
  return "Localizacao sera confirmada automaticamente ao solicitar senha.";
}

function requestLocation() {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("Seu navegador nao permite localizacao automatica."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      (error) => {
        const messages = {
          1: "Autorize a localizacao do navegador para solicitar senha automaticamente.",
          2: "Nao foi possivel encontrar sua localizacao agora.",
          3: "A localizacao demorou para responder. Tente novamente."
        };
        reject(new Error(messages[error.code] || "Nao foi possivel confirmar sua localizacao."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: LOCATION_CACHE_MS }
    );
  });
}

function renderProducts() {
  const groups = personalizedProductGroups();
  document.querySelector("#productList").innerHTML = groups
    .map((group, index) => `
        <section class="offer-section">
          <div>
            <h3>${groupTitle(group, index)}</h3>
            <span class="offer-section-count">${groupSubtitle(group)}</span>
          </div>
          ${group.items.map((item) => productCard(group.sector, item)).join("")}
        </section>
      `)
    .join("");

  document.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", () => openProduct(button.dataset.product)));
}

function personalizedProductGroups() {
  const currentTicket = getCurrentQueueData();
  const priority = offerPriorityBySector[currentTicket?.sectorId] || [];
  const addedSectors = new Set(
    productGroups
      .filter((group) => group.items.some((item) => shoppingList.has(item.id)))
      .map((group) => group.sector)
  );

  return productGroups
    .map((group, index) => ({
      ...group,
      score: personalizedGroupScore(group, index, priority, addedSectors)
    }))
    .sort((first, second) => second.score - first.score || productGroups.findIndex((group) => group.sector === first.sector) - productGroups.findIndex((group) => group.sector === second.sector));
}

function personalizedGroupScore(group, index, priority, addedSectors) {
  const priorityIndex = priority.indexOf(group.sector);
  const priorityScore = priorityIndex >= 0 ? 100 - priorityIndex * 8 : 0;
  const listScore = addedSectors.has(group.sector) ? 18 : 0;
  return priorityScore + listScore - index;
}

function groupTitle(group, index) {
  const currentTicket = getCurrentQueueData();
  if (index === 0 && currentTicket) return `Recomendado para ${currentTicket.sector}`;
  if (shoppingList.size && group.items.some((item) => shoppingList.has(item.id))) return `${group.sector} na sua lista`;
  return group.sector;
}

function groupSubtitle(group) {
  const added = group.items.filter((item) => shoppingList.has(item.id)).length;
  return added
    ? `${added} na lista · ${group.items.length} ofertas`
    : `${group.items.length} ofertas selecionadas`;
}

function syncActionButtons() {
  renderSectorCards();
}

function productCard(sector, item) {
  const added = shoppingList.has(item.id);
  return `
    <button class="product-card ${added ? "added" : ""}" data-product="${item.id}">
      <span class="sale">${item.sale}</span>
      <img class="product-img" src="${item.image}" alt="${item.name}" loading="lazy" />
      <div>
        <strong>${item.name}</strong>
        <small>${sector}</small>
        <del>${item.old}</del>
        <b>${item.price}</b>
      </div>
      <span class="add-indicator">${added ? "✓" : "+"}</span>
    </button>
  `;
}

function findProduct(id) {
  return productGroups.flatMap((group) => group.items.map((item) => ({ ...item, sector: group.sector }))).find((item) => item.id === id);
}

function openProduct(id) {
  const item = findProduct(id);
  if (!item) return;
  document.querySelector("#detailName").textContent = item.name;
  document.querySelector("#detailDescription").textContent = item.description;
  document.querySelector("#detailOld").textContent = item.old;
  document.querySelector("#detailPrice").textContent = item.price;
  document.querySelector("#detailSector").textContent = item.sector;
  document.querySelector("#detailPhoto").src = item.image;
  document.querySelector("#detailPhoto").alt = item.name;
  document.querySelector("#addProduct").dataset.productId = item.id;
  document.querySelector("#addProduct").textContent = shoppingList.has(item.id) ? "Produto na lista" : "Adicionar à lista";
  document.querySelector("#toast").classList.remove("visible");
  navigate("detail");
}

async function addCurrentProduct() {
  const productId = document.querySelector("#addProduct").dataset.productId;
  if (!productId) return;
  const item = findProduct(productId);
  try {
    await api("/api/cart/items", {
      method: "POST",
      body: {
        customerId: identity.customerId,
        productId,
        productName: item.name,
        sectorName: item.sector,
        price: item.price
      }
    });
    await loadCart();
    shoppingList.add(productId);
    renderProducts();
    document.querySelector("#addProduct").textContent = "Produto na lista";
    document.querySelector("#toast").classList.add("visible");
    updateProductCard(productId);
  } catch (exception) {
    alert(exception.message);
  }
}

function updateProductCard(productId) {
  const card = document.querySelector(`[data-product="${CSS.escape(productId)}"]`);
  if (!card) return;
  card.classList.add("added");
  const indicator = card.querySelector(".add-indicator");
  if (indicator) indicator.textContent = "✓";
}

function notifyTicketCalled(ticket) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`Senha ${ticket.ticket} chamada`, {
      body: `${ticket.sector} - ${ticket.counterLabel}`,
      tag: ticket.id
    });
  }
}

async function handleNotifyButton() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  const called = Object.values(activeQueues).find((ticket) => ticket.status === "chamado");
  if (called) {
    currentSector = called.sectorId;
    syncQueue();
    document.querySelector("#callModal").classList.add("visible");
  }
}

async function sendRating() {
  const selected = document.querySelector("[data-rating].selected");
  await api("/api/ratings", {
    method: "POST",
    body: {
      customerId: identity.customerId,
      ticketId: getCurrentQueueData()?.id || null,
      score: selected?.dataset.rating || "sem_nota",
      comment: document.querySelector("textarea").value
    }
  });
  document.querySelector("#ratingToast").classList.add("visible");
}

function bindEvents() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.tab)));
  document.querySelectorAll("[data-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.join)));
  document.querySelectorAll("[data-quick-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.quickJoin)));
  document.querySelectorAll("[data-qr-checkin]").forEach((button) => button.addEventListener("click", () => confirmSectorPresence(button.dataset.qrCheckin)));
  document.querySelector("#backButton").addEventListener("click", () => navigate("home"));
  document.querySelector("#notifyButton").addEventListener("click", handleNotifyButton);
  document.querySelector("#floatingQueue").addEventListener("click", () => navigate("status"));
  document.querySelector("#confirmCall").addEventListener("click", confirmCall);
  document.querySelector("#ticketCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#statusCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#completeServiceButton").addEventListener("click", finishCurrentService);
  document.querySelector("#statusFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#floatingFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#addProduct").addEventListener("click", addCurrentProduct);
  document.querySelector("#priorityToggle")?.addEventListener("change", syncPriorityControls);
  document.querySelector("#priorityReason")?.addEventListener("change", syncPriorityControls);
  document.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-rating]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
  document.querySelector("#sendRating").addEventListener("click", sendRating);
}

function syncPriorityControls() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason");
  if (!toggle || !reason) return;
  reason.disabled = !toggle.checked;
  if (!toggle.checked) reason.value = "";
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...csrfHeader()
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({ error: "Backend indisponivel." }));
  if (response.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Login necessÃ¡rio.");
  }
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
}

function csrfHeader() {
  const token = getCookie("fz_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

async function requireSession(roles) {
  const { user } = await api("/api/auth/me");
  if (!user || !roles.includes(user.role)) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Acesso negado.");
  }
  return user;
}

window.ticketOrchestration = {
  callNextEligibleTicket: (sectorId) => api(`/api/sectors/${sectorId}/call-next`, { method: "POST" }),
  finishService: (ticketId) => api(`/api/tickets/${ticketId}/finish`, { method: "POST" }),
  getState: loadState
};
