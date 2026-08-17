// ─────────────────────────────────────────────────────────────────────────────
// Распределяющая шляпа: окно теста и карточка факультета в профиле.
//
// Тест проходят ОДИН раз в жизни аккаунта, поэтому окно устроено под одно
// требование: его можно закрыть в любой момент и вернуться туда же. Каждый
// ответ уезжает на сервер СРАЗУ (POST /api/faculty/answer), состояние берётся
// оттуда же при каждом открытии, и «продолжить» — это не восстановление из
// localStorage, а просто следующий неотвеченный вопрос. Свернул вкладку,
// разрядился телефон, пересел за другой компьютер — тест ждёт на том же месте.
//
// Никаких подсказок по ходу: ни счётчика факультетов, ни намёков в вариантах.
// Что получится, не знает и сам клиент — вопросы приходят без весов, считает
// сервер (см. backend/src/faculty/quiz.js). До последнего экрана в окне просто
// нечего подглядеть.
//
// Кнопки «пройти заново» нет и не будет. Она превратила бы факультет в
// настройку профиля, которую крутят, пока не выпадет любимая.
// ─────────────────────────────────────────────────────────────────────────────

import crestGryffindor from './assets/faculty-gryffindor.png';
import crestSlytherin from './assets/faculty-slytherin.png';
import crestRavenclaw from './assets/faculty-ravenclaw.png';
import crestHufflepuff from './assets/faculty-hufflepuff.png';

const MODAL_ID = 'faculty-modal';

// Гербы — картинки, по одной на дом. Лежат квадратами 224×224 с прозрачным
// полем (исходники и пересборка — design/faculty-crests/README.md), поэтому в
// вёрстке у всех четырёх один и тот же размер и заголовок карточки не прыгает
// вбок при смене факультета.
const CRESTS = {
    gryffindor: crestGryffindor,
    slytherin: crestSlytherin,
    ravenclaw: crestRavenclaw,
    hufflepuff: crestHufflepuff,
};

function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Неизвестный дом (переименовали id в коде, а у человека записан старый) — без
// герба, но с карточкой: текст важнее картинки, и ломаться из-за неё нечему.
function crestHtml(faculty) {
    const src = CRESTS[faculty.id];
    if (!src) return '';
    return `<img class="faculty-crest" src="${esc(src)}" alt="" width="224" height="224"/>`;
}

/** Карточка факультета — то, что человек видит в профиле после распределения. */
export function facultyCardHtml(faculty, { own = false } = {}) {
    if (!faculty) return '';
    const qualities = (faculty.qualities || [])
        .map(q => `<span class="faculty-quality">${esc(q)}</span>`).join('');
    const strengths = (faculty.strengths || [])
        .map(s => `<li>${esc(s)}</li>`).join('');

    return `
        <div class="faculty-card faculty-${esc(faculty.id)}">
            <div class="faculty-card-head">
                ${crestHtml(faculty)}
                <div class="faculty-card-title">
                    <div class="faculty-name">${esc(faculty.name)}</div>
                    <div class="faculty-tagline">${esc(faculty.tagline || '')}</div>
                </div>
            </div>
            <div class="faculty-qualities">${qualities}</div>
            <p class="faculty-about">${esc(faculty.about || '')}</p>
            ${strengths ? `<ul class="faculty-strengths">${strengths}</ul>` : ''}
            ${faculty.watch ? `<div class="faculty-watch"><b>За чем следить.</b> ${esc(faculty.watch)}</div>` : ''}
            <div class="faculty-card-foot">
                ${esc(faculty.symbol || '')}${faculty.colors ? ` · ${esc(faculty.colors)}` : ''}${
                    faculty.founder ? ` · основатель — ${esc(faculty.founder)}` : ''}
            </div>
            ${own ? '<div class="faculty-card-note">Факультет закреплён навсегда — пройти распределение можно один раз.</div>' : ''}
        </div>`;
}

/**
 * Тело секции «Факультет» в СВОЁМ профиле: результат, продолжение или
 * приглашение. state — ответ GET /api/faculty/state.
 */
