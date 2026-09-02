// ── Трубы: вторая заставка на фоне главной ───────────────────────────────────
// Это ПОРТ настоящей заставки Isaiah Odhner (github.com/1j01/pipes, MIT) —
// той самой из Windows 95, на three.js. Не «по мотивам»: Pipe, шарниры,
// чайники, леденцы, растворение между клубками и числа вероятностей взяты из
// её screensaver.js как есть, и правки в них по-хорошему надо сверять с
// оригиналом. Происхождение, лицензии и что именно изменено —
// design/pipes/README.md.
//
// Выбирается в профиле («Оформление» → «Фон главной»), по умолчанию остаётся
// сфера. Грузится ОТДЕЛЬНЫМ ЧАНКОМ по требованию, как игры-пасхалки: three.js
// весит полмегабайта, и у тех, кто оставил сферу, его в загрузке нет вовсе.
//
// ЧТО ИЗМЕНЕНО ПРОТИВ ОРИГИНАЛА, и почему (подробности у мест):
//   • КАМЕРА. В оригинале она стоит и прыгает в случайную точку на каждом
//     новом клубке. Здесь едет вокруг сцены непрерывно и понемногу отъезжает
//     по ходу цикла — фон, на который смотрят весь день, не должен дёргаться;
//   • РАСТВОРЕНИЕ КРАСИТСЯ ТЕМОЙ, а не чёрным: на светлой теме экран заливало
//     бы чёрными квадратами;
//   • ЖИЗНЕННЫЙ ЦИКЛ. Заставка замирает на скрытой странице, в фоновой вкладке
//     и под открытой модалкой, а геометрия старого клубка освобождается — у
//     оригинала это вкладка со скринсейвером, а у нас страница, открытая весь
//     день;
//   • ОРГАНОВ УПРАВЛЕНИЯ НЕТ (кнопки полноэкранного режима, выбора шарниров,
//     мыши-камеры): это фон под строкой поиска, а не страница заставки.
//
// Фон пространства заставка не рисует вовсе: канвас прозрачный (alpha: true,
// как в оригинале), а под ним тот же --search-bg, что и под сферой. Поэтому
// смена темы меняет фон сама.

import * as THREE from 'three';
import { TeapotBufferGeometry } from './vendor/TeapotBufferGeometry.js';
import candycaneUrl from './assets/pipes/candycane.png';
import { varToRgb } from './cssColor.js';

// ── Ниже и до конца блока Pipe — код оригинала ───────────────────────────────
const gridBounds = new THREE.Box3(
    new THREE.Vector3(-10, -10, -10),
    new THREE.Vector3(10, 10, 10),
);

const JOINTS_ELBOW = 'elbow';
const JOINTS_BALL = 'ball';
const JOINTS_MIXED = 'mixed';

const random = (x1, x2) => Math.random() * (x2 - x1) + x1;
const randomInteger = (x1, x2) => Math.round(random(x1, x2));
const chance = (value) => Math.random() < value;
const chooseFrom = (values) => values[Math.floor(Math.random() * values.length)];

function shuffleArrayInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function randomIntegerVector3WithinBox(box) {
    return new THREE.Vector3(
        randomInteger(box.min.x, box.max.x),
        randomInteger(box.min.y, box.max.y),
        randomInteger(box.min.z, box.max.z),
    );
}

const textures = {};
// Оригинал грузит текстуру через THREE.ImageUtils.loadTexture, которого в 98-й
// версии three.js уже нет (его заменили на TextureLoader) — то есть леденцы у
// него роняют кадр, а не выпадают. Здесь загрузчик нынешний, и пасхалка
// работает.
function loadTexture(url) {
    if (!textures[url]) {
        const texture = new THREE.TextureLoader().load(url);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        textures[url] = texture;
    }
    return textures[url];
}

