/* ===========================================================================
   El Sanatorio — Cinematic v2 orchestration
   2026-06-21
   Loads: GSAP + ScrollTrigger, Lenis smooth scroll, Three.js film-grain
   shader, ambient sound (Howler), cursor spotlight, reveal animations,
   Cuidadores week resolver, availability fetch, patient ID generator,
   Family Pass calculator, booking estimator, Hortensia chat widget.

   All third-party libs are loaded via CDN in index.html. This module is
   plain ES2022 — no build step, no bundler. Targets modern Evergreen
   browsers (Chrome/Safari/Firefox 2024+). Reduced-motion users get a
   static-friendly fallback per the @media (prefers-reduced-motion) block
   in cinematic-v2.css.
   =========================================================================== */

(() => {
  'use strict';

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const WA_NUMBER = '19034598763';            // canonical Maia WhatsApp (BRAIN.md)
  const WA_BASE = `https://wa.me/${WA_NUMBER}`;
  const TIER_PRICES = {                       // COP, locked per Andrew direct 2026-06-23
    standard: 60000,
    grupo: 48000        // 20% off Estandar for 4-8 person groups (advertised as discount)
  };

  /* ------------------------------------------------------------------
     1. CUSTOM CURSOR SPOTLIGHT
     ------------------------------------------------------------------ */
  function initCursor() {
    if (REDUCED_MOTION || IS_TOUCH) return;

    const spot = document.createElement('div');
    spot.className = 'cursor-spotlight';
    document.body.appendChild(spot);
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    document.body.appendChild(dot);

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    let sx = tx, sy = ty;
    let dx = tx, dy = ty;

    window.addEventListener('mousemove', (e) => {
      tx = e.clientX; ty = e.clientY;
    });

    function tick() {
      // spotlight follows with delay (lerp 0.08)
      sx += (tx - sx) * 0.08;
      sy += (ty - sy) * 0.08;
      spot.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      // dot follows tighter
      dx += (tx - dx) * 0.35;
      dy += (ty - dy) * 0.35;
      dot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
      requestAnimationFrame(tick);
    }
    tick();

    // hover expansion on interactive elements
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('a, button, [role="button"], input, select, textarea, .patient-card, .tile')) {
        dot.classList.add('is-hover');
      }
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest('a, button, [role="button"], input, select, textarea, .patient-card, .tile')) {
        dot.classList.remove('is-hover');
      }
    });
  }

  /* ------------------------------------------------------------------
     2. THREE.JS FILM GRAIN OVERLAY (fragment-shader fullscreen quad)
     ------------------------------------------------------------------ */
  function initGrain() {
    if (REDUCED_MOTION || !window.THREE) return;

    const canvas = document.querySelector('.cinema-grain');
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const setSize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
    setSize();
    window.addEventListener('resize', setSize);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.45 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uResolution;

        // good hash
        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;
          // 16mm grain — animated noise, with temporal lock at ~24fps
          float frame = floor(uTime * 24.0);
          float n = hash(uv * uResolution.xy * 0.5 + frame * 0.7);
          float grain = (n - 0.5) * uIntensity;

          // slight horizontal scratches (vintage emulsion damage)
          float scratch = step(0.998, hash(vec2(uv.y * 800.0, floor(uTime * 6.0))));
          grain += scratch * 0.15;

          // film dust speck (rare)
          float speck = step(0.9995, hash(uv * 2000.0 + frame));
          grain -= speck * 0.4;

          gl_FragColor = vec4(grain, grain * 0.96, grain * 0.85, abs(grain) * 1.5);
        }
      `
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const start = performance.now();
    function render() {
      mat.uniforms.uTime.value = (performance.now() - start) / 1000;
      mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    }
    render();
  }

  /* ------------------------------------------------------------------
     3. LENIS SMOOTH SCROLL
     ------------------------------------------------------------------ */
  function initLenis() {
    if (REDUCED_MOTION || !window.Lenis) return;
    const lenis = new Lenis({
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
      touchMultiplier: 2,
    });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    window.__lenis = lenis;

    // anchor links scroll through Lenis
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: -40, duration: 1.6 });
    });
  }

  /* ------------------------------------------------------------------
     4. GSAP SCROLLTRIGGER REVEALS
     ------------------------------------------------------------------ */
  function initScrollReveals() {
    if (!window.gsap || !window.ScrollTrigger) {
      // graceful fallback — IntersectionObserver
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.18, rootMargin: '0px 0px -10% 0px' });
      document.querySelectorAll('.fade-in-up').forEach((el) => obs.observe(el));
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    // generic fade-in-up
    gsap.utils.toArray('.fade-in-up').forEach((el, i) => {
      gsap.fromTo(el,
        { opacity: 0, y: 30 },
        {
          opacity: 1, y: 0, duration: 0.95, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' },
          delay: (i % 3) * 0.06,
        }
      );
    });

    // section-eyebrow staggers in
    gsap.utils.toArray('.section').forEach((sec) => {
      const eyebrow = sec.querySelector('.section__eyebrow');
      const title = sec.querySelector('.section__title');
      if (!eyebrow || !title) return;
      const tl = gsap.timeline({
        scrollTrigger: { trigger: sec, start: 'top 75%', toggleActions: 'play none none none' }
      });
      tl.from(eyebrow, { opacity: 0, x: -16, duration: 0.6, ease: 'power2.out' })
        .from(title, { opacity: 0, y: 24, duration: 0.9, ease: 'power3.out' }, '-=0.35');
    });

    // parallax: atrium projector drifts down as we scroll past hero
    const projector = document.querySelector('.atrium__projector');
    if (projector) {
      gsap.to(projector, {
        y: 120, opacity: 0.4,
        scrollTrigger: {
          trigger: '.atrium', start: 'top top', end: 'bottom top', scrub: true
        }
      });
    }

    // patient cards horizontal-pan hint on enter
    gsap.from('.patient-card', {
      opacity: 0, x: 40, stagger: 0.08, duration: 0.7, ease: 'power2.out',
      scrollTrigger: { trigger: '.asylum__reel', start: 'top 70%' }
    });

    // experience tiles cascade
    gsap.from('.tile', {
      opacity: 0, y: 32, stagger: 0.07, duration: 0.7, ease: 'power3.out',
      scrollTrigger: { trigger: '.experience__grid', start: 'top 80%' }
    });
  }

  /* ------------------------------------------------------------------
     5. AMBIENT SOUND (Howler) — opt-in
     ------------------------------------------------------------------ */
  function initSound() {
    const toggle = document.querySelector('.sound-toggle');
    if (!toggle) return;
    let isMuted = true;
    toggle.classList.add('is-muted');
    let sound = null;

    toggle.addEventListener('click', () => {
      if (!sound && window.Howl) {
        sound = new Howl({
          // ambient hospital corridor murmur — base64 silence by default;
          // when Andrew commissions the audio, drop file into /audio/ambient-asilo.mp3
          src: ['/audio/ambient-asilo.mp3', '/audio/ambient-asilo.ogg'],
          loop: true, volume: 0.35, html5: true,
          onloaderror: () => { /* silent fallback */ }
        });
      }
      isMuted = !isMuted;
      if (sound) {
        if (isMuted) sound.pause(); else sound.play();
      }
      toggle.classList.toggle('is-muted', isMuted);
    });
  }

  /* ------------------------------------------------------------------
     6. CUIDADORES — current week categoría (12-week rotation)
     Source: PROGRAMA-CUIDADORES-SANTA-MARTA-2026-06-21.md §2
     ------------------------------------------------------------------ */
  const CUIDADORES_ROTATION = [
    { startISO: '2026-06-24', wed: 'Maestros',    sun: 'Madres Cabeza de Familia',     code: 'MAESTRO-SM',  copy: 'Para los profes que aguantan el año entero corrigiendo a media luz — esta noche es de ustedes.' },
    { startISO: '2026-07-01', wed: 'Enfermeras',  sun: 'Adultos Mayores 65+',          code: 'ENFE-SM',     copy: 'Las que cuidan a Santa Marta todo el año. Una noche, déjenos cuidarlas a ustedes.' },
    { startISO: '2026-07-08', wed: 'Bomberos',    sun: 'Personas con Discapacidad',    code: 'BOMBERO-SM',  copy: 'Bomberos voluntarios y oficiales — los que corren cuando todos huyen. Una noche con nosotros.' },
    { startISO: '2026-07-15', wed: 'Policía Nacional', sun: 'Madres Cabeza de Familia', code: 'POLI-SM',    copy: 'Comando Magdalena — una noche tranquila con los tuyos. Te la mereces.' },
    { startISO: '2026-07-22', wed: 'Médicos',     sun: 'Adultos Mayores 65+',          code: 'MEDICO-SM',   copy: 'A los médicos y médicas de Santa Marta — bajen la bata un rato.' },
    { startISO: '2026-07-29', wed: 'Militares (Armada)', sun: 'Maestros',              code: 'ARMADA-SM',   copy: 'Marinos de la Armada Nacional — nos cuidan el mar. Esta noche les pagamos un poco para atrás.' },
    { startISO: '2026-08-05', wed: 'Trabajadores de la Salud', sun: 'Madres Cabeza de Familia', code: 'SALUD-SM', copy: 'Auxiliares, terapeutas, técnicos — lo que ustedes sostienen no se ve en la TV, pero nosotros lo vemos.' },
    { startISO: '2026-08-12', wed: 'Maestros',    sun: 'Adultos Mayores 65+',          code: 'MAESTRO2-SM', copy: 'Segunda vuelta: profes, esta semana es para ustedes y los suyos.' },
    { startISO: '2026-08-19', wed: 'Enfermeras',  sun: 'Personas con Discapacidad',    code: 'ENFE2-SM',    copy: 'Enfermeras del Tórax, del Prado, del General — vuelvan, esta noche está apartada.' },
    { startISO: '2026-08-26', wed: 'Primeros Respondientes (Bomberos + Policía)', sun: 'Madres Cabeza de Familia', code: '1ROS-SM', copy: 'Bomberos y Policía juntos — los héroes en uniforme. Una mesa larga.' },
    { startISO: '2026-09-02', wed: 'Médicos',     sun: 'Adultos Mayores 65+',          code: 'MEDICO2-SM',  copy: 'Segunda vuelta médica — guardia de 36 horas merece descanso de 3.' },
    { startISO: '2026-09-09', wed: 'Militares (Armada)', sun: 'Personas con Discapacidad + Cuidadores', code: 'ARMADA2-SM', copy: 'Armada Nacional — segunda noche del puerto, esta semana abrimos para ustedes.' },
  ];
  const FAMILY_PASS_CATEGORIES = [
    { value: 'maestros',     label: 'Maestro / Profesor',           id: 'Carnet del Magisterio / del colegio' },
    { value: 'enfermeras',   label: 'Enfermera / Enfermero',         id: 'Tarjeta COMENAL / carnet hospitalario' },
    { value: 'bomberos',     label: 'Bombero (voluntario u oficial)',id: 'Carnet del Cuerpo de Bomberos' },
    { value: 'policia',      label: 'Policía Nacional',              id: 'Carnet de la Policía Nacional' },
    { value: 'medicos',      label: 'Médico (general o especialista)',id: 'Tarjeta MinSalud / carnet hospitalario' },
    { value: 'militares',    label: 'Militar (Armada / Ejército / FAC)', id: 'Carnet militar vigente' },
    { value: 'madres',       label: 'Madre Cabeza de Familia',       id: 'RUV / Sec. de la Mujer / carta del párroco' },
    { value: 'mayores',      label: 'Adulto Mayor (65+)',            id: 'Cédula (edad ≥65)' },
    { value: 'discapacidad', label: 'Persona con Discapacidad',      id: 'Carnet RLCPD' },
    { value: 'salud',        label: 'Trabajador de la Salud (aux./téc.)', id: 'Carnet hospitalario' },
    { value: 'ninguno',      label: 'Ninguna de las anteriores',     id: null }
  ];

  function getCurrentWeek() {
    const today = new Date();
    today.setHours(0,0,0,0);
    let current = CUIDADORES_ROTATION[0];
    for (const wk of CUIDADORES_ROTATION) {
      if (new Date(wk.startISO) <= today) current = wk;
    }
    // also compute next Wed + Sun for display
    const dow = today.getDay(); // 0 Sun
    const daysToWed = (3 - dow + 7) % 7 || 7;
    const daysToSun = (0 - dow + 7) % 7 || 7;
    const nextWed = new Date(today); nextWed.setDate(today.getDate() + daysToWed);
    const nextSun = new Date(today); nextSun.setDate(today.getDate() + daysToSun);
    return { ...current, nextWed, nextSun };
  }

  function fmtSpanishDate(d) {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    return `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`;
  }

  function initCuidadores() {
    const wk = getCurrentWeek();
    const elCat = document.querySelector('[data-cuidadores-cat]');
    const elMeta = document.querySelector('[data-cuidadores-meta]');
    const elCopy = document.querySelector('[data-cuidadores-copy]');
    if (elCat) elCat.textContent = wk.wed;
    if (elMeta) elMeta.textContent = `Miércoles · ${fmtSpanishDate(wk.nextWed)} · Domingo: ${wk.sun}`;
    if (elCopy) elCopy.textContent = wk.copy;

    // populate Family Pass select
    const select = document.querySelector('[data-fpc-select]');
    if (select) {
      FAMILY_PASS_CATEGORIES.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.value; opt.textContent = c.label;
        select.appendChild(opt);
      });
    }
  }

  /* ------------------------------------------------------------------
     7. FAMILY PASS CALCULATOR
     ------------------------------------------------------------------ */
  function initFamilyPass() {
    const form = document.querySelector('[data-fpc-form]');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const cat = form.querySelector('[data-fpc-select]').value;
      const size = parseInt(form.querySelector('[data-fpc-size]').value, 10) || 0;
      const result = form.querySelector('[data-fpc-result]');
      const categoryObj = FAMILY_PASS_CATEGORIES.find((c) => c.value === cat);
      const week = getCurrentWeek();

      result.classList.remove('is-eligible', 'is-ineligible');

      if (!cat || cat === 'ninguno') {
        result.classList.add('is-ineligible');
        result.innerHTML = `El 2 por 1 de Cuidadores no aplica en tu caso — pero la entrada estándar son <strong>$60.000 COP</strong> por persona, mesa para todos. <br><br>Te dejo el chat de Hortensia para reservar.`;
        return;
      }
      if (size < 4 || size % 2 !== 0 || size > 8) {
        result.classList.add('is-ineligible');
        result.innerHTML = `El Programa Cuidadores es <strong>2 por 1</strong> — aplica desde 4 personas y en pares (4, 6 u 8). Ajusta el grupo y la casa los recibe.`;
        return;
      }
      const totalStd = size * TIER_PRICES.standard;
      const totalPass = (size / 2) * TIER_PRICES.standard; // pay for half the group (2 por 1)
      const savings = totalStd - totalPass;
      const msg = encodeURIComponent(
        `Hola, soy ${categoryObj.label} de Santa Marta. Vi lo del Programa Cuidadores y quiero reservar 2 por 1 para ${size} personas — pagamos ${size/2}, entramos ${size}. ¿Cómo hago?`
      );
      result.classList.add('is-eligible');
      result.innerHTML = `
        <strong>¡Califican!</strong> Programa Cuidadores · <em>${categoryObj.label}</em> · <strong>2 por 1</strong> para ${size} personas.<br><br>
        Pagan <strong>${size/2}</strong>, entran <strong>${size}</strong>. Total cubierto: <strong>$${totalPass.toLocaleString('es-CO')} COP</strong> (frente a $${totalStd.toLocaleString('es-CO')} general).<br>
        Ahorran <strong>$${savings.toLocaleString('es-CO')} COP</strong>. Comida y cocteles a precio normal. Trae ${categoryObj.id} vigente a la entrada.
        <br><a class="fpc__cta" href="${WA_BASE}?text=${msg}" target="_blank" rel="noopener">Reservar por WhatsApp</a>
      `;
    });
  }

  /* ------------------------------------------------------------------
     8. PATIENT ID GENERATOR (Section 4 — Programa Ficha del Paciente)
     ------------------------------------------------------------------ */
  const PATIENT_ARCHETYPES = {
    'AÁ': { name: 'El Cantador Hilario', sobriquet: 'El Proyector Humano', dx: 'Cree que Norm Lewis le canta a través de la pared. Tratamiento: subirle el brillo.' },
    'B':  { name: 'Don Bellasrio',       sobriquet: 'El Telégrafo',        dx: 'Envía mensajes Morse al puerto con los dientes. Tratamiento: ticker-tape diario.' },
    'C':  { name: 'Carmela la Costurera', sobriquet: 'La Mano Firme',      dx: 'Insiste en coser todo dos veces. Tratamiento: hilo de algodón abundante.' },
    'D':  { name: 'Don Aldo',            sobriquet: 'El Ciudadano',        dx: 'Habla con la pared del jardín. La pared responde. Tratamiento: mediar con paciencia.' },
    'E':  { name: 'Eulalia',             sobriquet: 'La que Vio',          dx: 'Ve lo que viene mañana. Tratamiento: ignorar lo que ya no se puede evitar.' },
    'F':  { name: 'Fermín',              sobriquet: 'El Cuentista',        dx: 'Recuerda cosas que no pasaron. Y a veces pasan. Tratamiento: anotar todo.' },
    'G':  { name: 'Genoveva',            sobriquet: 'La Encendedora',      dx: 'Prende fósforos para hablar con los muertos. Tratamiento: cerillas húmedas.' },
    'H':  { name: 'Don Hilario',         sobriquet: 'El Proyector Humano', dx: 'Cree proyectar películas con la cara. Tratamiento: pasarle el trapo de la lente.' },
    'IJ': { name: 'Joaquín',             sobriquet: 'El Cronómetro',       dx: 'Sabe qué hora es sin reloj. Y nunca se equivoca. Tratamiento: respetarle el ritmo.' },
    'K':  { name: 'Kátrina',             sobriquet: 'La Sombra',           dx: 'Camina sin hacer ruido. A veces aparece dos veces. Tratamiento: ofrecerle siempre dos sillas.' },
    'L':  { name: 'Lupita',              sobriquet: 'La Cocinera',         dx: 'Cocina platos que nadie pidió. Todos saben buenos. Tratamiento: agradecer.' },
    'M':  { name: 'Micaela',             sobriquet: 'La Modista del Pus',  dx: 'Cose miembros perdidos por la noche. Muy tranquila. Tratamiento: dejarla.' },
    'N':  { name: 'La Niña Marta',       sobriquet: 'La Acompañante',      dx: 'Tiene 8 años desde 1957. No envejece. Tratamiento: traerle dulces.' },
    'OÑ': { name: 'Olga',                sobriquet: 'La Profesora',        dx: 'Da clases de cosas que nunca enseñó. Los alumnos sí aprenden. Tratamiento: tomar nota.' },
    'P':  { name: 'Doña Pilar',          sobriquet: 'La Recepcionista',    dx: 'Lleva 23 años en el turno noche. Conoce a todos. Tratamiento: ningún cambio.' },
    'QR': { name: 'Rosa',                sobriquet: 'La Tejedora',         dx: 'Teje una bufanda que no termina. Tratamiento: comprarle más lana.' },
    'S':  { name: 'Soledad',             sobriquet: 'La Silenciosa',       dx: 'Habla solo en sueños. Y predice. Tratamiento: una almohada nueva.' },
    'T':  { name: 'Tobías',              sobriquet: 'El Coleccionista',    dx: 'Guarda cucharas debajo de la cama. 247 hasta ahora. Tratamiento: no contar.' },
    'UV': { name: 'Úrsula',              sobriquet: 'La que Reza',         dx: 'Reza a los santos que no existen. Le funciona. Tratamiento: encomendarse.' },
    'WXYZ': { name: 'Yolanda',           sobriquet: 'La Última',           dx: 'Es la última que llegó al pabellón. Nunca habla. Tratamiento: esperarla.' }
  };

  function pickArchetype(name) {
    const first = (name.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')[0]) || 'P';
    for (const k of Object.keys(PATIENT_ARCHETYPES)) {
      if (k.includes(first)) return PATIENT_ARCHETYPES[k];
    }
    return PATIENT_ARCHETYPES['P'];
  }

  function initFicha() {
    const form = document.querySelector('[data-ficha-form]');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('[data-ficha-input]');
      const name = (input.value || '').trim();
      if (!name) return;
      const arc = pickArchetype(name);
      const card = document.querySelector('[data-ficha-card]');
      const num = String(Math.floor(13 + Math.random() * 386)).padStart(3, '0');
      card.querySelector('[data-ficha-num]').textContent = `EXPEDIENTE Nº SAN-${num}`;
      card.querySelector('[data-ficha-name]').textContent = arc.name;
      card.querySelector('[data-ficha-real]').textContent = name.toUpperCase();
      card.querySelector('[data-ficha-sobriquet]').textContent = arc.sobriquet;
      card.querySelector('[data-ficha-ingreso]').textContent = fmtSpanishDate(new Date());
      card.querySelector('[data-ficha-dx]').textContent = arc.dx;
      const shareTxt = encodeURIComponent(`Mi ficha de paciente en El Sanatorio dice que soy "${arc.name} — ${arc.sobriquet}". 🏥 Reserva la tuya: https://el-sanatorio.com`);
      card.querySelector('[data-ficha-share]').href = `${WA_BASE}?text=${shareTxt}`;
      card.classList.add('is-visible');
      // smooth scroll to card
      setTimeout(() => card.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' }), 120);
    });
  }

  /* ------------------------------------------------------------------
     9. BOOKING ESTIMATOR
     ------------------------------------------------------------------ */
  function initEstimator() {
    const root = document.querySelector('[data-estimator]');
    if (!root) return;
    const size = root.querySelector('[data-est-size]');
    const tier = root.querySelector('[data-est-tier]');
    const totalEl = root.querySelector('[data-est-total]');
    const depEl = root.querySelector('[data-est-deposit]');
    const balEl = root.querySelector('[data-est-balance]');
    const waBtn = root.querySelector('[data-est-wa]');
    const wompiBtn = root.querySelector('[data-est-wompi]');

    function recalc() {
      const n = Math.max(1, Math.min(20, parseInt(size.value, 10) || 1));
      // Q1 gate (Andrew 2026-06-23): Grupo 4-8 (20% off) only valid for parties of 4-8.
      // Disable the Grupo option when size is outside that range, and bounce tier back
      // to Standard if the user had it selected.
      const grupoOpt = tier.querySelector('option[value="grupo"]');
      const grupoValid = n >= 4 && n <= 8;
      if (grupoOpt) {
        grupoOpt.disabled = !grupoValid;
        grupoOpt.textContent = grupoValid
          ? 'Grupo 4-8 (20% off) — $48.000 c/u'
          : 'Grupo 4-8 (20% off) — solo grupos de 4 a 8';
      }
      if (!grupoValid && tier.value === 'grupo') {
        tier.value = 'standard';
      }
      const t = TIER_PRICES[tier.value] || TIER_PRICES.standard;
      const total = n * t;
      const deposit = Math.round(total * 0.5);
      const balance = total - deposit;
      totalEl.textContent = `$${total.toLocaleString('es-CO')} COP`;
      depEl.textContent = `Depósito 50%: $${deposit.toLocaleString('es-CO')}`;
      balEl.textContent = `Saldo en la noche: $${balance.toLocaleString('es-CO')}`;

      const tierLabel = tier.value === 'grupo' ? 'Grupo 4-8 (20% off)' : 'Entrada Estándar';
      const msg = encodeURIComponent(
        `Hola Hortensia, quisiera reservar El Sanatorio: ${n} personas, ${tierLabel} ($${t.toLocaleString('es-CO')}/p). Total estimado $${total.toLocaleString('es-CO')} COP. ¿Para qué noche tenemos cupo?`
      );
      waBtn.href = `${WA_BASE}?text=${msg}`;
      // Route through Hortensia (WhatsApp) so she creates a real booking + UUID order_id
      // then sends back a working /pay/<uuid> link that maia-management's Wompi flow accepts.
      // Previously linked to /pay/estimator-{n}-{tier} which returned 400 because the
      // maia-management pay page validates orderId against UUID regex.
      const wompiMsg = encodeURIComponent(
        `Hola Hortensia, quiero pagar el depósito 50% ahora. Reserva: ${n} personas, ${tierLabel} ($${t.toLocaleString('es-CO')}/p). Total $${total.toLocaleString('es-CO')} COP, depósito $${deposit.toLocaleString('es-CO')} COP. ¿Me envías el link de Wompi para pagar ya?`
      );
      wompiBtn.href = `${WA_BASE}?text=${wompiMsg}`;
    }
    size.addEventListener('input', recalc);
    tier.addEventListener('change', recalc);
    recalc();
  }

  /* ------------------------------------------------------------------
     10. AVAILABILITY GRID (next 14 Thu-Sun nights)
     ------------------------------------------------------------------ */
  async function initAvailability() {
    const grid = document.querySelector('[data-availability]');
    if (!grid) return;
    const loadEl = grid.querySelector('.availability__loading');

    // Build next 14 valid nights (Thu/Fri/Sat/Sun), floored at LAUNCH so
    // pre-launch dates are never offered. Launch = Thu 2026-07-30.
    const LAUNCH = new Date('2026-07-30T00:00:00');
    const nights = [];
    const today = new Date(); today.setHours(0,0,0,0);
    const start = today > LAUNCH ? today : LAUNCH;
    for (let i = 0; i < 60 && nights.length < 12; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const dow = d.getDay(); // 0 Sun, 4 Thu, 5 Fri, 6 Sat
      if ([0, 4, 5, 6].includes(dow)) nights.push(d);
    }

    // try to fetch live availability (Supabase via Netlify Function) — graceful fallback
    let busy = new Set();
    try {
      const res = await fetch('/.netlify/functions/sanatorio-availability', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        (data.busy_dates || []).forEach((iso) => busy.add(iso));
      }
    } catch (_) { /* offline fallback OK */ }

    const dayLabels = { 0: 'Dom', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
    grid.querySelector('.availability__nights')?.remove();
    if (loadEl) loadEl.remove();

    const wrap = document.createElement('div');
    wrap.className = 'availability__nights';
    nights.forEach((d) => {
      const iso = d.toISOString().slice(0, 10);
      const isBusy = busy.has(iso);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'availability__night' + (isBusy ? ' is-busy' : '');
      btn.innerHTML = `<span class="availability__night-day">${dayLabels[d.getDay()]}</span><span class="availability__night-num">${d.getDate()}</span>`;
      btn.disabled = isBusy;
      btn.title = isBusy ? 'Cupo completo' : `Reservar ${fmtSpanishDate(d)}`;
      btn.addEventListener('click', () => {
        if (isBusy) return;
        const msg = encodeURIComponent(`Hola Hortensia, quiero reservar para el ${fmtSpanishDate(d)}. ¿Hay cupo?`);
        window.open(`${WA_BASE}?text=${msg}`, '_blank', 'noopener');
      });
      wrap.appendChild(btn);
    });
    grid.appendChild(wrap);
  }

  /* ------------------------------------------------------------------
     11. SET PROJECTION CLIP (Dr. Silvio hero loop, drop-in slot)
     ------------------------------------------------------------------ */
  function initProjector() {
    const projection = document.querySelector('.silvio-projection');
    if (!projection) return;
    const video = projection.querySelector('video');
    if (!video) return;
    // mark loaded only if at least one source resolves
    video.addEventListener('canplay', () => projection.classList.add('is-loaded'), { once: true });
    video.addEventListener('error', () => {
      // keep placeholder
      console.info('[Sanatorio] Dr. Silvio hero clip not yet commissioned — using Ektachrome placeholder.');
    });
  }

  /* ------------------------------------------------------------------
     12. KEYBOARD ACCESSIBILITY
     ------------------------------------------------------------------ */
  function initA11y() {
    // skip-to-main
    const skip = document.createElement('a');
    skip.href = '#asylum';
    skip.className = 'sr-only';
    skip.textContent = 'Saltar al contenido';
    skip.style.cssText = 'position:absolute;left:-9999px;top:0;color:#fff;background:#000;padding:8px;z-index:9999;';
    skip.addEventListener('focus', () => { skip.style.left = '10px'; });
    skip.addEventListener('blur', () => { skip.style.left = '-9999px'; });
    document.body.insertBefore(skip, document.body.firstChild);
  }

  /* ------------------------------------------------------------------
     BOOT
     ------------------------------------------------------------------ */
  function boot() {
    initA11y();
    initCuidadores();
    initFamilyPass();
    initFicha();
    initEstimator();
    initAvailability();
    initProjector();

    // visual layer — last, so DOM is stable
    initCursor();
    initGrain();
    initLenis();
    initScrollReveals();
    initSound();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
