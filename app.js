"use strict";

/* =========================================================
   CONFIGURACIÓN Y ESTADO
   ========================================================= */

const STORAGE_KEY = "oficios-tucuman-mvp-v1";

const DEPARTMENTS = [
  "San Miguel de Tucumán",
  "Burruyacú",
  "Leales",
  "Lules",
  "Tafí Viejo",
  "Yerba Buena",
  "Cruz Alta",
  "Chicligasta",
  "Monteros",
  "Río Chico",
  "Tafí del Valle",
  "Trancas",
  "Simoca",
  "Graneros",
  "La Cocha",
  "Famaillá",
  "Juan Bautista Alberdi"
];

const TRADES = [
  "Albañil",
  "Electricista",
  "Plomero",
  "Gasista",
  "Carpintero",
  "Herrero",
  "Zinguero",
  "Paisajista",
  "Jardinero",
  "Servicio de limpieza",
  "Paseador de perros",
  "Niñero",
  "Durlero",
  "Otros"
];

const app = document.querySelector("#app");
const header = document.querySelector("#header");
const modal = document.querySelector("#modal");
const toastElement = document.querySelector("#toast");

let db;
let toastTimer;

const ui = {
  search: "",
  department: "",
  trade: "",
  availability: "",
  calendarOwner: "",
  month: "",
  date: ""
};

/* =========================================================
   UTILIDADES
   ========================================================= */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

const E = escapeHTML;

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uid() {
  return window.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function displayDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function minutes(value) {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return minutes(aStart) < minutes(bEnd)
    && minutes(bStart) < minutes(aEnd);
}

function isFuture(date, time) {
  return new Date(`${date}T${time}:00`).getTime() > Date.now();
}

function fullName(user) {
  return `${user.name} ${user.surname}`;
}

function currentUser() {
  return db.users.find(user => user.id === db.sessionId) || null;
}

function professional(id) {
  return db.users.find(user =>
    user.id === id && user.role === "professional"
  );
}

function selected(value, expected) {
  return value === expected ? "selected" : "";
}

function options(items, value, firstLabel = "") {
  return [
    firstLabel ? `<option value="">${E(firstLabel)}</option>` : "",
    ...items.map(item => `
      <option value="${E(item)}" ${selected(item, value)}>
        ${E(item)}
      </option>
    `)
  ].join("");
}

function avatar(name = "OT") {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <rect width="240" height="240" rx="45" fill="#c2d8c4"/>
      <text
        x="120" y="139"
        text-anchor="middle"
        font-family="Arial"
        font-size="76"
        fill="#222"
      >${E(initials)}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function userImage(user, large = false) {
  return `
    <img
      class="avatar ${large ? "large" : ""}"
      src="${E(user.photo || avatar(fullName(user)))}"
      alt="Foto de ${E(fullName(user))}"
      loading="lazy"
    >
  `;
}

function identityBadge(user) {
  return user.identityVerified
    ? `<span class="badge verified">Identidad verificada ✓ · Demo</span>`
    : `<span class="badge">Identidad pendiente</span>`;
}

function ratingFor(proId) {
  const reviews = db.reviews.filter(review => review.proId === proId);

  return {
    count: reviews.length,
    average: reviews.length
      ? (
          reviews.reduce((total, review) => total + review.stars, 0)
          / reviews.length
        ).toFixed(1)
      : "—"
  };
}

function stars(value) {
  return "★".repeat(value) + "☆".repeat(5 - value);
}

function notify(message, error = false) {
  clearTimeout(toastTimer);

  toastElement.textContent = message;
  toastElement.classList.toggle("error", error);
  toastElement.hidden = false;

  toastTimer = setTimeout(() => {
    toastElement.hidden = true;
  }, 5000);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function go(route) {
  closeModal();

  const target = `#${route}`;

  if (location.hash === target) {
    render();
  } else {
    location.hash = target;
  }
}

function openModal(title, content) {
  modal.innerHTML = `
    <div class="modal-head">
      <h2 id="modal-title">${E(title)}</h2>
      <button
        type="button"
        class="modal-close"
        data-action="close-modal"
        aria-label="Cerrar"
      >×</button>
    </div>
    ${content}
  `;

  if (!modal.open) modal.showModal();
}

function closeModal() {
  if (modal.open) modal.close();
}

function commit(change) {
  const previous = JSON.stringify(db);

  try {
    change(db);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    return true;
  } catch (error) {
    db = JSON.parse(previous);

    notify(
      error.name === "QuotaExceededError"
        ? "No hay espacio disponible. Probá con una imagen más pequeña."
        : error.message || "No se pudieron guardar los cambios.",
      true
    );

    return false;
  }
}

async function passwordHash(password, salt) {
  assert(
    window.crypto?.subtle,
    "Este navegador requiere abrir el proyecto en localhost o HTTPS."
  );

  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validatePassword(password, confirm) {
  assert(password.length >= 8, "La contraseña debe tener al menos 8 caracteres.");
  assert(password === confirm, "Las contraseñas son diferentes.");
}

function normalizePhone(value) {
  const phone = value.replace(/\D/g, "");

  assert(
    phone.length >= 10 && phone.length <= 15,
    "Ingresá un teléfono válido con código de país."
  );

  return phone;
}

function newChallenge(userId, kind = "signup") {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);

  return {
    userId,
    kind,
    code: String(100000 + random[0] % 900000),
    expires: Date.now() + 10 * 60 * 1000
  };
}

/*
  Las fotos de trabajos se reducen antes de guardarse.
  El DNI se valida como imagen, pero no se almacena.
*/
async function readImage(file) {
  assert(file && file.size, "Seleccioná una imagen.");

  assert(
    ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    "La imagen debe ser JPG, PNG o WEBP."
  );

  assert(
    file.size <= 5 * 1024 * 1024,
    "La imagen no puede superar los 5 MB."
  );

  const objectURL = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(
        new Error("Error al subir una imagen. El archivo no pudo leerse.")
      );
      image.src = objectURL;
    });

    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");

    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const context = canvas.getContext("2d");

    assert(context, "El navegador no pudo procesar la imagen.");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.76);
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

/* =========================================================
   DATOS DE DEMOSTRACIÓN
   ========================================================= */

async function createSeed() {
  const salt = "demo";
  const hash = await passwordHash("Demo1234", salt);

  const client = {
    id: "client-demo",
    name: "Lucía",
    surname: "Pérez",
    department: "Leales",
    phone: "5493810000000",
    email: "cliente@demo.com",
    role: "client",
    passwordHash: hash,
    salt,
    emailVerified: true,
    photo: ""
  };

  const definitions = [
    ["pro-1", "Martín", "Gómez", "Gasista", "Leales",
      ["San Miguel de Tucumán", "Cruz Alta"], true, "12"],
    ["pro-2", "Diego", "López", "Gasista", "San Miguel de Tucumán",
      ["Leales", "Yerba Buena"], false, "13"],
    ["pro-3", "Carolina", "Ruiz", "Electricista", "Leales",
      ["Lules", "Cruz Alta"], true, "47"],
    ["pro-4", "Javier", "Díaz", "Albañil", "Tafí Viejo",
      ["Leales", "Yerba Buena"], false, "14"],
    ["pro-5", "Pablo", "Sosa", "Plomero", "Yerba Buena",
      ["San Miguel de Tucumán", "Leales"], true, "15"],
    ["pro-6", "Ana", "Torres", "Carpintero", "Monteros",
      ["Famaillá", "Leales"], false, "44"],
    ["pro-7", "Mariana", "Vega", "Jardinero", "Leales",
      ["Lules", "San Miguel de Tucumán"], false, "49"],
    ["pro-8", "Gabriel", "Romero", "Herrero", "Cruz Alta",
      ["Leales", "Burruyacú"], false, "33"]
  ];

  const professionals = definitions.map((item, index) => {
    const [
      id, name, surname, trade, department, zones, alwaysAvailable, photo
    ] = item;

    const calendar = {};

    calendar[dateAfter(2)] = {
      status: "busy",
      slots: defaultSlots()
    };

    calendar[dateAfter(3)] = {
      status: "available",
      slots: defaultSlots().map((slot, slotIndex) => ({
        ...slot,
        status: slotIndex === 1 ? "reserved" : "available"
      }))
    };

    calendar[dateAfter(4)] = {
      status: "reserved",
      slots: defaultSlots()
    };

    return {
      id,
      name,
      surname,
      trade,
      department,
      zones,
      alwaysAvailable,
      calendar,
      role: "professional",
      email: index === 0
        ? "profesional@demo.com"
        : `profesional${index + 1}@demo.com`,
      phone: "5493810000000",
      salt,
      passwordHash: hash,
      emailVerified: true,
      identityVerified: index !== 7,
      license: trade === "Gasista" ? `DEMO-${1200 + index}` : "",
      bio: `Soy ${name}, trabajo en ${trade.toLowerCase()} y atiendo en `
        + `${department} y zonas cercanas. Me enfoco en la puntualidad, `
        + "el cuidado de los espacios y la comunicación con cada cliente.",
      photo: `https://i.pravatar.cc/240?img=${photo}`,
      works: [
        {
          id: uid(),
          title: "Trabajo terminado",
          description: "Ejemplo ilustrativo de un servicio realizado.",
          photo: "https://images.unsplash.com/photo-1504307651254-35680f356dfd"
            + "?auto=format&fit=crop&w=800&q=75"
        }
      ]
    };
  });

  const reviews = professionals.flatMap((pro, index) => [
    {
      id: `review-${index}-1`,
      proId: pro.id,
      clientId: `sample-client-${index}-1`,
      clientName: "Andrea",
      stars: 5,
      comment: "Excelente atención, cumplió con el horario acordado.",
      date: dateAfter(-12),
      response: index === 0 ? "" : "Muchas gracias por la confianza."
    },
    {
      id: `review-${index}-2`,
      proId: pro.id,
      clientId: `sample-client-${index}-2`,
      clientName: "Fernando",
      stars: 4,
      comment: "Buen trabajo y muy buena comunicación.",
      date: dateAfter(-6),
      response: ""
    }
  ]);

  return {
    version: 1,
    users: [client, ...professionals],
    sessionId: null,
    challenge: null,
    reviews,
    bookings: [
      {
        id: "booking-demo-completed",
        token: uid(),
        clientId: client.id,
        proId: "pro-1",
        date: dateAfter(-2),
        start: "10:00",
        end: "11:00",
        status: "completed",
        extra: false,
        createdAt: new Date().toISOString()
      }
    ]
  };
}

/* =========================================================
   CALENDARIO Y DISPONIBILIDAD
   ========================================================= */

function defaultSlots() {
  return [
    { id: "slot-1", start: "10:00", end: "11:00", status: "available" },
    { id: "slot-2", start: "11:30", end: "12:30", status: "available" },
    { id: "slot-3", start: "15:00", end: "16:00", status: "available" },
    { id: "slot-4", start: "17:00", end: "18:00", status: "available" }
  ];
}

function getDay(pro, date) {
  const existing = pro.calendar?.[date];

  if (existing) return JSON.parse(JSON.stringify(existing));

  const weekday = new Date(`${date}T12:00:00`).getDay();

  return {
    status: weekday === 0 ? "busy" : "available",
    slots: defaultSlots()
  };
}

function bookingsOn(proId, date) {
  return db.bookings.filter(booking =>
    booking.proId === proId
    && booking.date === date
    && booking.status !== "cancelled"
  );
}

function slotHasBooking(proId, date, slot) {
  return bookingsOn(proId, date).some(booking =>
    overlaps(slot.start, slot.end, booking.start, booking.end)
  );
}

function slotState(pro, date, slot) {
  if (slotHasBooking(pro.id, date, slot)) return "reserved";

  const day = getDay(pro, date);

  if (day.status !== "available") return day.status;

  return slot.status;
}

function dayState(pro, date) {
  const day = getDay(pro, date);
  const states = day.slots.map(slot => slotState(pro, date, slot));

  const hasFutureFree = day.slots.some((slot, index) =>
    states[index] === "available" && isFuture(date, slot.start)
  );

  if (hasFutureFree) return "available";
  if (states.includes("reserved")) return "reserved";

  return "busy";
}

function hasAvailability(pro, days = 7) {
  return Array.from({ length: days }, (_, index) => dateAfter(index))
    .some(date => dayState(pro, date) === "available");
}

function ensureCalendar(proId) {
  if (ui.calendarOwner !== proId) {
    ui.calendarOwner = proId;
    ui.date = dateKey();
    ui.month = `${dateKey().slice(0, 7)}-01`;
  }
}

function calendarHTML(pro, editable = false) {
  ensureCalendar(pro.id);

  const month = new Date(`${ui.month}T12:00:00`);
  const year = month.getFullYear();
  const monthNumber = month.getMonth();
  const lastDay = new Date(year, monthNumber + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7;

  const title = month.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric"
  });

  const cells = Array.from({ length: offset }, () => "<span></span>");

  for (let day = 1; day <= lastDay; day++) {
    const date = dateKey(new Date(year, monthNumber, day, 12));
    const status = dayState(pro, date);
    const hasReserved = getDay(pro, date).slots.some(slot =>
      slotState(pro, date, slot) === "reserved"
    );

    const label = {
      available: "disponible",
      busy: "ocupado",
      reserved: "reservado"
    }[status];

    cells.push(`
      <button
        type="button"
        class="day ${status} ${ui.date === date ? "selected" : ""}"
        data-action="select-day"
        data-date="${date}"
        ${date < dateKey() ? "disabled" : ""}
        aria-label="${E(displayDate(date))}: ${label}"
        aria-pressed="${ui.date === date}"
      >
        ${day}
        ${status === "available" && hasReserved
          ? '<span class="dot" aria-hidden="true">●</span>'
          : ""}
      </button>
    `);
  }

  return `
    <div class="calendar-head">
      <button
        class="btn secondary small"
        data-action="change-month"
        data-delta="-1"
        aria-label="Mes anterior"
      >‹</button>
      <strong>${E(title)}</strong>
      <button
        class="btn secondary small"
        data-action="change-month"
        data-delta="1"
        aria-label="Mes siguiente"
      >›</button>
    </div>

    <div class="calendar-week" aria-hidden="true">
      ${["L", "M", "M", "J", "V", "S", "D"].map(day => `<span>${day}</span>`).join("")}
    </div>

    <div class="calendar-grid">${cells.join("")}</div>

    <div class="legend">
      <span class="badge available">Libre</span>
      <span class="badge busy">Ocupado</span>
      <span class="badge reserved">Reservado</span>
    </div>

    <small class="muted">
      Un punto indica que ese día también tiene horarios reservados.
    </small>

    <h3 class="section-title">${E(displayDate(ui.date))}</h3>

    ${editable ? dayEditorHTML(pro) : clientSlotsHTML(pro)}
  `;
}