// Одна труба: ползёт по узлам сетки, оставляя за собой цилиндры и шарниры.
// Тела (цилиндр, шар, чайник, «эльбол») и вероятности — как в оригинале.
function Pipe(scene, grid, options) {
    const self = this;
    const pipeRadius = 0.2;
    const ballJointRadius = pipeRadius * 1.5;
    const teapotSize = ballJointRadius;

    self.currentPosition = randomIntegerVector3WithinBox(gridBounds);
    self.positions = [self.currentPosition];
    self.object3d = new THREE.Object3D();
    scene.add(self.object3d);

    if (options.texturePath) {
        self.material = new THREE.MeshLambertMaterial({ map: loadTexture(options.texturePath) });
    } else {
        const color = randomInteger(0, 0xffffff);
        const emissive = new THREE.Color(color).multiplyScalar(0.3);
        self.material = new THREE.MeshPhongMaterial({
            specular: 0xa9fcff,
            color,
            emissive,
            shininess: 100,
        });
    }

    // ── Слияние кусков (этого в оригинале нет) ───────────────────────────────
    // Труба растёт на шестьдесят клеток в секунду, и к концу цикла в сцене
    // несколько тысяч отдельных мешей — столько же вызовов отрисовки на КАЖДЫЙ
    // кадр. Оригиналу это сходит с рук: он занимает весь экран и живёт минуту.
    // У нас это фон рабочей страницы, открытой весь день, и на офисной
    // видеокарте столько вызовов кладёт кадр в пол.
    //
    // Поэтому свежие куски по-прежнему добавляются поодиночке (труба обязана
    // расти НА ГЛАЗАХ), а как только их накапливается BATCH, они сливаются в
    // один меш. Картинка от этого не меняется ни на пиксель: материал у трубы
    // один, а геометрия складывается со своими матрицами.
    const BATCH = 60;
    const loose = [];

    const addPiece = function (mesh) {
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        self.object3d.add(mesh);
        loose.push(mesh);
        if (loose.length >= BATCH) flush();
    };

    const flush = function () {
        if (loose.length < 2) return;
        const merged = new THREE.Geometry();
        for (const mesh of loose) {
            const g = mesh.geometry.isBufferGeometry
                ? new THREE.Geometry().fromBufferGeometry(mesh.geometry)
                : mesh.geometry;
            merged.merge(g, mesh.matrix);
            self.object3d.remove(mesh);
            if (g !== mesh.geometry) g.dispose();
            mesh.geometry.dispose();
        }
        loose.length = 0;
        const batch = new THREE.Mesh(new THREE.BufferGeometry().fromGeometry(merged), self.material);
        batch.matrixAutoUpdate = false;
        self.object3d.add(batch);
        merged.dispose();
    };

    const makeCylinderBetweenPoints = function (fromPoint, toPoint, material) {
        const deltaVector = new THREE.Vector3().subVectors(toPoint, fromPoint);
        const arrow = new THREE.ArrowHelper(deltaVector.clone().normalize(), fromPoint);
        const geometry = new THREE.CylinderGeometry(
            pipeRadius, pipeRadius, deltaVector.length(), 10, 4, true,
        );
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.setFromQuaternion(arrow.quaternion);
        mesh.position.addVectors(fromPoint, deltaVector.multiplyScalar(0.5));
        addPiece(mesh);
    };

    const makeBallJoint = function (position) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(ballJointRadius, 8, 8), self.material);
        ball.position.copy(position);
        addPiece(ball);
    };

    const makeTeapotJoint = function (position) {
        const teapot = new THREE.Mesh(
            new TeapotBufferGeometry(teapotSize, true, true, true, true, true),
            self.material,
        );
        teapot.position.copy(position);
        teapot.rotation.x = (Math.floor(random(0, 50)) * Math.PI) / 2;
        teapot.rotation.y = (Math.floor(random(0, 50)) * Math.PI) / 2;
        teapot.rotation.z = (Math.floor(random(0, 50)) * Math.PI) / 2;
        addPiece(teapot);
    };

    // «Эльбол», а не настоящее колено: у оригинала тут шарик поменьше шарового
    // шарнира — так угол выглядит скруглённым, а не срезанным. Настоящее
    // колено там в планах и закомментировано десятком строк.
    const makeElbowJoint = function (fromPosition) {
        const elball = new THREE.Mesh(new THREE.SphereGeometry(pipeRadius, 8, 8), self.material);
        elball.position.copy(fromPosition);
        addPiece(elball);
    };

    grid.setAt(self.currentPosition, self);
    makeBallJoint(self.currentPosition);

    self.update = function () {
        let lastDirectionVector = null;
        if (self.positions.length > 1) {
            const lastPosition = self.positions[self.positions.length - 2];
            lastDirectionVector = new THREE.Vector3().subVectors(self.currentPosition, lastPosition);
        }

        // ЕДИНСТВЕННАЯ правка в самом росте. Оригинал берёт ОДНО направление и,
        // если там занято или это край сетки, просто ничего не делает — труба
        // молча стоит до конца цикла (в его же TODO это записано как «ideally,
        // have a pool of the 6 possible directions»). Мы перебираем все шесть в
        // случайном порядке; прямо, как и у него, идём с вероятностью 1/2.
        const directions = [];
        if (chance(1 / 2) && lastDirectionVector) directions.push(lastDirectionVector);
        const pool = [];
        for (const axis of 'xyz') {
            for (const sign of [+1, -1]) {
                const v = new THREE.Vector3();
                v[axis] += sign;
                pool.push(v);
            }
        }
        shuffleArrayInPlace(pool);
        directions.push(...pool);

        for (const directionVector of directions) {
            const newPosition = new THREE.Vector3().addVectors(self.currentPosition, directionVector);
            if (!gridBounds.containsPoint(newPosition)) continue;
            if (grid.getAt(newPosition)) continue;
            grid.setAt(newPosition, self);

            // Шарнир — только на повороте (начальный шар ставится выше).
            if (lastDirectionVector && !lastDirectionVector.equals(directionVector)) {
                if (chance(options.teapotChance)) makeTeapotJoint(self.currentPosition);
                else if (chance(options.ballJointChance)) makeBallJoint(self.currentPosition);
                else makeElbowJoint(self.currentPosition);
            }

            makeCylinderBetweenPoints(self.currentPosition, newPosition, self.material);
            self.currentPosition = newPosition;
            self.positions.push(newPosition);
            return;
        }

        self.dead = true;  // тупик: со всех шести сторон занято
        flush();
    };

    // Клубок живёт минуты, страница — весь день: буферы и материалы старого
    // клубка надо отдавать видеокарте обратно. Оригинал этого не делает — ему
    // и не надо, у него вкладка с одной заставкой.
    self.dispose = function () {
        self.object3d.traverse((node) => { node.geometry?.dispose(); });
        self.material.dispose();
    };
}