export function facultySectionHtml(state) {
    if (!state) {
        return '<div class="search-empty">Не удалось загрузить распределение</div>';
    }
    if (state.status === 'done') {
        return facultyCardHtml(state.faculty, { own: true });
    }
    const started = state.status === 'in_progress';
    const left = (state.total || 0) - (state.answered || 0);
    return `
        <div class="faculty-invite">
            <p class="faculty-invite-text">${started
                ? `Распределение начато: отвечено ${state.answered} из ${state.total}. Можно продолжить с того же места.`
                : 'Распределяющая шляпа задаст несколько десятков вопросов — про тебя, а не про работу. Отвечать честно выгоднее, чем «правильно»: угадать, к чему ведёт вариант, всё равно нельзя.'}</p>
            ${started ? '' : '<p class="faculty-invite-warn">Пройти можно <b>один раз</b>. Факультет останется с аккаунтом навсегда.</p>'}
            <button class="btn btn-pri faculty-start" id="btn-faculty-start">${
                started ? `Продолжить (осталось ${left})` : 'Пройти распределение'}</button>
            <div class="faculty-invite-hint">Прервали? Закрывай окно смело — ответы сохраняются по одному, вернёшься на тот же вопрос.</div>
        </div>`;
}

// ── Окно теста ───────────────────────────────────────────────────────────────

/**
 * Открывает окно и ведёт человека по вопросам.
 * onFinished(faculty) — вызывается после того, как факультет выдан, чтобы
 * профиль перерисовался вместе с подложкой и плашкой у ника.
 */