function clientSlotsHTML(pro) {
  const day = getDay(pro, ui.date);
  const user = currentUser();
  const canBook = user?.role === "client";

  return `
    <div class="slots">
      ${day.slots.map(slot => {
        const status = slotState(pro, ui.date, slot);
        const available = status === "available"
          && isFuture(ui.date, slot.start);

        const label = !isFuture(ui.date, slot.start)
          ? "No disponible"
          : {
              available: "Contratar",
              busy: "Ocupado",
              reserved: "Reservado"
            }[status];

        return `
          <button
            class="slot"
            data-action="book"
            data-pro="${pro.id}"
            data-slot="${slot.id}"
            ${!available || !canBook ? "disabled" : ""}
          >
            <strong>${slot.start} – ${slot.end}</strong>
            <small>${label}</small>
          </button>
        `;
      }).join("")}
    </div>

    ${!day.slots.length
      ? '<p class="muted">No hay horarios cargados para este día.</p>'
      : ""}

    ${pro.alwaysAvailable && canBook ? `
      <button
        class="btn secondary wide"
        style="margin-top:15px"
        data-action="extra-service"
        data-pro="${pro.id}"
      >
        Solicitar fuera de horario
      </button>
    ` : ""}
  `;
}

function scheduleRow(slot, locked = false) {
  return `
    <div
      class="schedule-row"
      data-slot-id="${E(slot.id)}"
      data-locked="${locked}"
      data-extra="${Boolean(slot.extra)}"
    >
      <label class="field">
        <span>Desde</span>
        <input
          type="time"
          class="slot-start"
          value="${slot.start}"
          required
          ${locked ? "disabled" : ""}
        >
      </label>

      <label class="field">
        <span>Hasta</span>
        <input
          type="time"
          class="slot-end"
          value="${slot.end}"
          required
          ${locked ? "disabled" : ""}
        >
      </label>

      <label class="field">
        <span>Estado</span>
        <select class="slot-status" ${locked ? "disabled" : ""}>
          <option value="available" ${selected(slot.status, "available")}>
            Libre
          </option>
          <option value="busy" ${selected(slot.status, "busy")}>
            Ocupado
          </option>
          <option value="reserved" ${selected(slot.status, "reserved")}>
            Reservado
          </option>
        </select>
      </label>

      <button
        type="button"
        class="btn danger small"
        data-action="remove-slot"
        ${locked ? "disabled" : ""}
      >Eliminar</button>

      ${locked ? `
        <small class="lock-note">
          Horario contratado. No se puede modificar desde el calendario.
        </small>
      ` : ""}
    </div>
  `;
}

function dayEditorHTML(pro) {
  const day = getDay(pro, ui.date);
  const hasBookings = bookingsOn(pro.id, ui.date).length > 0;

  return `
    <form
      data-form="schedule"
      data-date="${ui.date}"
      class="stack"
    >
      <label class="field">
        <span>Estado general del día</span>
        <select name="dayStatus" ${hasBookings ? "disabled" : ""}>
          <option value="available" ${selected(day.status, "available")}>
            Disponible según horarios
          </option>
          <option value="busy" ${selected(day.status, "busy")}>
            Día ocupado
          </option>
          <option value="reserved" ${selected(day.status, "reserved")}>
            Día reservado
          </option>
        </select>
      </label>

      ${hasBookings ? `
        <small class="muted">
          Hay contrataciones registradas. Podés editar los horarios restantes.
        </small>
      ` : ""}

      <div id="schedule-rows">
        ${day.slots.map(slot => scheduleRow(
          {
            ...slot,
            status: slotHasBooking(pro.id, ui.date, slot)
              ? "reserved"
              : slot.status
          },
          slotHasBooking(pro.id, ui.date, slot)
        )).join("")}
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn secondary"
          data-action="add-slot"
        >Agregar horario</button>

        <button type="submit" class="btn primary">
          Guardar disponibilidad
        </button>
      </div>
    </form>
  `;
}