// ── Камера ───────────────────────────────────────────────────────────────────
// Того, что ниже, в оригинале нет вовсе: там look() ставит камеру в случайную
// точку на расстоянии 14 и оставляет её там до следующего клубка. Здесь она
// едет вокруг сцены непрерывно (оборот примерно за три минуты), качается по
// высоте и по ходу цикла отъезжает: клубок растёт по шестьдесят клеток в
// секунду на трубу, и с четырнадцати он очень быстро перестаёт помещаться в
// кадр — камера оказывается внутри клубка, а не смотрит на него.
const YAW_SPEED = 2 * Math.PI / 190000;
const PITCH_MID = 0.18;
const PITCH_AMP = 0.26;
const PITCH_MS = 97000;                   // не кратно обороту — вид не повторяется
const DIST_NEAR = 15;                     // 14 у оригинала, чуть дальше — под отъезд
const DIST_FAR = 32;
const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const isTouchOnly = typeof matchMedia === 'function'
    && matchMedia('(hover: none) and (pointer: coarse)').matches;
const prefersReducedMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_DPR = isTouchOnly ? 1.5 : 2;

/**
 * @param {HTMLElement} stage — коробка с двумя канвасами (см. index.html)
 * @returns {{ setVisible: (v: boolean) => void }}
 */