export function openFacultyTest({ apiFetch, state, onFinished }) {
    document.getElementById(MODAL_ID)?.remove();

    const questions = state.questions || [];
    const sections = new Map((state.sections || []).map(s => [s.id, s]));
    const answers = { ...(state.answers || {}) };

    // Начинаем с первого НЕотвеченного: это и есть «продолжить с места, на
    // котором остановились». Если отвечено всё (закрыли окно перед самой
    // кнопкой «Готово») — показываем последний вопрос, с него доступен финиш.
    let index = questions.findIndex(q => answers[q.id] === undefined);
    if (index < 0) index = Math.max(0, questions.length - 1);

    // Незавершённая расстановка живёт только на экране: отправлять на сервер
    // половину порядка нельзя — это не ответ.
    let ordering = [];

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal faculty-modal';
    modal.innerHTML = `
        <div class="modal-backdrop"></div>
        <div class="modal-win faculty-win">
            <div class="modal-head">
                <span id="faculty-head">Распределение</span>
                <button class="btn btn-sec" id="faculty-close" title="Закрыть — ответы сохранены">✕</button>
            </div>
            <div class="modal-body" id="faculty-body"></div>
        </div>`;
    document.body.appendChild(modal);

    const body = modal.querySelector('#faculty-body');
    const head = modal.querySelector('#faculty-head');
    const close = () => modal.remove();
    modal.querySelector('#faculty-close').onclick = close;
    // По клику на фон окно НЕ закрываем: промах мимо варианта не должен
    // выглядеть как «тест закрылся сам». Для выхода есть крестик.

    render();

    function answeredCount() {
        return questions.filter(q => answers[q.id] !== undefined).length;
    }

    function render() {
        const q = questions[index];
        const section = sections.get(q.section);
        const done = answeredCount();
        const pct = Math.round((done / questions.length) * 100);

        head.textContent = section ? section.title : 'Распределение';

        body.innerHTML = `
            <div class="faculty-progress">
                <div class="faculty-progress-bar"><span style="width:${pct}%"></span></div>
                <div class="faculty-progress-text">Вопрос ${index + 1} из ${questions.length}</div>
            </div>
            ${section ? `<div class="faculty-hint">${esc(section.hint)}</div>` : ''}
            <div class="faculty-q">${esc(q.text)}</div>
            <div class="faculty-answers" id="faculty-answers">${answersHtml(q)}</div>
            <div class="faculty-error hidden" id="faculty-error"></div>
            <div class="faculty-nav">
                <button class="btn btn-sec" id="faculty-prev" ${index === 0 ? 'disabled' : ''}>Назад</button>
                <span class="faculty-saved">Ответы сохраняются сразу</span>
                ${nextButtonHtml(q, done)}
            </div>`;

        bind(q);
    }

    function nextButtonHtml(q, done) {
        // «Готово» появляется только когда отвечено всё: на полпути кнопка
        // финиша обманывала бы — тест нельзя досдать наполовину.
        if (done === questions.length) {
            return '<button class="btn btn-pri" id="faculty-finish">Готово</button>';
        }
        const answered = answers[q.id] !== undefined;
        return `<button class="btn btn-sec" id="faculty-next" ${answered ? '' : 'disabled'}>Дальше</button>`;
    }

    function answersHtml(q) {
        if (q.type === 'scale') {
            return `<div class="faculty-scale">${q.labels.map((label, i) => `
                <button class="faculty-scale-btn${answers[q.id] === i ? ' picked' : ''}" data-value="${i}">
                    <span class="faculty-scale-dot"></span>${esc(label)}
                </button>`).join('')}</div>`;
        }
        if (q.type === 'order') {
            const saved = Array.isArray(answers[q.id]) ? answers[q.id] : null;
            const current = ordering.length ? ordering : (saved || []);
            return `<div class="faculty-order">
                ${q.items.map(item => {
                    const pos = current.indexOf(item.id);
                    return `<button class="faculty-order-item${pos >= 0 ? ' picked' : ''}" data-id="${esc(item.id)}">
                        <span class="faculty-order-num">${pos >= 0 ? pos + 1 : ''}</span>${esc(item.text)}
                    </button>`;
                }).join('')}
                <button class="btn btn-sec faculty-order-reset" id="faculty-order-reset">Расставить заново</button>
                <div class="faculty-order-hint">Нажимай по порядку: первое нажатие — самое важное.</div>
            </div>`;
        }
        return `<div class="faculty-options${q.type === 'pair' ? ' faculty-options-pair' : ''}">
            ${q.options.map(o => `
                <button class="faculty-option${answers[q.id] === o.id ? ' picked' : ''}" data-id="${esc(o.id)}">${esc(o.text)}</button>
            `).join('')}
        </div>`;
    }

    function showError(text) {
        const box = modal.querySelector('#faculty-error');
        if (!box) return;
        box.textContent = text;
        box.classList.remove('hidden');
    }

    // Ответ уходит на сервер сразу же. Пока он летит, кнопки заблокированы: без
    // этого двойной тап по варианту на телефоне отправлял бы два запроса и
    // перескакивал через вопрос.
    async function saveAndAdvance(q, value) {
        const buttons = body.querySelectorAll('button');
        buttons.forEach(b => { b.disabled = true; });
        try {
            await apiFetch('/api/faculty/answer', { method: 'POST', body: { id: q.id, value } });
        } catch (err) {
            buttons.forEach(b => { b.disabled = false; });
            showError(`Не удалось сохранить ответ: ${err.message}. Попробуй ещё раз.`);
            return;
        }
        answers[q.id] = value;
        ordering = [];
        // Дальше сам — но только вперёд по неотвеченным: если человек вернулся
        // назад и поменял ответ, он остаётся на месте и решает сам, куда идти.
        if (index < questions.length - 1 && answeredCount() < questions.length) index++;
        render();
    }

    function bind(q) {
        const prev = modal.querySelector('#faculty-prev');
        if (prev) prev.onclick = () => { if (index > 0) { index--; ordering = []; render(); } };

        const next = modal.querySelector('#faculty-next');
        if (next) next.onclick = () => {
            if (index < questions.length - 1) { index++; ordering = []; render(); }
        };

        const finish = modal.querySelector('#faculty-finish');
        if (finish) finish.onclick = () => doFinish(finish);

        if (q.type === 'scale') {
            body.querySelectorAll('.faculty-scale-btn').forEach(btn => {
                btn.onclick = () => saveAndAdvance(q, Number(btn.dataset.value));
            });
            return;
        }
        if (q.type === 'order') {
            body.querySelectorAll('.faculty-order-item').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.dataset.id;
                    if (ordering.includes(id)) return;
                    ordering.push(id);
                    if (ordering.length === q.items.length) saveAndAdvance(q, ordering.slice());
                    else render();
                };
            });
            const reset = modal.querySelector('#faculty-order-reset');
            if (reset) reset.onclick = () => { ordering = []; render(); };
            return;
        }
        body.querySelectorAll('.faculty-option').forEach(btn => {
            btn.onclick = () => saveAndAdvance(q, btn.dataset.id);
        });
    }

    async function doFinish(button) {
        button.disabled = true;
        button.textContent = 'Шляпа думает…';
        let result;
        try {
            result = await apiFetch('/api/faculty/finish', { method: 'POST', body: {} });
        } catch (err) {
            button.disabled = false;
            button.textContent = 'Готово';
            showError(err.message);
            return;
        }
        reveal(result.faculty);
    }

    // Пауза перед ответом — единственная «анимация» во всём тесте, и она тут не
    // для красоты: без неё факультет появляется в тот же миг, что и нажатие, и
    // выглядит как заранее заготовленный, а не как итог получаса ответов.
    function reveal(faculty) {
        head.textContent = 'Распределение';
        body.innerHTML = `
            <div class="faculty-reveal">
                <div class="faculty-thinking">Шляпа думает…</div>
            </div>`;
        setTimeout(() => {
            body.innerHTML = `
                <div class="faculty-reveal faculty-reveal-done">
                    ${facultyCardHtml(faculty, { own: true })}
                    <button class="btn btn-pri" id="faculty-ok">Понятно</button>
                </div>`;
            modal.querySelector('#faculty-ok').onclick = () => {
                close();
                onFinished?.(faculty);
            };
        }, 1600);
    }
}