/* =========================================================
   NAVEGACIÓN Y AUTENTICACIÓN
   ========================================================= */

function renderHeader(route) {
  const user = currentUser();

  const links = !user ? [] : user.role === "client" ? [
    ["home", "Inicio / Buscar"],
    ["bookings", "Mis servicios"],
    ["account", "Mi perfil"]
  ] : [
    ["dashboard", "Inicio"],
    [`profile/${user.id}`, "Mi perfil"],
    ["reviews", "Mis reseñas"],
    ["works", "Mis trabajos"],
    ["calendar", "Calendario"],
    ["account", "Configuración"]
  ];

  header.innerHTML = `
    <div class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#${user ? defaultRoute(user) : "login"}">
          <span class="brand-mark">OT</span>
          Oficios Tucumán
        </a>

        <nav class="nav" aria-label="Navegación principal">
          ${links.map(([path, label]) => `
            <a href="#${path}" class="${route === path ? "active" : ""}">
              ${label}
            </a>
          `).join("")}

          ${user ? `
            <button data-action="logout">Salir</button>
          ` : `
            <a href="#login">Ingresar</a>
            <a href="#register">Registrarse</a>
          `}
        </nav>
      </div>
    </div>
  `;
}

function defaultRoute(user) {
  return user.role === "professional" ? "dashboard" : "home";
}

function authLayout(content) {
  return `
    <div class="auth-layout">
      <section class="auth-intro">
        <span class="eyebrow">Hecho para Tucumán</span>
        <h1>El profesional que necesitás, cerca tuyo.</h1>
        <p>
          Buscá por oficio, conocé sus trabajos y encontrá
          un horario que se adapte a vos.
        </p>
        <div class="actions">
          <span class="badge">Oficios y servicios</span>
          <span class="badge">Toda la provincia</span>
        </div>
      </section>

      <section class="auth-panel">${content}</section>
    </div>
  `;
}

function loginPage() {
  return authLayout(`
    <h2>Bienvenido</h2>
    <p class="muted">Ingresá con el correo de tu cuenta.</p>

    <form data-form="login" class="stack">
      <label class="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          required
          autocomplete="username"
          placeholder="tu@email.com"
        >
      </label>

      <label class="field">
        <span>Contraseña</span>
        <input
          type="password"
          name="password"
          required
          autocomplete="current-password"
        >
      </label>

      <button class="btn primary wide" type="submit">
        Iniciar sesión
      </button>

      <a href="#reset" class="muted">¿Olvidaste tu contraseña?</a>
      <a href="#register" class="btn secondary wide">Registrarse</a>
    </form>

    <div class="notice" style="margin-top:22px">
      <strong>Probá la plataforma</strong>
      <p>
        Cliente: cliente@demo.com<br>
        Profesional: profesional@demo.com<br>
        Contraseña: <strong>Demo1234</strong>
      </p>

      <div class="actions">
        <button
          class="btn secondary small"
          data-action="demo-login"
          data-role="client"
        >Completar cliente</button>

        <button
          class="btn secondary small"
          data-action="demo-login"
          data-role="professional"
        >Completar profesional</button>
      </div>
    </div>
  `);
}

function registerPage() {
  return `
    <section class="auth-panel narrow">
      <h1>Crear cuenta</h1>
      <p class="muted">
        Elegí cómo querés participar. Los datos de este MVP se guardan
        únicamente en este navegador.
      </p>

      <form data-form="register" class="stack">
        <input type="hidden" name="role" value="client">

        <div class="role-switch">
          <button
            type="button"
            class="selected"
            data-action="select-role"
            data-role="client"
            aria-pressed="true"
          >Registrarme como cliente</button>

          <button
            type="button"
            data-action="select-role"
            data-role="professional"
            aria-pressed="false"
          >Registrarme como profesional</button>
        </div>

        <div class="form-grid">
          <label class="field">
            <span>Nombre</span>
            <input name="name" required maxlength="60" autocomplete="given-name">
          </label>

          <label class="field">
            <span>Apellido</span>
            <input
              name="surname"
              required
              maxlength="60"
              autocomplete="family-name"
            >
          </label>

          <label class="field full">
            <span>Departamento principal</span>
            <select name="department" required>
              ${options(DEPARTMENTS, "", "Seleccioná un departamento")}
            </select>
          </label>

          <label class="field full">
            <span>Número de teléfono</span>
            <input
              type="tel"
              name="phone"
              required
              maxlength="22"
              placeholder="5493810000000"
              autocomplete="tel"
            >
            <small>Incluí el código de país. Usá un número ficticio.</small>
          </label>

          <label class="field full">
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              maxlength="120"
              autocomplete="email"
            >
          </label>

          <label class="field">
            <span>Contraseña</span>
            <input
              type="password"
              name="password"
              minlength="8"
              required
              autocomplete="new-password"
            >
          </label>

          <label class="field">
            <span>Confirmar contraseña</span>
            <input
              type="password"
              name="confirm"
              minlength="8"
              required
              autocomplete="new-password"
            >
          </label>
        </div>

        <fieldset id="professional-fields" class="stack" disabled>
          <legend>Tu perfil profesional</legend>

          <label class="field">
            <span>Oficio</span>
            <select name="trade" required>
              ${options(TRADES, "", "Seleccioná un oficio")}
            </select>
          </label>

          <label id="license-field" class="field" hidden>
            <span>Matrícula</span>
            <input name="license" maxlength="60" disabled>
          </label>

          <div class="stack">
            <strong>
              ¿En qué otros departamentos estás dispuesto a trabajar?
            </strong>

            <div class="checklist">
              ${DEPARTMENTS.map(department => `
                <label class="checkline">
                  <input
                    type="checkbox"
                    name="zones"
                    value="${E(department)}"
                  >
                  ${E(department)}
                </label>
              `).join("")}
            </div>
          </div>

          <label class="field">
            <span>Cuéntales a tus clientes sobre tu trabajo</span>
            <textarea
              name="bio"
              required
              minlength="20"
              maxlength="1200"
              placeholder="Tu experiencia, los servicios que ofrecés..."
            ></textarea>
          </label>

          <div class="notice stack">
            <div>
              <strong>Sube tu DNI de Mi Argentina</strong>
              <p>
                En una plataforma real se utilizaría para verificar
                tu identidad. En esta demo seleccioná una imagen ficticia:
                no se almacena ni se muestra públicamente.
              </p>
            </div>

            <a
              class="btn secondary"
              href="https://mi.argentina.gob.ar/"
              target="_blank"
              rel="noopener noreferrer"
            >Abrir Mi Argentina</a>

            <label class="field">
              <span>Subir foto del DNI</span>
              <input
                type="file"
                name="dni"
                accept="image/jpeg,image/png,image/webp"
                required
              >
              <small>JPG, PNG o WEBP. Máximo 5 MB.</small>
            </label>
          </div>
        </fieldset>

        <button type="submit" class="btn primary wide">
          Registrarme
        </button>

        <a href="#login" class="muted">Ya tengo una cuenta</a>
      </form>
    </section>
  `;
}

function verificationPage() {
  const challenge = db.challenge;
  const user = db.users.find(item => item.id === challenge?.userId);

  if (!challenge || !user) {
    return `
      <section class="panel narrow">
        <h2>No hay una verificación pendiente</h2>
        <a class="btn primary" href="#login">Ir al inicio de sesión</a>
      </section>
    `;
  }

  const reset = challenge.kind === "reset";

  return `
    <section class="panel narrow">
      <h1>${reset ? "Restablecé tu contraseña" : "Verifica tu correo electrónico"}</h1>

      <p>Te enviamos un código de verificación a tu correo.</p>
      <p class="muted">${E(user.email)}</p>

      <div class="notice" style="margin-bottom:20px">
        Envío simulado. No se envió un correo real.
        Usá este código, válido por 10 minutos:
        <strong class="demo-code">${challenge.code}</strong>
      </div>

      <form data-form="verify" class="stack">
        <label class="field">
          <span>Código de verificación</span>
          <input
            name="code"
            inputmode="numeric"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            autocomplete="one-time-code"
            placeholder="000000"
          >
        </label>

        ${reset ? `
          <label class="field">
            <span>Nueva contraseña</span>
            <input
              name="password"
              type="password"
              minlength="8"
              required
              autocomplete="new-password"
            >
          </label>

          <label class="field">
            <span>Confirmar contraseña</span>
            <input
              name="confirm"
              type="password"
              minlength="8"
              required
              autocomplete="new-password"
            >
          </label>
        ` : ""}

        <button class="btn primary" type="submit">
          ${reset ? "Verificar y cambiar contraseña" : "Verificar"}
        </button>

        <button
          type="button"
          class="btn secondary"
          data-action="resend-code"
        >Reenviar código</button>

        <a href="#login" class="muted">Volver al inicio de sesión</a>
      </form>
    </section>
  `;
}

function resetPage() {
  return `
    <section class="panel narrow">
      <h1>Recuperar cuenta</h1>
      <p class="muted">
        Ingresá tu correo para generar un código de recuperación de prueba.
      </p>

      <form data-form="reset" class="stack">
        <label class="field">
          <span>Email</span>
          <input type="email" name="email" required autocomplete="email">
        </label>

        <button class="btn primary" type="submit">Enviar código</button>
        <a href="#login" class="muted">Volver</a>
      </form>
    </section>
  `;
}