export function startPipes(stage) {
    const canvasWebGL = stage.querySelector('#pipes-canvas, canvas:first-of-type');
    const canvas2d = stage.querySelector('#pipes-dissolve, canvas:last-of-type');
    const ctx2d = canvas2d.getContext('2d');

    const renderer = new THREE.WebGLRenderer({
        alpha: true,          // фон пространства — CSS под канвасом, как в оригинале
        antialias: true,
        canvas: canvasWebGL,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x111111));
    const directionalLightL = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLightL.position.set(-1.2, 1.5, 0.5);
    scene.add(directionalLightL);

    // Сетка занятых узлов — как в оригинале, объект со строковыми ключами.
    const nodes = new Map();
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const grid = {
        setAt: (p, v) => nodes.set(key(p), v),
        getAt: (p) => nodes.get(key(p)),
        clear: () => nodes.clear(),
    };

    const options = {
        multiple: true,
        texturePath: null,
        joints: JOINTS_MIXED,
        interval: [16, 24],   // секунды между растворениями, как в оригинале
    };

    let pipes = [];      // весь клубок: его освобождать на растворении
    let growing = [];    // те, что ещё ползут
    let visible = true;
    let running = false;
    let rafId = 0;
    let prevTime = 0;

    // Растворение: экран покрывается квадратиками цвета фона, и под ними
    // клубок меняется на новый. ЦВЕТ БЕРЁТСЯ ИЗ ТЕМЫ (--search-bg), а не чёрный
    // как в оригинале: на светлой теме чёрные квадраты выглядели бы поломкой.
    let dissolveColor = 'rgb(7,9,13)';
    const readTheme = () => {
        const c = varToRgb('--search-bg', { r: 7, g: 9, b: 13 });
        dissolveColor = `rgb(${c.r},${c.g},${c.b})`;
    };
    readTheme();

    let dissolveRects = [];
    let dissolveRectsIndex = -1;
    let dissolveRectsPerRow = 50;
    let dissolveRectsPerColumn = 50;
    let dissolveTransitionFrames = 120;
    let dissolveEndCallback = null;

    const cssSize = () => ({ w: stage.offsetWidth, h: stage.offsetHeight });

    function dissolve(seconds, endCallback) {
        const { w, h } = cssSize();
        dissolveRectsPerRow = Math.max(1, Math.ceil(w / 20));
        dissolveRectsPerColumn = Math.max(1, Math.ceil(h / 20));
        dissolveRects = new Array(dissolveRectsPerRow * dissolveRectsPerColumn)
            .fill(null)
            .map((_null, index) => ({
                x: index % dissolveRectsPerRow,
                y: Math.floor(index / dissolveRectsPerRow),
            }));
        shuffleArrayInPlace(dissolveRects);
        dissolveRectsIndex = 0;
        dissolveTransitionFrames = seconds * 60;
        dissolveEndCallback = endCallback;
    }

    function fillRect(rect) {
        const { w, h } = cssSize();
        const rectWidth = w / dissolveRectsPerRow;
        const rectHeight = h / dissolveRectsPerColumn;
        ctx2d.fillStyle = dissolveColor;
        ctx2d.fillRect(
            Math.floor(rect.x * rectWidth),
            Math.floor(rect.y * rectHeight),
            Math.ceil(rectWidth),
            Math.ceil(rectHeight),
        );
    }

    function finishDissolve() {
        dissolveEndCallback();
        dissolveRects = [];
        dissolveRectsIndex = -1;
        ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
    }

    let clearing = false;
    // Возраст клубка. У оригинала это setTimeout, здесь — накопитель прямо в
    // кадре: заставка замирает, когда на неё не смотрят, а таймер тикал бы и
    // на скрытой странице — вернулся человек, а клубок как раз растворился.
    // От него же считается отъезд камеры, поэтому число нужно всё равно.
    let cycleAge = 0;
    let cycleMs = random(options.interval[0], options.interval[1]) * 1000;

    function startClear() {
        if (clearing) return;
        clearing = true;
        dissolve(2, reset);
    }

    function reset() {
        for (const pipe of pipes) {
            scene.remove(pipe.object3d);
            pipe.dispose();
        }
        pipes = [];
        growing = [];
        grid.clear();
        clearing = false;
        cycleAge = 0;
        cycleMs = random(options.interval[0], options.interval[1]) * 1000;
    }

    // Камера. Угол объезда копится сам по себе, а расстояние — от возраста
    // клубка: он обнуляется на каждом растворении, и камера возвращается к
    // сцене ровно тогда, когда смотреть на ней уже не на что.
    let yaw = random(0, Math.PI * 2);
    let clock = 0;
    function placeCamera(dt) {
        clock += dt;
        yaw += dt * YAW_SPEED;
        const pitch = PITCH_MID + Math.sin((clock / PITCH_MS) * Math.PI * 2) * PITCH_AMP;
        // «Меньше движения» в системе: камера встаёт на середину отъезда, но
        // трубы продолжают расти — без роста от заставки не остаётся ничего.
        const t = prefersReducedMotion ? 0.5 : smoothstep(clamp01(cycleAge / cycleMs));
        const dist = DIST_NEAR + (DIST_FAR - DIST_NEAR) * t;
        camera.position.set(
            dist * Math.cos(pitch) * Math.sin(yaw),
            dist * Math.sin(pitch),
            dist * Math.cos(pitch) * Math.cos(yaw),
        );
        camera.lookAt(scene.position);
    }

    // Размеры канвасов держим по вёрстке, а не по window.innerWidth: заставка
    // живёт в куске страницы, а не во весь экран.
    function syncSize() {
        const { w, h } = cssSize();
        if (!w || !h) return false;
        if (canvas2d.width !== w || canvas2d.height !== h) {
            canvas2d.width = w;
            canvas2d.height = h;
            // Растворение переживает ресайз: уже закрытые квадраты
            // перерисовываем в новом размере (у оригинала так же).
            for (let i = 0; i < dissolveRectsIndex; i++) fillRect(dissolveRects[i]);
        }
        if (canvasWebGL.width !== Math.round(w * renderer.getPixelRatio())
            || canvasWebGL.height !== Math.round(h * renderer.getPixelRatio())) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        return true;
    }

    // Цикл: та же механика, что у сферы (sphere.js), и по тем же причинам —
    // там она расписана подробно. Заставка замирает на скрытой странице, в
    // фоновой вкладке и под открытой модалкой; будят её visibilitychange,
    // ResizeObserver и наблюдатель за классом modal-open. Для WebGL это важнее,
    // чем для сферы: тут на каждый кадр уезжает несколько тысяч отрисовок.
    const animate = (time) => {
        const paused = document.body.classList.contains('modal-open');
        if (!visible || document.hidden || paused || !stage.offsetWidth) {
            running = false;
            prevTime = 0;
            return;
        }
        rafId = requestAnimationFrame(animate);
        if (!syncSize()) return;

        const dt = prevTime ? Math.min(time - prevTime, 100) : 16;
        prevTime = time;
        placeCamera(prefersReducedMotion ? 0 : dt);

        if (!clearing) {
            cycleAge += dt;
            if (cycleAge >= cycleMs) startClear();
        }

        for (const pipe of growing) pipe.update();
        // Труба, у которой заняты все шесть сторон, из растущих выбывает — но
        // из сцены не девается: то, что она построила, остаётся до конца
        // цикла. Оригинал такую трубу просто оставляет дёргаться вхолостую.
        growing = growing.filter(p => !p.dead);

        if (growing.length === 0) {
            const jointType = options.joints;
            const pipeOptions = {
                teapotChance: 1 / 200,   // 1 / 1000 в самой Windows, 1/200 у оригинала порта
                ballJointChance: jointType === JOINTS_BALL ? 1 : jointType === JOINTS_MIXED ? 1 / 3 : 0,
                texturePath: options.texturePath,
            };
            if (chance(1 / 20)) {
                pipeOptions.teapotChance = 1 / 20;
                pipeOptions.texturePath = candycaneUrl;
            }
            for (let i = 0; i < 1 + options.multiple * (1 + chance(1 / 10)); i++) {
                const pipe = new Pipe(scene, grid, pipeOptions);
                pipes.push(pipe);
                growing.push(pipe);
            }
        }

        if (!clearing) renderer.render(scene, camera);

        if (dissolveRectsIndex > -1) {
            const rectsAtATime = Math.max(1, Math.floor(dissolveRects.length / dissolveTransitionFrames));
            for (let i = 0; i < rectsAtATime && dissolveRectsIndex < dissolveRects.length; i++) {
                fillRect(dissolveRects[dissolveRectsIndex]);
                dissolveRectsIndex += 1;
            }
            if (dissolveRectsIndex === dissolveRects.length) finishDissolve();
        }
    };

    const kick = () => {
        cancelAnimationFrame(rafId);
        prevTime = 0;
        running = true;
        rafId = requestAnimationFrame(animate);
    };

    kick();

    document.addEventListener('themechange', () => { readTheme(); if (!running) kick(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    window.addEventListener('pageshow', kick);
    if (typeof MutationObserver === 'function') {
        new MutationObserver(() => {
            if (!running && !document.body.classList.contains('modal-open')) kick();
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => { if (!running && stage.offsetWidth) kick(); }).observe(stage);
    }
    // Контекст WebGL браузер отбирает у долгоживущих вкладок (нехватка памяти,
    // сброс драйвера). Без preventDefault он не станет его восстанавливать, и
    // на месте заставки останется пустой прямоугольник навсегда.
    canvasWebGL.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        running = false;
        cancelAnimationFrame(rafId);
    });
    canvasWebGL.addEventListener('webglcontextrestored', () => { reset(); kick(); });

    return {
        setVisible(v) {
            visible = v;
            if (v && !running) kick();
        },
    };
}