/* =========================================================
   BÚSQUEDA Y FILTROS
   ========================================================= */

function professionalCard(pro) {
  const rating = ratingFor(pro.id);
  const local = pro.department === ui.department;

  return `
    <a class="pro-card" href="#profile/${pro.id}">
      <div class="card-top">
        ${userImage(pro)}
        ${pro.alwaysAvailable
          ? '<span class="badge available">24/7</span>'
          : ""}
      </div>

      <h3>${E(fullName(pro))}</h3>
      <p>${E(pro.trade)}</p>
      <p class="muted"><small>${E(pro.department)}</small></p>
      ${identityBadge(pro)}

      <div class="card-bottom">
        <span class="rating">
          ★ <strong>${rating.average}</strong> (${rating.count})
        </span>

        <span class="badge">
          ${ui.department ? (local ? "De tu zona" : "Trabaja en tu zona") : "Ver perfil"}
        </span>
      </div>
    </a>
  `;
}

function searchResultsHTML() {
  const term = normalize(ui.search);

  const professionals = db.users.filter(user => {
    if (user.role !== "professional" || !user.emailVerified) return false;

    const matchesSearch = !term || normalize(user.trade).includes(term);
    const matchesTrade = !ui.trade || user.trade === ui.trade;

    const matchesDepartment = !ui.department
      || user.department === ui.department
      || user.zones.includes(ui.department);

    const matchesAvailability = !ui.availability
      || (ui.availability === "247" && user.alwaysAvailable)
      || (
        ui.availability === "week"
        && hasAvailability(user)
      )
      || (
        ui.availability === "today"
        && dayState(user, dateKey()) === "available"
      );

    return matchesSearch
      && matchesTrade
      && matchesDepartment
      && matchesAvailability;
  });

  if (!professionals.length) {
    return `
      <div class="empty">
        <h3>No encontramos profesionales con esos filtros</h3>
        <p>Probá con otro oficio o ampliá la zona de búsqueda.</p>
        <button class="btn secondary" data-action="clear-filters">
          Limpiar filtros
        </button>
      </div>
    `;
  }

  if (!ui.department) {
    return `
      <h2 class="section-title">${professionals.length} profesionales</h2>
      <div class="cards">${professionals.map(professionalCard).join("")}</div>
    `;
  }

  const local = professionals.filter(pro => pro.department === ui.department);
  const visitors = professionals.filter(pro => pro.department !== ui.department);

  return `
    ${local.length ? `
      <h2 class="section-title">Profesionales de ${E(ui.department)}</h2>
      <div class="cards">${local.map(professionalCard).join("")}</div>
    ` : ""}

    ${visitors.length ? `
      <h2 class="section-title">
        De otros departamentos que trabajan en ${E(ui.department)}
      </h2>
      <div class="cards">${visitors.map(professionalCard).join("")}</div>
    ` : ""}
  `;
}

function homePage(user) {
  return `
    <section class="hero">
      <span class="eyebrow">Hola, ${E(user.name)}</span>
      <h1>Encontrá una solución cerca tuyo.</h1>
      <p>
        Conocé profesionales de tu zona, revisá sus trabajos
        y elegí cuándo necesitás el servicio.
      </p>
    </section>

    <div class="searchbar">
      <input
        id="search-input"
        type="search"
        value="${E(ui.search)}"
        placeholder="¿Qué necesitás? Gasista, plomero..."
        aria-label="Buscar profesionales por oficio"
      >

      <button class="btn secondary" data-action="filters">
        Filtros
      </button>
    </div>

    <div id="filter-summary" class="filter-summary">
      ${filterSummary()}
    </div>

    <section id="search-results" aria-live="polite">
      ${searchResultsHTML()}
    </section>
  `;
}

function filterSummary() {
  const availabilityLabels = {
    "": "Cualquier disponibilidad",
    today: "Con turnos hoy",
    week: "Con turnos en los próximos 7 días",
    "247": "Disponible 24/7"
  };

  return [
    ui.department || "Todos los departamentos",
    ui.trade || "Todos los oficios",
    availabilityLabels[ui.availability]
  ].map(E).join(" · ");
}

function showFilters() {
  openModal("Filtrar profesionales", `
    <form data-form="filters" class="stack">
      <label class="field">
        <span>Departamento donde necesitás el servicio</span>
        <select name="department">
          ${options(DEPARTMENTS, ui.department, "Todos los departamentos")}
        </select>
      </label>

      <label class="field">
        <span>Oficio</span>
        <select name="trade">
          ${options(TRADES, ui.trade, "Todos los oficios")}
        </select>
      </label>

      <label class="field">
        <span>Disponibilidad</span>
        <select name="availability">
          <option value="">Cualquiera</option>
          <option value="today" ${selected(ui.availability, "today")}>
            Con turnos hoy
          </option>
          <option value="week" ${selected(ui.availability, "week")}>
            Próximos 7 días
          </option>
          <option value="247" ${selected(ui.availability, "247")}>
            Disponible 24/7
          </option>
        </select>
      </label>

      <button type="submit" class="btn primary">Aplicar filtros</button>

      <button
        type="button"
        class="btn secondary"
        data-action="clear-filters"
      >Limpiar filtros</button>
    </form>
  `);
}

/* =========================================================
   PERFILES, TRABAJOS Y RESEÑAS
   ========================================================= */

function profileHeader(pro) {
  const rating = ratingFor(pro.id);

  return `
    <div class="profile-head">
      ${userImage(pro, true)}

      <div>
        <h1>${E(fullName(pro))}</h1>
        <p>${E(pro.trade)}</p>
        <p class="muted">${E(pro.department)}</p>

        <div class="actions">
          ${identityBadge(pro)}
          ${pro.alwaysAvailable
            ? '<span class="badge available">Disponible 24/7</span>'
            : ""}
        </div>

        <p class="rating" style="margin-top:9px">
          ★ <strong>${rating.average}</strong>
          · ${rating.count} reseñas
        </p>
      </div>
    </div>
  `;
}

function galleryHTML(pro) {
  if (!pro.works.length) {
    return '<div class="empty">Todavía no hay trabajos publicados.</div>';
  }

  return `
    <div class="gallery">
      ${pro.works.map(work => `
        <article class="work-card">
          <img
            src="${E(work.photo)}"
            alt="${E(work.title)}"
            loading="lazy"
          >
          <div>
            <h3>${E(work.title)}</h3>
            <p>${E(work.description)}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function canReview(clientId, proId) {
  const hasCompletedService = db.bookings.some(booking =>
    booking.clientId === clientId
    && booking.proId === proId
    && booking.status === "completed"
  );

  const alreadyReviewed = db.reviews.some(review =>
    review.clientId === clientId && review.proId === proId
  );

  return hasCompletedService && !alreadyReviewed;
}

function reviewsHTML(pro, owner = false) {
  const reviews = db.reviews
    .filter(review => review.proId === pro.id)
    .slice()
    .reverse();

  const user = currentUser();

  const reviewForm = user?.role === "client" && canReview(user.id, pro.id)
    ? `
      <form
        data-form="review"
        data-pro="${pro.id}"
        class="stack notice"
        style="margin-top:20px"
      >
        <h3>Califica a este profesional</h3>

        <label class="field">
          <span>Calificación</span>
          <select name="stars" required>
            <option value="">Seleccioná una calificación</option>
            ${[5, 4, 3, 2, 1].map(value => `
              <option value="${value}">
                ${stars(value)} — ${value}
              </option>
            `).join("")}
          </select>
        </label>

        <label class="field">
          <span>Comentario</span>
          <textarea
            name="comment"
            minlength="5"
            maxlength="1000"
            required
          ></textarea>
        </label>

        <button class="btn primary" type="submit">
          Publicar reseña
        </button>
      </form>
    `
    : "";

  return `
    ${reviews.length ? reviews.map(review => `
      <article class="review">
        <div class="review-top">
          <strong>${E(review.clientName)}</strong>
          <span aria-label="${review.stars} de 5 estrellas">
            ${stars(review.stars)}
          </span>
        </div>

        <small class="muted">${E(displayDate(review.date))}</small>
        <p>${E(review.comment)}</p>

        ${review.response ? `
          <div class="response">
            <strong>Respuesta del profesional</strong>
            <p>${E(review.response)}</p>
          </div>
        ` : owner ? `
          <button
            class="btn secondary small"
            data-action="respond"
            data-review="${review.id}"
          >Responder</button>
        ` : ""}
      </article>
    `).join("") : '<div class="empty">Aún no hay reseñas.</div>'}

    ${reviewForm}

    ${!owner && user?.role === "client" && !reviewForm ? `
      <p class="muted" style="margin-top:20px">
        Podés publicar una reseña por profesional después de finalizar
        un servicio contratado.
      </p>
    ` : ""}
  `;
}

function profilePage(pro) {
  if (!pro || !pro.emailVerified) return notFound();

  const owner = currentUser()?.id === pro.id;

  return `
    ${profileHeader(pro)}

    <div class="profile-layout">
      <div class="stack">
        <section class="panel">
          <h2>Sobre mi trabajo</h2>
          <p class="preline">${E(pro.bio)}</p>

          <p class="muted">
            También trabajo en:
            ${E(pro.zones.join(", ") || "mi departamento principal")}.
          </p>

          ${pro.trade === "Gasista" ? `
            <p><strong>Matrícula:</strong> ${E(pro.license)}</p>
          ` : ""}

          ${!owner ? `
            <button
              class="btn primary"
              data-action="whatsapp"
              data-pro="${pro.id}"
            >Contactar por WhatsApp</button>
          ` : `
            <a href="#account" class="btn secondary">Editar mi perfil</a>
          `}
        </section>

        <section class="panel">
          <h2>Trabajos realizados</h2>
          ${galleryHTML(pro)}
        </section>

        <section class="panel" id="profile-reviews">
          <h2>Reseñas y calificaciones</h2>
          ${reviewsHTML(pro, owner)}
        </section>
      </div>

      <section class="panel">
        <h2>Calendario del profesional</h2>
        <p class="muted">
          Seleccioná un día para consultar sus horarios.
        </p>

        ${calendarHTML(pro)}

        ${owner ? `
          <a href="#calendar" class="btn secondary wide" style="margin-top:20px">
            Administrar disponibilidad
          </a>
        ` : ""}
      </section>
    </div>
  `;
}

/* =========================================================
   CONTRATACIONES Y QR SIMULADO
   ========================================================= */

function showBooking(proId, slotId) {
  const user = currentUser();
  const pro = professional(proId);
  const date = ui.date;
  const slot = getDay(pro, date).slots.find(item => item.id === slotId);

  assert(user?.role === "client", "Ingresá como cliente para contratar.");
  assert(slot, "El horario ya no existe.");

  assert(
    slotState(pro, date, slot) === "available" && isFuture(date, slot.start),
    "Este horario ya no está disponible."
  );

  openModal("Confirmar contratación", `
    <form
      data-form="booking"
      data-pro="${pro.id}"
      data-date="${date}"
      data-slot="${slot.id}"
      class="stack"
    >
      <div class="notice">
        <strong>${E(fullName(pro))} · ${E(pro.trade)}</strong>
        <p>
          ${E(displayDate(date))}<br>
          ${slot.start} – ${slot.end}
        </p>
      </div>

      <p class="muted">
        Se reservará el horario y se generará un acceso de verificación.
        Este MVP no realiza cobros.
      </p>

      <button type="submit" class="btn primary">
        Confirmar contratación
      </button>
    </form>
  `);
}

function showExtraService(proId) {
  const pro = professional(proId);

  assert(currentUser()?.role === "client", "Ingresá como cliente.");
  assert(pro?.alwaysAvailable, "Este profesional no tiene activada la atención 24/7.");

  openModal("Servicio fuera de horario", `
    <form data-form="extra-service" data-pro="${pro.id}" class="stack">
      <div class="notice warning">
        Este servicio se solicita fuera del horario laboral habitual.
        El profesional podría cobrar un importe adicional.
      </div>

      <p class="muted">
        Seleccioná un horario fuera de los turnos habituales.
        La plataforma no calcula ni agrega cargos.
      </p>

      <label class="field">
        <span>Fecha</span>
        <input
          name="date"
          type="date"
          min="${dateKey()}"
          value="${ui.date || dateKey()}"
          required
        >
      </label>

      <div class="form-grid">
        <label class="field">
          <span>Desde</span>
          <input name="start" type="time" value="20:00" required>
        </label>

        <label class="field">
          <span>Hasta</span>
          <input name="end" type="time" value="21:00" required>
        </label>
      </div>

      <button class="btn primary" type="submit">
        Continuar y contratar
      </button>
    </form>
  `);
}

function bookingCard(booking, owner = false) {
  const pro = professional(booking.proId);
  const client = db.users.find(user => user.id === booking.clientId);
  const completed = booking.status === "completed";

  const canComplete = !completed
    && new Date(`${booking.date}T${booking.end}:00`).getTime() <= Date.now();

  return `
    <article class="booking">
      <div class="review-top">
        <h3>${E(owner ? fullName(client) : fullName(pro))}</h3>

        <span class="badge ${completed ? "available" : "reserved"}">
          ${completed ? "Finalizado" : "Contratado"}
        </span>
      </div>

      <p>${E(pro.trade)} · ${E(displayDate(booking.date))}</p>
      <p class="muted">
        ${booking.start} – ${booking.end}
        ${booking.extra ? " · Fuera del horario habitual" : ""}
      </p>

      <div class="actions">
        ${!owner ? `
          <a class="btn secondary small" href="#profile/${pro.id}">
            Ver profesional
          </a>

          <button
            class="btn secondary small"
            data-action="show-qr"
            data-booking="${booking.id}"
          >Ver QR de verificación</button>
        ` : ""}

        ${canComplete ? `
          <button
            class="btn primary small"
            data-action="complete-service"
            data-booking="${booking.id}"
          >Marcar servicio finalizado</button>
        ` : ""}

        ${!owner && completed && canReview(booking.clientId, pro.id) ? `
          <a class="btn primary small" href="#profile/${pro.id}">
            Calificar profesional
          </a>
        ` : ""}
      </div>

      ${!completed && !canComplete ? `
        <small class="muted">
          Podrás finalizar el servicio cuando termine el horario reservado.
        </small>
      ` : ""}
    </article>
  `;
}

function bookingsPage(user) {
  const owner = user.role === "professional";

  const bookings = db.bookings
    .filter(booking =>
      owner ? booking.proId === user.id : booking.clientId === user.id
    )
    .slice()
    .sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));

  return `
    <div class="page-head">
      <div>
        <h1>${owner ? "Servicios contratados" : "Mis servicios"}</h1>
        <p>Consultá tus contrataciones y el estado de cada servicio.</p>
      </div>
    </div>

    <div class="stack">
      ${bookings.length
        ? bookings.map(booking => bookingCard(booking, owner)).join("")
        : '<div class="empty">Todavía no hay servicios contratados.</div>'}
    </div>
  `;
}

function qrIllustration() {
  return `
    <svg viewBox="0 0 100 100" role="img" aria-label="QR ilustrativo, no escaneable">
      <rect width="100" height="100" fill="white"/>
      <g fill="#222">
        <path d="M0 0h30v30H0z M70 0h30v30H70z M0 70h30v30H0z"/>
        <path d="M40 0h10v10H40z M40 20h20v10H40z M40 40h10v20H40z
          M60 40h20v10H60z M90 40h10v20H90z M0 40h20v10H0z
          M20 50h10v10H20z M40 70h10v30H40z M60 60h10v20H60z
          M80 70h20v10H80z M60 90h20v10H60z M90 90h10v10H90z"/>
      </g>
      <g fill="white">
        <path d="M6 6h18v18H6z M76 6h18v18H76z M6 76h18v18H6z"/>
      </g>
      <g fill="#222">
        <path d="M11 11h8v8H11z M81 11h8v8H81z M11 81h8v8H11z"/>
      </g>
    </svg>
  `;
}

function showQR(bookingId) {
  const booking = db.bookings.find(item => item.id === bookingId);
  const user = currentUser();

  assert(
    booking && user?.id === booking.clientId,
    "No tenés acceso a esta contratación."
  );

  openModal("Verificación del profesional", `
    <div class="qr-demo">
      ${qrIllustration()}

      <strong>QR de demostración</strong>

      <p class="muted">
        Esta imagen no es escaneable. Usá el botón para simular
        la lectura y abrir la ficha de identidad.
      </p>

      <a class="btn primary" href="#identity/${booking.token}">
        Simular lectura del QR
      </a>
    </div>
  `);
}

function identityPage(token) {
  const booking = db.bookings.find(item => item.token === token);
  const pro = booking ? professional(booking.proId) : null;

  if (!pro) return notFound();

  return `
    <section class="panel narrow stack">
      <span class="eyebrow">Ficha de verificación</span>

      ${userImage(pro, true)}

      <div>
        <h1>${E(fullName(pro))}</h1>
        <p>${E(pro.trade)}</p>
        <p class="muted">${E(pro.department)}</p>
        ${identityBadge(pro)}
      </div>

      <div class="notice">
        Esta ficha muestra información pública.
        No contiene el número ni la imagen del DNI.
      </div>

      <button
        class="btn primary"
        data-action="verify-identity"
        data-pro="${pro.id}"
      >Verificar identidad</button>

      <p id="identity-result" class="muted" aria-live="polite"></p>

      <small class="muted">
        Verificación simulada, sin conexión con organismos oficiales.
        El acceso funciona con los datos guardados en este navegador.
      </small>
    </section>
  `;
}

/* =========================================================
   PANEL PROFESIONAL Y CONFIGURACIÓN
   ========================================================= */

function dashboardPage(user) {
  const rating = ratingFor(user.id);
  const active = db.bookings.filter(booking =>
    booking.proId === user.id && booking.status === "confirmed"
  );

  return `
    ${profileHeader(user)}

    <div class="stats">
      <div class="stat">
        <strong>${active.length}</strong>
        <span>Servicios pendientes</span>
      </div>

      <div class="stat">
        <strong>${rating.average}</strong>
        <span>Calificación promedio</span>
      </div>

      <div class="stat">
        <strong>${user.works.length}</strong>
        <span>Trabajos publicados</span>
      </div>
    </div>

    <section class="panel stack" style="margin-top:22px">
      <h2>Tu espacio profesional</h2>

      ${availabilitySwitch(user)}

      <div class="actions">
        <a class="btn primary" href="#calendar">Administrar calendario</a>
        <button class="btn secondary" data-action="add-work">Agregar trabajo</button>
        <a class="btn secondary" href="#reviews">Mis reseñas</a>
        <a class="btn secondary" href="#bookings">Ver servicios</a>
      </div>
    </section>

    <h2 class="section-title">Próximos servicios</h2>

    <div class="stack">
      ${active.length
        ? active
            .slice()
            .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
            .map(booking => bookingCard(booking, true))
            .join("")
        : '<div class="empty">Todavía no tenés servicios pendientes.</div>'}
    </div>
  `;
}

function availabilitySwitch(user) {
  return `
    <label class="switch">
      <span>
        <strong>Disponibilidad 24/7</strong>
        <small>Aceptar servicios fuera del horario habitual.</small>
      </span>

      <input
        id="availability-toggle"
        type="checkbox"
        ${user.alwaysAvailable ? "checked" : ""}
        aria-label="Activar disponibilidad 24/7"
      >
    </label>
  `;
}

function calendarPage(user) {
  return `
    <div class="page-head">
      <div>
        <h1>Mi calendario</h1>
        <p>Organizá días, horarios y reservas.</p>
      </div>
    </div>

    <section class="panel narrow stack">
      ${availabilitySwitch(user)}
      <div>${calendarHTML(user, true)}</div>
    </section>
  `;
}

function worksPage(user) {
  return `
    <div class="page-head">
      <div>
        <h1>Mis trabajos</h1>
        <p>Mostrá tu experiencia con fotografías y descripciones.</p>
      </div>

      <button class="btn primary" data-action="add-work">
        Agregar trabajo
      </button>
    </div>

    ${galleryHTML(user)}
  `;
}

function showWorkForm() {
  assert(currentUser()?.role === "professional", "Acceso exclusivo para profesionales.");

  openModal("Agregar trabajo", `
    <form data-form="work" class="stack">
      <label class="field">
        <span>Fotografía</span>
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          required
        >
        <small>JPG, PNG o WEBP. Máximo 5 MB.</small>
      </label>

      <label class="field">
        <span>Título del trabajo</span>
        <input name="title" maxlength="90" required>
      </label>

      <label class="field">
        <span>Descripción</span>
        <textarea name="description" maxlength="1200" required></textarea>
      </label>

      <button class="btn primary" type="submit">Publicar trabajo</button>
    </form>
  `);
}

function accountPage(user) {
  const owner = user.role === "professional";

  return `
    <section class="panel narrow">
      <h1>${owner ? "Configuración" : "Mi perfil"}</h1>
      <p class="muted">${E(user.email)}</p>

      <form data-form="account" class="stack">
        ${userImage(user, true)}

        <label class="field">
          <span>Cambiar foto de perfil</span>
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
          >
        </label>

        <div class="form-grid">
          <label class="field">
            <span>Nombre</span>
            <input name="name" value="${E(user.name)}" required maxlength="60">
          </label>

          <label class="field">
            <span>Apellido</span>
            <input
              name="surname"
              value="${E(user.surname)}"
              required
              maxlength="60"
            >
          </label>
        </div>

        <label class="field">
          <span>Departamento principal</span>
          <select name="department" required>
            ${options(DEPARTMENTS, user.department)}
          </select>
        </label>

        <label class="field">
          <span>Teléfono con código de país</span>
          <input name="phone" type="tel" value="${E(user.phone)}" required>
        </label>

        ${owner ? `
          <label class="field">
            <span>Presentación profesional</span>
            <textarea name="bio" minlength="20" maxlength="1200" required>${E(user.bio)}</textarea>
          </label>

          <div>
            <h3>Zonas adicionales de trabajo</h3>
            <div class="checklist">
              ${DEPARTMENTS.map(department => `
                <label class="checkline">
                  <input
                    type="checkbox"
                    name="zones"
                    value="${E(department)}"
                    ${user.zones.includes(department) ? "checked" : ""}
                  >
                  ${E(department)}
                </label>
              `).join("")}
            </div>
          </div>

          ${identityBadge(user)}
        ` : ""}

        <button class="btn primary" type="submit">Guardar cambios</button>
      </form>
    </section>
  `;
}

/* =========================================================
   RENDERIZADO DE RUTAS
   ========================================================= */

function notFound() {
  return `
    <section class="empty">
      <h1>No encontramos esta página</h1>
      <a class="btn primary" href="#login">Volver al inicio</a>
    </section>
  `;
}

function render() {
  closeModal();

  const user = currentUser();
  let route = location.hash.slice(1)
    || (user ? defaultRoute(user) : db.challenge ? "verify" : "login");

  const [page, id] = route.split("/");
  const publicPages = ["login", "register", "verify", "reset", "identity"];

  if (!user && !publicPages.includes(page)) {
    go(db.challenge ? "verify" : "login");
    return;
  }

  if (user && ["login", "register", "reset"].includes(page)) {
    go(defaultRoute(user));
    return;
  }

  const professionalPages = ["dashboard", "calendar", "works", "reviews"];

  if (user?.role !== "professional" && professionalPages.includes(page)) {
    go("home");
    return;
  }

  if (page === "home" && user?.role === "professional") {
    go("dashboard");
    return;
  }

  renderHeader(route);

  const pages = {
    login: () => loginPage(),
    register: () => registerPage(),
    verify: () => verificationPage(),
    reset: () => resetPage(),
    home: () => homePage(user),
    profile: () => profilePage(professional(id)),
    dashboard: () => dashboardPage(user),
    calendar: () => calendarPage(user),
    works: () => worksPage(user),
    reviews: () => `
      <section class="panel">
        <h1>Mis reseñas</h1>
        <p class="muted">Podés responder una sola vez a cada reseña.</p>
        ${reviewsHTML(user, true)}
      </section>
    `,
    account: () => accountPage(user),
    bookings: () => bookingsPage(user),
    identity: () => identityPage(id)
  };

  app.innerHTML = pages[page] ? pages[page]() : notFound();
}

/* =========================================================
   ENVÍO DE FORMULARIOS
   ========================================================= */

document.addEventListener("submit", async event => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;

  event.preventDefault();

  if (form.dataset.busy === "true" || !form.reportValidity()) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const value = name => String(data.get(name) || "").trim();
  const password = name => String(data.get(name) || "");

  form.dataset.busy = "true";
  if (submitButton) submitButton.disabled = true;

  try {
    switch (form.dataset.form) {
      case "login": {
        const email = value("email").toLowerCase();
        const user = db.users.find(item => item.email.toLowerCase() === email);

        assert(user, "Email o contraseña incorrectos.");

        const hash = await passwordHash(password("password"), user.salt);

        assert(hash === user.passwordHash, "Email o contraseña incorrectos.");

        if (!user.emailVerified) {
          if (commit(state => {
            state.challenge = newChallenge(user.id);
          })) {
            go("verify");
            notify("Primero verificá tu correo electrónico.");
          }
          break;
        }

        if (commit(state => {
          state.sessionId = user.id;
          state.challenge = null;
        })) {
          ui.department = user.department;
          ui.search = "";
          ui.trade = "";
          ui.availability = "";
          ui.calendarOwner = "";

          go(defaultRoute(user));
          notify(`Bienvenido, ${user.name}.`);
        }

        break;
      }

      case "register": {
        const role = value("role");
        const email = value("email").toLowerCase();
        const name = value("name");
        const surname = value("surname");
        const department = value("department");

        assert(["client", "professional"].includes(role), "Seleccioná un tipo de cuenta.");
        assert(name && surname, "Completá nombre y apellido.");
        assert(DEPARTMENTS.includes(department), "Seleccioná un departamento.");
        assert(!db.users.some(user => user.email === email), "Ya existe una cuenta con ese email.");

        validatePassword(password("password"), password("confirm"));

        const phone = normalizePhone(value("phone"));
        const pro = role === "professional";
        const trade = pro ? value("trade") : "";

        if (pro) {
          assert(TRADES.includes(trade), "Seleccioná un oficio.");

          assert(
            trade !== "Gasista" || value("license"),
            "La matrícula es requerida para Gasista."
          );

          assert(value("bio").length >= 20, "Escribí una presentación de al menos 20 caracteres.");

          // Se comprueba la imagen y se descarta. No se guarda el DNI.
          await readImage(data.get("dni"));
        }

        const id = uid();
        const salt = uid();
        const hash = await passwordHash(password("password"), salt);

        const user = {
          id,
          name,
          surname,
          department,
          phone,
          email,
          role,
          salt,
          passwordHash: hash,
          emailVerified: false,
          photo: "",
          ...(pro ? {
            trade,
            license: trade === "Gasista" ? value("license") : "",
            bio: value("bio"),
            zones: data.getAll("zones").filter(zone => zone !== department),
            identityVerified: true,
            alwaysAvailable: false,
            calendar: {},
            works: []
          } : {})
        };

        if (commit(state => {
          state.users.push(user);
          state.challenge = newChallenge(id);
        })) {
          go("verify");
          notify("Cuenta creada. Se simuló el envío del código de verificación.");
        }

        break;
      }

      case "verify": {
        const challenge = db.challenge;

        assert(challenge, "No hay una verificación pendiente.");

        assert(
          Date.now() <= challenge.expires,
          "El código venció. Seleccioná Reenviar código."
        );

        assert(value("code") === challenge.code, "El código ingresado no es válido.");

        let hash;

        if (challenge.kind === "reset") {
          validatePassword(password("password"), password("confirm"));

          const user = db.users.find(item => item.id === challenge.userId);
          hash = await passwordHash(password("password"), user.salt);

          assert(db.challenge === challenge, "El código cambió. Volvé a intentarlo.");
          assert(Date.now() <= challenge.expires, "El código venció. Reenviá el código.");
        }

        if (commit(state => {
          const user = state.users.find(item => item.id === challenge.userId);

          if (challenge.kind === "reset") user.passwordHash = hash;
          user.emailVerified = true;

          state.challenge = null;
          state.sessionId = null;
        })) {
          go("login");

          notify(challenge.kind === "reset"
            ? "Contraseña actualizada. Ya podés iniciar sesión."
            : "Correo verificado correctamente.");
        }

        break;
      }

      case "reset": {
        const user = db.users.find(item =>
          item.email === value("email").toLowerCase()
        );

        assert(user, "No existe una cuenta local con ese correo.");

        if (commit(state => {
          state.challenge = newChallenge(user.id, "reset");
        })) {
          go("verify");
          notify("Código de recuperación generado en modo demostración.");
        }

        break;
      }

      case "filters": {
        ui.department = value("department");
        ui.trade = value("trade");
        ui.availability = value("availability");

        render();
        break;
      }

      case "booking": {
        const user = currentUser();
        const pro = professional(form.dataset.pro);
        const date = form.dataset.date;

        assert(user?.role === "client", "Ingresá como cliente.");

        const slot = getDay(pro, date).slots.find(item =>
          item.id === form.dataset.slot
        );

        assert(
          slot
          && slotState(pro, date, slot) === "available"
          && isFuture(date, slot.start),
          "Ese horario ya no está disponible."
        );

        const booking = {
          id: uid(),
          token: uid(),
          clientId: user.id,
          proId: pro.id,
          date,
          start: slot.start,
          end: slot.end,
          status: "confirmed",
          extra: false,
          createdAt: new Date().toISOString()
        };

        if (commit(state => state.bookings.push(booking))) {
          closeModal();
          go("bookings");
          notify("Servicio contratado correctamente. Tu verificación ya está disponible.");
        }

        break;
      }

      case "extra-service": {
        const user = currentUser();
        const pro = professional(form.dataset.pro);

        assert(user?.role === "client", "Ingresá como cliente.");
        assert(pro?.alwaysAvailable, "El profesional desactivó la disponibilidad 24/7.");

        const date = value("date");
        const start = value("start");
        const end = value("end");
        const day = getDay(pro, date);

        assert(isFuture(date, start), "Seleccioná un horario futuro.");
        assert(minutes(start) < minutes(end), "La hora final debe ser posterior a la inicial.");
        assert(day.status === "available", "Ese día está marcado como ocupado o reservado.");

        assert(
          !day.slots.some(slot => overlaps(start, end, slot.start, slot.end)),
          "Elegí un horario que no se superponga con los turnos del calendario."
        );

        assert(
          !bookingsOn(pro.id, date).some(booking =>
            overlaps(start, end, booking.start, booking.end)
          ),
          "Ese horario ya fue contratado."
        );

        const booking = {
          id: uid(),
          token: uid(),
          clientId: user.id,
          proId: pro.id,
          date,
          start,
          end,
          status: "confirmed",
          extra: true,
          createdAt: new Date().toISOString()
        };

        if (commit(state => {
          const target = state.users.find(item => item.id === pro.id);

          day.slots.push({
            id: uid(),
            start,
            end,
            status: "available",
            extra: true
          });

          day.slots.sort((a, b) => minutes(a.start) - minutes(b.start));
          target.calendar[date] = day;

          state.bookings.push(booking);
        })) {
          go("bookings");
          notify("Servicio fuera de horario contratado. No se aplicaron cargos automáticos.");
        }

        break;
      }

      case "review": {
        const user = currentUser();
        const proId = form.dataset.pro;
        const score = Number(value("stars"));
        const comment = value("comment");

        assert(user?.role === "client", "Ingresá como cliente.");
        assert(canReview(user.id, proId), "No tenés un servicio habilitado para esta reseña.");
        assert(Number.isInteger(score) && score >= 1 && score <= 5, "Seleccioná entre 1 y 5 estrellas.");
        assert(comment.length >= 5, "Escribí un comentario de al menos 5 caracteres.");

        if (commit(state => {
          state.reviews.push({
            id: uid(),
            proId,
            clientId: user.id,
            clientName: fullName(user),
            stars: score,
            comment,
            date: dateKey(),
            response: ""
          });
        })) {
          render();
          notify("Reseña publicada correctamente.");
        }

        break;
      }

      case "response": {
        const user = currentUser();
        const review = db.reviews.find(item =>
          item.id === form.dataset.review
        );

        assert(
          user?.role === "professional" && review?.proId === user.id,
          "No podés responder esta reseña."
        );

        assert(!review.response, "Esta reseña ya tiene una respuesta.");
        assert(value("response"), "Escribí una respuesta.");

        if (commit(() => {
          review.response = value("response");
        })) {
          render();
          notify("Respuesta publicada correctamente.");
        }

        break;
      }

      case "work": {
        const user = currentUser();

        assert(user?.role === "professional", "Ingresá como profesional.");
        assert(value("title") && value("description"), "Completá el título y la descripción.");

        const photo = await readImage(data.get("photo"));

        assert(currentUser()?.id === user.id, "La sesión cambió. Volvé a iniciar sesión.");

        if (commit(() => {
          user.works.unshift({
            id: uid(),
            title: value("title"),
            description: value("description"),
            photo
          });
        })) {
          go("works");
          notify("Trabajo publicado correctamente.");
        }

        break;
      }

      case "schedule": {
        const user = currentUser();
        const date = form.dataset.date;

        assert(user?.role === "professional", "Ingresá como profesional.");
        assert(date >= dateKey(), "No se puede modificar una fecha pasada.");

        const original = getDay(user, date);
        const rows = [...form.querySelectorAll(".schedule-row")];

        const slots = rows.map(row => ({
          id: row.dataset.slotId,
          start: row.querySelector(".slot-start").value,
          end: row.querySelector(".slot-end").value,
          status: row.querySelector(".slot-status").value,
          extra: row.dataset.extra === "true"
        }));

        for (const slot of slots) {
          assert(slot.start && slot.end, "Completá todos los horarios.");
          assert(minutes(slot.start) < minutes(slot.end), "La hora final debe ser posterior a la inicial.");

          assert(
            ["available", "busy", "reserved"].includes(slot.status),
            "Estado de horario inválido."
          );
        }

        const sorted = slots.slice().sort((a, b) =>
          minutes(a.start) - minutes(b.start)
        );

        for (let index = 1; index < sorted.length; index++) {
          assert(
            minutes(sorted[index - 1].end) <= minutes(sorted[index].start),
            "Los horarios no pueden superponerse."
          );
        }

        for (const slot of original.slots) {
          if (!slotHasBooking(user.id, date, slot)) continue;

          const replacement = slots.find(item => item.id === slot.id);

          assert(
            replacement
            && replacement.start === slot.start
            && replacement.end === slot.end
            && replacement.status === "reserved",
            "No podés modificar ni eliminar un horario contratado."
          );
        }

        const hasBookings = bookingsOn(user.id, date).length > 0;
        const dayStatus = hasBookings ? original.status : value("dayStatus");

        assert(
          ["available", "busy", "reserved"].includes(dayStatus),
          "Estado del día inválido."
        );

        if (commit(() => {
          user.calendar[date] = { status: dayStatus, slots: sorted };
        })) {
          render();
          notify("Disponibilidad actualizada correctamente.");
        }

        break;
      }

      case "account": {
        const user = currentUser();

        assert(user, "Iniciá sesión.");
        assert(value("name") && value("surname"), "Completá nombre y apellido.");
        assert(DEPARTMENTS.includes(value("department")), "Departamento inválido.");

        const phone = normalizePhone(value("phone"));
        let photo = user.photo;

        const file = data.get("photo");
        if (file?.size) photo = await readImage(file);

        if (user.role === "professional") {
          assert(value("bio").length >= 20, "La presentación debe tener al menos 20 caracteres.");
        }

        assert(currentUser()?.id === user.id, "La sesión cambió.");

        if (commit(() => {
          user.name = value("name");
          user.surname = value("surname");
          user.department = value("department");
          user.phone = phone;
          user.photo = photo;

          if (user.role === "professional") {
            user.bio = value("bio");
            user.zones = data.getAll("zones").filter(zone =>
              zone !== user.department
            );
          }
        })) {
          if (user.role === "client") ui.department = user.department;

          render();
          notify("Perfil actualizado correctamente.");
        }

        break;
      }
    }
  } catch (error) {
    notify(error.message || "No se pudo completar la operación.", true);
  } finally {
    delete form.dataset.busy;
    if (submitButton) submitButton.disabled = false;
  }
});

/* =========================================================
   BOTONES Y ACCIONES
   ========================================================= */

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;

  const action = button.dataset.action;

  try {
    switch (action) {
      case "close-modal":
        closeModal();
        break;

      case "logout":
        if (commit(state => {
          state.sessionId = null;
        })) {
          ui.calendarOwner = "";
          go("login");
          notify("Sesión cerrada.");
        }
        break;

      case "demo-login": {
        const form = document.querySelector('[data-form="login"]');

        form.elements.email.value = button.dataset.role === "client"
          ? "cliente@demo.com"
          : "profesional@demo.com";

        form.elements.password.value = "Demo1234";
        form.elements.email.focus();
        break;
      }

      case "select-role": {
        const form = button.closest("form");
        const isProfessional = button.dataset.role === "professional";

        form.elements.role.value = button.dataset.role;
        form.querySelector("#professional-fields").disabled = !isProfessional;

        form.querySelectorAll('[data-action="select-role"]').forEach(item => {
          const active = item === button;

          item.classList.toggle("selected", active);
          item.setAttribute("aria-pressed", String(active));
        });

        updateLicenseField(form);
        break;
      }

      case "resend-code": {
        assert(db.challenge, "No hay una verificación pendiente.");

        const { userId, kind } = db.challenge;

        if (commit(state => {
          state.challenge = newChallenge(userId, kind);
        })) {
          render();
          notify("Se generó un nuevo código de demostración.");
        }

        break;
      }

      case "filters":
        showFilters();
        break;

      case "clear-filters":
        ui.search = "";
        ui.department = "";
        ui.trade = "";
        ui.availability = "";
        render();
        break;

      case "change-month": {
        const month = new Date(`${ui.month}T12:00:00`);

        month.setMonth(month.getMonth() + Number(button.dataset.delta));

        const earliest = new Date(`${dateKey().slice(0, 7)}-01T12:00:00`);

        if (month < earliest) {
          notify("No se pueden reservar fechas pasadas.");
          break;
        }

        ui.month = dateKey(month);
        render();
        break;
      }

      case "select-day":
        ui.date = button.dataset.date;
        render();
        break;

      case "book":
        showBooking(button.dataset.pro, button.dataset.slot);
        break;

      case "extra-service":
        showExtraService(button.dataset.pro);
        break;

      case "show-qr":
        showQR(button.dataset.booking);
        break;

      case "verify-identity": {
        const pro = professional(button.dataset.pro);

        document.querySelector("#identity-result").textContent =
          pro.identityVerified
            ? "Identidad verificada ✓. Resultado simulado; no constituye una validación oficial."
            : "La identidad de este profesional todavía está pendiente de verificación.";

        break;
      }

      case "complete-service": {
        const user = currentUser();
        const booking = db.bookings.find(item =>
          item.id === button.dataset.booking
        );

        assert(
          booking && [booking.clientId, booking.proId].includes(user?.id),
          "No tenés acceso a este servicio."
        );

        assert(booking.status === "confirmed", "El servicio ya está finalizado.");

        assert(
          new Date(`${booking.date}T${booking.end}:00`).getTime() <= Date.now(),
          "Todavía no terminó el horario reservado."
        );

        openModal("Finalizar servicio", `
          <div class="stack">
            <p>
              Confirmá que el trabajo ya fue realizado.
              Esto habilitará la reseña del cliente.
            </p>

            <button
              class="btn primary"
              data-action="confirm-completion"
              data-booking="${booking.id}"
            >Confirmar servicio finalizado</button>
          </div>
        `);

        break;
      }

      case "confirm-completion": {
        const user = currentUser();
        const booking = db.bookings.find(item =>
          item.id === button.dataset.booking
        );

        assert(
          booking && [booking.clientId, booking.proId].includes(user?.id),
          "No tenés acceso a este servicio."
        );

        assert(booking.status === "confirmed", "El servicio ya está finalizado.");

        assert(
          new Date(`${booking.date}T${booking.end}:00`).getTime() <= Date.now(),
          "El horario reservado todavía no terminó."
        );

        if (commit(() => {
          booking.status = "completed";
        })) {
          render();
          notify("Servicio finalizado. El cliente ya puede dejar su reseña.");
        }

        break;
      }

      case "respond": {
        const user = currentUser();
        const review = db.reviews.find(item =>
          item.id === button.dataset.review
        );

        assert(
          user?.role === "professional" && review?.proId === user.id,
          "No podés responder esta reseña."
        );

        assert(!review.response, "Ya respondiste esta reseña.");

        openModal("Responder reseña", `
          <form
            data-form="response"
            data-review="${review.id}"
            class="stack"
          >
            <div class="notice">
              <strong>${E(review.clientName)}</strong>
              <p>${E(review.comment)}</p>
            </div>

            <label class="field">
              <span>Tu respuesta</span>
              <textarea name="response" maxlength="1000" required></textarea>
            </label>

            <small class="muted">
              Solo se permite una respuesta por reseña.
            </small>

            <button type="submit" class="btn primary">
              Publicar respuesta
            </button>
          </form>
        `);

        break;
      }

      case "add-work":
        showWorkForm();
        break;

      case "add-slot": {
        assert(currentUser()?.role === "professional", "Ingresá como profesional.");

        const rows = document.querySelector("#schedule-rows");

        rows.insertAdjacentHTML("beforeend", scheduleRow({
          id: uid(),
          start: "",
          end: "",
          status: "available"
        }));

        rows.lastElementChild.querySelector("input").focus();
        break;
      }

      case "remove-slot": {
        const row = button.closest(".schedule-row");

        assert(row.dataset.locked !== "true", "No se puede eliminar un horario contratado.");

        row.remove();
        break;
      }

      case "whatsapp": {
        const pro = professional(button.dataset.pro);
        const phone = pro.phone.replace(/\D/g, "");
        const message = encodeURIComponent(
          `Hola ${pro.name}, vi tu perfil en Oficios Tucumán `
          + `y quiero consultar por un servicio de ${pro.trade.toLowerCase()}.`
        );

        openModal("Contacto por WhatsApp", `
          <div class="stack">
            <p>
              Vas a abrir WhatsApp para contactar a
              <strong>${E(fullName(pro))}</strong>.
            </p>

            <div class="notice">
              Los teléfonos de los perfiles precargados son ficticios.
              Abrir el enlace no envía un mensaje automáticamente.
            </div>

            <a
              class="btn primary"
              href="https://wa.me/${phone}?text=${message}"
              target="_blank"
              rel="noopener noreferrer"
            >Abrir WhatsApp</a>
          </div>
        `);

        break;
      }
    }
  } catch (error) {
    notify(error.message || "No se pudo completar la acción.", true);
  }
});

/* =========================================================
   CAMBIOS EN CAMPOS
   ========================================================= */

function updateLicenseField(form) {
  const field = form.querySelector("#license-field");
  if (!field) return;

  const needsLicense = form.elements.role.value === "professional"
    && form.elements.trade.value === "Gasista";

  field.hidden = !needsLicense;
  form.elements.license.disabled = !needsLicense;
  form.elements.license.required = needsLicense;
}

document.addEventListener("change", event => {
  const target = event.target;

  if (
    target.name === "trade"
    && target.closest('[data-form="register"]')
  ) {
    updateLicenseField(target.form);
  }

  if (target.id === "availability-toggle") {
    const user = currentUser();

    if (user?.role !== "professional") return;

    const previous = user.alwaysAvailable;

    if (commit(() => {
      user.alwaysAvailable = target.checked;
    })) {
      notify(user.alwaysAvailable
        ? "Disponibilidad 24/7 activada."
        : "Disponibilidad 24/7 desactivada.");
    } else {
      target.checked = previous;
    }
  }
});

document.addEventListener("input", event => {
  if (event.target.id !== "search-input") return;

  ui.search = event.target.value;

  document.querySelector("#search-results").innerHTML = searchResultsHTML();
});

/*
  Si una foto externa no carga, se muestra un avatar local.
*/
document.addEventListener("error", event => {
  const image = event.target;

  if (image.tagName !== "IMG" || image.dataset.fallback) return;

  image.dataset.fallback = "true";
  image.src = avatar("Oficios Tucumán");
}, true);

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
});

/*
  Actualiza los datos cuando otra pestaña modifica localStorage.
  Se cierran formularios abiertos para evitar guardar estados viejos.
*/
window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;

  try {
    const incoming = JSON.parse(event.newValue);

    if (incoming.version !== 1) return;

    db = incoming;
    render();
    notify("Los datos se actualizaron desde otra pestaña.");
  } catch {
    notify("No se pudieron leer los cambios de otra pestaña.", true);
  }
});

/* =========================================================
   INICIO
   ========================================================= */

async function boot() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      db = JSON.parse(saved);

      assert(
        db.version === 1
        && Array.isArray(db.users)
        && Array.isArray(db.bookings)
        && Array.isArray(db.reviews),
        "Los datos locales no tienen un formato válido."
      );
    } else {
      db = await createSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    }

    const user = currentUser();
    ui.department = user?.department || "Leales";

    if (db.challenge && !user) {
      if (location.hash === "#verify") {
        render();
      } else {
        go("verify");
      }
    } else {
      render();
    }
  } catch (error) {
    app.innerHTML = `
      <section class="panel narrow">
        <h1>No se pudo iniciar la aplicación</h1>
        <p>${E(error.message)}</p>
        <p class="muted">
          Permití el almacenamiento local y usá un navegador actualizado.
          Si abriste el archivo directamente y el navegador limita sus
          funciones, ejecutalo con Live Server desde Visual Studio Code.
        </p>
      </section>
    `;
  }
}

boot();